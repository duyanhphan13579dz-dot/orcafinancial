"use client";

/**
 * Trang phân tích chi tiết chỉ số tài chính: chart intraday, lịch sử theo
 * khoảng thời gian, số liệu thống kê, khối ngoại, động lực thành phần và
 * đánh giá trạng thái — toàn bộ tính từ dữ liệu thật (vndirect dchart).
 */
import { use, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtNum, fmtPct, fmtVol, usePoll } from "@/lib/client";
import { useRealtimeMarket } from "@/lib/use-realtime-market";
import type { IndexAssessment, IndexStats } from "@/lib/index-analysis";

interface IndexAnalysisPayload {
  code: string;
  name: string;
  exchange: string;
  range: string;
  source: string;
  intraday: Array<{ time: number; close: number; volume: number }>;
  history: Array<{ time: number; close: number; volume: number; high: number; low: number }>;
  stats: IndexStats | null;
  assessment: IndexAssessment;
  drivers: {
    gainers: Array<{ symbol: string; close: number; changePct: number | null; volume: number }>;
    losers: Array<{ symbol: string; close: number; changePct: number | null; volume: number }>;
    note: string;
  };
  foreign: { status: string; note?: string };
}

const RANGES = ["1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;

const dayTick = (t: number) =>
  new Date(t * 1000).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
const minuteTick = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

function tone(pct: number | null | undefined) {
  if (pct == null) return "text-slate-400";
  return pct > 0 ? "text-emerald-400" : pct < 0 ? "text-rose-400" : "text-slate-300";
}

function Stat({ label, value, sub, toneClass }: { label: string; value: string; sub?: string; toneClass?: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-[#091d34]/70 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-sm font-bold ${toneClass ?? "text-slate-100"}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

export default function IndexDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const [range, setRange] = useState<(typeof RANGES)[number]>("6M");
  const analysis = usePoll<IndexAnalysisPayload>(`/indices/${normalized}?range=${range}`, 20_000);
  const realtime = useRealtimeMarket([normalized]);
  const rt = realtime.quotes[normalized];

  const data = analysis.data;
  const livePrice = rt?.price ?? data?.stats?.last ?? null;
  const liveChange = rt?.changePct ?? data?.stats?.changePct ?? null;

  const historyData = useMemo(
    () => (data?.history ?? []).map((b) => ({ ...b, t: b.time })),
    [data?.history],
  );
  const intradayData = useMemo(
    () => (data?.intraday ?? []).map((b) => ({ ...b, t: b.time })),
    [data?.intraday],
  );

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-cyan-400 hover:underline">← Tổng quan thị trường</Link>
          <h1 className="font-display mt-1 text-2xl font-extrabold text-white">
            {data?.name ?? normalized}
            <span className="ml-2 rounded border border-cyan-400/30 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-cyan-300">{data?.exchange ?? ""}</span>
          </h1>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            {rt ? <span className="flex items-center gap-1 text-[10px] text-emerald-400"><span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />LIVE</span> : <span className="text-[10px] text-slate-500">NGUỒN: {(data?.source ?? "—").toUpperCase()}</span>}
          </div>
          <div className={`font-mono text-3xl font-extrabold tabular-nums ${rt ? "text-emerald-300" : "text-white"}`}>{fmtNum(livePrice)}</div>
          <div className={`font-mono text-sm font-semibold ${tone(liveChange)}`}>{fmtPct(liveChange)}</div>
        </div>
      </div>

      <div className="panel space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">LỊCH SỬ CHỈ SỐ</div>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded px-2 py-1 text-[10px] font-semibold ${range === r ? "border border-cyan-600/70 bg-cyan-500/15 text-cyan-200" : "border border-slate-700 bg-slate-900/50 text-slate-400 hover:text-slate-200"}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {historyData.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">Chưa có dữ liệu lịch sử (cần môi trường có mạng tới vndirect dchart).</div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={historyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="idxFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#12314f" strokeDasharray="3 3" />
                <XAxis dataKey="t" tickFormatter={dayTick} stroke="#3b5876" fontSize={10} tickLine={false} />
                <YAxis domain={["auto", "auto"]} stroke="#3b5876" fontSize={10} tickLine={false} width={70} tickFormatter={(v: number) => fmtNum(v, 0)} />
                <Tooltip
                  contentStyle={{ background: "#0b2644", border: "1px solid #1a3558", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleDateString("vi-VN")}
                  formatter={(value) => [fmtNum(Number(value)), "Đóng cửa"]}
                />
                <Area type="monotone" dataKey="close" stroke="#22d3ee" strokeWidth={2} fill="url(#idxFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-3 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">INTRADAY (1 PHÚT)</div>
          {intradayData.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">Chưa có dữ liệu intraday.</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={intradayData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#12314f" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tickFormatter={minuteTick} stroke="#3b5876" fontSize={10} tickLine={false} />
                  <YAxis domain={["auto", "auto"]} stroke="#3b5876" fontSize={10} tickLine={false} width={70} tickFormatter={(v: number) => fmtNum(v, 1)} />
                  <Tooltip
                    contentStyle={{ background: "#0b2644", border: "1px solid #1a3558", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleTimeString("vi-VN")}
                    formatter={(value) => [fmtNum(Number(value)), "Chỉ số"]}
                  />
                  <Line type="monotone" dataKey="close" stroke="#34d399" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="panel space-y-3 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">SỐ LIỆU</div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Đóng cửa" value={fmtNum(data?.stats?.last ?? null)} />
            <Stat label="Tham chiếu" value={fmtNum(data?.stats?.prevClose ?? null)} />
            <Stat label="Cao nhất phiên" value={fmtNum(data?.stats?.high ?? null)} />
            <Stat label="Thấp nhất phiên" value={fmtNum(data?.stats?.low ?? null)} />
            <Stat label="Khối lượng" value={fmtVol(data?.stats?.volume ?? null)} sub={`TB 20 phiên: ${fmtVol(data?.stats?.avgVolume20d ?? null)}`} />
            <Stat label="Thay đổi" value={fmtPct(data?.stats?.changePct ?? null)} toneClass={tone(data?.stats?.changePct)} />
            <Stat label="MA20" value={fmtNum(data?.stats?.ma20 ?? null)} />
            <Stat label="MA50" value={fmtNum(data?.stats?.ma50 ?? null)} />
            <Stat label="Đỉnh 52 tuần" value={fmtNum(data?.stats?.week52High ?? null)} sub={data?.stats?.off52wHighPct != null ? `${fmtPct(data.stats.off52wHighPct)} so với đỉnh` : undefined} />
            <Stat label="Đáy 52 tuần" value={fmtNum(data?.stats?.week52Low ?? null)} />
            <Stat label="Động lượng 1T" value={fmtPct(data?.stats?.mom1mPct ?? null)} toneClass={tone(data?.stats?.mom1mPct)} />
            <Stat label="Động lượng 3T" value={fmtPct(data?.stats?.mom3mPct ?? null)} toneClass={tone(data?.stats?.mom3mPct)} />
            <Stat label="Biến động năm" value={data?.stats?.volatilityAnnPct != null ? `${fmtNum(data.stats.volatilityAnnPct, 1)}%` : "—"} />
            <Stat label="Số bars dùng" value={String(data?.stats?.barsUsed ?? 0)} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">ĐÁNH GIÁ TRẠNG THÁI</div>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${data?.assessment?.trend === "up" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : data?.assessment?.trend === "down" ? "border-rose-400/30 bg-rose-400/10 text-rose-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300"}`}>
              {data?.assessment?.trendLabel ?? "—"} · Rủi ro {(data?.assessment?.risk ?? "medium").toUpperCase()}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-slate-300">{data?.assessment?.summary ?? "Đang tải…"}</p>
          <div className="space-y-1.5">
            {(data?.assessment?.signals ?? []).map((s) => (
              <div key={s.label} className="flex items-center justify-between rounded-md border border-white/5 bg-[#091d34]/70 px-3 py-1.5 text-xs">
                <span className="text-slate-400">{s.label}</span>
                <span className={`font-mono font-semibold ${s.tone === "up" ? "text-emerald-400" : s.tone === "down" ? "text-rose-400" : "text-slate-300"}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel space-y-3 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">ĐỘNG LỰC TÁC ĐỘNG</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">Kéo tăng</div>
                {(data?.drivers?.gainers ?? []).length === 0 ? <div className="text-xs text-slate-500">—</div> : (data?.drivers?.gainers ?? []).map((q) => (
                  <Link key={q.symbol} href={`/stocks/${q.symbol}`} className="flex items-center justify-between border-b border-white/5 py-1.5 text-xs hover:text-cyan-200">
                    <span className="font-semibold text-cyan-300">{q.symbol}</span>
                    <span className="font-mono text-emerald-400">{fmtPct(q.changePct)}</span>
                  </Link>
                ))}
              </div>
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-rose-400">Kéo giảm</div>
                {(data?.drivers?.losers ?? []).length === 0 ? <div className="text-xs text-slate-500">—</div> : (data?.drivers?.losers ?? []).map((q) => (
                  <Link key={q.symbol} href={`/stocks/${q.symbol}`} className="flex items-center justify-between border-b border-white/5 py-1.5 text-xs hover:text-cyan-200">
                    <span className="font-semibold text-cyan-300">{q.symbol}</span>
                    <span className="font-mono text-rose-400">{fmtPct(q.changePct)}</span>
                  </Link>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-slate-500">{data?.drivers?.note}</p>
          </div>

          <div className="panel space-y-2 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">KHỐI NGOẠI</div>
            <div className="text-xs text-slate-400">{data?.foreign?.note ?? "Đang tải…"}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
