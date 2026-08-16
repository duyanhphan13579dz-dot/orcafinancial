"use client";

import { useState, useEffect, useId } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { ProtectedPage } from "@/components/ProtectedPage";

const METHODS = [
  { id: "canslim", name: "CANSLIM", desc: "Bộ lọc tăng trưởng William O'Neil", defaultMin: 70 },
  { id: "minervini", name: "Trend Template", desc: "Bộ lọc xu hướng Mark Minervini", defaultMin: 80 },
  { id: "wyckoff", name: "Wyckoff", desc: "Xác định pha Tích lũy/Phân phối", defaultMin: 60 },
  { id: "elliott", name: "Elliott Wave", desc: "Đếm sóng đẩy và điều chỉnh", defaultMin: 55 },
];

const PRESETS = [
  { value: 40, label: "Lỏng" },
  { value: 60, label: "Vừa" },
  { value: 75, label: "Chặt" },
  { value: 90, label: "Elite" },
];

export default function ScreenerPage() {
  const sliderId = useId();
  const [method, setMethod] = useState("canslim");
  const [minScore, setMinScore] = useState<number>(METHODS[0].defaultMin);
  const [results, setResults] = useState<any[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [passedCount, setPassedCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScreen = async (mId: string, score: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<any>(`/screener/${mId}?minScore=${score}`);
      setResults(res.data.results);
      setTotal(res.data.totalEvaluated ?? res.data.universeSize ?? 0);
      setPassedCount(res.data.passedCount ?? res.data.results.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Reset slider when method changes
  useEffect(() => {
    const m = METHODS.find((x) => x.id === method);
    if (m) setMinScore(m.defaultMin);
  }, [method]);

  // Re-run when either method or score changes (debounced)
  useEffect(() => {
    const t = setTimeout(() => void runScreen(method, minScore), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, minScore]);

  const currentMethod = METHODS.find((m) => m.id === method)!;
  const sliderPct = ((minScore - 1) / 99) * 100;

  return (
    <ProtectedPage featureName="bộ lọc cổ phiếu">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-[#00d4ff] uppercase">ORCA Quantitative Screener</div>
            <h1 className="display-xl text-4xl md:text-5xl text-white mt-1">Stock Screener</h1>
            <p className="text-sm text-slate-400 mt-2 max-w-2xl">
              {currentMethod.desc} · Điều chỉnh ngưỡng điểm tối thiểu để tinh chỉnh kết quả theo khẩu vị rủi ro của bạn.
            </p>
          </div>
        <div className="flex gap-2 flex-wrap">
          {METHODS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`font-display rounded-md border px-4 py-2 text-sm font-bold transition-all ${
                method === m.id
                  ? "border-[#00d4ff] bg-[#00d4ff]/15 text-[#00d4ff] shadow-[0_0_20px_-6px_rgba(0,212,255,0.6)]"
                  : "border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-500"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {/* Score threshold control */}
      <div className="panel p-5 relative scanlines overflow-hidden bg-gradient-to-br from-[#0a1d33] via-[#0A2540] to-[#0a1d33]">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5 items-center">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-mono text-[10px] tracking-[0.25em] text-slate-400 uppercase">Min score threshold</div>
                <div className="flex items-baseline gap-3 mt-1">
                  <span className="font-display text-5xl font-extrabold text-white tabular-nums leading-none">{minScore}</span>
                  <span className="font-mono text-xs text-slate-500">/ 100</span>
                </div>
              </div>
              <div className="flex gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setMinScore(p.value)}
                    className={`font-mono rounded border px-2.5 py-1 text-[10px] tracking-wider transition-all ${
                      minScore === p.value
                        ? "border-[#00d4ff] bg-[#00d4ff]/15 text-[#00d4ff]"
                        : "border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {p.label} · {p.value}
                  </button>
                ))}
              </div>
            </div>
            <input
              id={sliderId}
              type="range"
              min={1}
              max={100}
              value={minScore}
              onChange={(e) => setMinScore(parseInt(e.target.value, 10))}
              className="orca-range"
              style={{ ["--pct" as any]: `${sliderPct}%` }}
            />
            <div className="flex justify-between font-mono text-[9px] text-slate-500 mt-1.5 tracking-widest">
              <span>1 · MỞ RỘNG</span>
              <span>25</span>
              <span>50 · CÂN BẰNG</span>
              <span>75</span>
              <span>100 · ELITE</span>
            </div>
          </div>

          <div className="flex gap-3 lg:border-l lg:border-[#1a3558] lg:pl-5">
            <div className="text-center">
              <div className="font-mono text-[9px] tracking-[0.25em] text-slate-500 uppercase">Universe</div>
              <div className="font-display text-2xl font-bold text-white tabular-nums">{total}</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-[9px] tracking-[0.25em] text-slate-500 uppercase">Passed</div>
              <div className="font-display text-2xl font-bold text-[#00d4ff] tabular-nums">{passedCount}</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-[9px] tracking-[0.25em] text-slate-500 uppercase">Hit rate</div>
              <div className="font-display text-2xl font-bold text-emerald-300 tabular-nums">
                {total > 0 ? `${((passedCount / total) * 100).toFixed(0)}%` : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="panel border-rose-700 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</div>}

      {loading ? (
        <div className="p-12 text-center text-slate-500">
          <div className="inline-block h-6 w-6 rounded-full border-2 border-[#00d4ff] border-t-transparent animate-spin" />
          <div className="mt-2 text-xs font-mono tracking-widest uppercase">Đang sàng lọc dữ liệu thật…</div>
        </div>
      ) : results.length === 0 ? (
        <div className="panel p-10 text-center">
          <div className="font-display text-lg text-slate-300">Không có cổ phiếu nào đạt ngưỡng {minScore}/100</div>
          <div className="text-xs text-slate-500 mt-1">Hãy hạ ngưỡng điểm hoặc đổi phương pháp để mở rộng tập kết quả.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 reveal-stagger">
          {results.map((r) => (
            <div key={r.symbol} className="panel p-5 border-[#1a3558] hover:border-[#00d4ff]/50 transition-all relative overflow-hidden group">
              <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#00d4ff]/5 to-transparent pointer-events-none" />
              <div className="flex items-start justify-between relative">
                <div>
                  <Link href={`/stocks/${r.symbol}`} className="font-display text-2xl font-extrabold text-white hover:text-[#00d4ff] tracking-tight">
                    {r.symbol}
                  </Link>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider font-mono ${
                        r.score >= 80 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-700/50"
                          : r.score >= 60 ? "bg-amber-500/15 text-amber-300 border border-amber-700/50"
                          : "bg-slate-700/50 text-slate-300 border border-slate-600/50"
                      }`}
                    >
                      {r.classification}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-3xl font-extrabold tabular-nums" style={{ color: r.score >= 80 ? "#34d399" : r.score >= 60 ? "#fbbf24" : "#b8cfe2" }}>
                    {r.score}
                  </div>
                  <div className="font-mono text-[9px] text-slate-500 tracking-widest">/ 100</div>
                </div>
              </div>

              <div className="mt-3 bar-track">
                <div className="bar-fill" style={{ width: `${r.score}%`, background: r.score >= 80 ? "#34d399" : r.score >= 60 ? "#fbbf24" : "#00d4ff" }} />
              </div>

              <div className="mt-4 space-y-1.5">
                {r.reasons.slice(0, 5).map((reason: string, i: number) => (
                  <div key={i} className="flex gap-2 text-[11px] text-slate-300 leading-snug">
                    <span className="text-[#00d4ff] font-bold">›</span>
                    <span>{reason}</span>
                  </div>
                ))}
                {r.reasons.length > 5 && <div className="text-[10px] text-slate-500 italic pl-4">+ {r.reasons.length - 5} tiêu chí khác</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </ProtectedPage>
  );
}
