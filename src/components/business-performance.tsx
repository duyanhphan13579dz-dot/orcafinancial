"use client";

/**
 * Khối "Hiệu suất kinh doanh" trên tab Cơ bản.
 * Hiển thị: điểm tổng, 5 trụ cột, DuPont 3 & 5 bước, biểu đồ xu hướng và bảng chỉ số
 * kèm CÔNG THỨC của từng chỉ số (hover/tooltip).
 */

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = "#7aa8d4";
const GRID = "rgba(122,168,212,0.08)";
const UP = "#34d399";
const DOWN = "#fb7185";
const CYAN = "#00d4ff";
const BLUE = "#38bdf8";
const AMBER = "#fbbf24";
const VIOLET = "#a78bfa";

const TOOLTIP_STYLE = {
  background: "rgba(10,37,64,0.97)",
  border: "1px solid #1a3558",
  borderRadius: 6,
  fontSize: 11,
  maxWidth: 340,
} as const;

export interface EngineMetricVM {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  benchmark: number | null;
  score: number | null;
  verdict: string;
  estimated?: boolean;
}

export interface EngineGroupVM {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  weighted: number;
  narrative: string;
  metrics: EngineMetricVM[];
}

export interface DupontVM {
  netProfitMarginPct: number | null;
  assetTurnover: number | null;
  equityMultiplier: number | null;
  reconstructedPct: number | null;
  description: string;
}

export interface Dupont5VM {
  roePct: number | null;
  description: string;
  steps: Array<{ key: string; label: string; value: number | null; unit: string; formula: string }>;
}

export interface PerformanceSeriesPoint {
  shortTag: string;
  displayPeriodVi: string;
  revenue: number | null;
  ebitda: number | null;
  netIncome: number | null;
  eps: number | null;
  grossMarginPct: number | null;
  ebitdaMarginPct: number | null;
  netMarginPct: number | null;
  revenueYoYPct: number | null;
  netIncomeYoYPct: number | null;
  roePct: number | null;
  roaPct: number | null;
  dsoDays: number | null;
  dioDays: number | null;
  dpoDays: number | null;
  cccDays: number | null;
}

export interface BusinessPerformanceVM {
  symbol: string;
  asOfPeriod: string;
  asOfPeriodVi: string;
  ltmMethod: string;
  basis: string;
  overall: number;
  rating: string;
  groups: EngineGroupVM[];
  dupont3: DupontVM;
  dupont5: Dupont5VM;
  series: PerformanceSeriesPoint[];
  summary: string;
  coverage: { computed: number; total: number; pct: number };
  warnings: string[];
}

export function scoreColor(score: number | null): string {
  if (score === null) return "#64748b";
  if (score >= 80) return "#34d399";
  if (score >= 65) return "#a3e635";
  if (score >= 45) return "#fbbf24";
  if (score >= 25) return "#fb923c";
  return "#fb7185";
}

