"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastCtx = createContext<{ push: (kind: ToastKind, message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-24 md:bottom-6 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-2xl backdrop-blur animate-in slide-in-from-bottom-2 max-w-[90vw] md:max-w-sm ${
              t.kind === "success"
                ? "border-emerald-700 bg-emerald-950/90 text-emerald-200"
                : t.kind === "error"
                  ? "border-rose-700 bg-rose-950/90 text-rose-200"
                  : "border-[#1a3558] bg-[#0e2e4f]/95 text-slate-200"
            }`}
          >
            <span className="mr-2">{t.kind === "success" ? "✓" : t.kind === "error" ? "✕" : "ℹ"}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Graceful no-op if a component is rendered outside the provider.
    return { push: () => {} };
  }
  return ctx;
}
