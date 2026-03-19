import { ImapClient } from "deno-imap";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let client: ImapClient | null = null;

  try {
    const body = await req.json();
    const { action, host, port, secure, username, password } = body;

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
        await client.selectMailbox(folder);

        const uidResults = await client.search({ all: true });
        const uids = (Array.isArray(uidResults) ? uidResults : [uidResults])
          .map((value: unknown) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0);

        const total = uids.length;
        const sortedUids = [...uids].sort((a, b) => b - a);
        const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
        const safePageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0 ? Number(pageSize) : 50;
        const start = (safePage - 1) * safePageSize;
        const pageUids = sortedUids.slice(start, start + safePageSize);

        if (pageUids.length === 0) {
          await client.disconnect();
          client = null;
          return ok({ emails: [], total, page: safePage, pageSize: safePageSize });
        }

        const sequence = pageUids.join(",");
        const messages = await (client as any).fetch(sequence, {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          size: true,
        });

        const normalized = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
        const emails = normalized
          .filter((msg: any) => Number.isFinite(Number(msg?.uid)))
          .map((msg: any) => {
            const env = msg.envelope || {};
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
            };
          });

        await client.disconnect();
        client = null;
        return ok({ emails, total, page: safePage, pageSize: safePageSize });
      }

      case "fetch": {
        const { folder = "INBOX", uid } = body;
        if (!uid) return err("Missing uid", 400);

        await client.selectMailbox(folder);

        const targetUid = Number(uid);
        if (!Number.isFinite(targetUid)) return err("Invalid uid", 400);

        // Helper to decode Uint8Array
        function decodeData(data: unknown, charset = "utf-8"): string {
          if (data instanceof Uint8Array) {
            try { return new TextDecoder(charset).decode(data); } catch { return new TextDecoder("utf-8").decode(data); }
          }
          if (typeof data === "string") return data;
          return "";
        }

        function extractCharset(header: string): string {
          const match = header.match(/charset=["']?([^"';\s]+)/i);
          return match ? match[1].trim() : "utf-8";
        }

        function extractEncoding(header: string): string {
          if (header.includes("base64")) return "base64";
          if (header.includes("quoted-printable")) return "quoted-printable";
          return "7bit";
        }

        function decodeContent(body: string, encoding: string, charset: string): string {
          if (encoding === "base64") {
            try {
              const clean = body.replace(/\s/g, "");
              const binary = atob(clean);
              const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
              try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
            } catch { return body; }
          } else if (encoding === "quoted-printable") {
            const clean = body.replace(/=\r?\n/g, "");
            const bytes: number[] = [];
            for (let i = 0; i < clean.length; i++) {
              if (clean[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(clean.slice(i + 1, i + 3))) {
                bytes.push(parseInt(clean.slice(i + 1, i + 3), 16));
                i += 2;
              } else {
                bytes.push(clean.charCodeAt(i) & 0xff);
              }
            }
            try {
              const byteArray = new Uint8Array(bytes);
              try { return new TextDecoder(charset).decode(byteArray); } catch { return new TextDecoder("utf-8").decode(byteArray); }
            } catch { return clean; }
          }
          return body;
        }

        // Recursively parse MIME parts from raw RFC822 message
        function parseMimeParts(rawMessage: string): { text: string; html: string } {
          let text = "";
          let html = "";

          // Split header from body
          const headerEnd = rawMessage.indexOf("\r\n\r\n");
          if (headerEnd === -1) {
            const headerEnd2 = rawMessage.indexOf("\n\n");
            if (headerEnd2 === -1) return { text: rawMessage, html: "" };
            return parseMimeBody(rawMessage.substring(0, headerEnd2), rawMessage.substring(headerEnd2 + 2));
          }
          return parseMimeBody(rawMessage.substring(0, headerEnd), rawMessage.substring(headerEnd + 4));
        }

        function parseMimeBody(headers: string, body: string): { text: string; html: string } {
          const headersLower = headers.toLowerCase();
          // Unfold headers (continuation lines)
          const unfoldedHeaders = headers.replace(/\r?\n[ \t]+/g, " ");
          const unfoldedLower = unfoldedHeaders.toLowerCase();

          // Check for multipart
          const boundaryMatch = unfoldedLower.match(/content-type:\s*multipart\/[^;]*;[^]*?boundary=["']?([^"'\s;]+)/i)
            || unfoldedHeaders.match(/boundary=["']?([^"'\s;]+)/i);

          if (boundaryMatch) {
            const boundary = boundaryMatch[1];
            return parseMultipartBody(body, boundary);
          }

          // Single part
          const charset = extractCharset(unfoldedLower);
          const encoding = extractEncoding(unfoldedLower);
          const decoded = decodeContent(body, encoding, charset);

          if (unfoldedLower.includes("content-type: text/html") || unfoldedLower.includes("content-type:text/html")) {
            return { text: "", html: decoded };
          }
          if (unfoldedLower.includes("content-type: text/plain") || unfoldedLower.includes("content-type:text/plain")) {
            return { text: decoded, html: "" };
          }
          // Default: treat as plain text
          return { text: decoded, html: "" };
        }

        function parseMultipartBody(body: string, boundary: string): { text: string; html: string } {
          let text = "";
          let html = "";
          const parts = body.split("--" + boundary);

          for (const rawPart of parts) {
            const part = rawPart.replace(/^\r?\n/, "");
            if (!part || part.startsWith("--")) continue;

            // Find header/body split
            let splitIdx = part.indexOf("\r\n\r\n");
            let splitLen = 4;
            if (splitIdx === -1) {
              splitIdx = part.indexOf("\n\n");
              splitLen = 2;
            }
            if (splitIdx === -1) continue;

            const partHeaders = part.substring(0, splitIdx);
            const partBody = part.substring(splitIdx + splitLen).replace(/\r?\n--$/, "").trimEnd();
            const partHeadersLower = partHeaders.toLowerCase();

            // Check for nested multipart
            const nestedBoundary = partHeaders.match(/boundary=["']?([^"'\s;]+)/i);
            if (nestedBoundary) {
              const nested = parseMultipartBody(partBody, nestedBoundary[1]);
              if (!text && nested.text) text = nested.text;
              if (!html && nested.html) html = nested.html;
              continue;
            }

            const isHtml = partHeadersLower.includes("text/html");
            const isPlain = partHeadersLower.includes("text/plain");
            if (!isHtml && !isPlain) continue;

            const charset = extractCharset(partHeadersLower);
            const encoding = extractEncoding(partHeadersLower);
            const decoded = decodeContent(partBody, encoding, charset);

            if (isHtml && !html) html = decoded;
            if (isPlain && !text) text = decoded;
          }

          return { text, html };
        }

        // Step 1: Try bodyParts + bodyStructure (lightweight, no full source download)
        let msg: any = null;
        try {
          const messages = await (client as any).fetch(String(targetUid), {
            byUid: true,
            uid: true,
            envelope: true,
            flags: true,
            bodyStructure: true,
            bodyParts: ["TEXT", "1", "1.1", "1.2", "2"],
          });
          const fetched = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
          msg = fetched.find((item: any) => Number(item?.uid) === targetUid) || fetched[0] || null;
        } catch (e) {
          console.error("fetch bodyParts failed:", e);
          try {
            const messages = await (client as any).fetch(String(targetUid), {
              byUid: true,
              uid: true,
              envelope: true,
              flags: true,
              bodyStructure: true,
              bodyParts: ["TEXT"],
            });
            const fetched = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
            msg = fetched.find((item: any) => Number(item?.uid) === targetUid) || fetched[0] || null;
          } catch (e2) {
            console.error("fetch TEXT failed:", e2);
          }
        }

        if (!msg) {
          await client.disconnect();
          client = null;
          return ok({ uid, flags: [], subject: "", from: { name: "Unknown", email: "" }, to: [], cc: [], date: "", messageId: "", bodyText: "", bodyHtml: "", notFound: true });
        }

        let bodyText = "";
        let bodyHtml = "";

        // Extract charset/encoding from bodyStructure for each MIME part
        type PartMeta = { type: string; subtype: string; charset: string; encoding: string; partId: string };
        function flattenStructure(struct: any, partPrefix = ""): PartMeta[] {
          const results: PartMeta[] = [];
          if (!struct) return results;
          if (struct.childNodes && Array.isArray(struct.childNodes)) {
            struct.childNodes.forEach((child: any, idx: number) => {
              const childPart = partPrefix ? `${partPrefix}.${idx + 1}` : String(idx + 1);
              results.push(...flattenStructure(child, childPart));
            });
            return results;
          }
          const type = (struct.type || "").toLowerCase();
          const subtype = (struct.subtype || "").toLowerCase();
          const params = struct.parameters || struct.params || {};
          const charset = (params.charset || "utf-8").toLowerCase();
          const encoding = (struct.encoding || "7bit").toLowerCase();
          const partId = partPrefix || "1";
          results.push({ type, subtype, charset, encoding, partId });
          return results;
        }

        const structParts = flattenStructure(msg.bodyStructure);
        console.log("bodyStructure parts:", JSON.stringify(structParts.map(p => ({ id: p.partId, t: `${p.type}/${p.subtype}`, cs: p.charset, enc: p.encoding }))));

        function findPartMeta(partKey: string): PartMeta | undefined {
          if (partKey === "TEXT") return structParts.find(p => p.type === "text");
          return structParts.find(p => p.partId === partKey);
        }

        const isLikelyBase64 = (value: string): boolean => {
          const compact = value.replace(/\s/g, "");
          if (compact.length < 24 || compact.length % 4 !== 0) return false;
          return /^[A-Za-z0-9+/=]+$/.test(compact);
        };

        const looksLikeMimeBlob = (value: string): boolean => {
          if (!value) return false;
          const lower = value.toLowerCase();
          return lower.includes("content-type: multipart/") ||
            lower.includes("content-transfer-encoding:") ||
            /(?:^|\r?\n)--[^\r\n]{8,}/.test(value);
        };

        const decodeByHeuristic = (value: string, charset = "utf-8") => {
          if (!isLikelyBase64(value)) return value;
          const decoded = decodeContent(value, "base64", charset);
          return decoded && decoded !== value ? decoded : value;
        };

        const extractMimeFromBlob = (value: string): { text: string; html: string } => {
          if (!value) return { text: "", html: "" };
          const maybeDecoded = decodeByHeuristic(value, "utf-8");
          if (!looksLikeMimeBlob(maybeDecoded)) return { text: "", html: "" };
          const parsed = parseMimeParts(maybeDecoded);
          return {
            text: (parsed.text || "").trim(),
            html: (parsed.html || "").trim(),
          };
        };

        const extractFromParts = (parts: unknown): { text: string; html: string } => {
          if (!parts || typeof parts !== "object") return { text: "", html: "" };
          let text = "";
          let html = "";

          for (const [partKey, partValue] of Object.entries(parts as Record<string, unknown>)) {
            const value = partValue as any;
            let rawBytes: Uint8Array | null = null;
            const rawField = value?.data ?? value?.body ?? value;
            if (rawField instanceof Uint8Array) {
              rawBytes = rawField;
            } else if (typeof rawField === "string") {
              rawBytes = Uint8Array.from(rawField, (c: string) => c.charCodeAt(0) & 0xff);
            }
            if (!rawBytes || rawBytes.length === 0) continue;

            const meta = findPartMeta(partKey);
            const headersRaw = String(value?.headers || value?.header || "");
            const headers = headersRaw.toLowerCase();

            const charset = meta?.charset || extractCharset(headers) || "utf-8";
            const encoding = meta?.encoding || extractEncoding(headers) || "7bit";
            const isHtmlPart = meta ? (meta.subtype === "html") : headers.includes("text/html");
            const isPlainPart = meta ? (meta.subtype === "plain") : headers.includes("text/plain");

            const rawStr = new TextDecoder("latin1").decode(rawBytes);

            let decoded = rawStr;
            if (encoding === "base64") {
              decoded = decodeContent(rawStr, "base64", charset);
            } else if (encoding === "quoted-printable") {
              decoded = decodeContent(rawStr, "quoted-printable", charset);
            } else {
              try {
                decoded = new TextDecoder(charset).decode(rawBytes);
              } catch {
                try { decoded = new TextDecoder("utf-8").decode(rawBytes); } catch { /* keep rawStr */ }
              }
            }

            const recovered = extractMimeFromBlob(decoded);
            if (recovered.html && !html) html = recovered.html;
            if (recovered.text && !text) text = recovered.text;
            if (recovered.html || recovered.text) continue;

            const decodedBase64 = decodeByHeuristic(decoded, charset);
            const nestedRecovered = decodedBase64 !== decoded ? extractMimeFromBlob(decodedBase64) : { text: "", html: "" };
            if (nestedRecovered.html && !html) html = nestedRecovered.html;
            if (nestedRecovered.text && !text) text = nestedRecovered.text;
            if (nestedRecovered.html || nestedRecovered.text) continue;

            const candidate = decodedBase64;
            const looksHtml = /<\/?[a-z][\s\S]*>/i.test(candidate);
            const hasMimeMarkers = looksLikeMimeBlob(candidate);

            if (!hasMimeMarkers && (isHtmlPart || (!isPlainPart && looksHtml)) && !html) {
              html = candidate;
            } else if (!text) {
              text = candidate;
            }
          }

          return { text, html };
        };

        const normalizeBodies = () => {
          const fromHtmlBlob = extractMimeFromBlob(bodyHtml);
          if (fromHtmlBlob.html) bodyHtml = fromHtmlBlob.html;
          if (fromHtmlBlob.text && !bodyText) bodyText = fromHtmlBlob.text;

          const fromTextBlob = extractMimeFromBlob(bodyText);
          if (fromTextBlob.html && !bodyHtml) bodyHtml = fromTextBlob.html;
          if (fromTextBlob.text && (!bodyText || looksLikeMimeBlob(bodyText))) bodyText = fromTextBlob.text;

          if (bodyText && !bodyHtml && isLikelyBase64(bodyText)) {
            const decodedText = decodeContent(bodyText, "base64", "utf-8");
            if (/<\/?[a-z][\s\S]*>/i.test(decodedText)) {
              bodyHtml = decodedText;
            } else if (decodedText !== bodyText) {
              bodyText = decodedText;
            }
          }

          if (bodyHtml && isLikelyBase64(bodyHtml)) {
            const decodedHtml = decodeContent(bodyHtml, "base64", "utf-8");
            if (/<\/?[a-z][\s\S]*>/i.test(decodedHtml)) bodyHtml = decodedHtml;
          }
        };

        // Try parts/bodyParts first
        const fromParts = extractFromParts(msg.parts);
        bodyText = fromParts.text;
        bodyHtml = fromParts.html;

        if (!bodyText && !bodyHtml) {
          const fromBodyParts = extractFromParts(msg.bodyParts);
          bodyText = fromBodyParts.text;
          bodyHtml = fromBodyParts.html;
        }

        normalizeBodies();

        // If bodyText looks like raw MIME, parse it
        if (bodyText && bodyText.includes("Content-Type:")) {
          const parsed = parseMimeParts(bodyText);
          if (parsed.html && !bodyHtml) bodyHtml = parsed.html;
          if (parsed.text) bodyText = parsed.text;
        }

        normalizeBodies();

        // Step 2: If parts yielded nothing, try source but only for small messages (< 500KB)
        if (!bodyText && !bodyHtml) {
          const msgSize = Number(msg.size || 0);
          const sizeLimit = 500_000;
          if (!msgSize || msgSize < sizeLimit) {
            try {
              console.log("Parts empty, falling back to source for uid", targetUid, "size:", msgSize);
              const srcMessages = await (client as any).fetch(String(targetUid), {
                byUid: true,
                uid: true,
                source: true,
              });
              const srcFetched = (Array.isArray(srcMessages) ? srcMessages : [srcMessages]).filter(Boolean);
              const srcMsg = srcFetched.find((item: any) => Number(item?.uid) === targetUid) || srcFetched[0];
              if (srcMsg?.source) {
                const rawStr = decodeData(srcMsg.source);
                if (rawStr) {
                  const parsed = parseMimeParts(rawStr);
                  bodyText = parsed.text;
                  bodyHtml = parsed.html;
                }
              }
            } catch (e) {
              console.error("source fallback failed:", e);
            }
          } else {
            console.log("Skipping source fallback for large message, size:", msgSize);
          }
        }

        normalizeBodies();

        // If no HTML and bodyText looks like HTML
        if (!bodyHtml && bodyText && (bodyText.includes("<html") || bodyText.includes("<div") || bodyText.includes("<table"))) {
          bodyHtml = bodyText;
        }

        console.log("fetch result - bodyText:", bodyText.length, "bodyHtml:", bodyHtml.length);

        const env = msg.envelope || {};
        const resolvedUid = Number.isFinite(Number(msg.uid)) ? Number(msg.uid) : targetUid;

        await client.disconnect();
        client = null;

        return ok({
          uid: resolvedUid,
          flags: msg.flags || [],
          subject: env.subject || "",
          from: env.from?.[0] ? {
            name: env.from[0].name || env.from[0].mailbox,
            email: `${env.from[0].mailbox}@${env.from[0].host}`,
          } : { name: "Unknown", email: "" },
          to: (env.to || []).map((a: any) => ({
            name: a.name || a.mailbox,
            email: `${a.mailbox}@${a.host}`,
          })),
          cc: (env.cc || []).map((a: any) => ({
            name: a.name || a.mailbox,
            email: `${a.mailbox}@${a.host}`,
          })),
          date: env.date || "",
          messageId: env.messageId || "",
          bodyText,
          bodyHtml,
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

        await client.disconnect();
        client = null;
        return ok({ success: true });
      }

      case "move": {
        const { folder = "INBOX", uid: moveUid, targetFolder } = body;
        if (!moveUid || !targetFolder) return err("Missing uid or targetFolder", 400);

        await client.selectMailbox(folder);
        await client.moveMessages(String(moveUid), targetFolder, true);

        await client.disconnect();
        client = null;
        return ok({ success: true });
      }

      case "delete": {
        const { folder = "INBOX", uid: delUid } = body;
        if (!delUid) return err("Missing uid", 400);

        await client.selectMailbox(folder);
        await client.setFlags(String(delUid), ["\\Deleted"], "add", true);
        // Expunge to permanently delete
        await client.expunge();

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
