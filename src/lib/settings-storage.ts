import {
  deleteNativeSecret,
  getNativeSecret,
  isDesktopRuntime,
  setNativeSecret,
} from "@/lib/desktop/secrets";
import type { CryptoKeys, UserSettings } from "@/types";

export const SETTINGS_STORAGE_KEY = "glowmail_settings";
const AI_API_KEY_SECRET = "ai-api-key";
const TMH_API_KEY_SECRET = "tmh-api-key";
const SMIME_PRIVATE_KEY_SECRET = "crypto-smime-key-pem";
const SMIME_CERT_PASSWORD_SECRET = "crypto-smime-cert-password";
const PGP_PRIVATE_KEY_SECRET = "crypto-pgp-private-key";
const PGP_PASSPHRASE_SECRET = "crypto-pgp-passphrase";

type SecureSettingsPayload = {
  aiApiKey: string;
  tigerMediaHubApiKey: string;
  cryptoKeys: Pick<
    CryptoKeys,
    "smimeKeyPem" | "smimeCertPassword" | "pgpPrivateKey" | "pgpPassphrase"
  >;
};

export function loadPersistedSettings(): Partial<UserSettings> {
  const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!saved) return {};

  try {
    const parsed = JSON.parse(saved) as Partial<UserSettings>;
    if ("aiApiKey" in parsed) {
      delete (parsed as Partial<UserSettings> & { aiApiKey?: string }).aiApiKey;
    }
    if (parsed.tigerMediaHub && "apiKey" in parsed.tigerMediaHub) {
      parsed.tigerMediaHub = {
        ...parsed.tigerMediaHub,
        apiKey: "",
      };
    }
    if (parsed.cryptoKeys) {
      parsed.cryptoKeys = {
        ...parsed.cryptoKeys,
        smimeKeyPem: undefined,
        smimeCertPassword: undefined,
        pgpPrivateKey: undefined,
        pgpPassphrase: undefined,
      };
    }
    return parsed;
  } catch (error) {
    console.error("Failed to parse settings", error);
    return {};
  }
}

export function persistSettings(settings: UserSettings): void {
  const sanitized: UserSettings = {
    ...settings,
    aiApiKey: "",
    tigerMediaHub: {
      ...settings.tigerMediaHub,
      apiKey: "",
    },
    cryptoKeys: {
      ...settings.cryptoKeys,
      smimeKeyPem: undefined,
      smimeCertPassword: undefined,
      pgpPrivateKey: undefined,
      pgpPassphrase: undefined,
    },
  };

  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
}

export async function loadAiApiKey(): Promise<string> {
  if (!isDesktopRuntime()) {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return "";

    try {
      const parsed = JSON.parse(saved) as Partial<UserSettings>;
      return parsed.aiApiKey || "";
    } catch {
      return "";
    }
  }

  const secret = await getNativeSecret(AI_API_KEY_SECRET);
  if (secret) return secret;

  const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!saved) return "";

  try {
    const parsed = JSON.parse(saved) as Partial<UserSettings>;
    const legacyKey = parsed.aiApiKey || "";

    if (legacyKey) {
      await setNativeSecret(AI_API_KEY_SECRET, legacyKey);
      persistSettings({
        ...(parsed as UserSettings),
        aiApiKey: legacyKey,
      });
    }

    return legacyKey;
  } catch {
    return "";
  }
}

export async function persistAiApiKey(secret: string): Promise<void> {
  if (!isDesktopRuntime()) return;

  if (secret.trim()) {
    await setNativeSecret(AI_API_KEY_SECRET, secret);
  } else {
    await deleteNativeSecret(AI_API_KEY_SECRET);
  }
}

async function readSecretWithLegacyFallback(
  secretKey: string,
  legacyValue: string | undefined,
): Promise<string> {
  if (!isDesktopRuntime()) {
    return legacyValue || "";
  }

  const secret = await getNativeSecret(secretKey);
  if (secret) return secret;

  if (legacyValue) {
    await setNativeSecret(secretKey, legacyValue);
    return legacyValue;
  }

  return "";
}

async function writeOptionalSecret(secretKey: string, value: string | undefined): Promise<void> {
  if (!isDesktopRuntime()) return;

  if (value?.trim()) {
    await setNativeSecret(secretKey, value);
  } else {
    await deleteNativeSecret(secretKey);
  }
}

export async function loadSecureSettings(): Promise<SecureSettingsPayload> {
  const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
  let parsed: Partial<UserSettings> = {};

  if (saved) {
    try {
      parsed = JSON.parse(saved) as Partial<UserSettings>;
    } catch {
      parsed = {};
    }
  }

  const cryptoKeys = parsed.cryptoKeys || {};

  return {
    aiApiKey: await readSecretWithLegacyFallback(AI_API_KEY_SECRET, parsed.aiApiKey),
    tigerMediaHubApiKey: await readSecretWithLegacyFallback(
      TMH_API_KEY_SECRET,
      parsed.tigerMediaHub?.apiKey,
    ),
    cryptoKeys: {
      smimeKeyPem: await readSecretWithLegacyFallback(
        SMIME_PRIVATE_KEY_SECRET,
        cryptoKeys.smimeKeyPem,
      ),
      smimeCertPassword: await readSecretWithLegacyFallback(
        SMIME_CERT_PASSWORD_SECRET,
        cryptoKeys.smimeCertPassword,
      ),
      pgpPrivateKey: await readSecretWithLegacyFallback(
        PGP_PRIVATE_KEY_SECRET,
        cryptoKeys.pgpPrivateKey,
      ),
      pgpPassphrase: await readSecretWithLegacyFallback(
        PGP_PASSPHRASE_SECRET,
        cryptoKeys.pgpPassphrase,
      ),
    },
  };
}

export async function persistSecureSettings(settings: UserSettings): Promise<void> {
  if (!isDesktopRuntime()) return;

  await Promise.all([
    writeOptionalSecret(AI_API_KEY_SECRET, settings.aiApiKey),
    writeOptionalSecret(TMH_API_KEY_SECRET, settings.tigerMediaHub?.apiKey),
    writeOptionalSecret(SMIME_PRIVATE_KEY_SECRET, settings.cryptoKeys?.smimeKeyPem),
    writeOptionalSecret(
      SMIME_CERT_PASSWORD_SECRET,
      settings.cryptoKeys?.smimeCertPassword,
    ),
    writeOptionalSecret(PGP_PRIVATE_KEY_SECRET, settings.cryptoKeys?.pgpPrivateKey),
    writeOptionalSecret(PGP_PASSPHRASE_SECRET, settings.cryptoKeys?.pgpPassphrase),
  ]);
}
