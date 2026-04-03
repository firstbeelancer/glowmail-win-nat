import { invoke } from "@tauri-apps/api/core";

export type BackendProvider = "supabase" | "native";

type BackendPayload = Record<string, unknown>;
const NATIVE_DESKTOP_FUNCTIONS = new Set(["imap-proxy", "smtp-proxy"]);

function isDesktopTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;

  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    navigator.userAgent.includes("Tauri")
  );
}

function readConfiguredProvider(): BackendProvider {
  const configured = import.meta.env.VITE_BACKEND_PROVIDER;

  if (configured === "native" || configured === "supabase") {
    return configured;
  }

  return "supabase";
}

export function getBackendProvider(): BackendProvider {
  return readConfiguredProvider();
}

async function invokeSupabaseFunction<T>(
  functionName: string,
  payload: BackendPayload,
): Promise<T> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error("Supabase URL or publishable key is not configured");
  }

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.error || data?.message || `${functionName} request failed`,
    );
  }

  return data as T;
}

async function invokeNativeFunction<T>(
  functionName: string,
  payload: BackendPayload,
): Promise<T> {
  return invoke<T>("native_backend_invoke", {
    request: {
      functionName,
      payload,
    },
  });
}

export async function invokeBackendFunction<T>(
  functionName: string,
  payload: BackendPayload = {},
): Promise<T> {
  const configuredProvider = readConfiguredProvider();
  const isDesktop = isDesktopTauriRuntime();

  if (configuredProvider === "native") {
    return invokeNativeFunction<T>(functionName, payload);
  }

  if (isDesktop && NATIVE_DESKTOP_FUNCTIONS.has(functionName)) {
    return invokeNativeFunction<T>(functionName, payload);
  }

  return invokeSupabaseFunction<T>(functionName, payload);
}
