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

        // Fetch raw RFC822 message (source + body parts) for reliable parsing
        let msg: any = null;
        try {
          const messages = await (client as any).fetch(String(targetUid), {
            byUid: true,
            uid: true,
            envelope: true,
            flags: true,
            source: true,
            bodyParts: ["TEXT", "1", "1.1", "1.2", "2"],
          });
          const fetched = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
          msg = fetched.find((item: any) => Number(item?.uid) === targetUid) || fetched[0] || null;
        } catch (e) {
          console.error("fetch with source failed:", e);
          // Fallback: try a minimal body-part only request
          try {
            const messages = await (client as any).fetch(String(targetUid), {
              byUid: true,
              uid: true,
              envelope: true,
              flags: true,
              bodyParts: ["TEXT"],
            });
            const fetched = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
            msg = fetched.find((item: any) => Number(item?.uid) === targetUid) || fetched[0] || null;
          } catch (e2) {
            console.error("fallback fetch also failed:", e2);
          }
        }

        if (!msg) {
          await client.disconnect();
          client = null;
          return ok({ uid, flags: [], subject: "", from: { name: "Unknown", email: "" }, to: [], cc: [], date: "", messageId: "", bodyText: "", bodyHtml: "", notFound: true });
        }

        let bodyText = "";
        let bodyHtml = "";

        const extractFromParts = (parts: unknown): { text: string; html: string } => {
          if (!parts || typeof parts !== "object") return { text: "", html: "" };
          let text = "";
          let html = "";

          for (const [, partValue] of Object.entries(parts as Record<string, unknown>)) {
            const value = partValue as any;
            const raw = decodeData(value?.data ?? value?.body ?? value);
            if (!raw) continue;

            const headers = String(value?.headers || value?.header || "").toLowerCase();
            const isHtml = headers.includes("text/html") || /<\/?[a-z][\s\S]*>/i.test(raw);

            if (isHtml && !html) html = raw;
            else if (!text) text = raw;
          }

          return { text, html };
        };

        // Primary: parse from raw source (most reliable)
        if (msg.source) {
          const rawStr = decodeData(msg.source);
          if (rawStr) {
            const parsed = parseMimeParts(rawStr);
            bodyText = parsed.text;
            bodyHtml = parsed.html;
          }
        }

        // Fallback: deno-imap can return parts as either `parts` or `bodyParts`
        if (!bodyText && !bodyHtml) {
          const fromParts = extractFromParts(msg.parts);
          bodyText = fromParts.text;
          bodyHtml = fromParts.html;
        }

        if (!bodyText && !bodyHtml) {
          const fromBodyParts = extractFromParts(msg.bodyParts);
          bodyText = fromBodyParts.text;
          bodyHtml = fromBodyParts.html;
        }

        // If bodyText looks like raw MIME, parse it
        if (bodyText && !bodyHtml && bodyText.includes("Content-Type:")) {
          const parsed = parseMimeParts(bodyText);
          if (parsed.html) bodyHtml = parsed.html;
          if (parsed.text) bodyText = parsed.text;
        }

        // If no HTML and bodyText looks like HTML
        if (!bodyHtml && bodyText && (bodyText.includes("<html") || bodyText.includes("<div") || bodyText.includes("<table"))) {
          bodyHtml = bodyText;
        }

        console.log(
          "fetch result - bodyText length:",
          bodyText.length,
          "bodyHtml length:",
          bodyHtml.length,
          "has source:",
          !!msg.source,
          "has parts:",
          !!msg.parts,
          "has bodyParts:",
          !!msg.bodyParts,
        );

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
