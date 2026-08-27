"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

interface ScalpingResult {
  symbol: string;
  signal: "LONG" | "SHORT" | "WAIT";
  state: string;
  paperOnly: boolean;
  executionEnabled: boolean;
  group: string;
  dataQuality: { score: number; gaps: string[] };
  blockers: string[];
  bestCandidate: {
    strategy: string;
    score: number;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    riskRewardAfterCosts: number;
    reasons: string[];
    risk: { quantity: number; notional: number; riskAmount: number; valid: boolean };
  } | null;
}

function fmt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value < 1 ? value.toFixed(6) : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function signalLabel(signal: ScalpingResult["signal"]): string {
  return signal === "LONG" ? "Mua" : signal === "SHORT" ? "Bán" : "Chờ";
}

function signalClass(signal: ScalpingResult["signal"]) {
  if (signal === "LONG") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (signal === "SHORT") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  return "border-amber-500/40 bg-amber-500/10 text-amber-300";
}

export default function CryptoScalpingPanel({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ScalpingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    void api<ScalpingResult>(
      `/crypto/${encodeURIComponent(symbol)}/scalping?orderFlow=0`,
      { timeoutMs: 4_000 },
    )
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [open, data, symbol]);

  const candidate = data?.bestCandidate;
  return (
    <section className="panel border border-[#00d4ff]/20 p-3.5 sm:p-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-[#00d4ff]">Crypto · Scalping · M15–M5–M1</div>
          <div className="mt-1 text-sm font-semibold text-white">Tín hiệu nghiên cứu nhiều mã</div>
        </div>
        <div className="flex items-center gap-2">
          {data && <span className={`rounded-md border px-2 py-1 text-xs font-black ${signalClass(data.signal)}`}>{signalLabel(data.signal)}</span>}
          <span className="text-xs text-slate-500">{open ? "Thu gọn" : "Mở panel"}</span>
        </div>
      </button>

      {open && (
        <div className="mt-3 border-t border-white/10 pt-3">
          {open && !data && !error && <div className="h-24 animate-pulse rounded-lg bg-slate-800/50" />}
          {error && <div className="text-xs text-rose-300">Không tải được scalping: {error}</div>}
          {data && (
            <>
              <div className={`rounded-lg border p-3 ${signalClass(data.signal)}`}>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide opacity-70">Tín hiệu định lượng</div>
                    <div className="mt-1 text-3xl font-black">{signalLabel(data.signal)}</div>
                  </div>
                  <div className="text-right text-[10px] opacity-80">
                    <div>{data.state} · {data.group}</div>
                    <div>Chất lượng dữ liệu {data.dataQuality.score.toFixed(0)}/15</div>
                  </div>
                </div>
              </div>

              {candidate ? (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Chiến lược</div><div className="font-semibold text-white">{candidate.strategy}</div></div>
                    <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Điểm</div><div className="font-mono font-semibold text-white">{candidate.score.toFixed(1)}/100</div></div>
                    <div className="rounded bg-black/20 p-2"><div className="text-slate-500">R:R sau phí</div><div className="font-mono font-semibold text-white">{candidate.riskRewardAfterCosts.toFixed(2)}</div></div>
                    <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Rủi ro mô phỏng</div><div className="font-mono font-semibold text-white">${fmt(candidate.risk.riskAmount)}</div></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><div className="text-slate-500">Điểm vào</div><div className="font-mono text-white">{fmt(candidate.entry)}</div></div>
                    <div><div className="text-slate-500">SL</div><div className="font-mono text-rose-300">{fmt(candidate.stopLoss)}</div></div>
                    <div><div className="text-slate-500">TP</div><div className="font-mono text-emerald-300">{fmt(candidate.takeProfit)}</div></div>
                  </div>
                  <div className="space-y-1 text-xs text-slate-300">
                    {candidate.reasons.map((reason) => <div key={reason}>• {reason}</div>)}
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-xs text-slate-400">Chưa có thiết lập đạt điều kiện; hệ thống đang chờ.</div>
              )}

              {(data.blockers.length > 0 || data.dataQuality.gaps.length > 0) && (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] text-amber-200">
                  <div className="font-semibold">Giới hạn an toàn</div>
                  {[...new Set([...data.blockers, ...data.dataQuality.gaps])].slice(0, 5).map((blocker) => <div key={blocker}>• {blocker}</div>)}
                </div>
              )}
              <div className="mt-3 text-[10px] text-slate-500">Chỉ dùng để mô phỏng và nghiên cứu · Không gửi lệnh thật.</div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
