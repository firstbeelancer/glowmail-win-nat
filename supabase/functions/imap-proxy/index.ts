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
          bodyStructure: true,
          size: true,
        });

        const normalized = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);

        // Helper: extract attachment info from bodyStructure
        const extractAttachments = (bs: any): { name: string; size: number; type: string }[] => {
          if (!bs) return [];
          const atts: { name: string; size: number; type: string }[] = [];
          const walk = (node: any) => {
            if (!node) return;
            // Handle both possible field names from different IMAP libs
            const disposition = (node.disposition || node.contentDisposition || '').toLowerCase();
            const nodeType = node.type || node.mediaType || '';
            const nodeSubtype = node.subtype || node.mediaSubtype || '';
            const mimeType = `${nodeType}/${nodeSubtype}`.toLowerCase();
            const filename = node.dispositionParameters?.filename 
              || node.parameters?.name 
              || node.contentDispositionParameters?.filename
              || node.attrs?.name
              || '';

            const isTextBody = ['text/plain', 'text/html'].includes(mimeType);
            const isAttachment = disposition === 'attachment' ||
              (disposition === 'inline' && node.id && mimeType.startsWith('image/')) ||
              (filename && !isTextBody) ||
              (!isTextBody && !mimeType.startsWith('multipart/') && !mimeType.startsWith('message/') && mimeType !== '/' && disposition !== '' && disposition !== 'inline');

            if (isAttachment) {
              atts.push({
                name: filename || 'unnamed',
                size: node.size || 0,
                type: mimeType,
              });
            }
            // Walk children in various structures
            const children = node.childNodes || node.parts || node.body;
            if (Array.isArray(children)) {
              children.forEach(walk);
            }
          };
          walk(bs);
          return atts;
        };

        const emails = normalized
          .filter((msg: any) => Number.isFinite(Number(msg?.uid)))
          .map((msg: any) => {
            const env = msg.envelope || {};
            const attachments = extractAttachments(msg.bodyStructure);
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
              attachments,
            };
          })
          .sort((a: any, b: any) => b.uid - a.uid); // newest first

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

        let rawSource: Uint8Array | null = null;
        let envelope: any = null;
        let flags: string[] = [];

        let msgSourceType = "undefined";
        let msgSourceConstructor = "undefined";
        let rawSourceOrigin = "none";

        const toUint8Array = (value: unknown): Uint8Array | null => {
          if (value instanceof Uint8Array) return value;
          if (typeof value === "string") return new TextEncoder().encode(value);
          if (value instanceof ArrayBuffer) return new Uint8Array(value);
          if (value && typeof value === "object") {
            const maybe = value as { buffer?: unknown; byteOffset?: unknown; byteLength?: unknown };
            if (maybe.buffer instanceof ArrayBuffer) {
              const byteOffset = typeof maybe.byteOffset === "number" ? maybe.byteOffset : 0;
              const byteLength = typeof maybe.byteLength === "number" ? maybe.byteLength : undefined;
              return new Uint8Array(maybe.buffer, byteOffset, byteLength);
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

        const readRawCandidate = (label: string, value: unknown) => {
          if (value == null) return;
          const converted = toUint8Array(value);
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
            source: true,
          });

          const fetched = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
          const msg = fetched.find((item: any) => Number(item?.uid) === targetUid) || fetched[0];

          if (msg) {
            envelope = msg.envelope;
            flags = msg.flags || [];
            msgSourceType = typeof msg.source;
            msgSourceConstructor = msg.source?.constructor?.name || "undefined";

            readRawCandidate("msg.source", msg.source);
            if (!rawSource) readRawCandidate("msg.raw", msg.raw);

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
              bodyParts: [""],
            });

            const fetched2 = (Array.isArray(messages2) ? messages2 : [messages2]).filter(Boolean);
            const msg2 = fetched2.find((item: any) => Number(item?.uid) === targetUid) || fetched2[0];

            if (msg2) {
              if (!envelope) envelope = msg2.envelope;
              if (!flags.length) flags = msg2.flags || [];

              if (!rawSource) readRawCandidate("msg2.source", msg2.source);
              if (!rawSource) readRawCandidate("msg2.raw", msg2.raw);

              const bodyContent = msg2.bodyParts?.get?.("") || msg2.body?.get?.("") || msg2["body[]"];
              console.log(
                "fallback bodyParts - hasContent:",
                !!bodyContent,
                "type:",
                typeof bodyContent,
                "keys:",
                Object.keys(msg2).join(","),
              );

              if (!rawSource) readRawCandidate("msg2.body[]", bodyContent);
            }
          } catch (e2) {
            console.error("fetch bodyParts fallback failed:", e2);
          }
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

        const rawPreview = (() => {
          try {
            return new TextDecoder().decode(rawSource.slice(0, 300));
          } catch {
            return "[raw preview unavailable]";
          }
        })();

        const parsed = await PostalMime.parse(rawSource);

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

        // Extract attachments with base64 content for download
        const attachments = (parsed.attachments || [])
          .filter((a: any) => {
            const mimeType = (a.mimeType || '').toLowerCase();
            return mimeType !== 'text/plain' && mimeType !== 'text/html';
          })
          .map((a: any) => {
            let contentBase64 = '';
            try {
              if (a.content) {
                const bytes = a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content);
                // Convert to base64
                let binary = '';
                for (let i = 0; i < bytes.length; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                contentBase64 = btoa(binary);
              }
            } catch { /* skip content if encoding fails */ }
            return {
              name: a.filename || 'unnamed',
              size: a.content?.length || 0,
              type: a.mimeType || 'application/octet-stream',
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
