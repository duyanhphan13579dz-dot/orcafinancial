"use client";

/**
 * Trang phân tích chỉ số — phong cách LANDING PAGE: hero lớn, số liệu nổi bật,
 * các khối nội dung rõ nhịp. Dữ liệu thật từ vndirect dchart (EOD) + overlay
 * realtime khi có nguồn live; không bịa số.
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

function HeroStat({ label, value, sub, toneClass }: { label: string; value: string; sub?: string; toneClass?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold tabular-nums ${toneClass ?? "text-white"}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-400">{eyebrow}</div>
      <h2 className="font-display mt-1 text-xl font-bold text-white md:text-2xl">{title}</h2>
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
  const isLive = Boolean(rt && rt.source !== "rest");

  const data = analysis.data;
  const stats = data?.stats ?? null;
  const livePrice = isLive ? rt!.price : (stats?.last ?? null);
  const liveChange = isLive ? rt!.changePct : (stats?.changePct ?? null);

  const historyData = useMemo(() => (data?.history ?? []).map((b) => ({ ...b, t: b.time })), [data?.history]);
  const intradayData = useMemo(() => (data?.intraday ?? []).map((b) => ({ ...b, t: b.time })), [data?.intraday]);

  const assessment = data?.assessment;

  return (
    <main className="min-h-screen">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-cyan-400/10 bg-gradient-to-b from-[#0a2540] via-[#0b2745] to-[#071a30]">
        <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-10 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 py-10 md:py-14">
          <Link href="/" className="text-xs text-cyan-400 hover:underline">← Tổng quan thị trường</Link>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-400">PHÂN TÍCH CHỈ SỐ</div>
              <h1 className="font-display mt-2 text-4xl font-extrabold tracking-tight text-white md:text-5xl">
                {data?.name ?? normalized}
              </h1>
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-200">{data?.exchange ?? ""}</span>
                {assessment ? (
                  <span className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${assessment.trend === "up" ? "border border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : assessment.trend === "down" ? "border border-rose-400/40 bg-rose-400/10 text-rose-300" : "border border-amber-400/40 bg-amber-400/10 text-amber-300"}`}>
                    {assessment.trendLabel}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-2 text-[10px]">
                {isLive ? (
                  <span className="flex items-center gap-1 font-semibold text-emerald-400"><span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />LIVE</span>
                ) : (
                  <span className="font-semibold uppercase tracking-wider text-slate-500">EOD · {(data?.source ?? "vndirect-dchart").toUpperCase()}</span>
                )}
              </div>
              <div className={`font-mono text-5xl font-extrabold tabular-nums md:text-6xl ${isLive ? "text-emerald-300" : "text-white"}`}>
                {fmtNum(livePrice)}
              </div>
              <div className={`mt-1 font-mono text-lg font-bold ${tone(liveChange)}`}>{fmtPct(liveChange)}</div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <HeroStat label="MA20" value={fmtNum(stats?.ma20 ?? null)} />
            <HeroStat label="MA50" value={fmtNum(stats?.ma50 ?? null)} />
            <HeroStat label="Đỉnh 52T" value={fmtNum(stats?.week52High ?? null)} sub={stats?.off52wHighPct != null ? `${fmtPct(stats.off52wHighPct)} so với đỉnh` : undefined} />
            <HeroStat label="Đáy 52T" value={fmtNum(stats?.week52Low ?? null)} />
            <HeroStat label="Khối lượng" value={fmtVol(stats?.volume ?? null)} sub={`TB 20 phiên: ${fmtVol(stats?.avgVolume20d ?? null)}`} />
            <HeroStat label="Biến động năm" value={stats?.volatilityAnnPct != null ? `${fmtNum(stats.volatilityAnnPct, 1)}%` : "—"} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-10 px-4 py-10">
        {/* ── LỊCH SỬ ────────────────────────────────────────── */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionTitle eyebrow="CHART" title="Lịch sử chỉ số" />
            <div className="mb-4 flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${range === r ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#0a2038]/80 p-4 md:p-6">
            {historyData.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-500">Chưa có dữ liệu lịch sử (cần môi trường có mạng tới vndirect dchart).</div>
            ) : (
              <div className="h-80">
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
                      contentStyle={{ background: "#0b2644", border: "1px solid #1a3558", borderRadius: 12, fontSize: 12 }}
                      labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleDateString("vi-VN")}
                      formatter={(value) => [fmtNum(Number(value)), "Đóng cửa"]}
                    />
                    <Area type="monotone" dataKey="close" stroke="#22d3ee" strokeWidth={2} fill="url(#idxFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        {/* ── INTRADAY + SỐ LIỆU ─────────────────────────────── */}
        <section className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SectionTitle eyebrow="CHART" title="Intraday (1 phút)" />
            <div className="rounded-2xl border border-white/10 bg-[#0a2038]/80 p-4 md:p-6">
              {intradayData.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500">Chưa có dữ liệu intraday.</div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={intradayData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#12314f" strokeDasharray="3 3" />
                      <XAxis dataKey="t" tickFormatter={minuteTick} stroke="#3b5876" fontSize={10} tickLine={false} />
                      <YAxis domain={["auto", "auto"]} stroke="#3b5876" fontSize={10} tickLine={false} width={70} tickFormatter={(v: number) => fmtNum(v, 1)} />
                      <Tooltip
                        contentStyle={{ background: "#0b2644", border: "1px solid #1a3558", borderRadius: 12, fontSize: 12 }}
                        labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleTimeString("vi-VN")}
                        formatter={(value) => [fmtNum(Number(value)), "Chỉ số"]}
                      />
                      <Line type="monotone" dataKey="close" stroke="#34d399" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
          <div className="lg:col-span-2">
            <SectionTitle eyebrow="DATA" title="Số liệu phiên" />
            <div className="grid grid-cols-2 gap-3">
              <HeroStat label="Đóng cửa" value={fmtNum(stats?.last ?? null)} />
              <HeroStat label="Tham chiếu" value={fmtNum(stats?.prevClose ?? null)} />
              <HeroStat label="Cao nhất" value={fmtNum(stats?.high ?? null)} />
              <HeroStat label="Thấp nhất" value={fmtNum(stats?.low ?? null)} />
              <HeroStat label="Thay đổi" value={fmtPct(stats?.changePct ?? null)} toneClass={tone(stats?.changePct)} />
              <HeroStat label="Động lượng 1T" value={fmtPct(stats?.mom1mPct ?? null)} toneClass={tone(stats?.mom1mPct)} />
              <HeroStat label="Động lượng 3T" value={fmtPct(stats?.mom3mPct ?? null)} toneClass={tone(stats?.mom3mPct)} />
              <HeroStat label="Số bars" value={String(stats?.barsUsed ?? 0)} />
            </div>
          </div>
        </section>

        {/* ── ĐÁNH GIÁ ───────────────────────────────────────── */}
        <section>
          <SectionTitle eyebrow="ĐỊNH LƯỢNG" title="Đánh giá trạng thái" />
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#0c2a4a] to-[#0a2038] p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className={`font-display text-2xl font-extrabold md:text-3xl ${assessment?.trend === "up" ? "text-emerald-300" : assessment?.trend === "down" ? "text-rose-300" : "text-amber-300"}`}>
                {assessment?.trendLabel ?? "—"}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                Rủi ro
                <span className={`rounded-full px-3 py-1 font-bold uppercase ${assessment?.risk === "high" ? "bg-rose-400/15 text-rose-300" : assessment?.risk === "medium" ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/15 text-emerald-300"}`}>
                  {assessment?.risk ?? "medium"}
                </span>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300">{assessment?.summary ?? "Đang tải…"}</p>
            <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {(assessment?.signals ?? []).map((s) => (
                <div key={s.label} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{s.label}</div>
                  <div className={`mt-1 text-sm font-semibold ${s.tone === "up" ? "text-emerald-400" : s.tone === "down" ? "text-rose-400" : "text-slate-200"}`}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── ĐỘNG LỰC + KHỐI NGOẠI ──────────────────────────── */}
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-[#0a2038]/80 p-6">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">Kéo tăng</div>
            {(data?.drivers?.gainers ?? []).length === 0 ? (
              <div className="text-sm text-slate-500">Chưa có dữ liệu.</div>
            ) : (
              (data?.drivers?.gainers ?? []).map((q) => (
                <Link key={q.symbol} href={`/stocks/${q.symbol}`} className="flex items-center justify-between border-b border-white/5 py-2.5 text-sm hover:text-cyan-200">
                  <span className="font-bold text-cyan-300">{q.symbol}</span>
                  <span className="font-mono text-emerald-400">{fmtPct(q.changePct)}</span>
                </Link>
              ))
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#0a2038]/80 p-6">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-400">Kéo giảm</div>
            {(data?.drivers?.losers ?? []).length === 0 ? (
              <div className="text-sm text-slate-500">Chưa có dữ liệu.</div>
            ) : (
              (data?.drivers?.losers ?? []).map((q) => (
                <Link key={q.symbol} href={`/stocks/${q.symbol}`} className="flex items-center justify-between border-b border-white/5 py-2.5 text-sm hover:text-cyan-200">
                  <span className="font-bold text-cyan-300">{q.symbol}</span>
                  <span className="font-mono text-rose-400">{fmtPct(q.changePct)}</span>
                </Link>
              ))
            )}
            <p className="mt-3 text-[10px] text-slate-500">{data?.drivers?.note}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#0a2038]/80 p-6">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400">Khối ngoại</div>
            <p className="text-sm leading-relaxed text-slate-400">{data?.foreign?.note ?? "Đang tải…"}</p>
          </div>
        </section>

        <footer className="pb-6 text-center text-[10px] text-slate-600">
          Nguồn: vndirect dchart (EOD) · Đánh giá định lượng thuần túy, không dùng dự đoán LLM · Không hiển thị số liệu giả.
        </footer>
      </div>
    </main>
  );
}
