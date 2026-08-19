"use client";

import Link from "next/link";
import { api, changeColor, fmtNum, fmtPct, fmtVol, usePoll } from "@/lib/client";
import { ProtectedPage } from "@/components/ProtectedPage";

interface Quote {
  symbol: string;
  close: number;
  volume: number;
  changePct: number | null;
  source: string;
  confidence: number;
}
interface Item {
  symbol: string;
  addedAt: string;
  quote: Quote | null;
}

export default function WatchlistPage() {
  const { data, loading, refresh, error } = usePoll<{ items: Item[] }>("/watchlist", 15000);

  const remove = async (symbol: string) => {
    await api(`/watchlist?symbol=${symbol}`, { method: "DELETE" });
    void refresh();
  };

  return (
    <ProtectedPage featureName="danh sách theo dõi">
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Watchlist</h1>
        <span className="text-xs text-slate-500">Giá cập nhật mỗi 15 giây qua Data Engine</span>
      </div>

      {error && <div className="panel border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-300">{error}</div>}
      {loading && !data && <div className="panel p-8 text-center text-sm text-slate-500">Đang tải…</div>}

      {data && data.items.length === 0 && (
        <div className="panel p-8 text-center text-sm text-slate-500">
          Chưa có mã nào. Tìm một mã (VD: <Link href="/stocks/VNM" className="text-cyan-400">VNM</Link>) và bấm “+ Watchlist”.
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="panel p-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                <th className="py-2">Mã</th>
                <th className="text-right">Giá</th>
                <th className="text-right">+/- %</th>
                <th className="text-right">KL</th>
                <th className="text-right">Nguồn</th>
                <th className="text-right">Confidence</th>
                <th className="text-right"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.symbol} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="py-2">
                    <Link href={`/stocks/${item.symbol}`} className="font-semibold text-cyan-400 hover:underline">
                      {item.symbol}
                    </Link>
                  </td>
                  <td className="text-right">{fmtNum(item.quote?.close)}</td>
                  <td className={`text-right font-medium ${changeColor(item.quote?.changePct)}`}>{fmtPct(item.quote?.changePct)}</td>
                  <td className="text-right text-slate-400">{fmtVol(item.quote?.volume)}</td>
                  <td className="text-right text-[10px] text-slate-600">{item.quote?.source ?? "—"}</td>
                  <td className="text-right text-[10px] text-slate-600">
                    {item.quote ? `${(item.quote.confidence * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="text-right">
                    <button onClick={() => void remove(item.symbol)} className="text-xs text-rose-400 hover:underline touch-min px-2">
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </ProtectedPage>
  );
}
