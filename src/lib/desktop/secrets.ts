import { invoke } from "@tauri-apps/api/core";

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function setNativeSecret(secretKey: string, secretValue: string): Promise<void> {
  if (!isDesktopRuntime()) return;

  await invoke("secret_store_set", {
    secretKey,
    secretValue,
  });
}

export async function getNativeSecret(secretKey: string): Promise<string | null> {
  if (!isDesktopRuntime()) return null;

  const value = await invoke<string | null>("secret_store_get", {
    secretKey,
  });

  return value ?? null;
}

export async function deleteNativeSecret(secretKey: string): Promise<void> {
  if (!isDesktopRuntime()) return;

  await invoke("secret_store_delete", {
    secretKey,
  });
}
