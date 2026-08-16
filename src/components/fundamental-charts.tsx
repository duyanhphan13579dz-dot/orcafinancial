"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CHART_AXIS = "#7aa8d4";
const GRID = "rgba(122,168,212,0.08)";
const UP = "#34d399";
const DOWN = "#fb7185";
const CYAN = "#00d4ff";
const BLUE = "#38bdf8";
const AMBER = "#fbbf24";

interface QuarterPoint {
  displayPeriod: string;
  displayPeriodVi: string;
  shortTag: string;
  revenue: number;
  grossProfit: number;
  ebitda: number;
  netIncome: number;
  eps: number;
  roePct: number;
  roaPct: number;
  grossMarginPct: number;
  netMarginPct: number;
  ebitdaMarginPct: number;
  debtEquity: number;
}
interface Industry {
  sector: string;
  industry: string;
  roePct: number;
  roaPct: number;
  netMarginPct: number;
  grossMarginPct: number;
  ebitdaMarginPct: number;
  debtEquity: number;
}

export function RevenueProfitChart({ data }: { data: QuarterPoint[] }) {
  const rows = useMemo(
    () =>
      [...data].reverse().map((q) => ({
        period: q.shortTag,
        title: q.displayPeriodVi,
        "Doanh thu": q.revenue,
        "LN gộp": q.grossProfit,
        "EBITDA": q.ebitda,
        "LN ròng": q.netIncome,
      })),
    [data],
  );
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="period" tick={{ fill: CHART_AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            cursor={{ fill: "rgba(0,212,255,0.06)" }}
            contentStyle={{ background: "rgba(10,37,64,0.96)", border: "1px solid #1a3558", borderRadius: 6, fontSize: 11 }}
            labelStyle={{ color: "#fff", fontWeight: 600 }}
            formatter={((v: number, name: string) => [`${Number(v).toLocaleString("vi-VN")} tỷ`, name]) as any}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#b8cfe2" }} />
          <Bar dataKey="Doanh thu" fill={BLUE} radius={[2, 2, 0, 0]} />
          <Bar dataKey="EBITDA" fill={CYAN} radius={[2, 2, 0, 0]} />
          <Bar dataKey="LN ròng" fill={UP} radius={[2, 2, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MarginsTrendChart({ data }: { data: QuarterPoint[] }) {
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
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="period" tick={{ fill: CHART_AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={40} unit="%" />
          <Tooltip contentStyle={{ background: "rgba(10,37,64,0.96)", border: "1px solid #1a3558", borderRadius: 6, fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#b8cfe2" }} />
          <Line type="monotone" dataKey="Biên gộp" stroke={AMBER} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="Biên EBITDA" stroke={CYAN} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Biên LN ròng" stroke={UP} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ROEvsIndustryChart({ data, industry }: { data: QuarterPoint[]; industry: Industry }) {
  const rows = useMemo(
    () =>
      [...data].reverse().map((q) => ({
        period: q.shortTag,
        ROE: q.roePct,
        ROA: q.roaPct,
        "ROE ngành": industry.roePct,
      })),
    [data, industry],
  );
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="period" tick={{ fill: CHART_AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={40} unit="%" />
          <Tooltip contentStyle={{ background: "rgba(10,37,64,0.96)", border: "1px solid #1a3558", borderRadius: 6, fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#b8cfe2" }} />
          <Line type="monotone" dataKey="ROE" stroke={CYAN} strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          <Line type="monotone" dataKey="ROA" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} />
          <ReferenceLine y={industry.roePct} stroke={AMBER} strokeDasharray="4 4" label={{ value: `ngành ${industry.roePct.toFixed(1)}%`, fill: AMBER, fontSize: 10, position: "insideTopRight" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EPSTrendChart({ data }: { data: QuarterPoint[] }) {
  const rows = useMemo(
    () =>
      [...data].reverse().map((q) => ({
        period: q.shortTag,
        EPS: q.eps,
      })),
    [data],
  );
  return (
    <div className="h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="period" tick={{ fill: CHART_AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip contentStyle={{ background: "rgba(10,37,64,0.96)", border: "1px solid #1a3558", borderRadius: 6, fontSize: 11 }} formatter={((v: number) => [`${Number(v).toFixed(2)} nghìn VND`, "EPS"]) as any} />
          <Bar dataKey="EPS" radius={[3, 3, 0, 0]}>
            {rows.map((r, i) => (
              <Cell key={i} fill={r.EPS >= 0 ? CYAN : DOWN} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HealthGauge({ overall, rating }: { overall: number; rating: string }) {
  const color = overall >= 70 ? UP : overall >= 45 ? AMBER : DOWN;
  return (
    <div className="relative h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="62%" outerRadius="95%" data={[{ value: overall, fill: color }]} startAngle={220} endAngle={-40}>
          <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "rgba(122,168,212,0.08)" }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="gauge-center text-4xl" style={{ color }}>{overall}</div>
        <div className="font-mono text-[10px] tracking-[0.3em] text-slate-400 mt-1">/ 100 · HẠNG {rating}</div>
      </div>
    </div>
  );
}

export function IndustryCompareBars({ comparisons }: { comparisons: Array<{ metric: string; label: string; company: number; industry: number; unit: string }> }) {
  const maxAbs = Math.max(...comparisons.map((c) => Math.max(Math.abs(c.company), Math.abs(c.industry))), 1);
  return (
    <div className="space-y-3">
      {comparisons.map((c) => {
        const beat = c.metric === "de" ? c.company < c.industry : c.company > c.industry; // lower D/E is better
        const wC = (Math.abs(c.company) / maxAbs) * 100;
        const wI = (Math.abs(c.industry) / maxAbs) * 100;
        return (
          <div key={c.metric}>
            <div className="flex justify-between items-center mb-1 text-[11px]">
              <span className="font-mono tracking-wider text-slate-400 uppercase">{c.label}</span>
              <span className={`font-mono ${beat ? "text-emerald-300" : "text-amber-300"}`}>
                {c.company.toFixed(2)}{c.unit} <span className="text-slate-600">vs</span> {c.industry.toFixed(2)}{c.unit}
              </span>
            </div>
            <div className="space-y-1">
              <div className="bar-track">
                <div className="bar-fill bg-[#00d4ff]" style={{ width: `${wC}%` }} />
              </div>
              <div className="bar-track">
                <div className="bar-fill bg-amber-400/70" style={{ width: `${wI}%` }} />
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex gap-4 text-[10px] font-mono text-slate-500 mt-2">
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 bg-[#00d4ff]" /> Công ty</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 bg-amber-400/70" /> Trung bình ngành</span>
      </div>
    </div>
  );
}
