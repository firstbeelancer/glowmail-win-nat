import { ImapClient } from "deno-imap";
import PostalMime from "postal-mime";

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

        // Fetch raw RFC822 source
        let rawSource: Uint8Array | null = null;
        let envelope: any = null;
        let flags: string[] = [];

        try {
          const messages = await (client as any).fetch(String(targetUid), {
            byUid: true,
            uid: true,
            envelope: true,
            flags: true,
            source: true,
          });
          const fetched = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
          const msg = fetched.find((item: any) => Number(item?.uid) === targetUid) || fetched[0];

          if (msg) {
            envelope = msg.envelope;
            flags = msg.flags || [];

            if (msg.source instanceof Uint8Array) {
              rawSource = msg.source;
            } else if (typeof msg.source === "string") {
              rawSource = new TextEncoder().encode(msg.source);
            }
          }
        } catch (e) {
          console.error("fetch source failed:", e);
        }

        if (!rawSource) {
          await client.disconnect();
          client = null;
          return ok({
            uid: targetUid,
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

        // Parse with postal-mime
        const parser = new PostalMime();
        const parsed = await parser.parse(rawSource);

        const bodyText = parsed.text || "";
        const bodyHtml = parsed.html || "";

        console.log(
          "fetch result (postal-mime) - bodyText:",
          bodyText.length,
          "bodyHtml:",
          bodyHtml.length,
          "attachments:",
          (parsed.attachments || []).length,
        );

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
