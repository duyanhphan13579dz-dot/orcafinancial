"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";

/* ───────────────────────── VN time helpers (client) ───────────────────────── */
const VN_OFFSET_MIN = 7 * 60;
function vnNow(): Date {
  const d = new Date();
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000;
  return new Date(utcMs + VN_OFFSET_MIN * 60_000);
}
function pad2(n: number) { return String(n).padStart(2, "0"); }
function vnKey(d: Date) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function vnWeekday(d: Date) { return d.getUTCDay(); }
const VI_DAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
function viLong(d: Date) {
  return `${VI_DAYS[vnWeekday(d)]}, ${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
function minutesToTarget(d: Date, hh: number, mm: number): number {
  const nowMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const tgtMin = hh * 60 + mm;
  return tgtMin - nowMin; // negative if past
}

interface ReportRow { type: "morning" | "summary"; date: string; title: string; createdAt: string; }
interface SchedulerJob {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  attemptsToday: number;
  successesToday: number;
  todayKey: string | null;
  target: string;
  cap: string;
  backup?: string;
  minutesUntilTarget: number | null;
}
interface SchedulerStatus {
  started: boolean;
  tickMs: number;
  maxRetry: number;
  lastTickAt: string | null;
  tickCount: number;
  vnNow: { hh: number; mm: number; key: string; weekday: number; isWeekday: boolean };
  jobs: Record<string, SchedulerJob>;
}

/* ───────────────────────── small UI atoms ───────────────────────── */

function StatusLamp({ state }: { state: "live" | "idle" | "error" | "pending" }) {
  const map = {
    live: { c: "#34d399", label: "ĐÃ PHÁT HÀNH", glow: true },
    idle: { c: "#7aa8d4", label: "CHỜ LỊCH", glow: false },
    error: { c: "#fb7185", label: "LỖI", glow: true },
    pending: { c: "#fbbf24", label: "ĐANG TẠO", glow: true },
  }[state];
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`h-2 w-2 rounded-full ${map.glow ? "live-dot" : ""}`}
        style={{ background: map.c, color: map.c, boxShadow: map.glow ? `0 0 8px ${map.c}` : "none" }}
      />
      <span className="font-mono text-[10px] tracking-[0.25em] uppercase" style={{ color: map.c }}>{map.label}</span>
    </span>
  );
}

function fmtCountdown(mins: number): string {
  if (mins <= 0) return "đã qua";
  if (mins < 60) return `${mins} phút`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${pad2(m)}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "vừa xong";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

/* ───────────────────────── main page ───────────────────────── */

export default function ReportsPage() {
  const [now, setNow] = useState<Date>(() => vnNow());
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ type: string; date: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoBackfilled, setAutoBackfilled] = useState<Record<string, boolean>>({});
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 1s clock
  useEffect(() => {
    const id = setInterval(() => setNow(vnNow()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch scheduler + reports; poll
  const refresh = async () => {
    try {
      const [s, r] = await Promise.all([
        fetch("/api/v1/reports/scheduler", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/v1/reports?limit=30", { cache: "no-store" }).then((x) => x.json()),
      ]);
      setScheduler(s.data?.scheduler ?? null);
      setReports(r.data?.reports ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, []);

  const todayKey = vnKey(now);
  const isWeekday = vnWeekday(now) >= 1 && vnWeekday(now) <= 5;

  const morningToday = reports.find((r) => r.type === "morning" && r.date === todayKey);
  const summaryToday = reports.find((r) => r.type === "summary" && r.date === todayKey);

  // Auto-backfill logic — fire silently if a report is past its target and missing.
  useEffect(() => {
    if (!isWeekday) return;
    const jobs: Array<{ type: "morning" | "summary"; hh: number; mm: number }> = [
      { type: "morning", hh: 7, mm: 30 },
      { type: "summary", hh: 15, mm: 15 },
    ];
    for (const j of jobs) {
      if (autoBackfilled[j.type]) continue;
      const exists = j.type === "morning" ? morningToday : summaryToday;
      if (exists) continue;
      const minsPast = -minutesToTarget(now, j.hh, j.mm);
      // Only auto-backfill if we're at least 5 min past target and not already triggering.
      if (minsPast < 5) continue;
      if (triggering[j.type]) continue;
      setAutoBackfilled((s) => ({ ...s, [j.type]: true }));
      void doTrigger(j.type, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, morningToday, summaryToday, isWeekday]);

  const doTrigger = async (type: "morning" | "summary", silent = false) => {
    setTriggering((s) => ({ ...s, [type]: true }));
    try {
      await fetch(`/api/v1/reports/trigger/${type}`, { method: "POST" });
      await refresh();
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTriggering((s) => ({ ...s, [type]: false }));
    }
  };

  const openPreview = async (r: ReportRow) => {
    try {
      const res = await fetch(`/api/v1/reports/${r.type}?date=${r.date}`, { cache: "no-store" });
      const j = await res.json();
      setPreview({ type: r.type, date: r.date, html: j.data?.html ?? "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doPrint = () => {
    const w = iframeRef.current?.contentWindow;
    if (w) w.print();
  };
  const doDownloadHtml = () => {
    if (!preview) return;
    const blob = new Blob([preview.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ORCA_${preview.type === "morning" ? "Morning_Brief" : "Market_Summary"}_${preview.date}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const doOpenTab = () => {
    if (!preview) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(preview.html);
    w.document.close();
  };

  const recentByType = useMemo(() => {
    const m = reports.filter((r) => r.type === "morning").slice(0, 6);
    const s = reports.filter((r) => r.type === "summary").slice(0, 6);
    return { m, s };
  }, [reports]);

  /* ───────── Deck renderer ───────── */
  const renderDeck = (
    type: "morning" | "summary",
    accent: string,
    accentSoft: string,
    icon: string,
    title: string,
    subtitle: string,
    target: { hh: number; mm: number },
    todayRow: ReportRow | undefined,
    history: ReportRow[],
  ) => {
    const job = scheduler?.jobs[type];
    const exists = !!todayRow;
    const isTriggering = triggering[type];
    const minsTo = minutesToTarget(now, target.hh, target.mm);
    const pastTarget = minsTo <= 0;
    const state: "live" | "idle" | "error" | "pending" = isTriggering
      ? "pending"
      : exists
        ? "live"
        : job?.lastError && pastTarget
          ? "error"
          : "idle";
    const countdownLabel = exists
      ? `phát hành lúc ${new Date(todayRow.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`
      : pastTarget
        ? `trễ ${fmtCountdown(-minsTo)} · chờ scheduler hoặc trigger`
        : `còn ${fmtCountdown(minsTo)} tới ${pad2(target.hh)}:${pad2(target.mm)}`;

    return (
      <article
        className="panel relative overflow-hidden p-5 reveal scanlines"
        style={{ borderColor: exists ? `${accent}55` : undefined }}
      >
        {/* ambient tint */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background: `radial-gradient(120% 80% at 100% 0%, ${accentSoft}22 0%, transparent 50%), radial-gradient(80% 60% at 0% 100%, ${accent}14 0%, transparent 60%)`,
          }}
        />
        <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5">
          {/* left */}
          <div>
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-md flex items-center justify-center text-xl"
                style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accentSoft} 100%)`, color: "#0A2540" }}
              >
                {icon}
              </div>
              <div>
                <div className="font-mono text-[10px] tracking-[0.3em] uppercase" style={{ color: accent }}>{type === "morning" ? "07:30 ICT · Mon–Fri" : "15:15 ICT · Mon–Fri"}</div>
                <h2 className="font-display text-xl md:text-2xl font-extrabold text-white tracking-tight leading-tight">{title}</h2>
              </div>
            </div>
            <p className="text-[12px] text-slate-400 mt-2 leading-relaxed max-w-xl">{subtitle}</p>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <StatusLamp state={state} />
              <span className="font-mono text-[11px] text-slate-300 tabular-nums">{countdownLabel}</span>
              {job && (
                <span className="font-mono text-[10px] text-slate-500">
                  hôm nay: {job.successesToday}/{job.attemptsToday || 0} lần thành công
                </span>
              )}
            </div>

            {job?.lastError && (
              <div className="mt-3 rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-200 font-mono">
                <span className="font-bold">LỖI GẦN NHẤT:</span> {job.lastError.slice(0, 180)}
              </div>
            )}
          </div>

          {/* right — actions */}
          <div className="flex flex-col gap-2 lg:min-w-[200px]">
            <button
              onClick={() => doTrigger(type)}
              disabled={isTriggering}
              className="btn-orca flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isTriggering ? (
                <>
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-[#0A2540] border-t-transparent animate-spin" />
                  Đang tạo…
                </>
              ) : exists ? (
                <>Tạo lại bản hôm nay</>
              ) : (
                <>Phát hành ngay</>
              )}
            </button>
            {todayRow && (
              <button onClick={() => openPreview(todayRow)} className="btn-orca-outline text-xs">
                Xem &amp; in PDF
              </button>
            )}
            <div className="font-mono text-[9px] text-slate-500 text-center mt-1">
              POST /api/v1/reports/trigger/{type}
            </div>
          </div>
        </div>

        {/* history rail */}
        {history.length > 0 && (
          <div className="relative mt-5 pt-4 border-t border-[#1a3558]/70">
            <div className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate-500 mb-2">Lịch sử phát hành gần đây</div>
            <div className="flex flex-wrap gap-1.5">
              {history.map((r) => {
                const isToday = r.date === todayKey;
                return (
                  <button
                    key={r.date}
                    onClick={() => openPreview(r)}
                    className={`group relative rounded border px-2 py-1 text-[10px] font-mono tabular-nums transition-all hover:-translate-y-0.5 ${
                      isToday ? "border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]" : "border-[#1a3558] text-slate-400 hover:border-[#00d4ff]/60 hover:text-white"
                    }`}
                    title={r.title}
                  >
                    <span className="opacity-70">{r.date.slice(5)}</span>
                    <span className="ml-1.5 inline-block h-1 w-1 rounded-full bg-emerald-400 align-middle" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </article>
    );
  };

  /* ───────── Scheduler status strip ───────── */
  const schedStrip = scheduler && (
    <div className="panel p-3 relative overflow-hidden bg-gradient-to-r from-[#0a1d33] via-[#0A2540] to-[#0a1d33]">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[11px] font-mono">
        <div>
          <div className="text-[9px] tracking-[0.25em] uppercase text-slate-500">Scheduler</div>
          <div className="text-white mt-0.5 flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${scheduler.started ? "bg-emerald-400 live-dot" : "bg-rose-500"}`} />
            {scheduler.started ? "RUNNING" : "STOPPED"}
          </div>
        </div>
        <div>
          <div className="text-[9px] tracking-[0.25em] uppercase text-slate-500">Tick interval</div>
          <div className="text-white mt-0.5 tabular-nums">{(scheduler.tickMs / 1000).toFixed(0)}s · retry ≤ {scheduler.maxRetry}</div>
        </div>
        <div>
          <div className="text-[9px] tracking-[0.25em] uppercase text-slate-500">Last tick</div>
          <div className="text-white mt-0.5">{timeAgo(scheduler.lastTickAt)}</div>
        </div>
        <div>
          <div className="text-[9px] tracking-[0.25em] uppercase text-slate-500">Tick count</div>
          <div className="text-white mt-0.5 tabular-nums">#{scheduler.tickCount}</div>
        </div>
        <div>
          <div className="text-[9px] tracking-[0.25em] uppercase text-slate-500">VN local</div>
          <div className="text-white mt-0.5 tabular-nums">{pad2(scheduler.vnNow.hh)}:{pad2(scheduler.vnNow.mm)} · {scheduler.vnNow.isWeekday ? "ngày giao dịch" : "cuối tuần"}</div>
        </div>
      </div>
    </div>
  );

  /* ───────── Page render ───────── */
  return (
    <ProtectedPage featureName="báo cáo hàng ngày">
    <div className="space-y-6">
      {/* ─── Masthead ─── */}
      <header className="relative overflow-hidden panel p-6 md:p-8 scanlines">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(60% 120% at 0% 0%, rgba(0,212,255,0.18) 0%, transparent 50%), radial-gradient(50% 80% at 100% 100%, rgba(14,165,233,0.14) 0%, transparent 60%)",
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="font-mono text-[10px] tracking-[0.35em] uppercase text-[#00d4ff]">ORCA Newsroom · Publishing desk</div>
            <h1 className="display-xl text-5xl md:text-6xl text-white mt-2">
              Bản tin <span className="italic text-[#7aa8d4]">hàng ngày</span>
            </h1>
            <p className="font-display text-base text-slate-300 mt-3 max-w-2xl leading-relaxed">
              Hai ấn phẩm tự động — <em className="text-[#00d4ff] not-italic font-semibold">Morning Brief</em> lúc 07:30 và <em className="text-[#00d4ff] not-italic font-semibold">Market Summary</em> lúc 15:15 giờ Việt Nam, phát hành mỗi ngày giao dịch. Font Be Vietnam Pro nhúng sẵn, hỗ trợ đầy đủ tiếng Việt khi in PDF.
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">VN local time</div>
            <div className="font-display text-4xl md:text-5xl font-extrabold text-white tabular-nums leading-none mt-1">
              {pad2(now.getUTCHours())}<span className="text-[#00d4ff]">:</span>{pad2(now.getUTCMinutes())}<span className="text-slate-500 text-2xl">:{pad2(now.getUTCSeconds())}</span>
            </div>
            <div className="font-mono text-[11px] text-slate-400 mt-1">{viLong(now)} · ICT (UTC+7)</div>
            <div className={`mt-2 inline-block rounded-full px-2.5 py-0.5 font-mono text-[10px] tracking-widest ${isWeekday ? "bg-emerald-500/15 text-emerald-300 border border-emerald-700/50" : "bg-amber-500/15 text-amber-300 border border-amber-700/50"}`}>
              {isWeekday ? "NGÀY GIAO DỊCH" : "CUỐI TUẦN · KHÔNG PHÁT HÀNH"}
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="panel border-rose-700 bg-rose-950/30 p-3 text-sm text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white text-xs">đóng</button>
        </div>
      )}

      {schedStrip}

      {/* ─── Publishing decks ─── */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {renderDeck(
          "morning",
          "#0ea5e9",
          "#bae6fd",
          "☀",
          "Morning Brief",
          "Điểm tin vĩ mô, doanh nghiệp & thị trường qua đêm, kèm chiến lược thận trọng trong ngày với danh mục phòng thủ và cảnh báo rủi ro cụ thể.",
          { hh: 7, mm: 30 },
          morningToday,
          recentByType.m,
        )}
        {renderDeck(
          "summary",
          "#0A2540",
          "#7dd3fc",
          "🌙",
          "Market Summary",
          "Đọc vị phiên giao dịch vừa khép lại, đối chiếu với dự báo đầu ngày, và đưa ra kế hoạch hành động phiên tiếp theo với ba kịch bản rõ ràng cùng mức cắt lỗ / chốt lời tham khảo.",
          { hh: 15, mm: 15 },
          summaryToday,
          recentByType.s,
        )}
      </section>

      {/* ─── Timeline of all recent reports ─── */}
      <section className="panel p-5">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#00d4ff]">Archive</div>
            <h3 className="font-display text-xl font-extrabold text-white tracking-tight">Lịch sử phát hành</h3>
          </div>
          <div className="font-mono text-[10px] text-slate-500">{reports.length} bản ghi</div>
        </div>
        {loading ? (
          <div className="text-sm text-slate-500 py-8 text-center">Đang tải…</div>
        ) : reports.length === 0 ? (
          <div className="text-sm text-slate-500 py-8 text-center italic">Chưa có bản tin nào được phát hành. Nhấn "Phát hành ngay" ở trên để tạo bản đầu tiên.</div>
        ) : (
          <div className="relative">
            <div className="absolute left-3 top-2 bottom-2 w-px bg-gradient-to-b from-[#00d4ff]/60 via-[#1a3558] to-transparent" />
            <ul className="space-y-2">
              {reports.map((r, i) => {
                const isMorning = r.type === "morning";
                const accent = isMorning ? "#0ea5e9" : "#7dd3fc";
                const isToday = r.date === todayKey;
                return (
                  <li key={`${r.type}-${r.date}-${i}`} className="relative pl-8 reveal" style={{ animationDelay: `${Math.min(i * 30, 400)}ms` }}>
                    <span
                      className="absolute left-[7px] top-3 h-3 w-3 rounded-full border-2 border-[#0A2540]"
                      style={{ background: accent, boxShadow: isToday ? `0 0 10px ${accent}` : "none" }}
                    />
                    <button
                      onClick={() => openPreview(r)}
                      className={`w-full text-left rounded border p-3 transition-all hover:-translate-y-0.5 ${
                        isToday ? "border-[#00d4ff]/60 bg-[#00d4ff]/5" : "border-[#1a3558] bg-[#0a1d33]/40 hover:border-[#00d4ff]/40"
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[10px] tracking-[0.25em] uppercase" style={{ color: accent }}>
                            {isMorning ? "Morning Brief" : "Market Summary"}
                          </span>
                          <span className="font-display text-base font-bold text-white tabular-nums">{r.date}</span>
                          {isToday && <span className="font-mono text-[9px] tracking-widest text-[#00d4ff] uppercase border border-[#00d4ff]/40 rounded px-1.5 py-0.5">Hôm nay</span>}
                        </div>
                        <span className="font-mono text-[10px] text-slate-500">
                          {new Date(r.createdAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 line-clamp-1">{r.title}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* ─── Preview modal ─── */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col p-3 md:p-6"
          onClick={() => setPreview(null)}
        >
          <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#00d4ff] shrink-0">Preview</div>
              <div className="font-display text-lg font-bold text-white truncate">
                {preview.type === "morning" ? "Morning Brief" : "Market Summary"} · <span className="tabular-nums">{preview.date}</span>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={doPrint} className="btn-orca text-xs touch-min">In / Lưu PDF</button>
              <button onClick={doDownloadHtml} className="btn-orca-outline text-xs touch-min">Tải HTML</button>
              <button onClick={doOpenTab} className="btn-orca-outline text-xs touch-min hidden sm:inline-flex">Mở tab mới</button>
              <button onClick={() => setPreview(null)} className="btn-orca-ghost touch-min" aria-label="Đóng">Đóng ✕</button>
            </div>
          </div>
          <div className="flex-1 rounded-lg overflow-hidden bg-white shadow-[0_30px_80px_-20px_rgba(0,212,255,0.3)] border border-[#1a3558]" onClick={(e) => e.stopPropagation()}>
            <iframe
              ref={iframeRef}
              title={`ORCA report ${preview.type} ${preview.date}`}
              srcDoc={preview.html}
              className="w-full h-full border-0"
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
          <div className="no-print mt-2 text-center font-mono text-[10px] text-slate-500">
            Font Be Vietnam Pro + Inter + JetBrains Mono được nhúng qua Google Fonts · trình duyệt sẽ embed khi in PDF · charset UTF-8 đảm bảo tiếng Việt không lỗi
          </div>
        </div>
      )}
    </div>
    </ProtectedPage>
  );
}
