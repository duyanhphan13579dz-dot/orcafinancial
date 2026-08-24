"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { isDocumentVisible, whenVisible } from "@/lib/client-visibility";
import type { CryptoSentimentIntelligence } from "@/lib/crypto/types";

function severityClass(s: string): string {
  if (s === "HIGH") return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  if (s === "MEDIUM") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-slate-700/50 bg-slate-900/40 text-slate-300";
}

function labelClass(l: string): string {
  if (l === "BULLISH") return "text-emerald-400";
  if (l === "BEARISH") return "text-rose-400";
  return "text-amber-300";
}

export function CryptoSentimentPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<CryptoSentimentIntelligence | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const load = () => {
      if (!isDocumentVisible()) return;
      void api<CryptoSentimentIntelligence>(
        `/crypto/${encodeURIComponent(symbol)}/sentiment-intel`,
      )
        .then((r) => {
          if (!cancelled) setData(r.data);
        })
        .catch(() => undefined);
    };
    // Defer first fetch slightly so chart/bundle paint first
    const t = setTimeout(load, 400);
    const id = setInterval(load, 120_000);
    const off = whenVisible(load);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(id);
      off();
    };
  }, [symbol]);

  if (!data) {
    return (
      <section className="panel overflow-hidden">
        <div className="px-4 py-2.5 text-xs text-slate-500">Social Sentiment · …</div>
      </section>
    );
  }

  if (!data.available) {
    return (
      <section className="panel overflow-hidden">
        <div className="px-4 py-2.5 text-xs text-slate-500">Sentiment · không có tin</div>
      </section>
    );
  }

  const d = data.distribution;

  return (
    <section className="panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-white/[0.02]"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold text-white">Social Sentiment</span>
          <span className={`text-xs font-bold ${labelClass(data.label)}`}>{data.label}</span>
          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {d.sampleSize} news
          </span>
        </div>
        <span className="text-xs text-slate-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800/80 px-3 pb-3 pt-2.5">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className={`text-xl font-black ${labelClass(data.label)}`}>{data.label}</span>
            <span className="text-[11px] text-slate-500">
              {data.score.toFixed(2)} · {Math.round(data.confidence * 100)}% conf
            </span>
          </div>

          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span className="text-emerald-400/90">{d.bullishPct}%</span>
            <span>{d.neutralPct}%</span>
            <span className="text-rose-400/90">{d.bearishPct}%</span>
          </div>
          <div className="mb-2.5 flex h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="bg-emerald-500" style={{ width: `${d.bullishPct}%` }} />
            <div className="bg-slate-500" style={{ width: `${d.neutralPct}%` }} />
            <div className="bg-rose-500" style={{ width: `${d.bearishPct}%` }} />
          </div>

          <div
            className={`mb-2.5 rounded-lg border p-2 text-[11px] leading-relaxed ${severityClass(data.divergence.severity)}`}
          >
            <div className="font-semibold">
              {data.divergence.title}
              <span className="ml-1.5 text-[9px] opacity-60">{data.divergence.severity}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 opacity-90">{data.divergence.insight}</p>
          </div>

          {data.headlines.length > 0 && (
            <div className="max-h-28 space-y-0.5 overflow-y-auto">
              {data.headlines.slice(0, 3).map((h, i) => (
                <a
                  key={`${h.link}-${i}`}
                  href={h.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-md bg-slate-900/50 px-2 py-1 text-[11px] transition hover:bg-slate-800/70"
                >
                  <span className={`mr-1 font-mono text-[9px] font-bold ${labelClass(h.lean)}`}>
                    {h.lean.slice(0, 4)}
                  </span>
                  <span className="text-slate-300 line-clamp-1">{h.title}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
