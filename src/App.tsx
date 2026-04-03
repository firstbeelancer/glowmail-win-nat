import { Component, type ErrorInfo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();
const ERROR_STORAGE_KEY = "glowmail_runtime_error";

type ErrorBoundaryState = {
  error: string | null;
};

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      error: stringifyError(error),
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    const message = [stringifyError(error), errorInfo.componentStack]
      .filter(Boolean)
      .join("\n\n");
    persistRuntimeError(message);
  }

  render() {
    if (this.state.error) {
      return <FatalErrorScreen error={this.state.error} />;
    }

    return this.props.children;
  }
}

function stringifyError(error: unknown) {
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

function persistRuntimeError(message: string) {
  try {
    localStorage.setItem(ERROR_STORAGE_KEY, message);
  } catch {
    // Ignore storage failures and still show the in-memory fallback UI.
  }
}

function clearRuntimeError() {
  try {
    localStorage.removeItem(ERROR_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function FatalErrorScreen({ error }: { error: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(34,211,238,0.18), transparent 45%), #07131d",
        color: "#e6f7fb",
        fontFamily: "Segoe UI, sans-serif",
        padding: "32px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "min(900px, 100%)",
          background: "rgba(7, 19, 29, 0.92)",
          border: "1px solid rgba(34, 211, 238, 0.3)",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.45)",
        }}
      >
        <h1 style={{ margin: "0 0 12px", fontSize: "28px", fontWeight: 700 }}>
          GlowMail упал при запуске
        </h1>
        <p style={{ margin: "0 0 16px", color: "#bfeaf0", lineHeight: 1.5 }}>
          Вместо чёрного экрана я теперь показываю текст ошибки. Пришли мне этот текст, и я
          добью баг уже точечно.
        </p>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "rgba(2, 6, 12, 0.9)",
            borderRadius: "14px",
            padding: "16px",
            overflow: "auto",
            maxHeight: "50vh",
            color: "#8ef0ff",
          }}
        >
          {error}
        </pre>
        <button
          type="button"
          onClick={() => {
            clearRuntimeError();
            window.location.reload();
          }}
          style={{
            marginTop: "16px",
            border: "none",
            borderRadius: "999px",
            padding: "12px 18px",
            background: "#22d3ee",
            color: "#06202a",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Перезапустить окно
        </button>
      </div>
    </div>
  );
}

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
