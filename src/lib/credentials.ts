/**
 * Credential storage with basic obfuscation.
 * NOT encryption — protects against casual inspection of localStorage,
 * not against a determined attacker with devtools access.
 */

const STORAGE_KEY = 'glowmail_credentials';

// Simple XOR-based obfuscation (not cryptographic security)
const OBF_KEY = 'GlowMail2026!xK9';

function xorObfuscate(input: string): string {
  const key = OBF_KEY;
  let result = '';
  for (let i = 0; i < input.length; i++) {
    result += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result); // base64 for safe storage
}

function xorDeobfuscate(encoded: string): string {
  const key = OBF_KEY;
  const decoded = atob(encoded);
  let result = '';
  for (let i = 0; i < decoded.length; i++) {
    result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

export type StoredCredentials = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  email: string;
  password: string;
  name: string;
};

export function saveCredentials(creds: StoredCredentials): void {
  const payload = {
    ...creds,
    password: xorObfuscate(creds.password),
    _obf: true,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadCredentials(): StoredCredentials | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Handle legacy unobfuscated credentials
    const password = parsed._obf
      ? xorDeobfuscate(parsed.password)
      : parsed.password;
    return {
      imapHost: parsed.imapHost,
      imapPort: parsed.imapPort,
      smtpHost: parsed.smtpHost,
      smtpPort: parsed.smtpPort,
      email: parsed.email,
      password,
      name: parsed.name || parsed.email?.split('@')[0] || '',
    };
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasCredentials(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}
