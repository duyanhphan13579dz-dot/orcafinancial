"use client";

import type { ReactNode } from "react";

export function SettingsSection({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="panel p-5 md:p-6">
      <header className="mb-4">
        <h2 className="font-display text-lg md:text-xl font-bold text-white">{title}</h2>
        {description && <p className="text-xs md:text-sm text-slate-400 mt-1 leading-relaxed">{description}</p>}
      </header>
      <div className="space-y-4">{children}</div>
      {footer && <div className="mt-5 pt-4 border-t border-[#1a3558]/70">{footer}</div>}
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-2">
      <div className="sm:w-1/3 min-w-0">
        <div className="text-sm text-slate-200 font-medium">{label}</div>
        {hint && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{hint}</div>}
      </div>
      <div className="sm:flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-[#00d4ff]" : "bg-slate-700"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none min-h-[44px] disabled:opacity-60 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-3 py-2.5 text-sm text-white focus:border-[#00d4ff] focus:outline-none min-h-[44px] ${props.className ?? ""}`}
    />
  );
}

export function Button({
  variant = "primary",
  loading,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "danger" | "ghost";
  loading?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-gradient-to-r from-[#00d4ff] to-[#0073a8] text-[#0A2540]",
    outline: "border border-[#00d4ff] text-[#00d4ff] hover:bg-[#00d4ff]/10",
    danger: "border border-rose-600 text-rose-300 hover:bg-rose-950/40",
    ghost: "border border-[#2a4a75] text-slate-300 hover:border-[#00d4ff] hover:text-[#00d4ff]",
  }[variant];

  return (
    <button {...rest} disabled={rest.disabled || loading} className={`${base} ${styles} ${rest.className ?? ""}`}>
      {loading && (
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      )}
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  const styles = {
    neutral: "bg-slate-700/60 text-slate-300 border-slate-600",
    good: "bg-emerald-500/15 text-emerald-300 border-emerald-700",
    warn: "bg-amber-500/15 text-amber-300 border-amber-700",
    bad: "bg-rose-500/15 text-rose-300 border-rose-700",
  }[tone];
  return <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium ${styles}`}>{children}</span>;
}
