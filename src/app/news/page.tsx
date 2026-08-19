"use client";

import { useState } from "react";
import { timeAgo, usePoll } from "@/lib/client";
import { ProtectedPage } from "@/components/ProtectedPage";

interface NewsItem {
  id: number;
  title: string;
  link: string;
  description: string;
  imageUrl: string | null;
  sourceName: string;
  symbols: string;
  sentiment: number;
  publishedAt: string;
}

function SentimentDot({ score }: { score: number }) {
  const color = score >= 0.15 ? "bg-emerald-400" : score > -0.15 ? "bg-amber-400" : "bg-rose-400";
  const label = score >= 0.15 ? "Tích cực" : score > -0.15 ? "Trung lập" : "Tiêu cực";
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />
      {label} ({score >= 0 ? "+" : ""}{score.toFixed(2)})
    </span>
  );
}

export default function NewsPage() {
  const [page, setPage] = useState(1);
  const [symbol, setSymbol] = useState("");
  const query = `/news?page=${page}&limit=20${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}`;
  const { data, loading, error } = usePoll<{ items: NewsItem[]; total: number; limit: number }>(query, 60000);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  // Compute average sentiment for the displayed page
  const avgSentiment = data && data.items.length > 0
    ? data.items.reduce((s, n) => s + n.sentiment, 0) / data.items.length
    : 0;

  return (
    <ProtectedPage featureName="tin tức thị trường">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Tin tức thị trường</h1>
        <span className="text-xs text-slate-500">Nguồn thật: VnExpress · CafeF · Vietstock (RSS) · NLP Sentiment</span>
        {data && data.items.length > 0 && (
          <span className="text-xs text-slate-400">
            Sentiment trung bình: <SentimentDot score={avgSentiment} />
          </span>
        )}
        <input
          value={symbol}
          onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setPage(1); }}
          placeholder="Lọc theo mã (VD: VNM)"
          className="ml-auto rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm outline-none w-44"
        />
      </div>

      {error && <div className="panel border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-300">{error}</div>}
      {loading && !data && <div className="panel p-8 text-center text-sm text-slate-500">Đang tải tin thật từ RSS…</div>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.items ?? []).map((n) => (
          <a key={n.id} href={n.link} target="_blank" rel="noreferrer" className="panel flex gap-3 p-3 hover:border-slate-600">
            {n.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={n.imageUrl} alt="" className="h-20 w-28 rounded object-cover shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium leading-snug line-clamp-2">{n.title}</div>
              <div className="mt-1 text-xs text-slate-500 line-clamp-2">{n.description}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                <span>{n.sourceName} · {timeAgo(n.publishedAt)}</span>
                {n.symbols && <span className="text-cyan-500 font-medium">{n.symbols}</span>}
                <SentimentDot score={n.sentiment} />
              </div>
            </div>
          </a>
        ))}
      </div>

      {data && data.items.length === 0 && (
        <div className="panel p-8 text-center text-sm text-slate-500">Không có tin phù hợp.</div>
      )}

      <div className="flex items-center justify-center gap-3 text-sm">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40 hover:bg-slate-800 touch-min">← Trước</button>
        <span className="text-slate-500">Trang {page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40 hover:bg-slate-800 touch-min">Sau →</button>
      </div>
    </div>
    </ProtectedPage>
  );
}
