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

function buildCacheRow(accountKey: string, host: string, username: string, folder: string, msg: any): SearchCacheRow | null {
  if (!Number.isFinite(Number(msg?.uid))) return null;
  const env = msg.envelope || {};
  let hasAttachments = false;
  try {
    hasAttachments = msg.bodyStructure ? imapHasAttachments(msg.bodyStructure) : false;
  } catch {
    hasAttachments = false;
  }
  const attachmentNames = extractAttachmentNames(msg.bodyStructure);

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

async function extractSearchableBody(msg: any) {
  const rawCandidate = msg?.raw ?? msg?.source;
  if (!rawCandidate) return "";

  let bytes: Uint8Array | null = null;
  if (rawCandidate instanceof Uint8Array) {
    bytes = rawCandidate;
  } else if (typeof rawCandidate === "string") {
    bytes = new TextEncoder().encode(rawCandidate);
  } else if (rawCandidate instanceof ArrayBuffer) {
    bytes = new Uint8Array(rawCandidate);
  } else if (rawCandidate && typeof rawCandidate === "object" && rawCandidate.buffer instanceof ArrayBuffer) {
    const offset = typeof rawCandidate.byteOffset === "number" ? rawCandidate.byteOffset : 0;
    const length = typeof rawCandidate.byteLength === "number" ? rawCandidate.byteLength : undefined;
    bytes = new Uint8Array(rawCandidate.buffer, offset, length);
  }

  if (!bytes || bytes.length === 0) return "";

  try {
    const parsed = await PostalMime.parse(bytes);
    return normalizeSearchTerm([
      parsed.subject || "",
      parsed.text || "",
      typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : "",
    ].join(" "));
  } catch {
    return "";
  }
}

async function searchMessageContent(msg: any, term: string) {
  if (searchEmailFromEnvelope(msg, term)) return true;
  const bodyHaystack = await extractSearchableBody(msg);
  return bodyHaystack.includes(term);
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
    ...(includeSource ? { source: true } : {}),
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
            source: true,
          });

          const fetched = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
          const msg = fetched.find((item: any) => Number(item?.uid) === targetUid) || fetched[0];

          if (msg) {
            envelope = msg.envelope;
            flags = msg.flags || [];
            messageSize = Number(msg.size || 0);
            msgSourceType = typeof msg.source;
            msgSourceConstructor = msg.source?.constructor?.name || "undefined";

            // Try 'raw' first (deno-imap returns raw, not source)
            await readRawCandidate("msg.raw", msg.raw);
            if (!rawSource) await readRawCandidate("msg.source", msg.source);

            console.log(
              "fetch source attempt - hasSource:",
              !!rawSource,
              "origin:",
              rawSourceOrigin,
              "msg.source type:",
              msgSourceType,
              "msg.source constructor:",
              msgSourceConstructor,
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
        if (!finalHtml && parsed.attachments?.length) {
          const htmlAttachment = parsed.attachments.find((a: any) => a.mimeType === "text/html");
          if (htmlAttachment?.content) {
            finalHtml = new TextDecoder().decode(
              htmlAttachment.content instanceof Uint8Array
                ? htmlAttachment.content
                : new Uint8Array(htmlAttachment.content),
            ).trim();
          }
        }

        const hasBody = Boolean(bodyText || finalHtml);

        const attachments = (parsed.attachments || [])
          .filter((a: any) => {
            const mimeType = (a.mimeType || "").toLowerCase();
            return mimeType !== "text/plain" && mimeType !== "text/html";
          })
          .map((a: any) => {
            const bytes = a.content
              ? (a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content))
              : null;

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

        const env = envelope || {};
        const resolvedUid = targetUid;

        await client.disconnect();
        client = null;

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
        const cachedMatchedUids = await querySearchCacheByTerm(accountKey, folder, term);
        cachedMatchedUids.forEach((uid) => matchedUidSet.add(uid));
        console.log(`[search] cached matches=${cachedMatchedUids.length}`);
        // deno-imap search() signature: search(criteria: ImapSearchCriteria, charset?: string)
        // ImapSearchCriteria.header expects: { field: string, value: string }[]
        // ImapSearchCriteria.text/body expect: string
        // Returns sequence numbers (not UIDs)
        const searchAttempts: Array<{ label: string; criteria: Record<string, unknown> }> = [
          { label: "Text", criteria: { text: term } },
          { label: "Subject", criteria: { header: [{ field: "Subject", value: term }] } },
          { label: "From", criteria: { header: [{ field: "From", value: term }] } },
          { label: "To", criteria: { header: [{ field: "To", value: term }] } },
          { label: "Cc", criteria: { header: [{ field: "Cc", value: term }] } },
        ];
        let anySearchWorked = false;

        for (const attempt of searchAttempts) {
          try {
            const searchResult = await client.search(attempt.criteria as any);
            const seqNos = (Array.isArray(searchResult) ? searchResult : []).map(Number).filter(Number.isFinite);
            if (seqNos.length > 0) {
              anySearchWorked = true;
              // Convert sequence numbers to UIDs by fetching UID for each
              const seqRange = seqNos.join(",");
              const uidMsgs = await (client as any).fetch(seqRange, { uid: true });
              const fetched = (Array.isArray(uidMsgs) ? uidMsgs : [uidMsgs]).filter(Boolean);
              for (const m of fetched) {
                if (Number.isFinite(Number(m?.uid))) matchedUidSet.add(Number(m.uid));
              }
            }
            // If TEXT search worked, skip header-specific searches (TEXT covers them)
            if (attempt.label === "Text" && anySearchWorked) break;
          } catch (attemptError) {
            console.log(`[search] search failed for ${attempt.label}:`, attemptError);
          }
        }

        matchedUids = [...matchedUidSet];
        const shouldForceContentScan = !term.includes("@");

        if (!anySearchWorked || matchedUids.length === 0 || shouldForceContentScan) {
          console.log(
            `[search] falling back to content scan anySearchWorked=${anySearchWorked} preMatched=${matchedUids.length} force=${shouldForceContentScan}`,
          );
          const mailboxStatus = await client.selectMailbox(folder);
          const totalMessages = Number((mailboxStatus as any)?.exists ?? (mailboxStatus as any)?.messages ?? 0);
          const batchSize = 200;
          const scannedMatches: any[] = [];

          for (let seqEnd = totalMessages; seqEnd >= 1; seqEnd -= batchSize) {
            const seqStart = Math.max(1, seqEnd - batchSize + 1);
            const sequence = `${seqStart}:${seqEnd}`;
            const batch = await fetchEnvelopeBatch(client, sequence, false, true);
            for (const msg of batch) {
              if (!Number.isFinite(Number(msg?.uid))) continue;
              if (await searchMessageContent(msg, normalizedTerm)) {
                scannedMatches.push(msg);
                matchedUidSet.add(Number(msg.uid));
              }
            }
          }

          matchedUids = [...matchedUidSet].sort((a, b) => b - a);

          if (scannedMatches.length > 0) {
            await upsertSearchCache(
              scannedMatches
                .map((msg: any) => buildCacheRow(accountKey, host, username, folder, msg))
                .filter(Boolean) as SearchCacheRow[],
            );
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