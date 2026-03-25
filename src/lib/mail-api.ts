import { supabase } from "@/integrations/supabase/client";
import { loadCredentials } from "./credentials";

export type MailCredentials = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  email: string;
  password: string;
};

function getCredentials(): MailCredentials | null {
  return loadCredentials();
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

export async function searchEmails(folder: string, query: string, page = 1, pageSize = 30) {
  const data = await callImap("search", { folder, query, page, pageSize });
  return data;
}

export async function reindexSearchCache(folder = "INBOX", limit = 50, cursor: number | null = null) {
  const data = await callImap("reindex-search-cache", { folder, limit, cursor });
  return data;
}


export async function appendToFolder(folder: string, rawMessage: string, flags?: string[]) {
  return callImap("append", { folder, rawMessage, flags });
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

/* ─── Crypto proxy helpers ─── */
async function callCrypto(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("crypto-proxy", {
    body: { action, ...extra },
  });
  if (error) throw new Error(error.message || "Crypto request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function pgpVerifySignature(params: {
  armoredMessage?: string;
  cleartext?: string;
  publicKeyArmored: string;
}) {
  return callCrypto("pgp-verify", params);
}

export async function pgpDecryptMessage(params: {
  armoredMessage: string;
  privateKeyArmored: string;
  passphrase?: string;
}) {
  return callCrypto("pgp-decrypt", params);
}

export async function pgpSignMessage(params: {
  text: string;
  privateKeyArmored: string;
  passphrase?: string;
}) {
  return callCrypto("pgp-sign", params);
}

export async function pgpEncryptMessage(params: {
  text: string;
  recipientPublicKeys: string[];
  privateKeyArmored?: string;
  passphrase?: string;
}) {
  return callCrypto("pgp-encrypt", params);
}

export async function smimeCertInfo(certPem: string) {
  return callCrypto("smime-info", { certPem });
}

export async function sendToTigerMediaHub(params: {
  projectUrl: string;
  apiKey: string;
  userId: string;
  folder?: string;
  fileName: string;
  fileBase64: string;
  fileType: string;
}) {
  const { data, error } = await supabase.functions.invoke("tmh-proxy", {
    body: params,
  });

  if (error) throw new Error(error.message || "TMH request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}
