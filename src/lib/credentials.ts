import {
  deleteNativeSecret,
  getNativeSecret,
  isDesktopRuntime,
  setNativeSecret,
} from "@/lib/desktop/secrets";

const STORAGE_KEY = "glowmail_credentials";
const OBF_KEY = "GlowMail2026!xK9";

type StoredCredentialsMetadata = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  email: string;
  name: string;
  password?: string;
  _obf?: boolean;
};

export type StoredCredentials = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  email: string;
  password: string;
  name: string;
};

function xorObfuscate(input: string): string {
  const key = OBF_KEY;
  let result = "";
  for (let i = 0; i < input.length; i++) {
    result += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result);
}

function xorDeobfuscate(encoded: string): string {
  const key = OBF_KEY;
  const decoded = atob(encoded);
  let result = "";
  for (let i = 0; i < decoded.length; i++) {
    result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

function getPasswordSecretKey(email: string): string {
  return `mail-password:${email.toLowerCase()}`;
}

function parseCredentialMetadata(): StoredCredentialsMetadata | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredCredentialsMetadata;
  } catch {
    return null;
  }
}

function persistCredentialMetadata(metadata: StoredCredentialsMetadata): void {
  const sanitized: StoredCredentialsMetadata = {
    imapHost: metadata.imapHost,
    imapPort: metadata.imapPort,
    smtpHost: metadata.smtpHost,
    smtpPort: metadata.smtpPort,
    email: metadata.email,
    name: metadata.name,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
}

export function getCredentialProfile(): Omit<StoredCredentials, "password"> | null {
  const metadata = parseCredentialMetadata();
  if (!metadata) return null;

  return {
    imapHost: metadata.imapHost,
    imapPort: metadata.imapPort,
    smtpHost: metadata.smtpHost,
    smtpPort: metadata.smtpPort,
    email: metadata.email,
    name: metadata.name || metadata.email?.split("@")[0] || "",
  };
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  persistCredentialMetadata({
    imapHost: creds.imapHost,
    imapPort: creds.imapPort,
    smtpHost: creds.smtpHost,
    smtpPort: creds.smtpPort,
    email: creds.email,
    name: creds.name,
  });

  if (isDesktopRuntime()) {
    await setNativeSecret(getPasswordSecretKey(creds.email), creds.password);
    return;
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      imapHost: creds.imapHost,
      imapPort: creds.imapPort,
      smtpHost: creds.smtpHost,
      smtpPort: creds.smtpPort,
      email: creds.email,
      name: creds.name,
      password: xorObfuscate(creds.password),
      _obf: true,
    }),
  );
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const metadata = parseCredentialMetadata();
  if (!metadata) return null;

  const fallbackPassword = metadata.password
    ? metadata._obf
      ? xorDeobfuscate(metadata.password)
      : metadata.password
    : null;

  if (isDesktopRuntime()) {
    const secretKey = getPasswordSecretKey(metadata.email);
    let password = await getNativeSecret(secretKey);

    if (!password && fallbackPassword) {
      password = fallbackPassword;
      await setNativeSecret(secretKey, password);
      persistCredentialMetadata(metadata);
    }

    if (!password) return null;

    return {
      imapHost: metadata.imapHost,
      imapPort: metadata.imapPort,
      smtpHost: metadata.smtpHost,
      smtpPort: metadata.smtpPort,
      email: metadata.email,
      password,
      name: metadata.name || metadata.email?.split("@")[0] || "",
    };
  }

  if (!fallbackPassword) return null;

  return {
    imapHost: metadata.imapHost,
    imapPort: metadata.imapPort,
    smtpHost: metadata.smtpHost,
    smtpPort: metadata.smtpPort,
    email: metadata.email,
    password: fallbackPassword,
    name: metadata.name || metadata.email?.split("@")[0] || "",
  };
}

export async function clearCredentials(): Promise<void> {
  const metadata = parseCredentialMetadata();
  localStorage.removeItem(STORAGE_KEY);

  if (isDesktopRuntime() && metadata?.email) {
    await deleteNativeSecret(getPasswordSecretKey(metadata.email));
  }
}

export function hasCredentials(): boolean {
  return !!parseCredentialMetadata();
}
