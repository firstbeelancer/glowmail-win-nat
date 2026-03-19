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
            body: true,
          });
        } catch (fetchErr) {
          console.error("fetch with body failed, retrying without body:", fetchErr);
          messages = await client.fetch(String(uid), {
            uid: true,
            envelope: true,
            flags: true,
          });
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

        // Try to extract body text
        let bodyText = "";
        let bodyHtml = "";
        
        if (msg.body) {
          if (typeof msg.body === "string") {
            bodyText = msg.body;
          } else if (typeof msg.body === "object") {
            bodyText = msg.body["1"] || msg.body["TEXT"] || msg.body["text"] || "";
            if (!bodyText) {
              // Try first available key
              const keys = Object.keys(msg.body);
              if (keys.length > 0) bodyText = String(msg.body[keys[0]] || "");
            }
          }
        }
        
        // Simple check if it's HTML
        if (bodyText.includes("<html") || bodyText.includes("<div") || bodyText.includes("<p")) {
          bodyHtml = bodyText;
        }

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
