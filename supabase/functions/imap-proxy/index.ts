import { ImapClient, hasAttachments as imapHasAttachments } from "deno-imap";
import PostalMime from "postal-mime";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Address = { name: string; email: string };

type SearchCacheRow = {
  account_key: string;
  account_email: string;
  imap_host: string;
  folder_id: string;
  uid: number;
  subject: string;
  snippet: string;
  from_name: string;
  from_email: string;
  to_addresses: Address[];
  cc_addresses: Address[];
  attachment_names: string[];
  has_attachments: boolean;
  flags: string[];
  message_id: string;
  in_reply_to: string;
  sent_at: string;
  body_text?: string;
  updated_at?: string;
};

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function makeAccountKey(host: string, username: string) {
  return `${host.trim().toLowerCase()}::${username.trim().toLowerCase()}`;
}

function normalizeAddress(address: any): Address {
  if (!address) return { name: "", email: "" };
  const mailbox = address.mailbox || "";
  const host = address.host || "";
  return {
    name: address.name || mailbox || "",
    email: mailbox && host ? `${mailbox}@${host}` : (address.email || ""),
  };
}

function normalizeSearchTerm(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hasNonAscii(value: string) {
  return /[^\u0000-\u007f]/.test(value);
}

function decodeMimeWords(value: string) {
  if (!value) return "";
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === "B") {
        const binary = atob(text);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      }

      const decoded = text
        .replace(/_/g, " ")
        .replace(/=([0-9A-Fa-f]{2})/g, (_hexMatch: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return text;
    }
  });
}

function extractAttachmentNames(bodyStructure: any): string[] {
  if (!bodyStructure) return [];
  const names = new Set<string>();
  const walk = (node: any) => {
    if (!node) return;
    const rawDisp = node.disposition || node.contentDisposition || "";
    const disposition = (typeof rawDisp === "string" ? rawDisp : rawDisp?.type || "").toString().toLowerCase();
    const nodeType = node.type || node.mediaType || "";
    const nodeSubtype = node.subtype || node.mediaSubtype || "";
    const mimeType = `${nodeType}/${nodeSubtype}`.toLowerCase();
    const filename = node.dispositionParameters?.filename
      || node.parameters?.name
      || node.contentDispositionParameters?.filename
      || node.attrs?.name
      || (typeof rawDisp === "object" && rawDisp?.params?.filename)
      || "";
    const isTextBody = ["text/plain", "text/html"].includes(mimeType);
    const isMultipart = mimeType.startsWith("multipart/") || mimeType.startsWith("message/");
    const isAttachment = disposition === "attachment"
      || (disposition === "inline" && node.id && mimeType.startsWith("image/"))
      || (filename && !isTextBody)
      || (!isTextBody && !isMultipart && mimeType !== "/" && nodeType !== "" && disposition !== "" && disposition !== "inline");

    if (isAttachment && filename) names.add(filename);
    const children = node.childNodes || node.parts || node.body;
    if (Array.isArray(children)) children.forEach(walk);
  };
  walk(bodyStructure);
  return [...names];
}

/** Walk MIME bodyStructure tree and return the IMAP part path (e.g. "1.2") for the first text/html node */
function findHtmlPartPath(node: any, path = ""): string | null {
  if (!node) return null;
  const type = (node.type || node.mediaType || "").toLowerCase();
  const subtype = (node.subtype || node.mediaSubtype || "").toLowerCase();

  if (type === "text" && subtype === "html") {
    // prefer node.part if the library provides it, otherwise use computed path
    return node.part || path || "1";
  }

  const children = node.childNodes || node.parts || [];
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const childPath = path ? `${path}.${i + 1}` : `${i + 1}`;
      const result = findHtmlPartPath(children[i], childPath);
      if (result) return result;
    }
  }

  return null;
}

