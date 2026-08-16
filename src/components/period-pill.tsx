"use client";

import type { ReactNode } from "react";

/** Vietnamese period pill — small monospaced chip with display-period code + Vi label on hover. */
export function PeriodPill({ displayPeriod, displayPeriodVi, shortTag, className }: { displayPeriod: string; displayPeriodVi?: string; shortTag?: string; className?: string }) {
  return (
    <span
      title={displayPeriodVi ?? displayPeriod}
      className={`inline-flex items-center gap-1.5 rounded-md border border-[#1a3558] bg-[#0a1d33]/70 px-2 py-0.5 text-[10px] font-mono tabular-nums text-[#b8cfe2] ${className ?? ""}`}
    >
      <span className="h-1 w-1 rounded-full bg-[#00d4ff]" />
      {displayPeriod}
      {displayPeriodVi && <span className="text-[9px] italic text-slate-500">· {displayPeriodVi}</span>}
    </span>
  );
}

export function SectionTitle({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
      <div>
        {eyebrow && <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-1">{eyebrow}</div>}
        <h3 className="font-display text-xl md:text-2xl font-extrabold text-white tracking-tight">{title}</h3>
      </div>
      {children && <div className="text-xs text-slate-400">{children}</div>}
    </div>
  );
}
