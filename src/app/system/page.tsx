"use client";

import { useEffect, useMemo, useState } from "react";
import { timeAgo } from "@/lib/client";

interface Circuit {
  name: string;
  state: "closed" | "open" | "half-open";
  status: "UP" | "DEGRADED" | "DOWN";
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorClass: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastDownAt: string | null;
  cumulativeDowntimeMs: number;
  uptimeMs: number;
  totalCalls: number;
  totalSuccesses: number;
  totalFailures: number;
  successRate: number;
  startedAt: string | null;
  threshold: number;
  cooldownMs: number;
}
interface Connector {
  name: string;
  priority: number;
  role: string;
  capabilities: string[];
  circuit: Circuit;
  recentLogs: Array<{ ts: string; level: string; msg: string; [k: string]: unknown }>;
}
interface Alert {
  provider?: string;
  level: string;
  message: string;
  dispatchedAt: string;
  resolvedAt: string | null;
  slackOk: boolean | null;
}
interface StaleFlag { key: string; kind: string; symbol: string | null; since: string; reason: string; }

const STATUS_STYLE: Record<string, { dot: string; text: string; ring: string; tint: string }> = {
  UP: { dot: "bg-emerald-400", text: "text-emerald-300", ring: "border-emerald-700/60", tint: "from-emerald-500/10 to-transparent" },
  DEGRADED: { dot: "bg-amber-400", text: "text-amber-300", ring: "border-amber-700/60", tint: "from-amber-500/10 to-transparent" },
  DOWN: { dot: "bg-rose-500", text: "text-rose-300", ring: "border-rose-700/60", tint: "from-rose-500/15 to-transparent" },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function SuccessBar({ rate }: { rate: number }) {
  const pct = Math.max(0, Math.min(1, rate)) * 100;
  const color = pct >= 95 ? "bg-emerald-400" : pct >= 80 ? "bg-amber-400" : "bg-rose-500";
  return (
    <div className="bar-track">
      <div className={`bar-fill ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function SystemPage() {
  const [data, setData] = useState<{
    connectors: Connector[];
    staleFlags: StaleFlag[];
    openAlerts: Alert[];
    recentAlerts: Alert[];
    dbAlerts: Alert[];
    systemLogs: Array<{ ts: string; level: string; msg: string; [k: string]: unknown }>;
    config: Record<string, string | boolean>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});
  const [logFilter, setLogFilter] = useState<{ provider: string; level: string }>({ provider: "", level: "" });
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [upstream, setUpstream] = useState<{ aggregate: string; upstream: Record<string, { status: string; latencyMs: number | null; error?: string; lastSuccessAt?: string | null }> } | null>(null);

  const load = async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/v1/admin/connectors", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/health/upstream", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      setData(r1.data);
      if (r2?.data) setUpstream(r2.data);
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, []);

  const doAction = async (name: string, action: "test" | "reset") => {
    setActionLoading((s) => ({ ...s, [name]: action }));
    try {
      await fetch(`/api/v1/admin/connectors/${encodeURIComponent(name)}/${action}`, { method: "POST" });
      await load();
    } finally {
      setActionLoading((s) => ({ ...s, [name]: null }));
    }
  };

  const totals = useMemo(() => {
    if (!data) return { up: 0, degraded: 0, down: 0, total: 0 };
    const cs = data.connectors.filter((c) => c.circuit && typeof c.circuit.totalCalls === "number");
    return {
      up: cs.filter((c) => c.circuit.status === "UP").length,
      degraded: cs.filter((c) => c.circuit.status === "DEGRADED").length,
      down: cs.filter((c) => c.circuit.status === "DOWN").length,
      total: cs.length,
    };
  }, [data]);

  const overall: "OK" | "DEGRADED" | "DOWN" =
    totals.down > 0 ? "DOWN" : totals.degraded > 0 ? "DEGRADED" : "OK";

  const filteredLogs = useMemo(() => {
    if (!data) return [];
    const src = logFilter.provider ? (data.connectors.find((c) => c.name === logFilter.provider)?.recentLogs ?? []) : data.systemLogs;
    if (!logFilter.level) return src;
    return src.filter((l) => l.level === logFilter.level);
  }, [data, logFilter]);

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] tracking-[0.3em] text-[#00d4ff] font-bold uppercase">ORCA OPS CONSOLE</div>
          <h1 className="display text-3xl md:text-4xl text-white mt-1">Upstream Health & Telemetry</h1>
          <p className="text-sm text-slate-400 mt-2 max-w-2xl">
            Giám sát real-time trạng thái mọi connector — circuit breaker, uptime, success rate, alert timeline và structured logs.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>Cập nhật mỗi 5s</div>
          <div className="text-slate-400">Lần cuối: {lastRefresh ? lastRefresh.toLocaleTimeString("vi-VN") : "—"}</div>
        </div>
      </div>

      {/* ─── Overall status banner ─── */}
      <div
        className={`panel relative overflow-hidden p-6 ${
          overall === "OK" ? "breathe-ok" : overall === "DEGRADED" ? "breathe-deg" : "breathe-down"
        }`}
      >
        <div className={`absolute inset-0 bg-gradient-to-br ${STATUS_STYLE[overall === "OK" ? "UP" : overall].tint} pointer-events-none`} />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className={`h-4 w-4 rounded-full ${STATUS_STYLE[overall === "OK" ? "UP" : overall].dot} live-dot`} />
          <div>
            <div className="text-[10px] tracking-[0.2em] text-slate-400 uppercase">System Status</div>
            <div className={`display text-4xl ${STATUS_STYLE[overall === "OK" ? "UP" : overall].text}`}>
              {overall === "OK" ? "ALL SYSTEMS OPERATIONAL" : overall === "DEGRADED" ? "PARTIAL DEGRADATION" : "UPSTREAM OUTAGE"}
            </div>
          </div>
          <div className="ml-auto flex gap-6 text-sm">
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Up</div>
              <div className="text-2xl font-bold text-emerald-300 tabular-nums">{totals.up}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Degraded</div>
              <div className="text-2xl font-bold text-amber-300 tabular-nums">{totals.degraded}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Down</div>
              <div className="text-2xl font-bold text-rose-300 tabular-nums">{totals.down}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Stale flags</div>
              <div className="text-2xl font-bold text-slate-200 tabular-nums">{data?.staleFlags.length ?? 0}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Upstream latency matrix ─── */}
      {upstream && (
        <div className="panel p-4 relative scanlines overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase">Upstream matrix · /api/health/upstream</div>
              <div className="font-display text-sm text-white mt-0.5">Aggregate: <span className={upstream.aggregate === "up" ? "text-emerald-300" : upstream.aggregate === "degraded" ? "text-amber-300" : "text-rose-300"}>{upstream.aggregate.toUpperCase()}</span></div>
            </div>
            <div className="font-mono text-[9px] text-slate-500">{Object.keys(upstream.upstream).length} systems</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 reveal-stagger">
            {Object.entries(upstream.upstream).map(([name, u]) => {
              const color = u.status === "up" ? "#34d399" : u.status === "degraded" ? "#fbbf24" : "#fb7185";
              return (
                <div key={name} className="bg-[#0a1d33]/60 border border-[#1a3558] rounded px-2.5 py-2 hover:border-[#00d4ff]/40 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-slate-300 truncate">{name}</span>
                    <span className="h-1.5 w-1.5 rounded-full live-dot" style={{ background: color, color }} />
                  </div>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color }}>{u.status}</span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-200">
                      {u.latencyMs !== null ? `${(u.latencyMs / 1000).toFixed(1)}s ago` : "—"}
                    </span>
                  </div>
                  {u.error && <div className="mt-1 text-[9px] text-rose-300/80 truncate" title={u.error}>{u.error}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="panel border-rose-700 bg-rose-950/20 p-3 text-sm text-rose-300">Không lấy được trạng thái: {error}</div>}

      {/* ─── Connector cards grid ─── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white tracking-wider uppercase">Connectors</h2>
          <span className="text-[10px] text-slate-500">{data?.connectors.length ?? 0} registered</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(data?.connectors ?? []).map((c, i) => {
            const st = STATUS_STYLE[c.circuit.status] ?? STATUS_STYLE.UP;
            const actionBusy = actionLoading[c.name];
            return (
              <div
                key={c.name}
                className={`connector-card panel relative overflow-hidden p-4 reveal ${st.ring}`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${st.tint} pointer-events-none`} />
                <div className="relative">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${st.dot} ${c.circuit.status === "DOWN" ? "pulse-down" : "live-dot"}`} />
                        <span className="font-bold text-white truncate">{c.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        P{c.priority} · <span className="uppercase tracking-wider">{c.role}</span> · circuit {c.circuit.state}
                      </div>
                    </div>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${st.text} border ${st.ring}`}>
                      {c.circuit.status}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                        <span>Success rate</span>
                        <span className="tabular-nums text-slate-300">{(c.circuit.successRate * 100).toFixed(1)}%</span>
                      </div>
                      <SuccessBar rate={c.circuit.successRate} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div className="bg-slate-900/40 rounded px-2 py-1">
                        <div className="text-slate-500">Calls</div>
                        <div className="text-slate-200 tabular-nums font-semibold">{c.circuit.totalCalls.toLocaleString()}</div>
                      </div>
                      <div className="bg-slate-900/40 rounded px-2 py-1">
                        <div className="text-slate-500">Uptime</div>
                        <div className="text-slate-200 tabular-nums font-semibold">{formatDuration(c.circuit.uptimeMs)}</div>
                      </div>
                      <div className="bg-slate-900/40 rounded px-2 py-1">
                        <div className="text-slate-500">Last OK</div>
                        <div className="text-slate-200 font-semibold">{c.circuit.lastSuccessAt ? timeAgo(c.circuit.lastSuccessAt) : "—"}</div>
                      </div>
                    </div>
                    {c.circuit.cumulativeDowntimeMs > 0 && (
                      <div className="text-[10px] text-rose-300/80">Downtime tích lũy: {formatDuration(c.circuit.cumulativeDowntimeMs)}</div>
                    )}
                    {c.circuit.lastError && (
                      <div className="rounded bg-rose-950/30 border border-rose-900/40 px-2 py-1 text-[10px] text-rose-300 truncate" title={c.circuit.lastError}>
                        <span className="text-rose-500 font-bold">{c.circuit.lastErrorClass ?? "ERR"}</span> · {c.circuit.lastError}
                      </div>
                    )}
                  </div>

                  {c.recentLogs && c.recentLogs.length > 0 && (
                    <details className="mt-3 group">
                      <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-[#00d4ff]">Recent logs ({c.recentLogs.length})</summary>
                      <div className="mt-1 max-h-28 overflow-y-auto rounded bg-black/30 p-2 space-y-0.5">
                        {c.recentLogs.map((l, j) => (
                          <div key={j} className="log-line text-slate-400">
                            <span className="text-slate-600">{l.ts.slice(11, 19)}</span>{" "}
                            <span className={l.level === "error" || l.level === "critical" ? "text-rose-400" : l.level === "warn" ? "text-amber-400" : "text-emerald-400"}>
                              {l.level.toUpperCase()}
                            </span>{" "}
                            <span className="text-slate-300">{l.msg}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <div className="mt-3 flex gap-1.5">
                    <button
                      onClick={() => doAction(c.name, "test")}
                      disabled={!!actionBusy}
                      className="btn-orca-ghost flex-1"
                    >
                      {actionBusy === "test" ? "Đang chạy…" : "Test"}
                    </button>
                    <button
                      onClick={() => doAction(c.name, "reset")}
                      disabled={!!actionBusy}
                      className="btn-orca-ghost flex-1"
                    >
                      {actionBusy === "reset" ? "…" : "Reset circuit"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Alerts timeline + stale flags ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-white tracking-wider uppercase">Alert timeline</h2>
            <span className="text-[10px] text-slate-500">
              {data?.openAlerts.length ?? 0} open · Slack {data?.config.slackWebhookConfigured ? "ON" : "OFF"}
            </span>
          </div>
          {(data?.openAlerts.length ?? 0) > 0 && (
            <div className="mb-3 rounded border border-rose-700/60 bg-rose-950/30 p-2 text-[11px] text-rose-200 pulse-down">
              <div className="font-bold text-rose-300">CẢNH BÁO ĐANG MỞ</div>
              {data!.openAlerts.map((a, i) => (
                <div key={i} className="mt-1">• {a.provider}: {a.message.slice(0, 160)}</div>
              ))}
            </div>
          )}
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {(data?.recentAlerts.length ?? 0) === 0 && (
              <div className="text-xs text-slate-500 italic">Chưa có alert nào được dispatch trong phiên này.</div>
            )}
            {(data?.recentAlerts ?? []).map((a, i) => {
              const color = a.level === "DOWN" ? "text-rose-300 border-rose-800 bg-rose-950/30" : a.level === "RECOVERED" ? "text-emerald-300 border-emerald-800 bg-emerald-950/20" : "text-amber-300 border-amber-800 bg-amber-950/20";
              return (
                <div key={i} className={`rounded border px-2.5 py-1.5 text-[11px] ${color}`}>
                  <div className="flex justify-between items-center">
                    <span className="font-bold">{a.level}</span>
                    <span className="text-slate-500">{timeAgo(a.dispatchedAt)}</span>
                  </div>
                  <div className="text-slate-300 mt-0.5">
                    <span className="font-semibold">{(a as any).provider}</span> — {a.message.slice(0, 180)}
                  </div>
                  {a.slackOk !== null && a.slackOk !== undefined && (
                    <div className="text-[9px] text-slate-500 mt-0.5">Slack: {a.slackOk ? "✓ delivered" : "✗ failed"}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="text-sm font-bold text-white tracking-wider uppercase mb-3">Stale data flags</h2>
          {(data?.staleFlags.length ?? 0) === 0 ? (
            <div className="text-xs text-emerald-300/80 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 live-dot" /> Không có dữ liệu stale — mọi luồng dữ liệu đang tươi.
            </div>
          ) : (
            <div className="space-y-1.5">
              {(data?.staleFlags ?? []).map((s) => (
                <div key={s.key} className="rounded border border-amber-800/60 bg-amber-950/20 px-2.5 py-1.5 text-[11px] text-amber-200">
                  <div className="font-semibold">{s.kind}{s.symbol ? ` · ${s.symbol}` : ""}</div>
                  <div className="text-amber-300/80">{s.reason.slice(0, 180)}</div>
                  <div className="text-[9px] text-slate-500">since {timeAgo(s.since)}</div>
                </div>
              ))}
            </div>
          )}

          <h2 className="text-sm font-bold text-white tracking-wider uppercase mb-2 mt-5">Resilience config</h2>
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            {data?.config && Object.entries(data.config).map(([k, v]) => (
              <div key={k} className="bg-slate-900/40 rounded px-2 py-1 flex justify-between gap-2">
                <span className="text-slate-500 truncate">{k}</span>
                <span className="text-slate-200 font-mono tabular-nums">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Structured logs ─── */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-bold text-white tracking-wider uppercase">Structured logs (ring buffer)</h2>
          <div className="flex gap-2 text-[11px]">
            <select
              value={logFilter.provider}
              onChange={(e) => setLogFilter((s) => ({ ...s, provider: e.target.value }))}
              className="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-slate-300"
            >
              <option value="">Tất cả provider</option>
              {(data?.connectors ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select
              value={logFilter.level}
              onChange={(e) => setLogFilter((s) => ({ ...s, level: e.target.value }))}
              className="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-slate-300"
            >
              <option value="">Mọi mức</option>
              <option value="debug">debug+</option>
              <option value="info">info+</option>
              <option value="warn">warn+</option>
              <option value="error">error+</option>
              <option value="critical">critical</option>
            </select>
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto rounded bg-black/40 p-3 space-y-0.5">
          {filteredLogs.length === 0 ? (
            <div className="text-xs text-slate-500 italic">Chưa có log phù hợp với bộ lọc.</div>
          ) : (
            filteredLogs.map((l, i) => (
              <div key={i} className="log-line">
                <span className="text-slate-600">{l.ts.slice(11, 23)}</span>{" "}
                <span className={l.level === "critical" ? "text-fuchsia-400 font-bold" : l.level === "error" ? "text-rose-400" : l.level === "warn" ? "text-amber-400" : l.level === "debug" ? "text-slate-500" : "text-emerald-400"}>
                  {l.level.toUpperCase().padEnd(8)}
                </span>{" "}
                {typeof l.provider === "string" && <span className="text-[#00d4ff]">[{l.provider}]</span>}{" "}
                <span className="text-slate-300">{l.msg}</span>
                {Object.keys(l).filter((k) => !["ts", "level", "msg", "provider"].includes(k)).length > 0 && (
                  <span className="text-slate-600"> {JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k]) => !["ts", "level", "msg", "provider"].includes(k))))}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
