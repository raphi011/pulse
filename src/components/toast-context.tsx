"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastVariant = "error" | "info";
type Toast = { id: number; message: string; variant: ToastVariant };
type ToastValue = { toast: (message: string, variant?: ToastVariant) => void };

const ToastContext = createContext<ToastValue | null>(null);
const DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "error") => {
      const id = nextId.current++;
      setToasts((ts) => [...ts, { id, message, variant }]);
      setTimeout(() => dismiss(id), DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm shadow-lg ring-1 ${
              t.variant === "error"
                ? "bg-danger/10 text-danger ring-danger/30"
                : "bg-card text-slate-700 ring-border dark:bg-card-dark dark:text-slate-200 dark:ring-border-dark"
            }`}
          >
            <span aria-hidden className="mt-px select-none">{t.variant === "error" ? "⚠" : "ℹ"}</span>
            <p className="min-w-0 flex-1 break-words">{t.message}</p>
            <button
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
