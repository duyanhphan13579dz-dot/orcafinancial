"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { LaunchEvent, LaunchpadIntelligence } from "@/lib/crypto/types";

function kindStyle(kind: string): string {
  switch (kind) {
    case "LAUNCHPOOL":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "LAUNCHPAD":
      return "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
    case "SPOT_LISTING":
      return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    case "FUTURES_LISTING":
      return "bg-violet-500/15 text-violet-300 border-violet-500/30";
    case "DELIST":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    default:
      return "bg-slate-700/40 text-slate-300 border-slate-600";
  }
}

function statusDot(status: string): string {
  if (status === "ONGOING" || status === "UPCOMING") return "bg-emerald-400";
  if (status === "RECENT") return "bg-amber-400";
  return "bg-slate-500";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("vi-VN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function EventCard({ e }: { e: LaunchEvent }) {
  return (
    <a
      href={e.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-slate-700/60 bg-slate-900/40 p-3 transition hover:border-[#00d4ff]/30 hover:bg-slate-800/40"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${kindStyle(e.kind)}`}
        >
          {e.kind.replace(/_/g, " ")}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
          <i className={`h-1.5 w-1.5 rounded-full ${statusDot(e.status)}`} />
          {e.status}
        </span>
        {e.primarySymbol && (
          <Link
            href={`/crypto/${e.primarySymbol}`}
            onClick={(ev) => ev.stopPropagation()}
            className="rounded bg-[#00d4ff]/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#00d4ff] hover:bg-[#00d4ff]/20"
          >
            {e.primarySymbol}
          </Link>
        )}
      </div>
      <div className="text-sm font-medium leading-snug text-slate-200 line-clamp-2">
        {e.title}
      </div>
      <div className="mt-2 text-[10px] text-slate-500">{fmtDate(e.publishedAt)}</div>
    </a>
  );
}

function Section({
  title,
  count,
  items,
}: {
  title: string;
  count: number;
  items: LaunchEvent[];
}) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <span className="text-[10px] text-slate-500">{count}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((e) => (
          <EventCard key={e.id} e={e} />
        ))}
      </div>
    </section>
  );
}

export default function LaunchpadPage() {
  const [data, setData] = useState<LaunchpadIntelligence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => setLoading(true));
    void api<LaunchpadIntelligence>("/crypto/launchpad")
      .then((r) => {
        if (!cancelled) {
          setData(r.data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const s = data?.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/crypto" className="text-xs text-[#00d4ff] hover:underline">
            ← Thị trường Crypto
          </Link>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-[.25em] text-[#00d4ff]">
            Phase 5 · Binance CMS
          </div>
          <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Launchpad & Launchpool
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            New listings · Launchpool · Launchpad · Delist announcements
          </p>
        </div>
        {data?.fetchedAt && (
          <span className="text-[10px] text-slate-500">
            Updated {fmtDate(data.fetchedAt)}
          </span>
        )}
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["Total", s.total],
              ["Launchpool", s.launchpool],
              ["Launchpad", s.launchpad],
              ["Spot list", s.spotListings],
              ["Futures", s.futuresListings],
              ["Delist", s.delistings],
            ] as const
          ).map(([label, n]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-700/50 bg-slate-900/50 px-3 py-2.5"
            >
              <div className="text-[10px] uppercase text-slate-500">{label}</div>
              <div className="mt-0.5 font-mono text-xl font-bold text-white">{n}</div>
            </div>
          ))}
        </div>
      )}

      {loading && !data && (
        <div className="panel p-10 text-center text-slate-500">Đang tải announcements…</div>
      )}

      {error && (
        <div className="panel border-rose-800 p-4 text-sm text-rose-300">{error}</div>
      )}

      {data?.available && (
        <>
          <Section title="Highlights" count={data.highlights.length} items={data.highlights} />
          <Section title="Launchpool" count={data.launchpool.length} items={data.launchpool} />
          <Section title="Launchpad" count={data.launchpad.length} items={data.launchpad} />
          <Section title="New listings" count={data.listings.length} items={data.listings} />
          <Section title="Delistings" count={data.delistings.length} items={data.delistings} />
        </>
      )}

      {!loading && data && !data.available && (
        <div className="panel p-8 text-center text-slate-500">
          Không lấy được dữ liệu Launchpad (CMS có thể bị chặn).
          {data.errors.length > 0 && (
            <div className="mt-2 text-[10px] text-slate-600">{data.errors.join(" · ")}</div>
          )}
        </div>
      )}

      <p className="text-[10px] text-slate-600">
        Binance không cung cấp REST API chính thức cho Launchpad/Launchpool. Orca tổng hợp từ
        public CMS announcements (catalog New Cryptocurrency Listing). Không phải lời khuyên đầu tư.
      </p>
    </div>
  );
}
