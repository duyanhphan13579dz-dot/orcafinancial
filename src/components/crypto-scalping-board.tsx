"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Row = {
  symbol: string;
  signal: "LONG" | "SHORT" | "WAIT";
  state: string;
  group: string;
  bestCandidate: { strategy: string; score: number; riskRewardAfterCosts: number } | null;
  blockers: string[];
};

function signalLabel(signal: string): string {
  return signal === "LONG" ? "Mua" : signal === "SHORT" ? "Bán" : "Chờ";
}

function signalClass(signal: string) {
  if (signal === "LONG") return "text-emerald-300";
  if (signal === "SHORT") return "text-rose-300";
  return "text-amber-300";
}

export default function CryptoScalpingBoard() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || rows.length) return;
    let cancelled = false;
    void api<{ results: Row[] }>("/crypto/scalping?orderFlow=0", { timeoutMs: 4_000 })
      .then((response) => {
        if (!cancelled) setRows(response.data.results ?? []);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [open, rows.length]);

  return (
    <section className="panel border border-[#00d4ff]/20 p-3 sm:p-4">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open}>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-[#00d4ff]">Bộ quét scalping</div>
          <div className="mt-1 text-sm font-semibold text-white">M15–M5–M1 · Cặp USDT nổi bật</div>
        </div>
        <span className="text-xs text-slate-500">{open ? "Thu gọn" : "Mở bộ quét"}</span>
      </button>
      {open && (
        <div className="mt-3 border-t border-white/10 pt-3">
          {open && !rows.length && !error && <div className="h-20 animate-pulse rounded-lg bg-slate-800/50" />}
          {error && <div className="text-xs text-rose-300">Không tải được bộ quét: {error}</div>}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-800"><th className="px-2 py-2">Mã</th><th className="px-2 py-2">Tín hiệu</th><th className="px-2 py-2">Chiến lược</th><th className="px-2 py-2">Điểm</th><th className="px-2 py-2">R:R</th><th className="px-2 py-2">Trạng thái</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.symbol} className="border-b border-slate-800/70">
                      <td className="px-2 py-2 font-semibold text-white">{row.symbol}</td>
                      <td className={`px-2 py-2 font-black ${signalClass(row.signal)}`}>{signalLabel(row.signal)}</td>
                      <td className="px-2 py-2 text-slate-300">{row.bestCandidate?.strategy ?? "—"}</td>
                      <td className="px-2 py-2 font-mono text-slate-300">{row.bestCandidate?.score?.toFixed(1) ?? "—"}</td>
                      <td className="px-2 py-2 font-mono text-slate-300">{row.bestCandidate?.riskRewardAfterCosts?.toFixed(2) ?? "—"}</td>
                      <td className="px-2 py-2 text-slate-500">{row.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!error && rows.length === 0 && open && <div className="text-xs text-slate-400">Chưa có setup đạt điều kiện. Hệ thống không tự động gửi lệnh.</div>}
          <div className="mt-3 text-[10px] text-slate-500">Chỉ dùng để mô phỏng và nghiên cứu · Không phải khuyến nghị đầu tư.</div>
        </div>
      )}
    </section>
  );
}
