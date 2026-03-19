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
        function decodeData(data: unknown): string {
          if (data instanceof Uint8Array) {
            return new TextDecoder().decode(data);
          }
          if (typeof data === "string") return data;
          return "";
        }

        // Try to extract body text from different sources
        let bodyText = "";
        let bodyHtml = "";
        
        // Method 1: parts.TEXT (from bodyParts)
        if (msg.parts?.TEXT?.data) {
          bodyText = decodeData(msg.parts.TEXT.data);
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
                const partHeader = part.substring(0, partSplit).toLowerCase();
                const partBody = part.substring(partSplit + 4).replace(/--$/, "").trim();
                
                // Decode quoted-printable or base64
                let decoded = partBody;
                if (partHeader.includes("base64")) {
                  try { decoded = atob(partBody.replace(/\s/g, "")); } catch { decoded = partBody; }
                  // Handle UTF-8 from base64
                  try {
                    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
                    decoded = new TextDecoder("utf-8").decode(bytes);
                  } catch { /* keep as is */ }
                } else if (partHeader.includes("quoted-printable")) {
                  decoded = partBody
                    .replace(/=\r?\n/g, "")
                    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
                  try {
                    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
                    decoded = new TextDecoder("utf-8").decode(bytes);
                  } catch { /* keep as is */ }
                }
                
                if (partHeader.includes("text/html")) {
                  bodyHtml = decoded;
                } else if (partHeader.includes("text/plain") && !bodyText) {
                  bodyText = decoded;
                }
              }
            } else {
              // Single part message
              let decoded = bodyPart;
              if (headerPart.toLowerCase().includes("base64")) {
                try { decoded = atob(bodyPart.replace(/\s/g, "")); } catch { decoded = bodyPart; }
                try {
                  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
                  decoded = new TextDecoder("utf-8").decode(bytes);
                } catch { /* keep as is */ }
              } else if (headerPart.toLowerCase().includes("quoted-printable")) {
                decoded = bodyPart
                  .replace(/=\r?\n/g, "")
                  .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
                try {
                  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
                  decoded = new TextDecoder("utf-8").decode(bytes);
                } catch { /* keep as is */ }
              }
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