export function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("vi-VN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/* ──────────────────────────────────────────────────────────── */

function MetricRow({ metric }: { metric: EngineMetricVM }) {
  return (
    <div className="health-indicator-row text-[11px] group">
      <div className="w-40 text-slate-400 truncate" title={`${metric.label}\nCông thức: ${metric.formula}`}>
        {metric.label}
        {metric.estimated ? <span className="ml-1 text-[9px] text-amber-500" title="Giá trị nội suy từ YTD">≈</span> : null}
      </div>
      <div className="flex-1 bar-track">
        <div
          className="bar-fill"
          style={{ width: `${metric.score ?? 0}%`, background: scoreColor(metric.score) }}
        />
      </div>
      <div className="w-24 text-right font-mono tabular-nums text-slate-200">
        {metric.value === null ? (
          <span className="text-slate-500 text-[10px]">{metric.verdict}</span>
        ) : (
          <>
            {fmt(metric.value)}
            <span className="text-slate-500 ml-0.5">{metric.unit}</span>
          </>
        )}
      </div>
      <div className="w-10 text-right font-mono text-[10px]" style={{ color: scoreColor(metric.score) }}>
        {metric.score ?? "—"}
      </div>
    </div>
  );
}

function GroupCard({ group }: { group: EngineGroupVM }) {
  return (
    <div className="panel p-4 reveal">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-display text-base font-bold text-white">{group.label}</div>
          <div className="font-mono text-[10px] text-slate-500">
            trọng số {(group.weight * 100).toFixed(0)}% · đóng góp {group.weighted.toFixed(2)} điểm
          </div>
        </div>
        <div className="font-display text-2xl font-extrabold" style={{ color: scoreColor(group.score) }}>
          {group.score ?? "—"}
        </div>
      </div>
      <p className="text-[12px] text-slate-300 leading-relaxed mb-3 italic">{group.narrative}</p>
      <div className="space-y-1.5">
        {group.metrics.map((m) => (
          <MetricRow key={m.key} metric={m} />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────── Biểu đồ ─────────────────── */

export function GrowthChart({ data }: { data: PerformanceSeriesPoint[] }) {
  const rows = useMemo(
    () =>
      [...data].reverse().map((q) => ({
        period: q.shortTag,
        title: q.displayPeriodVi,
        "Doanh thu": q.revenue,
        "LN ròng": q.netIncome,
        "Doanh thu YoY %": q.revenueYoYPct,
        "LN ròng YoY %": q.netIncomeYoYPct,
      })),
    [data],
  );
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="period" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={40} unit="%" />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#b8cfe2" }} />
          <Bar yAxisId="left" dataKey="Doanh thu" fill={BLUE} radius={[2, 2, 0, 0]} />
          <Bar yAxisId="left" dataKey="LN ròng" fill={CYAN} radius={[2, 2, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="Doanh thu YoY %" stroke={AMBER} strokeWidth={2} dot={{ r: 3 }} />
          <Line yAxisId="right" type="monotone" dataKey="LN ròng YoY %" stroke={UP} strokeWidth={2} dot={{ r: 3 }} />
          <ReferenceLine yAxisId="right" y={0} stroke="rgba(122,168,212,0.35)" strokeDasharray="3 3" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MarginStackChart({ data }: { data: PerformanceSeriesPoint[] }) {
  const rows = useMemo(
    () =>
      [...data].reverse().map((q) => ({
        period: q.shortTag,
        "Biên gộp": q.grossMarginPct,
        "Biên EBITDA": q.ebitdaMarginPct,
        "Biên LN ròng": q.netMarginPct,
      })),
    [data],
  );
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="period" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={40} unit="%" />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#b8cfe2" }} />
          <Line type="monotone" dataKey="Biên gộp" stroke={AMBER} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Biên EBITDA" stroke={CYAN} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Biên LN ròng" stroke={UP} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReturnChart({ data }: { data: PerformanceSeriesPoint[] }) {
  const rows = useMemo(
    () =>
      [...data].reverse().map((q) => ({
        period: q.shortTag,
        ROE: q.roePct,
        ROA: q.roaPct,
      })),
    [data],
  );
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="period" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={40} unit="%" />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#b8cfe2" }} />
          <Bar dataKey="ROE" fill={VIOLET} radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey="ROA" stroke={CYAN} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WorkingCapitalCycleChart({ data }: { data: PerformanceSeriesPoint[] }) {
  const rows = useMemo(
    () =>
      [...data].reverse().map((q) => ({
        period: q.shortTag,
        "Tồn kho (DIO)": q.dioDays,
        "Phải thu (DSO)": q.dsoDays,
        "Phải trả (DPO)": q.dpoDays !== null ? -q.dpoDays : null,
        "Chu kỳ tiền (CCC)": q.cccDays,
      })),
    [data],
  );
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="period" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={40} unit="n" />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={((v: number, n: string) => [`${Number(v).toFixed(0)} ngày`, n]) as never} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#b8cfe2" }} />
          <Bar dataKey="Tồn kho (DIO)" stackId="a" fill={AMBER} radius={[2, 2, 0, 0]} />
          <Bar dataKey="Phải thu (DSO)" stackId="a" fill={CYAN} radius={[2, 2, 0, 0]} />
          <Bar dataKey="Phải trả (DPO)" stackId="a" fill={BLUE} radius={[2, 2, 0, 0]} />
          <Line type="monotone" dataKey="Chu kỳ tiền (CCC)" stroke={UP} strokeWidth={2} dot={{ r: 3 }} />
          <ReferenceLine y={0} stroke="rgba(122,168,212,0.35)" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PerformanceRadar({ groups }: { groups: EngineGroupVM[] }) {
  const data = groups.map((g) => ({ group: g.label, score: g.score ?? 0, fullMark: 100 }));
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="rgba(122,168,212,0.18)" />
          <PolarAngleAxis dataKey="group" tick={{ fill: "#b8cfe2", fontSize: 10, fontFamily: "var(--font-mono)" }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: AXIS, fontSize: 9 }} stroke="rgba(122,168,212,0.18)" />
          <Radar name="Điểm" dataKey="score" stroke={CYAN} fill={CYAN} fillOpacity={0.28} strokeWidth={2} dot={{ r: 3, fill: CYAN }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DuPontWaterfall({ dupont5 }: { dupont5: Dupont5VM }) {
  const rows = dupont5.steps.map((s) => ({
    name: s.label.split("—")[0].trim().split("(")[0].trim(),
    full: s.label,
    value: s.value,
    unit: s.unit,
    formula: s.formula,
  }));
  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={{ fill: "#b8cfe2", fontSize: 10 }} axisLine={false} tickLine={false} width={130} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={((v: number, _n: string, item: { payload: { full: string; unit: string; formula: string } }) => [
              `${Number(v).toLocaleString("vi-VN")} ${item.payload.unit} — ${item.payload.formula}`,
              item.payload.full,
            ]) as never}
          />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {rows.map((r, i) => (
              <Cell key={r.full} fill={r.value === null ? "#475569" : [CYAN, BLUE, UP, AMBER, VIOLET][i % 5]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────────────── Card chính ─────────────────── */

export function BusinessPerformanceCard({ performance }: { performance: BusinessPerformanceVM }) {
  const color = scoreColor(performance.overall);
  return (
    <div className="space-y-5">
      <div className="panel p-4 bg-gradient-to-br from-[#0a1d33] to-[#0A2540] reveal">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
              Tóm tắt hiệu suất · LTM đến {performance.asOfPeriod}
            </div>
            <p className="text-slate-200 text-sm leading-relaxed font-display">{performance.summary}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-slate-400">
              <span className="rounded bg-slate-800/70 px-2 py-0.5">
                Phương pháp LTM: {performance.ltmMethod}
              </span>
              <span className="rounded bg-slate-800/70 px-2 py-0.5">
                Dạng BCTC: {performance.basis === "cumulative-ytd" ? "luỹ kế (đã tách quý)" : performance.basis === "standalone" ? "riêng từng quý" : "chưa xác định"}
              </span>
              <span className="rounded bg-slate-800/70 px-2 py-0.5">
                Độ phủ chỉ số: {performance.coverage.computed}/{performance.coverage.total} ({performance.coverage.pct}%)
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-5xl font-extrabold" style={{ color }}>
              {performance.overall}
            </div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-slate-400">
              /100 · HẠNG {performance.rating}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">Radar 5 trụ cột</div>
          <PerformanceRadar groups={performance.groups} />
        </div>
        <div className="panel p-4 lg:col-span-2 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Doanh thu · LN ròng và tăng trưởng YoY
          </div>
          <GrowthChart data={performance.series} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Biên lợi nhuận qua các quý (%)
          </div>
          <MarginStackChart data={performance.series} />
        </div>
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            ROE · ROA năm hoá (%)
          </div>
          <ReturnChart data={performance.series} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Chu kỳ vốn lưu động (ngày)
          </div>
          <WorkingCapitalCycleChart data={performance.series} />
          <p className="mt-1 text-[10px] text-slate-500 font-mono">
            CCC = DIO + DSO − DPO · DIO = 365/(COGS/Tồn kho BQ) · DSO = 365/(DT/Phải thu BQ) · DPO = 365/(COGS/Phải trả BQ)
          </p>
        </div>
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Phân rã DuPont 5 bước
          </div>
          <DuPontWaterfall dupont5={performance.dupont5} />
          <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">{performance.dupont5.description}</p>
        </div>
      </div>

      <div className="panel p-4 reveal">
        <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">DuPont 3 bước</div>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="bg-slate-800/60 px-2 py-1 rounded">
            Biên LN ròng: {fmt(performance.dupont3.netProfitMarginPct, 1)}%
          </span>
          <span className="text-slate-600">×</span>
          <span className="bg-slate-800/60 px-2 py-1 rounded">
            Vòng quay TS: {fmt(performance.dupont3.assetTurnover)}
          </span>
          <span className="text-slate-600">×</span>
          <span className="bg-slate-800/60 px-2 py-1 rounded">
            Đòn bẩy VCSH: {fmt(performance.dupont3.equityMultiplier)}
          </span>
          <span className="text-slate-600">=</span>
          <span className="bg-cyan-500/15 px-2 py-1 rounded font-bold text-cyan-300">
            ROE: {fmt(performance.dupont3.reconstructedPct, 1)}%
          </span>
        </div>
        <div className="mt-2 text-xs text-slate-500">{performance.dupont3.description}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {performance.groups.map((group) => (
          <GroupCard key={group.key} group={group} />
        ))}
      </div>

      {performance.warnings.length > 0 && (
        <div className="panel p-3 border-l-2 border-amber-500/60">
          <div className="font-mono text-[10px] tracking-[0.2em] text-amber-400 uppercase mb-1">
            Lưu ý về dữ liệu
          </div>
          <ul className="text-[11px] text-slate-400 space-y-1 list-disc pl-4">
            {performance.warnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
