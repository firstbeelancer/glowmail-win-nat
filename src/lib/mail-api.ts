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

export async function fetchEmailList(folder = "INBOX", page = 1, pageSize = 50) {
  const data = await callImap("list", { folder, page, pageSize });
  return data;
}

export async function fetchEmailBody(folder: string, uid: number) {
  const data = await callImap("fetch", { folder, uid });
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

export async function searchEmails(folder: string, query: string) {
  const data = await callImap("search", { folder, query });
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
