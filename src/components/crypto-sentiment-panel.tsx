"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { CryptoSentimentIntelligence } from "@/lib/crypto/types";

function severityClass(s: string): string {
  if (s === "HIGH") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  if (s === "MEDIUM") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-slate-600 bg-slate-900/40 text-slate-300";
}

function labelClass(l: string): string {
  if (l === "BULLISH") return "text-emerald-400";
  if (l === "BEARISH") return "text-rose-400";
  return "text-amber-300";
}

export function CryptoSentimentPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<CryptoSentimentIntelligence | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const load = () => {
      void api<CryptoSentimentIntelligence>(
        `/crypto/${encodeURIComponent(symbol)}/sentiment-intel`,
      )
        .then((r) => {
          if (!cancelled) setData(r.data);
        })
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  if (!data?.available) {
    return (
      <div className="panel p-4">
        <h2 className="mb-3 font-semibold text-white">Social Sentiment</h2>
        <div className="text-sm text-slate-500">Đang tải sentiment…</div>
      </div>
    );
  }

  const d = data.distribution;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-white">Social Sentiment</h2>
        <span className="text-[10px] text-slate-500">
          {d.sampleSize} headlines · {data.scoringSource}
          {data.model ? ` · ${data.model}` : ""}
        </span>
      </div>

      <div className="mb-3 flex items-end gap-3">
        <div className={`text-3xl font-black ${labelClass(data.label)}`}>
          {data.label}
        </div>
        <div className="mb-1 text-sm text-slate-400">
          score {data.score.toFixed(3)} · conf {Math.round(data.confidence * 100)}%
        </div>
      </div>

      <div className="mb-2 text-[10px] text-slate-500">
        Bullish {d.bullishPct}% · Neutral {d.neutralPct}% · Bearish {d.bearishPct}%
      </div>
      <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className="bg-emerald-500/80" style={{ width: `${d.bullishPct}%` }} />
        <div className="bg-slate-500/80" style={{ width: `${d.neutralPct}%` }} />
        <div className="bg-rose-500/80" style={{ width: `${d.bearishPct}%` }} />
      </div>

      <div
        className={`mb-4 rounded-lg border p-3 text-xs ${severityClass(data.divergence.severity)}`}
      >
        <div className="font-semibold">
          Divergence · {data.divergence.title}
          <span className="ml-2 text-[10px] opacity-70">{data.divergence.severity}</span>
        </div>
        <p className="mt-1 opacity-90">{data.divergence.insight}</p>
      </div>

      {data.headlines.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Headlines
          </div>
          {data.headlines.slice(0, 5).map((h, i) => (
            <a
              key={`${h.link}-${i}`}
              href={h.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded bg-slate-900/40 px-2 py-1.5 text-xs hover:bg-slate-800/60"
            >
              <span className={`mr-1.5 font-mono text-[10px] ${labelClass(h.lean)}`}>
                {h.lean.slice(0, 4)}
              </span>
              <span className="text-slate-300">{h.title}</span>
              <span className="mt-0.5 block text-[10px] text-slate-500">
                {h.source}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