/** Decode quoted-printable encoded string */
function decodeQuotedPrintable(input: string, charset = "utf-8"): string {
  // Remove soft line breaks
  const unfolded = input.replace(/=\r?\n/g, "");
  // Decode =XX hex sequences
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i++) {
    if (unfolded[i] === "=" && i + 2 < unfolded.length) {
      const hex = unfolded.substring(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(unfolded.charCodeAt(i));
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
}

function scoreTextReadability(value: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const letters = (value.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
  const replacement = (value.match(/�/g) || []).length;
  const control = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  return letters * 2 - replacement * 8 - control * 4 + Math.min(value.length / 200, 20);
}

function decodeBytesWithCharsetGuess(bytes: Uint8Array) {
  const charsets = ["utf-8", "windows-1251", "koi8-r", "iso-8859-5"];
  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const charset of charsets) {
    try {
      const decoded = new TextDecoder(charset).decode(bytes);
      const score = scoreTextReadability(decoded);
      if (score > bestScore) {
        bestScore = score;
        best = decoded;
      }
    } catch {
      // ignore charset decode failures
    }
  }

  return best;
}

function maybeDecodeQuotedPrintable(value: string) {
  if (!value) return value;
  const looksQP = /=[0-9A-Fa-f]{2}|=\r?\n/.test(value);
  if (!looksQP) return value;

  const candidates = [
    value,
    decodeQuotedPrintable(value, "utf-8"),
    decodeQuotedPrintable(value, "windows-1251"),
    decodeQuotedPrintable(value, "koi8-r"),
    decodeQuotedPrintable(value, "iso-8859-5"),
  ];

  let best = value;
  let bestScore = scoreTextReadability(value);

  for (const candidate of candidates) {
    const score = scoreTextReadability(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function stripHtmlForSearch(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function cleanBodyText(value: string) {
  return value
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildCacheRow(
  accountKey: string,
  host: string,
  username: string,
  folder: string,
  msg: any,
  bodyText?: string,
): SearchCacheRow | null {
  if (!Number.isFinite(Number(msg?.uid))) return null;
  const env = msg.envelope || {};
  let hasAttachments = false;
  try {
    hasAttachments = msg.bodyStructure ? imapHasAttachments(msg.bodyStructure) : false;
  } catch {
    hasAttachments = false;
  }
  const attachmentNames = extractAttachmentNames(msg.bodyStructure);
  const normalizedBodyText = typeof bodyText === "string" ? cleanBodyText(bodyText) : "";

  return {
    account_key: accountKey,
    account_email: username.trim().toLowerCase(),
    imap_host: host.trim().toLowerCase(),
    folder_id: folder,
    uid: Number(msg.uid),
    subject: decodeMimeWords(env.subject || "(No Subject)"),
    snippet: decodeMimeWords(msg.snippet || env.subject || ""),
    from_name: decodeMimeWords(normalizeAddress(env.from?.[0]).name),
    from_email: normalizeAddress(env.from?.[0]).email,
    to_addresses: (env.to || []).map((address: any) => {
      const normalized = normalizeAddress(address);
      return { ...normalized, name: decodeMimeWords(normalized.name) };
    }),
    cc_addresses: (env.cc || []).map((address: any) => {
      const normalized = normalizeAddress(address);
      return { ...normalized, name: decodeMimeWords(normalized.name) };
    }),
    attachment_names: attachmentNames,
    has_attachments: hasAttachments || attachmentNames.length > 0,
    flags: msg.flags || [],
    message_id: env.messageId || "",
    in_reply_to: env.inReplyTo || "",
    sent_at: env.date || new Date().toISOString(),
    ...(normalizedBodyText ? { body_text: normalizedBodyText } : {}),
  };
}

function searchEmailFromEnvelope(msg: any, term: string) {
  const env = msg.envelope || {};
  const from = normalizeAddress(env.from?.[0]);
  const to = (env.to || []).map(normalizeAddress);
  const cc = (env.cc || []).map(normalizeAddress);
  const attachmentNames = extractAttachmentNames(msg.bodyStructure);
  const haystack = normalizeSearchTerm([
    decodeMimeWords(env.subject || ""),
    decodeMimeWords(from.name),
    from.email,
    ...to.flatMap((item) => [decodeMimeWords(item.name), item.email]),
    ...cc.flatMap((item) => [decodeMimeWords(item.name), item.email]),
    ...attachmentNames,
  ].join(" "));

  return haystack.includes(term);
}

function toSearchableBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value && typeof value === "object" && (value as { buffer?: unknown }).buffer instanceof ArrayBuffer) {
    const offset = typeof (value as { byteOffset?: unknown }).byteOffset === "number"
      ? (value as { byteOffset: number }).byteOffset
      : 0;
    const length = typeof (value as { byteLength?: unknown }).byteLength === "number"
      ? (value as { byteLength: number }).byteLength
      : undefined;
    return new Uint8Array((value as { buffer: ArrayBuffer }).buffer, offset, length);
  }
  return null;
}

function extractInlineBodyCandidates(msg: any): Array<{ bytes: Uint8Array; source: string }> {
  const candidates: Array<{ bytes: Uint8Array; source: string }> = [];
  const pushCandidate = (value: unknown, source: string) => {
    const bytes = toSearchableBytes(value);
    if (bytes && bytes.length > 0) {
      candidates.push({ bytes, source });
    }
  };

  pushCandidate(msg?.raw, "msg.raw");
  pushCandidate(msg?.source, "msg.source");
  pushCandidate(msg?.["body[]"], "msg.body[]");

  if (msg?.bodyParts instanceof Map) {
    for (const [partKey, partValue] of msg.bodyParts.entries()) {
      pushCandidate(partValue, `msg.bodyParts.${String(partKey || "root")}`);
    }
  }

  if (msg?.body instanceof Map) {
    for (const [partKey, partValue] of msg.body.entries()) {
      pushCandidate(partValue, `msg.body.${String(partKey || "root")}`);
    }
  }

  if (Array.isArray(msg?.parts)) {
    msg.parts.forEach((part: any, index: number) => {
      pushCandidate(part?.body, `msg.parts.${index}.body`);
    });
  }

  return candidates;
}

async function extractSearchableBody(msg: any) {
  const byteCandidates = extractInlineBodyCandidates(msg);
  if (byteCandidates.length === 0) {
    return { normalizedText: "", plainText: "", source: "missing-raw" };
  }

  const textParts: string[] = [];
  let source = byteCandidates[0]?.source || "unknown";

  for (const candidate of byteCandidates) {
    const bytes = candidate.bytes;
    if (!bytes || bytes.length === 0) continue;

    source = candidate.source;

    try {
      const parsed = await PostalMime.parse(bytes);
      const parsedText = typeof parsed.text === "string" ? maybeDecodeQuotedPrintable(parsed.text) : "";
      const parsedHtml = typeof parsed.html === "string"
        ? maybeDecodeQuotedPrintable(stripHtmlForSearch(parsed.html))
        : "";

      if (parsedText) textParts.push(parsedText);
      if (parsedHtml) textParts.push(parsedHtml);
      if (textParts.length > 0) break;
    } catch {
      // Try raw decoding below for body part payloads and malformed sources.
    }

    const decodedRaw = decodeBytesWithCharsetGuess(bytes);
    if (decodedRaw) {
      const mimeBody = decodedRaw.replace(/^[\s\S]*?\r?\n\r?\n/, " ");
      const qpDecoded = maybeDecodeQuotedPrintable(mimeBody);
      const stripped = stripHtmlForSearch(qpDecoded);
      if (stripped.trim()) {
        textParts.push(stripped);
        source = `${candidate.source}-raw-decode-fallback`;
        break;
      }
    }
  }

  const plainText = cleanBodyText(textParts.join(" "));
  const normalizedText = normalizeSearchTerm(plainText);

  return {
    normalizedText,
    plainText,
    source: plainText ? source : "empty-raw",
  };
}

async function searchMessageContent(msg: any, term: string) {
  if (searchEmailFromEnvelope(msg, term)) {
    return {
      matched: true,
      bodyText: "",
      normalizedBody: "",
      source: "envelope",
    };
  }

  const extracted = await extractSearchableBody(msg);
  return {
    matched: extracted.normalizedText.includes(term),
    bodyText: extracted.plainText,
    normalizedBody: extracted.normalizedText,
    source: extracted.source,
  };
}

function mapFetchedSearchEmail(msg: any) {
  const env = msg.envelope || {};
  const attachments = extractAttachmentNames(msg.bodyStructure).map((name) => ({
    name: name || "unnamed",
    size: 0,
    type: "application/octet-stream",
  }));

  return {
    uid: msg.uid,
    flags: msg.flags || [],
    size: msg.size || 0,
    subject: env.subject || "(No Subject)",
    from: env.from?.[0]
      ? { name: env.from[0].name || env.from[0].mailbox, email: `${env.from[0].mailbox}@${env.from[0].host}` }
      : { name: "Unknown", email: "" },
    to: (env.to || []).map((a: any) => ({ name: a.name || a.mailbox, email: `${a.mailbox}@${a.host}` })),
    cc: (env.cc || []).map((a: any) => ({ name: a.name || a.mailbox, email: `${a.mailbox}@${a.host}` })),
    date: env.date || new Date().toISOString(),
    messageId: env.messageId || "",
    inReplyTo: env.inReplyTo || "",
    attachments,
  };
}

function cacheRowToEmail(row: SearchCacheRow) {
  return {
    uid: row.uid,
    flags: row.flags || [],
    size: 0,
    subject: row.subject || "(No Subject)",
    from: {
      name: row.from_name || "Unknown",
      email: row.from_email || "",
    },
    to: row.to_addresses || [],
    cc: row.cc_addresses || [],
    date: row.sent_at || new Date().toISOString(),
    messageId: row.message_id || "",
    inReplyTo: row.in_reply_to || "",
    hasAttachments: !!row.has_attachments,
    attachments: (row.attachment_names || []).map((name) => ({
      name,
      size: 0,
      type: "application/octet-stream",
    })),
  };
}

async function upsertSearchCache(rows: SearchCacheRow[]) {
  if (rows.length === 0) return;
  const admin = getAdminClient();
  if (!admin) return;
  const { error } = await admin
    .from("email_search_cache")
    .upsert(rows, { onConflict: "account_key,folder_id,uid" });
  if (error) {
    console.error("[search-cache] upsert failed:", error);
  }
}

async function querySearchCacheByUids(accountKey: string, folder: string, uids: number[]) {
  const admin = getAdminClient();
  if (!admin || uids.length === 0) return [];

  const { data, error } = await admin
    .from("email_search_cache")
    .select("*")
    .eq("account_key", accountKey)
    .eq("folder_id", folder)
    .in("uid", uids);

  if (error) {
    console.error("[search-cache] uid lookup failed:", error);
    return [];
  }

  return (data || []) as SearchCacheRow[];
}

async function querySearchCacheByTerm(accountKey: string, folder: string, term: string) {
  const admin = getAdminClient();
  if (!admin || !term.trim()) return [];

  const { data, error } = await admin.rpc("search_email_search_cache", {
    p_account_key: accountKey,
    p_folder_id: folder,
    p_query: term,
    p_limit: 1000,
    p_offset: 0,
  });

  if (error) {
    console.error("[search-cache] term lookup failed:", error);
    return [];
  }

  return (data || [])
    .map((row: { uid?: number | string }) => Number(row?.uid))
    .filter((uid) => Number.isFinite(uid));
}

async function fetchEnvelopeBatch(client: ImapClient, sequence: string, byUid = false, includeSource = false) {
  const messages = await (client as any).fetch(sequence, {
    ...(byUid ? { byUid: true } : {}),
    uid: true,
    envelope: true,
    flags: true,
    bodyStructure: true,
    size: true,
    ...(includeSource ? { source: true, bodyParts: [""] } : {}),
  });
  return (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
}

async function syncCachedFlags(accountKey: string, folder: string, uid: number, addFlags?: string[], removeFlags?: string[]) {
  const admin = getAdminClient();
  if (!admin || !Number.isFinite(uid)) return;

  const { data, error } = await admin
    .from("email_search_cache")
    .select("flags")
    .eq("account_key", accountKey)
    .eq("folder_id", folder)
    .eq("uid", uid)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[search-cache] flags read failed:", error);
    return;
  }

  const nextFlags = new Set<string>(Array.isArray(data.flags) ? data.flags : []);
  (addFlags || []).forEach((flag) => nextFlags.add(flag));
  (removeFlags || []).forEach((flag) => nextFlags.delete(flag));

  const { error: updateError } = await admin
    .from("email_search_cache")
    .update({ flags: [...nextFlags] })
    .eq("account_key", accountKey)
    .eq("folder_id", folder)
    .eq("uid", uid);

  if (updateError) {
    console.error("[search-cache] flags update failed:", updateError);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let client: ImapClient | null = null;

  try {
    const body = await req.json();
    const { action, host, port, secure, username, password } = body;
    const accountKey = makeAccountKey(host || "", username || "");

    if (!host || !username || !password) {
      return err("Missing credentials", 400);
    }

    const numericPort = Number(port) || 993;
    const tls = typeof secure === "boolean" ? secure : numericPort === 993;

    client = new ImapClient({
      host,
      port: numericPort,
      tls,
      username,
      password,
      autoConnect: false,
    });

    await client.connect();

    switch (action) {
      case "folders": {
        const mailboxes = await client.listMailboxes();
        const folders = mailboxes.map((m: any) => ({
          id: m.path || m.name,
          name: m.name,
          path: m.path,
          flags: m.flags || [],
          delimiter: m.delimiter,
        }));
        await client.disconnect();
        client = null;
        return ok({ folders });
      }

      case "list": {
        const { folder = "INBOX", page = 1, pageSize = 50 } = body;
        const mailboxStatus = await client.selectMailbox(folder);

        // Use EXISTS count from mailbox status for reliable pagination
        const total = (mailboxStatus as any)?.exists ?? (mailboxStatus as any)?.messages ?? 0;
        const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
        const safePageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0 ? Number(pageSize) : 50;

        if (total === 0) {
          await client.disconnect();
          client = null;
          return ok({ emails: [], total: 0, page: safePage, pageSize: safePageSize });
        }

        // Calculate sequence range (newest first)
        // Page 1: sequences (total-pageSize+1) to total
        // Page 2: sequences (total-2*pageSize+1) to (total-pageSize)
        const seqEnd = total - (safePage - 1) * safePageSize;
        const seqStart = Math.max(1, seqEnd - safePageSize + 1);

        if (seqEnd < 1) {
          await client.disconnect();
          client = null;
          return ok({ emails: [], total, page: safePage, pageSize: safePageSize });
        }

        const sequence = `${seqStart}:${seqEnd}`;
        console.log("list fetch - total:", total, "seqRange:", sequence, "page:", safePage);

        const messages = await (client as any).fetch(sequence, {
          uid: true,
          envelope: true,
          flags: true,
          size: true,
          bodyStructure: true,
        });

        const normalized = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);




        const emails = normalized
          .filter((msg: any) => Number.isFinite(Number(msg?.uid)))
          .map((msg: any) => {
            const env = msg.envelope || {};
            let hasAtt = false;
            try { hasAtt = msg.bodyStructure ? imapHasAttachments(msg.bodyStructure) : false; } catch {}

            return {
              uid: msg.uid,
              flags: msg.flags || [],
              size: msg.size || 0,
              subject: env.subject || "(No Subject)",
              from: env.from?.[0]
                ? {
                    name: env.from[0].name || env.from[0].mailbox,
                    email: `${env.from[0].mailbox}@${env.from[0].host}`,
                  }
                : { name: "Unknown", email: "" },
              to: (env.to || []).map((a: any) => ({
                name: a.name || a.mailbox,
                email: `${a.mailbox}@${a.host}`,
              })),
              cc: (env.cc || []).map((a: any) => ({
                name: a.name || a.mailbox,
                email: `${a.mailbox}@${a.host}`,
              })),
              date: env.date || new Date().toISOString(),
              messageId: env.messageId || "",
              inReplyTo: env.inReplyTo || "",
              hasAttachments: hasAtt,
              attachments: [],
            };
          })
          .sort((a: any, b: any) => b.uid - a.uid); // newest first

        await upsertSearchCache(
          normalized
            .map((msg: any) => buildCacheRow(accountKey, host, username, folder, msg))
            .filter(Boolean) as SearchCacheRow[],
        );

        await client.disconnect();
        client = null;
        return ok({ emails, total, page: safePage, pageSize: safePageSize });
      }

      case "fetch": {
        const { folder = "INBOX", uid, includeAttachmentContent = false } = body;
        if (!uid) return err("Missing uid", 400);

        await client.selectMailbox(folder);

        const targetUid = Number(uid);
        if (!Number.isFinite(targetUid)) return err("Invalid uid", 400);

        const MAX_RAW_BYTES = 3_000_000;
        const MAX_ATTACHMENT_INLINE_BYTES = 256_000;

        let rawSource: Uint8Array | null = null;
        let envelope: any = null;
        let bodyStructure: any = null;
        let flags: string[] = [];
        let messageSize = 0;

        let msgSourceType = "undefined";
        let msgSourceConstructor = "undefined";
        let rawSourceOrigin = "none";

        const toUint8Array = async (value: unknown): Promise<Uint8Array | null> => {
          if (value instanceof Uint8Array) {
            return value.length > MAX_RAW_BYTES ? value.slice(0, MAX_RAW_BYTES) : value;
          }
          if (typeof value === "string") {
            const encoded = new TextEncoder().encode(value);
            return encoded.length > MAX_RAW_BYTES ? encoded.slice(0, MAX_RAW_BYTES) : encoded;
          }
          if (value instanceof ArrayBuffer) {
            const bytes = new Uint8Array(value);
            return bytes.length > MAX_RAW_BYTES ? bytes.slice(0, MAX_RAW_BYTES) : bytes;
          }
          if (value && typeof value === "object") {
            const maybe = value as { buffer?: unknown; byteOffset?: unknown; byteLength?: unknown };
            if (maybe.buffer instanceof ArrayBuffer) {
              const byteOffset = typeof maybe.byteOffset === "number" ? maybe.byteOffset : 0;
              const byteLength = typeof maybe.byteLength === "number" ? maybe.byteLength : undefined;
              const bytes = new Uint8Array(maybe.buffer, byteOffset, byteLength);
              return bytes.length > MAX_RAW_BYTES ? bytes.slice(0, MAX_RAW_BYTES) : bytes;
            }
            const keys = Object.keys(value);
            if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
              const arr = new Uint8Array(keys.length);
              for (let i = 0; i < keys.length; i++) arr[i] = (value as any)[i];
              return arr.length > MAX_RAW_BYTES ? arr.slice(0, MAX_RAW_BYTES) : arr;
            }
          }
          return null;
        };

        const describe = (value: unknown) => ({
          type: typeof value,
          constructorName: value && typeof value === "object"
            ? ((value as any).constructor?.name || "Unknown")
            : "n/a",
          keys: value && typeof value === "object"
            ? Object.keys(value as Record<string, unknown>)
            : [],
        });

        const readRawCandidate = async (label: string, value: unknown) => {
          if (value == null) return;
          const converted = await toUint8Array(value);
          if (converted && converted.length > 0) {
            rawSource = converted;
            rawSourceOrigin = label;
            return;
          }

          const unsupported = describe(value);
          console.warn(
            "Unsupported raw source candidate:",
            label,
            "type:",
            unsupported.type,
            "constructor:",
            unsupported.constructorName,
            "keys:",
            unsupported.keys.join(","),
          );
        };

        try {
          const messages = await (client as any).fetch(String(targetUid), {
            byUid: true,
            uid: true,
            envelope: true,
            flags: true,
            size: true,
            bodyStructure: true,
            source: true,
          });

          const fetched = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
          const msg = fetched.find((item: any) => Number(item?.uid) === targetUid) || fetched[0];

          if (msg) {
            envelope = msg.envelope;
            flags = msg.flags || [];
            messageSize = Number(msg.size || 0);
            bodyStructure = msg.bodyStructure || null;
            msgSourceType = typeof msg.source;
            msgSourceConstructor = msg.source?.constructor?.name || "undefined";

            // Try 'raw' first (deno-imap returns raw, not source)
            await readRawCandidate("msg.raw", msg.raw);
            if (!rawSource) await readRawCandidate("msg.source", msg.source);

            console.log(
              "[fetch] source attempt - hasSource:",
              !!rawSource,
              "origin:",
              rawSourceOrigin,
              "hasBodyStructure:",
              !!bodyStructure,
              "keys:",
              Object.keys(msg).join(","),
            );
          }
        } catch (e) {
          console.error("fetch source failed:", e);
        }

        if (!rawSource) {
          try {
            const messages2 = await (client as any).fetch(String(targetUid), {
              byUid: true,
              uid: true,
              envelope: true,
              flags: true,
              size: true,
              bodyParts: [""],
            });

            const fetched2 = (Array.isArray(messages2) ? messages2 : [messages2]).filter(Boolean);
            const msg2 = fetched2.find((item: any) => Number(item?.uid) === targetUid) || fetched2[0];

            if (msg2) {
              if (!envelope) envelope = msg2.envelope;
              if (!flags.length) flags = msg2.flags || [];
              if (!messageSize) messageSize = Number(msg2.size || 0);

              if (!rawSource) await readRawCandidate("msg2.raw", msg2.raw);
              if (!rawSource) await readRawCandidate("msg2.source", msg2.source);
              if (!rawSource && msg2.parts) {
                const textPart = msg2.parts?.find?.((p: any) => p.body);
                if (textPart?.body) await readRawCandidate("msg2.parts[].body", textPart.body);
              }

              const bodyContent = msg2.bodyParts?.get?.("") || msg2.body?.get?.("") || msg2["body[]"];
              console.log(
                "fallback bodyParts - hasContent:",
                !!bodyContent,
                "type:",
                typeof bodyContent,
                "keys:",
                Object.keys(msg2).join(","),
              );

              if (!rawSource) await readRawCandidate("msg2.body[]", bodyContent);
            }
          } catch (e2) {
            console.error("fetch bodyParts fallback failed:", e2);
          }
        }

        if (messageSize > MAX_RAW_BYTES && !rawSource) {
          await client.disconnect();
          client = null;
          console.log("Skipping heavy parse for large message uid:", targetUid, "size:", messageSize);
          return ok({
            uid: targetUid,
            flags,
            subject: envelope?.subject || "",
            from: envelope?.from?.[0]
              ? {
                  name: envelope.from[0].name || envelope.from[0].mailbox,
                  email: `${envelope.from[0].mailbox}@${envelope.from[0].host}`,
                }
              : { name: "Unknown", email: "" },
            to: (envelope?.to || []).map((a: any) => ({
              name: a.name || a.mailbox,
              email: `${a.mailbox}@${a.host}`,
            })),
            cc: (envelope?.cc || []).map((a: any) => ({
              name: a.name || a.mailbox,
              email: `${a.mailbox}@${a.host}`,
            })),
            date: envelope?.date || "",
            messageId: envelope?.messageId || "",
            bodyText: "",
            bodyHtml: "",
            text: "",
            html: "",
            hasBody: false,
            tooLargeToParse: true,
            attachments: [],
          });
        }

        if (!rawSource) {
          await client.disconnect();
          client = null;
          console.log("No raw source obtained for uid:", targetUid);
          return ok({
            uid: targetUid,
            flags: [],
            subject: envelope?.subject || "",
            from: { name: "Unknown", email: "" },
            to: [],
            cc: [],
            date: "",
            messageId: "",
            bodyText: "",
            bodyHtml: "",
            text: "",
            html: "",
            hasBody: false,
            notFound: true,
          });
        }

        let parsed: any;
        try {
          parsed = await PostalMime.parse(rawSource);
        } catch (parseError) {
          console.error("PostalMime parse failed:", parseError);
          await client.disconnect();
          client = null;
          return ok({
            uid: targetUid,
            flags,
            subject: envelope?.subject || "",
            from: { name: "Unknown", email: "" },
            to: [],
            cc: [],
            date: envelope?.date || "",
            messageId: envelope?.messageId || "",
            bodyText: "",
            bodyHtml: "",
            text: "",
            html: "",
            hasBody: false,
            parseError: true,
            attachments: [],
          });
        }

        const bodyText = typeof parsed.text === "string" ? parsed.text.trim() : "";
        const bodyHtml = typeof parsed.html === "string" ? parsed.html.trim() : "";

        let finalHtml = bodyHtml;
        let htmlSource = bodyHtml ? "postal-mime" : "none";

        // Fallback 1: check if HTML is hiding in an attachment (text/html part treated as attachment)
        if (!finalHtml && parsed.attachments?.length) {
          try {
            const htmlAttachment = parsed.attachments.find((a: any) =>
              (a.mimeType || "").toLowerCase() === "text/html"
            );
            if (htmlAttachment?.content) {
              let contentBytes: Uint8Array | null = null;
              if (htmlAttachment.content instanceof Uint8Array) {
                contentBytes = htmlAttachment.content;
              } else if (htmlAttachment.content instanceof ArrayBuffer) {
                contentBytes = new Uint8Array(htmlAttachment.content);
              } else if (typeof htmlAttachment.content === "string") {
                contentBytes = new TextEncoder().encode(htmlAttachment.content);
              }
              if (contentBytes && contentBytes.length > 0) {
                finalHtml = new TextDecoder().decode(contentBytes).trim();
                htmlSource = "attachment-fallback";
                console.log("[fetch] Got HTML from attachment fallback, length:", finalHtml.length);
              }
            }
          } catch (attErr) {
            console.error("[fetch] HTML attachment fallback failed:", attErr);
          }
        }

        // Fallback 2: PostalMime gave no HTML, but bodyStructure says there IS an HTML part.
        if (!finalHtml && bodyStructure && client) {
          try {
            const htmlPartPath = findHtmlPartPath(bodyStructure);
            if (htmlPartPath) {
              console.log("[fetch] Trying direct IMAP part fetch:", htmlPartPath);
              const partMsgs = await (client as any).fetch(String(targetUid), {
                byUid: true,
                uid: true,
                bodyParts: [htmlPartPath],
              });
              const partArr = (Array.isArray(partMsgs) ? partMsgs : [partMsgs]).filter(Boolean);
              const partMsg = partArr.find((m: any) => Number(m?.uid) === targetUid) || partArr[0];

              if (partMsg) {
                let partContent: unknown = null;
                if (partMsg?.bodyParts instanceof Map) {
                  partContent = partMsg.bodyParts.get(htmlPartPath);
                } else if (partMsg?.body instanceof Map) {
                  partContent = partMsg.body.get(htmlPartPath);
                }
                if (!partContent) {
                  partContent = partMsg?.[`body[${htmlPartPath}]`];
                }

                if (partContent) {
                  const partBytes = await toUint8Array(partContent);
                  if (partBytes && partBytes.length > 0) {
                    let decoded = new TextDecoder().decode(partBytes).trim();
                    if (decoded.includes("=3D") || decoded.includes("=\r\n") || decoded.includes("=\n")) {
                      try {
                        decoded = decodeQuotedPrintable(decoded);
                      } catch (qpErr) {
                        console.error("[fetch] QP decode failed, using raw:", qpErr);
                      }
                    }
                    finalHtml = decoded;
                    htmlSource = "direct-imap-part";
                    console.log("[fetch] Got HTML from direct IMAP part fetch, length:", finalHtml.length);
                  }
                }
              }
            }
          } catch (partErr) {
            console.error("[fetch] Direct HTML part fetch failed:", partErr);
          }
        }

        // Fallback 3: if bodyText actually contains HTML tags, promote it
        if (!finalHtml && bodyText) {
          try {
            if (/<\/?[a-z][\s\S]*>/i.test(bodyText)) {
              finalHtml = bodyText;
              htmlSource = "text-promoted";
              console.log("[fetch] bodyText contains HTML tags, promoting to finalHtml");
            }
          } catch (regexErr) {
            console.error("[fetch] HTML detection in bodyText failed:", regexErr);
          }
        }

        const hasBody = Boolean(bodyText || finalHtml);
        console.log("[fetch] uid:", targetUid, "bodyText.len:", bodyText.length, "finalHtml.len:", finalHtml.length, "hasBody:", hasBody, "htmlSource:", htmlSource);

        let attachments: any[] = [];
        try {
          attachments = (parsed.attachments || [])
            .filter((a: any) => {
              const mimeType = (a.mimeType || "").toLowerCase();
              return mimeType !== "text/plain" && mimeType !== "text/html";
            })
            .map((a: any) => {
              let bytes: Uint8Array | null = null;
              try {
                if (a.content instanceof Uint8Array) {
                  bytes = a.content;
                } else if (a.content instanceof ArrayBuffer) {
                  bytes = new Uint8Array(a.content);
                } else if (a.content && typeof a.content === "object") {
                  bytes = new Uint8Array(a.content);
                }
              } catch {
                bytes = null;
              }

              let contentBase64 = "";
              if (includeAttachmentContent && bytes && bytes.length <= MAX_ATTACHMENT_INLINE_BYTES) {
                try {
                  let binary = "";
                  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                  contentBase64 = btoa(binary);
                } catch {
                  contentBase64 = "";
                }
              }

              return {
                name: a.filename || "unnamed",
                size: bytes?.length || 0,
                type: a.mimeType || "application/octet-stream",
                contentBase64,
              };
            });
        } catch (attProcessErr) {
          console.error("[fetch] Attachment processing failed:", attProcessErr);
          attachments = [];
        }

        const env = envelope || {};
        const resolvedUid = targetUid;

        await client.disconnect();
        client = null;

        // Backfill body_text into search cache for this email
        {
          try {
            // Use plain text first; if empty, strip HTML for searchable text
            let searchableBody = bodyText ? cleanBodyText(bodyText) : "";
            if (!searchableBody && finalHtml) {
              searchableBody = cleanBodyText(stripHtmlForSearch(maybeDecodeQuotedPrintable(finalHtml)));
            }
            if (searchableBody) {
              const db = getAdminClient();
              if (db) {
                const accountKey = makeAccountKey(host, username);
                const { count } = await db
                  .from("email_search_cache")
                  .update({ body_text: searchableBody })
                  .eq("account_key", accountKey)
                  .eq("folder_id", folder)
                  .eq("uid", resolvedUid)
                  .eq("body_text", "")
                  .select("uid", { count: "exact", head: true });
                if (count && count > 0) {
                  console.log("[fetch] backfilled body_text for uid:", resolvedUid, "len:", searchableBody.length);
                }
              }
            }
          } catch (backfillErr) {
            console.error("[fetch] body_text backfill failed:", backfillErr);
          }
        }

        return ok({
          uid: resolvedUid,
          flags,
          subject: parsed.subject || env.subject || "",
          from: parsed.from
            ? { name: parsed.from.name || parsed.from.address || "Unknown", email: parsed.from.address || "" }
            : env.from?.[0]
              ? { name: env.from[0].name || env.from[0].mailbox, email: `${env.from[0].mailbox}@${env.from[0].host}` }
              : { name: "Unknown", email: "" },
          to: (parsed.to || []).map((a: any) => ({
            name: a.name || a.address || "",
            email: a.address || "",
          })),
          cc: (parsed.cc || []).map((a: any) => ({
            name: a.name || a.address || "",
            email: a.address || "",
          })),
          date: parsed.date || env.date || "",
          messageId: parsed.messageId || env.messageId || "",
          bodyText,
          bodyHtml: finalHtml,
          text: bodyText,
          html: finalHtml,
          hasBody,
          attachments,
        });
      }

      case "copy": {
        const { folder = "INBOX", uid: copyUid, targetFolder } = body;
        if (!copyUid || !targetFolder) return err("Missing uid or targetFolder", 400);

        await client.selectMailbox(folder);
        await client.copyMessages(String(copyUid), targetFolder, true);

        await client.disconnect();
        client = null;
        return ok({ success: true });
      }

      case "flags": {
        const { folder = "INBOX", uid: flagUid, addFlags, removeFlags } = body;
        if (!flagUid) return err("Missing uid", 400);

        await client.selectMailbox(folder);

        if (addFlags?.length) {
          await client.setFlags(String(flagUid), addFlags, "add", true);
        }
        if (removeFlags?.length) {
          await client.setFlags(String(flagUid), removeFlags, "remove", true);
        }

        await syncCachedFlags(accountKey, folder, Number(flagUid), addFlags, removeFlags);

        await client.disconnect();
        client = null;
        return ok({ success: true });
      }

      case "move": {
        const { folder = "INBOX", uid: moveUid, targetFolder } = body;
        if (!moveUid || !targetFolder) return err("Missing uid or targetFolder", 400);

        await client.selectMailbox(folder);
        await client.moveMessages(String(moveUid), targetFolder, true);

        const admin = getAdminClient();
        if (admin) {
          const { error } = await admin
            .from("email_search_cache")
            .update({ folder_id: targetFolder })
            .eq("account_key", accountKey)
            .eq("folder_id", folder)
            .eq("uid", Number(moveUid));
          if (error) console.error("[search-cache] move update failed:", error);
        }

        await client.disconnect();
        client = null;
        return ok({ success: true });
      }

      case "search": {
        const { folder = "INBOX", query: searchQuery, page = 1, pageSize = 30 } = body;
        if (!searchQuery || typeof searchQuery !== "string") return err("Missing query", 400);

        await client.selectMailbox(folder);

        const term = searchQuery.trim();
        const safePage = Math.max(1, Number(page) || 1);
        const safePageSize = Math.min(50, Math.max(1, Number(pageSize) || 30));

        if (!term) {
          await client.disconnect();
          client = null;
          return ok({ emails: [], total: 0, page: safePage, pageSize: safePageSize, hasMore: false });
        }

        console.log(`[search] request folder="${folder}" query="${term}" page=${safePage} pageSize=${safePageSize}`);

        const normalizedTerm = normalizeSearchTerm(term);
        let matchedUids: number[] = [];
        const matchedUidSet = new Set<number>();

        // --- Phase 1: Search existing cache ---
        const cachedMatchedUids = await querySearchCacheByTerm(accountKey, folder, term);
        cachedMatchedUids.forEach((uid) => matchedUidSet.add(uid));

        // --- Phase 1b: Diagnostics - check body_text coverage in cache ---
        const admin = getAdminClient();
        let cacheTotal = 0;
        let cacheWithBody = 0;
        if (admin) {
          try {
            const { count: totalCount } = await admin
              .from("email_search_cache")
              .select("uid", { count: "exact", head: true })
              .eq("account_key", accountKey)
              .eq("folder_id", folder);
            cacheTotal = totalCount || 0;

            const { count: bodyCount } = await admin
              .from("email_search_cache")
              .select("uid", { count: "exact", head: true })
              .eq("account_key", accountKey)
              .eq("folder_id", folder)
              .neq("body_text", "");
            cacheWithBody = bodyCount || 0;
          } catch (e) {
            console.error("[search] cache diagnostics failed:", e);
          }
        }
        console.log(`[search] cache coverage: total=${cacheTotal} withBody=${cacheWithBody} cachedMatches=${cachedMatchedUids.length}`);

        // --- Phase 2: Populate body_text for cached emails missing it ---
        // This targeted fetch is much cheaper than a full content scan
        if (admin && cacheTotal > 0 && cacheWithBody < cacheTotal) {
          try {
            const { data: emptyBodyRows } = await admin
              .from("email_search_cache")
              .select("uid")
              .eq("account_key", accountKey)
              .eq("folder_id", folder)
              .eq("body_text", "")
              .limit(100); // batch limit to avoid timeout

            const emptyUids = (emptyBodyRows || []).map((r: any) => Number(r.uid)).filter(Number.isFinite);
            if (emptyUids.length > 0) {
              console.log(`[search] populating body_text for ${emptyUids.length} cached emails`);
              let populatedCount = 0;
              let missingRawCount = 0;

              // Fetch source in batches of 10
              for (let i = 0; i < emptyUids.length; i += 10) {
                const batchUids = emptyUids.slice(i, i + 10);
                try {
                  const uidRange = batchUids.join(",");
                  const msgs = await (client as any).fetch(uidRange, {
                    byUid: true,
                    uid: true,
                    bodyStructure: true,
                    source: true,
                    bodyParts: [""],
                  });
                  const fetched = (Array.isArray(msgs) ? msgs : [msgs]).filter(Boolean);

                  for (const msg of fetched) {
                    const msgUid = Number(msg?.uid);
                    if (!Number.isFinite(msgUid)) continue;

                    const extracted = await extractSearchableBody(msg);
                    if (extracted.source === "missing-raw" || extracted.source === "empty-raw") {
                      missingRawCount++;
                      continue;
                    }
                    if (!extracted.plainText) continue;

                    await admin
                      .from("email_search_cache")
                      .update({ body_text: extracted.plainText })
                      .eq("account_key", accountKey)
                      .eq("folder_id", folder)
                      .eq("uid", msgUid)
                      .eq("body_text", "");
                    populatedCount++;
                  }
                } catch (batchErr) {
                  console.error("[search] body populate batch failed:", batchErr);
                }
              }
              console.log(`[search] body populate done: populated=${populatedCount} missingRaw=${missingRawCount}`);

              // Re-run cache search with newly populated body_text
              if (populatedCount > 0) {
                const newCachedUids = await querySearchCacheByTerm(accountKey, folder, term);
                newCachedUids.forEach((uid) => matchedUidSet.add(uid));
                console.log(`[search] re-cached matches after populate: ${newCachedUids.length} (was ${cachedMatchedUids.length})`);
              }
            }
          } catch (populateErr) {
            console.error("[search] body populate failed:", populateErr);
          }
        }

        // --- Phase 3: IMAP server-side search ---
        // deno-imap search() signature: search(criteria: ImapSearchCriteria, charset?: string)
        const searchAttempts: Array<{ label: string; criteria: Record<string, unknown> }> = [
          { label: "Text", criteria: { text: term } },
          { label: "Body", criteria: { body: term } },
          { label: "Subject", criteria: { header: [{ field: "Subject", value: term }] } },
          { label: "From", criteria: { header: [{ field: "From", value: term }] } },
          { label: "To", criteria: { header: [{ field: "To", value: term }] } },
          { label: "Cc", criteria: { header: [{ field: "Cc", value: term }] } },
        ];
        let anySearchWorked = false;
        const useUtf8Search = hasNonAscii(term);

        for (const attempt of searchAttempts) {
          try {
            const searchResult = useUtf8Search
              ? await client.search(attempt.criteria as any, "UTF-8")
              : await client.search(attempt.criteria as any);
            const seqNos = (Array.isArray(searchResult) ? searchResult : []).map(Number).filter(Number.isFinite);
            if (seqNos.length > 0) {
              anySearchWorked = true;
              const seqRange = seqNos.join(",");
              const uidMsgs = await (client as any).fetch(seqRange, { uid: true });
              const fetched = (Array.isArray(uidMsgs) ? uidMsgs : [uidMsgs]).filter(Boolean);
              for (const m of fetched) {
                if (Number.isFinite(Number(m?.uid))) matchedUidSet.add(Number(m.uid));
              }
            }
            if ((attempt.label === "Text" || attempt.label === "Body") && anySearchWorked) break;
          } catch (attemptError) {
            console.log(`[search] search failed for ${attempt.label}:`, attemptError);
          }
        }

        matchedUids = [...matchedUidSet];

        // --- Phase 4: Full content scan fallback (only if cache + IMAP gave nothing) ---
        const shouldForceContentScan = matchedUids.length === 0 && !term.includes("@");

        if (shouldForceContentScan) {
          console.log(`[search] last-resort content scan, no results from cache or IMAP`);
          const mailboxStatus = await client.selectMailbox(folder);
          const totalMessages = Number((mailboxStatus as any)?.exists ?? (mailboxStatus as any)?.messages ?? 0);
          const batchSize = 200;
          const scannedCacheRows: SearchCacheRow[] = [];
          let scannedCount = 0;
          let extractedBodyCount = 0;
          let missingRawCount = 0;

          for (let seqEnd = totalMessages; seqEnd >= 1; seqEnd -= batchSize) {
            const seqStart = Math.max(1, seqEnd - batchSize + 1);
            const sequence = `${seqStart}:${seqEnd}`;
            const batch = await fetchEnvelopeBatch(client, sequence, false, true);
            for (const msg of batch) {
              if (!Number.isFinite(Number(msg?.uid))) continue;
              scannedCount++;
              const contentResult = await searchMessageContent(msg, normalizedTerm);

              if (contentResult.source === "missing-raw" || contentResult.source === "empty-raw") {
                missingRawCount++;
              }

              if (contentResult.bodyText) {
                extractedBodyCount++;
                const row = buildCacheRow(accountKey, host, username, folder, msg, contentResult.bodyText);
                if (row) scannedCacheRows.push(row);
              }

              if (contentResult.matched) {
                matchedUidSet.add(Number(msg.uid));
              }
            }
          }

          console.log(
            `[search] content scan: scanned=${scannedCount} extractedBodies=${extractedBodyCount} missingRaw=${missingRawCount} newMatches=${matchedUidSet.size - matchedUids.length}`,
          );

          matchedUids = [...matchedUidSet].sort((a, b) => b - a);

          if (scannedCacheRows.length > 0) {
            await upsertSearchCache(scannedCacheRows.slice(0, 5000));
          }
        }

        matchedUids = [...matchedUidSet];

        // Sort newest first
        matchedUids.sort((a, b) => b - a);
        const totalFound = matchedUids.length;

        console.log(`[search] matched UIDs=${totalFound}`);

        if (totalFound === 0) {
          await client.disconnect();
          client = null;
          return ok({ emails: [], total: 0, page: safePage, pageSize: safePageSize, hasMore: false });
        }

        // Paginate UIDs
        const startIdx = (safePage - 1) * safePageSize;
        const pageUids = matchedUids.slice(startIdx, startIdx + safePageSize);
        const hasMore = startIdx + safePageSize < totalFound;

        if (pageUids.length === 0) {
          await client.disconnect();
          client = null;
          return ok({ emails: [], total: totalFound, page: safePage, pageSize: safePageSize, hasMore: false });
        }

        const cachedRows = await querySearchCacheByUids(accountKey, folder, pageUids);
        const cachedByUid = new Map<number, SearchCacheRow>(
          cachedRows
            .filter((row) => Number.isFinite(Number(row.uid)))
            .map((row) => [Number(row.uid), row]),
        );

        const missingUids = pageUids.filter((uid) => !cachedByUid.has(uid));
        let normalized: any[] = [];

        if (missingUids.length > 0) {
          const uidRange = missingUids.join(",");
          normalized = await fetchEnvelopeBatch(client, uidRange, true);
        }

        const fetchedEmails = normalized
          .filter((msg: any) => Number.isFinite(Number(msg?.uid)))
          .map((msg: any) => mapFetchedSearchEmail(msg));

        const fetchedByUid = new Map<number, any>(
          fetchedEmails.map((email: any) => [Number(email.uid), email]),
        );

        const emails = pageUids
          .map((uid) => fetchedByUid.get(uid) || cacheRowToEmail(cachedByUid.get(uid)!))
          .filter(Boolean);

        if (normalized.length > 0) {
          await upsertSearchCache(
            normalized
              .map((msg: any) => buildCacheRow(accountKey, host, username, folder, msg))
              .filter(Boolean) as SearchCacheRow[],
          );
        }

        console.log(`[search] response emails=${emails.length} totalFound=${totalFound}`);

        await client.disconnect();
        client = null;
        return ok({ emails, total: totalFound, page: safePage, pageSize: safePageSize, hasMore });
      }

      case "delete": {
        const { folder = "INBOX", uid: delUid } = body;
        if (!delUid) return err("Missing uid", 400);

        await client.selectMailbox(folder);
        await client.setFlags(String(delUid), ["\\Deleted"], "add", true);
        await client.expunge();

        const admin = getAdminClient();
        if (admin) {
          const { error } = await admin
            .from("email_search_cache")
            .delete()
            .eq("account_key", accountKey)
            .eq("folder_id", folder)
            .eq("uid", Number(delUid));
          if (error) console.error("[search-cache] delete failed:", error);
        }

        await client.disconnect();
        client = null;
        return ok({ success: true });
      }

      default:
        await client.disconnect();
        client = null;
        return err("Unknown action", 400);
    }
  } catch (e) {
    if (client) {
      try { await client.disconnect(); } catch { /* ignore */ }
    }
    console.error("imap-proxy error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("Authentication") || message.includes("LOGIN")) {
      return err("Authentication failed. Check your credentials.", 401);
    }
    return err(message);
  }
});
