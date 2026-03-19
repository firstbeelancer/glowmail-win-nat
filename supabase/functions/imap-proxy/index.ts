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
        
        // Search all messages to get UIDs
        const uids = await client.search({ all: true }, true);
        
        const total = uids.length;
        // Get latest messages first
        const sortedUids = [...uids].sort((a, b) => b - a);
        const start = (page - 1) * pageSize;
        const pageUids = sortedUids.slice(start, start + pageSize);
        
        if (pageUids.length === 0) {
          await client.disconnect();
          client = null;
          return ok({ emails: [], total, page, pageSize });
        }

        const sequence = pageUids.join(",");
        const messages = await client.fetch(sequence, {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          size: true,
        });

        const emails = (Array.isArray(messages) ? messages : [messages]).map((msg: any) => {
          const env = msg.envelope || {};
          return {
            uid: msg.uid,
            flags: msg.flags || [],
            size: msg.size || 0,
            subject: env.subject || "(No Subject)",
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
            date: env.date || new Date().toISOString(),
            messageId: env.messageId || "",
            inReplyTo: env.inReplyTo || "",
          };
        });

        await client.disconnect();
        client = null;
        return ok({ emails, total, page, pageSize });
      }

      case "fetch": {
        const { folder = "INBOX", uid } = body;
        if (!uid) return err("Missing uid", 400);

        await client.selectMailbox(folder);

        let messages;
        try {
          messages = await client.fetch(String(uid), {
            uid: true,
            envelope: true,
            flags: true,
            bodyParts: ["HEADER", "TEXT"],
            full: true,
          });
        } catch (fetchErr) {
          console.error("fetch with bodyParts failed, retrying with full only:", fetchErr);
          try {
            messages = await client.fetch(String(uid), {
              uid: true,
              envelope: true,
              flags: true,
              full: true,
            });
          } catch (fetchErr2) {
            console.error("fetch with full failed too:", fetchErr2);
            messages = await client.fetch(String(uid), {
              uid: true,
              envelope: true,
              flags: true,
            });
          }
        }

        const msg = Array.isArray(messages) ? messages[0] : messages;
        
        if (!msg) {
          await client.disconnect();
          client = null;
          return ok({
            uid,
            flags: [],
            subject: "",
            from: { name: "Unknown", email: "" },
            to: [],
            cc: [],
            date: "",
            messageId: "",
            bodyText: "",
            bodyHtml: "",
            notFound: true,
          });
        }

        // Helper to decode Uint8Array
        function decodeData(data: unknown, charset = "utf-8"): string {
          if (data instanceof Uint8Array) {
            try {
              return new TextDecoder(charset).decode(data);
            } catch {
              return new TextDecoder("utf-8").decode(data);
            }
          }
          if (typeof data === "string") return data;
          return "";
        }

        function normalizeNewlines(value: string): string {
          return value.replace(/\r\n/g, "\n");
        }

        // Extract charset from Content-Type header
        function extractCharset(header: string): string {
          const match = header.match(/charset=["']?([^"';\s]+)/i);
          return match ? match[1].trim() : "utf-8";
        }

        // Detect encoding from header
        function extractEncoding(header: string): string {
          if (header.includes("base64")) return "base64";
          if (header.includes("quoted-printable")) return "quoted-printable";
          return "7bit";
        }

        // Decode content based on encoding and charset
        function decodeContent(body: string, encoding: string, charset: string): string {
          let decoded = body;

          if (encoding === "base64") {
            try {
              const clean = body.replace(/\s/g, "");
              const binary = atob(clean);
              const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
              try {
                decoded = new TextDecoder(charset).decode(bytes);
              } catch {
                decoded = new TextDecoder("utf-8").decode(bytes);
              }
            } catch {
              decoded = body;
            }
          } else if (encoding === "quoted-printable") {
            const clean = body.replace(/=\r?\n/g, "");
            const bytes: number[] = [];
            for (let i = 0; i < clean.length; i++) {
              const ch = clean[i];
              const hex = clean.slice(i + 1, i + 3);
              if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
                bytes.push(parseInt(hex, 16));
                i += 2;
              } else {
                bytes.push(clean.charCodeAt(i) & 0xff);
              }
            }

            try {
              const byteArray = new Uint8Array(bytes);
              try {
                decoded = new TextDecoder(charset).decode(byteArray);
              } catch {
                decoded = new TextDecoder("utf-8").decode(byteArray);
              }
            } catch {
              decoded = clean;
            }
          }

          return decoded;
        }

        // Parse multipart text blob when body already contains MIME boundaries
        function parseMultipartBlob(source: string): { text: string; html: string } {
          const normalized = normalizeNewlines(source);
          const boundaryMatch = normalized.match(/(?:^|\n)--([^\n-][^\n]*)/);
          if (!boundaryMatch) return { text: "", html: "" };

          const boundary = boundaryMatch[1].trim();
          const parts = normalized.split("--" + boundary);
          let text = "";
          let html = "";

          for (const rawPart of parts) {
            const part = rawPart.trim();
            if (!part || part === "--") continue;

            const partSplit = part.indexOf("\n\n");
            if (partSplit === -1) continue;

            const partHeaderRaw = part.substring(0, partSplit);
            const partHeaderLower = partHeaderRaw.toLowerCase();
            const partBody = part.substring(partSplit + 2).replace(/\n--$/, "").trim();

            if (partHeaderLower.includes("multipart/")) {
              const nested = parseMultipartBlob(partBody);
              if (!text && nested.text) text = nested.text;
              if (!html && nested.html) html = nested.html;
              continue;
            }

            const isText = partHeaderLower.includes("content-type: text/plain");
            const isHtml = partHeaderLower.includes("content-type: text/html");
            if (!isText && !isHtml) continue;

            const charset = extractCharset(partHeaderLower);
            const encoding = extractEncoding(partHeaderLower);
            const decoded = decodeContent(partBody, encoding, charset);

            if (isHtml) {
              html = decoded;
            } else if (!text) {
              text = decoded;
            }
          }

          return { text: text.trim(), html: html.trim() };
        }

        // Try to extract body text from different sources
        let bodyText = "";
        let bodyHtml = "";
        
        // Method 1: parts.TEXT (from bodyParts)
        if (msg.parts?.TEXT?.data) {
          bodyText = decodeData(msg.parts.TEXT.data);
          const parsed = parseMultipartBlob(bodyText);
          if (parsed.text || parsed.html) {
            bodyText = parsed.text || bodyText;
            bodyHtml = parsed.html;
          }
        }
        // Method 2: raw message - parse MIME
        else if (msg.raw) {
          const rawText = decodeData(msg.raw);
          const headerBodySplit = rawText.indexOf("\r\n\r\n");
          if (headerBodySplit > -1) {
            const headerPart = rawText.substring(0, headerBodySplit);
            const bodyPart = rawText.substring(headerBodySplit + 4);
            
            // Check for multipart
            const boundaryMatch = headerPart.match(/boundary="?([^";\s]+)"?/i);
            if (boundaryMatch) {
              const boundary = boundaryMatch[1];
              const parts = bodyPart.split("--" + boundary);
              for (const part of parts) {
                if (part.trim() === "--" || part.trim() === "") continue;
                const partSplit = part.indexOf("\r\n\r\n");
                if (partSplit === -1) continue;
                const partHeaderRaw = part.substring(0, partSplit);
                const partHeaderLower = partHeaderRaw.toLowerCase();
                const partBody = part.substring(partSplit + 4).replace(/--$/, "").trim();
                
                // Check for nested multipart (e.g. multipart/alternative inside multipart/mixed)
                const nestedBoundaryMatch = partHeaderRaw.match(/boundary="?([^";\s]+)"?/i);
                if (nestedBoundaryMatch) {
                  const nestedBoundary = nestedBoundaryMatch[1];
                  const nestedParts = partBody.split("--" + nestedBoundary);
                  for (const np of nestedParts) {
                    if (np.trim() === "--" || np.trim() === "") continue;
                    const npSplit = np.indexOf("\r\n\r\n");
                    if (npSplit === -1) continue;
                    const npHeaderRaw = np.substring(0, npSplit);
                    const npHeaderLower = npHeaderRaw.toLowerCase();
                    const npBody = np.substring(npSplit + 4).replace(/--$/, "").trim();
                    const npCharset = extractCharset(npHeaderLower);
                    const npEncoding = extractEncoding(npHeaderLower);
                    const npDecoded = decodeContent(npBody, npEncoding, npCharset);
                    
                    if (npHeaderLower.includes("text/html")) {
                      bodyHtml = npDecoded;
                    } else if (npHeaderLower.includes("text/plain") && !bodyText) {
                      bodyText = npDecoded;
                    }
                  }
                  continue;
                }
                
                const charset = extractCharset(partHeaderLower);
                const encoding = extractEncoding(partHeaderLower);
                const decoded = decodeContent(partBody, encoding, charset);
                
                if (partHeaderLower.includes("text/html")) {
                  bodyHtml = decoded;
                } else if (partHeaderLower.includes("text/plain") && !bodyText) {
                  bodyText = decoded;
                }
              }
            } else {
              // Single part message
              const charset = extractCharset(headerPart.toLowerCase());
              const encoding = extractEncoding(headerPart.toLowerCase());
              const decoded = decodeContent(bodyPart, encoding, charset);
              bodyText = decoded;
            }
          }
        }
        // Method 3: body property (legacy fallback)
        else if (msg.body) {
          if (typeof msg.body === "string") {
            bodyText = msg.body;
          } else if (typeof msg.body === "object") {
            bodyText = msg.body["1"] || msg.body["TEXT"] || msg.body["text"] || "";
            if (!bodyText) {
              const keys = Object.keys(msg.body);
              if (keys.length > 0) bodyText = String(msg.body[keys[0]] || "");
            }
          }

          const parsed = parseMultipartBlob(bodyText);
          if (parsed.text || parsed.html) {
            bodyText = parsed.text || bodyText;
            bodyHtml = parsed.html;
          }
        }
        
        // If we got HTML but no plain text, use HTML
        if (!bodyText && bodyHtml) bodyText = bodyHtml;
        // If bodyText looks like HTML, set bodyHtml
        if (!bodyHtml && bodyText && (bodyText.includes("<html") || bodyText.includes("<div") || bodyText.includes("<p") || bodyText.includes("<table"))) {
          bodyHtml = bodyText;
        }

        console.log("fetch result - bodyText length:", bodyText.length, "bodyHtml length:", bodyHtml.length, "has parts:", !!msg.parts, "has raw:", !!msg.raw);

        const env = msg.envelope || {};
        
        await client.disconnect();
        client = null;

        return ok({
          uid: msg.uid,
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
