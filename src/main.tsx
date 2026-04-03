import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const ERROR_STORAGE_KEY = "glowmail_runtime_error";

function isDesktopTauriRuntime() {
  if (typeof window === "undefined") return false;

  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    navigator.userAgent.includes("Tauri")
  );
}

async function clearDesktopServiceWorkers() {
  if (!isDesktopTauriRuntime()) return;

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
    }
  } catch (error) {
    console.warn("Failed to clear desktop service workers", error);
  }
}

function formatRuntimeError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ""}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function persistRuntimeError(error: unknown) {
  const message = formatRuntimeError(error);
  try {
    localStorage.setItem(ERROR_STORAGE_KEY, message);
  } catch {
    // Ignore storage failures.
  }
  renderFatalError(message);
}

function renderFatalError(message: string) {
  const root = document.getElementById("root");
  if (!root) return;

  root.innerHTML = `
    <div style="min-height:100vh;background:radial-gradient(circle at top, rgba(34,211,238,0.18), transparent 45%), #07131d;color:#e6f7fb;font-family:'Segoe UI',sans-serif;padding:32px 20px;display:flex;align-items:center;justify-content:center;">
      <div style="width:min(900px,100%);background:rgba(7,19,29,0.92);border:1px solid rgba(34,211,238,0.3);border-radius:20px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,0.45);">
        <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;">GlowMail упал при запуске</h1>
        <p style="margin:0 0 16px;color:#bfeaf0;line-height:1.5;">Пришли мне этот текст ошибки, и я добью баг уже точечно.</p>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;background:rgba(2,6,12,0.9);border-radius:14px;padding:16px;overflow:auto;max-height:50vh;color:#8ef0ff;">${escapeHtml(
          message,
        )}</pre>
      </div>
    </div>
  `;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.addEventListener("error", (event) => {
  persistRuntimeError(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  persistRuntimeError(event.reason);
});

clearDesktopServiceWorkers()
  .catch((error) => {
    console.warn("Desktop startup cleanup failed", error);
  })
  .finally(() => {
    try {
      createRoot(document.getElementById("root")!).render(<App />);
    } catch (error) {
      persistRuntimeError(error);
    }
  });
