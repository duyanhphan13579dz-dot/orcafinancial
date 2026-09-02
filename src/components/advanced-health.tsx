"use client";

/**
 * Khối "Sức khỏe tài chính nâng cao" trên tab Cơ bản:
 * Altman Z'-Score, Piotroski F-Score, Beneish M-Score và bộ chỉ số thanh toán/đòn bẩy.
 */

import {
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  Bar,
  BarChart,
  XAxis,
  YAxis,
} from "recharts";
import { fmt, scoreColor } from "@/components/business-performance";

const AXIS = "#7aa8d4";
const GRID = "rgba(122,168,212,0.08)";
const UP = "#34d399";
const DOWN = "#fb7185";
const AMBER = "#fbbf24";
const CYAN = "#00d4ff";

const TOOLTIP_STYLE = {
  background: "rgba(10,37,64,0.97)",
  border: "1px solid #1a3558",
  borderRadius: 6,
  fontSize: 11,
  maxWidth: 360,
} as const;

export interface AltmanComponentVM {
  key: string;
  label: string;
  value: number | null;
  weight: number;
  contribution: number | null;
  formula: string;
}

export interface AltmanVM {
  zScore: number | null;
  zone: "safe" | "grey" | "distress" | "unavailable";
  zoneVi: string;
  verdictVi: string;
  score: number | null;
  components: AltmanComponentVM[];
}

export interface PiotroskiCriterionVM {
  key: string;
  label: string;
  passed: boolean | null;
  detail: string;
}

export interface PiotroskiVM {
  fScore: number | null;
  maxScore: number;
  evaluated: number;
  verdictVi: string;
  score: number | null;
  criteria: PiotroskiCriterionVM[];
}

export interface BeneishComponentVM {
  key: string;
  label: string;
  value: number | null;
  weight: number;
  formula: string;
}

export interface BeneishVM {
  mScore: number | null;
  manipulationRisk: "low" | "moderate" | "high" | "unavailable";
  verdictVi: string;
  score: number | null;
  components: BeneishComponentVM[];
}

export interface SolvencyMetricVM {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  benchmark: number | null;
  score: number | null;
  verdict: string;
}

export interface AdvancedHealthVM {
  symbol: string;
  asOfPeriod: string;
  overall: number;
  rating: string;
  altman: AltmanVM;
  piotroski: PiotroskiVM;
  beneish: BeneishVM;
  solvency: SolvencyMetricVM[];
  solvencyScore: number | null;
  distressFlags: string[];
  summary: string;
  warnings: string[];
}

const ZONE_COLOR: Record<AltmanVM["zone"], string> = {
  safe: UP,
  grey: AMBER,
  distress: DOWN,
  unavailable: "#64748b",
};

function AltmanGauge({ altman }: { altman: AltmanVM }) {
  const color = ZONE_COLOR[altman.zone];
  const pct = altman.zScore === null ? 0 : Math.max(0, Math.min(100, (altman.zScore / 4.5) * 100));
  return (
    <div className="relative h-[170px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="60%" outerRadius="95%" data={[{ value: pct, fill: color }]} startAngle={210} endAngle={-30}>
          <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "rgba(122,168,212,0.08)" }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-3xl font-display font-extrabold" style={{ color }}>
          {altman.zScore === null ? "—" : altman.zScore.toFixed(2)}
        </div>
        <div className="font-mono text-[9px] tracking-[0.2em] text-slate-400 mt-1">Z&apos;-SCORE</div>
        <div className="font-mono text-[9px] mt-0.5" style={{ color }}>{altman.zoneVi}</div>
      </div>
    </div>
  );
}

