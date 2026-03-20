import { supabase } from "@/integrations/supabase/client";

export type MailCredentials = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  email: string;
  password: string;
};

function getCredentials(): MailCredentials | null {
  const raw = localStorage.getItem("glowmail_credentials");
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    return {
      imapHost: c.imapHost,
      imapPort: c.imapPort,
      smtpHost: c.smtpHost,
      smtpPort: c.smtpPort,
      email: c.email,
      password: c.password,
    };
  } catch {
    return null;
  }
}

function makeAccountKey(host: string, username: string) {
  return `${host.trim().toLowerCase()}::${username.trim().toLowerCase()}`;
}

function getAccountKey(): string | null {
  const creds = getCredentials();
  if (!creds) return null;
  return makeAccountKey(creds.imapHost, creds.email);
}

async function callImap(action: string, extra: Record<string, unknown> = {}) {
  const creds = getCredentials();
  if (!creds) throw new Error("Not logged in");

  const { data, error } = await supabase.functions.invoke("imap-proxy", {
    body: {
      action,
      host: creds.imapHost,
      port: creds.imapPort,
      username: creds.email,
      password: creds.password,
      ...extra,
    },
  });

  if (error) throw new Error(error.message || "IMAP request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function fetchFolders() {
  const data = await callImap("folders");
  return data.folders || [];
}

function cacheRowToEmail(row: any) {
  return {
    uid: Number(row.uid),
    flags: row.flags || [],
    size: 0,
    subject: row.subject || "(No Subject)",
    from: { name: row.from_name || "Unknown", email: row.from_email || "" },
    to: row.to_addresses || [],
    cc: row.cc_addresses || [],
    date: row.sent_at || new Date().toISOString(),
    messageId: row.message_id || "",
    inReplyTo: row.in_reply_to || "",
    hasAttachments: row.has_attachments || false,
    attachments: (row.attachment_names || []).map((name: string) => ({
      name,
      size: 0,
      type: "application/octet-stream",
    })),
  };
}

/**
 * Local-first email list: try Supabase cache first, fall back to IMAP.
 * Always triggers IMAP sync in background to keep cache fresh.
 */
export async function fetchEmailList(folder = "INBOX", page = 1, pageSize = 50) {
  const accountKey = getAccountKey();

  if (accountKey) {
    try {
      const offset = (page - 1) * pageSize;
      const [{ data: cached, error: cacheError }, { data: countData }] = await Promise.all([
        supabase.rpc("list_cached_emails", {
          p_account_key: accountKey,
          p_folder_id: folder,
          p_limit: pageSize,
          p_offset: offset,
        }),
        supabase.rpc("count_cached_emails", {
          p_account_key: accountKey,
          p_folder_id: folder,
        }),
      ]);

      const totalCached = Number(countData) || 0;

      if (!cacheError && cached && (cached as any[]).length > 0) {
        const emails = (cached as any[]).map(cacheRowToEmail);

        // Trigger background IMAP sync (non-blocking)
        callImap("list", { folder, page: 1, pageSize }).catch(() => {});

        return { emails, total: totalCached, page, pageSize, fromCache: true };
      }
    } catch (e) {
      console.warn("Local cache read failed, falling back to IMAP:", e);
    }
  }

  // Fallback to IMAP
  const data = await callImap("list", { folder, page, pageSize });
  return data;
}

export async function fetchEmailBody(folder: string, uid: number) {
  const data = await callImap("fetch", { folder, uid, includeAttachmentContent: false });
  return data;
}

export async function setEmailFlags(folder: string, uid: number, addFlags?: string[], removeFlags?: string[]) {
  return callImap("flags", { folder, uid, addFlags, removeFlags });
}

export async function moveEmail(folder: string, uid: number, targetFolder: string) {
  return callImap("move", { folder, uid, targetFolder });
}

export async function copyEmail(folder: string, uid: number, targetFolder: string) {
  return callImap("copy", { folder, uid, targetFolder });
}

export async function deleteEmail(folder: string, uid: number) {
  return callImap("delete", { folder, uid });
}

/**
 * Local-first search: try Supabase cache first, fall back to IMAP search.
 */
export async function searchEmails(folder: string, query: string, page = 1, pageSize = 30) {
  const accountKey = getAccountKey();

  if (accountKey) {
    try {
      const offset = (page - 1) * pageSize;
      const { data: uidRows, error: searchError } = await supabase.rpc("search_email_search_cache", {
        p_account_key: accountKey,
        p_folder_id: folder,
        p_query: query,
        p_limit: pageSize + 1,
        p_offset: offset,
      });

      if (!searchError && uidRows && (uidRows as any[]).length > 0) {
        const hasMore = (uidRows as any[]).length > pageSize;
        const uids = (uidRows as any[]).slice(0, pageSize).map((r: any) => Number(r.uid));

        const { data: rows } = await supabase
          .from("email_search_cache")
          .select("*")
          .eq("account_key", accountKey)
          .eq("folder_id", folder)
          .in("uid", uids);

        if (rows && (rows as any[]).length > 0) {
          const rowMap = new Map((rows as any[]).map((r: any) => [Number(r.uid), r]));
          const emails = uids.map((uid) => rowMap.get(uid)).filter(Boolean).map(cacheRowToEmail);

          // Also trigger IMAP search in background to populate cache
          callImap("search", { folder, query, page: 1, pageSize: 30 }).catch(() => {});

          // Count total
          const { data: totalUids } = await supabase.rpc("search_email_search_cache", {
            p_account_key: accountKey,
            p_folder_id: folder,
            p_query: query,
            p_limit: 1000,
            p_offset: 0,
          });
          const total = totalUids ? (totalUids as any[]).length : emails.length;

          return { emails, total, page, pageSize, hasMore, fromCache: true };
        }
      }
    } catch (e) {
      console.warn("Local cache search failed, falling back to IMAP:", e);
    }
  }

  // Fallback to IMAP search
  const data = await callImap("search", { folder, query, page, pageSize });
  return data;
}

export async function sendEmail(params: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
}) {
  const creds = getCredentials();
  if (!creds) throw new Error("Not logged in");

  const { data, error } = await supabase.functions.invoke("smtp-proxy", {
    body: {
      host: creds.smtpHost,
      port: creds.smtpPort,
      username: creds.email,
      password: creds.password,
      from: creds.email,
      ...params,
    },
  });

  if (error) throw new Error(error.message || "SMTP request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}