function PiotroskiChecklist({ piotroski }: { piotroski: PiotroskiVM }) {
  return (
    <div className="space-y-1.5">
      {piotroski.criteria.map((c) => {
        const color = c.passed === null ? "#64748b" : c.passed ? UP : DOWN;
        const icon = c.passed === null ? "○" : c.passed ? "✓" : "✗";
        return (
          <div key={c.key} className="flex items-start gap-2 text-[11px]">
            <span className="font-mono w-4" style={{ color }}>{icon}</span>
            <div className="flex-1">
              <div className="text-slate-300">{c.label}</div>
              <div className="text-[10px] text-slate-500 font-mono">{c.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BeneishBars({ beneish }: { beneish: BeneishVM }) {
  const rows = beneish.components.map((c) => ({
    name: c.key.toUpperCase(),
    label: c.label,
    value: c.value,
    weight: c.weight,
    contribution: c.value === null ? null : c.value * c.weight,
    formula: c.formula,
  }));
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={((v: number, _n: string, item: { payload: { label: string; formula: string; weight: number } }) => [
              `${Number(v).toFixed(3)} (trọng số ${item.payload.weight})`,
              item.payload.label,
            ]) as never}
            labelFormatter={(_l, payload) => (payload?.[0]?.payload?.formula ?? "") as string}
          />
          <Bar dataKey="contribution" radius={[3, 3, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.contribution === null ? "#475569" : r.contribution >= 0 ? "rgba(251,113,133,0.7)" : "rgba(52,211,153,0.6)"} />
            ))}
          </Bar>
          <ReferenceLine y={0} stroke="rgba(122,168,212,0.35)" />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[10px] text-slate-500">
        Cột = đóng góp của từng biến vào M-Score (giá trị × trọng số). Cột đỏ làm tăng rủi ro điều chỉnh số liệu.
      </p>
    </div>
  );
}

function SolvencyTable({ metrics }: { metrics: SolvencyMetricVM[] }) {
  return (
    <div className="space-y-1.5">
      {metrics.map((m) => (
        <div key={m.key} className="health-indicator-row text-[11px]">
          <div className="w-52 text-slate-400 truncate" title={`${m.label}\nCông thức: ${m.formula}`}>
            {m.label}
          </div>
          <div className="flex-1 bar-track">
            <div className="bar-fill" style={{ width: `${m.score ?? 0}%`, background: scoreColor(m.score) }} />
          </div>
          <div className="w-24 text-right font-mono tabular-nums text-slate-200">
            {fmt(m.value)}
            <span className="text-slate-500 ml-0.5">{m.unit}</span>
          </div>
          <div className="w-16 text-right font-mono text-[10px] text-amber-300/80" title="Ngưỡng tham chiếu ngành">
            {m.benchmark === null ? "—" : fmt(m.benchmark)}
          </div>
          <div className="w-10 text-right font-mono text-[10px]" style={{ color: scoreColor(m.score) }}>
            {m.score ?? "—"}
          </div>
        </div>
      ))}
      <div className="flex gap-4 text-[10px] font-mono text-slate-500 mt-1">
        <span>Giá trị</span>
        <span className="ml-auto">Ngưỡng ngành</span>
        <span>Điểm</span>
      </div>
    </div>
  );
}

export function AdvancedHealthCard({ health }: { health: AdvancedHealthVM }) {
  const color = scoreColor(health.overall);
  return (
    <div className="space-y-5">
      <div className="panel p-4 bg-gradient-to-br from-[#0a1d33] to-[#0A2540] reveal">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
              Chẩn đoán sức khỏe tài chính · LTM {health.asOfPeriod}
            </div>
            <p className="text-slate-200 text-sm leading-relaxed font-display">{health.summary}</p>
          </div>
          <div className="text-right">
            <div className="font-display text-5xl font-extrabold" style={{ color }}>{health.overall}</div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-slate-400">/100 · HẠNG {health.rating}</div>
          </div>
        </div>
        {health.distressFlags.length > 0 && (
          <div className="mt-3 space-y-1">
            {health.distressFlags.map((f) => (
              <div key={f} className="text-[11px] text-rose-300 flex items-start gap-1.5">
                <span className="text-rose-400">⚠</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Altman */}
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Altman Z&apos;-Score
          </div>
          <AltmanGauge altman={health.altman} />
          <p className="text-[11px] text-slate-300 leading-relaxed">{health.altman.verdictVi}</p>
          <div className="mt-2 space-y-1">
            {health.altman.components.map((c) => (
              <div key={c.key} className="flex justify-between text-[10px] font-mono" title={c.formula}>
                <span className="text-slate-500 truncate">{c.label}</span>
                <span className="text-slate-300 tabular-nums">
                  {c.value === null ? "—" : c.value.toFixed(3)} × {c.weight} = {c.contribution === null ? "—" : c.contribution.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[9px] text-slate-500 font-mono">
            Z&apos; = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4 · &gt;2.6 an toàn · 1.1–2.6 vùng xám · &lt;1.1 nguy hiểm
          </p>
        </div>

        {/* Piotroski */}
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Piotroski F-Score
          </div>
          <div className="flex items-end gap-2 mb-2">
            <div className="text-4xl font-display font-extrabold" style={{ color: scoreColor(health.piotroski.score) }}>
              {health.piotroski.fScore ?? "—"}
            </div>
            <div className="text-[11px] text-slate-500 font-mono pb-1">
              / {health.piotroski.maxScore} · đánh giá được {health.piotroski.evaluated}/{health.piotroski.maxScore} tiêu chí
            </div>
          </div>
          <PiotroskiChecklist piotroski={health.piotroski} />
          <p className="mt-2 text-[11px] text-slate-400 italic">{health.piotroski.verdictVi}</p>
        </div>

        {/* Beneish */}
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Beneish M-Score
          </div>
          <div className="flex items-end gap-2 mb-1">
            <div
              className="text-4xl font-display font-extrabold"
              style={{
                color:
                  health.beneish.manipulationRisk === "low" ? UP : health.beneish.manipulationRisk === "moderate" ? AMBER : health.beneish.manipulationRisk === "high" ? DOWN : "#64748b",
              }}
            >
              {health.beneish.mScore === null ? "—" : health.beneish.mScore.toFixed(2)}
            </div>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed mb-2">{health.beneish.verdictVi}</p>
          <BeneishBars beneish={health.beneish} />
        </div>
      </div>

      <div className="panel p-4 reveal">
        <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-3">
          Thanh toán &amp; đòn bẩy · điểm {health.solvencyScore ?? "—"}/100
        </div>
        <SolvencyTable metrics={health.solvency} />
      </div>

      {health.warnings.length > 0 && (
        <div className="panel p-3 border-l-2 border-amber-500/60">
          <div className="font-mono text-[10px] tracking-[0.2em] text-amber-400 uppercase mb-1">Lưu ý dữ liệu</div>
          <ul className="text-[11px] text-slate-400 space-y-1 list-disc pl-4">
            {health.warnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
