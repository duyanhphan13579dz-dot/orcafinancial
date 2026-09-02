"use client";

/**
 * Khối "Định giá doanh nghiệp" trên tab Cơ bản.
 * Hiển thị bội số vs ngành, WACC/CAPM, DCF, biểu đồ "sân bóng" (football field),
 * lưới độ nhạy WACC × g và kết luận bằng tiếng Việt.
 */

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmt } from "@/components/business-performance";

const AXIS = "#7aa8d4";
const GRID = "rgba(122,168,212,0.08)";
const CYAN = "#00d4ff";
const UP = "#34d399";
const DOWN = "#fb7185";
const AMBER = "#fbbf24";

const TOOLTIP_STYLE = {
  background: "rgba(10,37,64,0.97)",
  border: "1px solid #1a3558",
  borderRadius: 6,
  fontSize: 11,
  maxWidth: 360,
} as const;

export interface MultipleVM {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  industry: number | null;
  vsIndustry: number | null;
  lowerIsBetter: boolean;
  verdict: string;
}

export interface WaccVM {
  costOfEquity: number | null;
  costOfDebt: number | null;
  costOfDebtAfterTax: number | null;
  taxRate: number;
  equityWeight: number | null;
  debtWeight: number | null;
  beta: number | null;
  riskFreeRate: number;
  equityRiskPremium: number;
  value: number | null;
  formula: string[];
}

export interface DcfVM {
  available: boolean;
  stageOneGrowth: number | null;
  terminalGrowth: number;
  wacc: number | null;
  baseFcf: number | null;
  enterpriseValue: number | null;
  netDebt: number | null;
  equityValue: number | null;
  valuePerShare: number | null;
  terminalValueSharePct: number | null;
  scenarios: { pessimistic: number | null; base: number | null; optimistic: number | null };
  stageOne: Array<{ year: number; fcf: number | null; discountFactor: number | null; presentValue: number | null }>;
  note: string;
}

export interface ValuationMethodVM {
  key: string;
  label: string;
  valuePerShare: number | null;
  low: number | null;
  high: number | null;
  weight: number;
  formula: string;
  note: string;
}

export interface SensitivityCellVM {
  wacc: number;
  terminalGrowth: number;
  valuePerShare: number | null;
}

export interface ValuationVM {
  symbol: string;
  asOfPeriod: string;
  price: number | null;
  sharesOutstandingMillions: number | null;
  marketCapBillionVnd: number | null;
  enterpriseValueBillionVnd: number | null;
  netDebtBillionVnd: number | null;
  epsLtm: number | null;
  bvps: number | null;
  dpsLtm: number | null;
  fcfPerShare: number | null;
  multiples: MultipleVM[];
  industryMultiples: { pe: number | null; pb: number | null; evEbitda: number | null; evSales: number | null; source: string };
  wacc: WaccVM;
  dcf: DcfVM;
  fcfe: DcfVM;
  ddm: { available: boolean; dps: number | null; valuePerShare: number | null; requiredReturn: number | null; growth: number | null; formula: string; note: string };
  grahamNumber: number | null;
  reverseDcf: { impliedGrowthPct: number | null; formula: string; verdictVi: string };
  methods: ValuationMethodVM[];
  targetPrice: { low: number | null; mid: number | null; high: number | null };
  upsidePct: number | null;
  marginOfSafetyPct: number | null;
  rating: string;
  verdictVi: string;
  sensitivity: { waccSteps: number[]; growthSteps: number[]; cells: SensitivityCellVM[] };
  assumptions: Record<string, number | string>;
  methodology: string[];
  warnings: string[];
}

const RATING_COLOR: Record<string, string> = {
  "HẤP DẪN": "#34d399",
  "TÍCH LŨY": "#a3e635",
  "HỢP LÝ": "#fbbf24",
  "ĐẮT": "#fb923c",
  "RẤT ĐẮT": "#fb7185",
  "N/A": "#64748b",
};

function MultipleCard({ m }: { m: MultipleVM }) {
  const good =
    m.value !== null && m.industry !== null
      ? m.lowerIsBetter
        ? m.value <= m.industry
        : m.value >= m.industry
      : null;
  return (
    <div className="bg-slate-800/40 rounded p-3" title={`Công thức: ${m.formula}`}>
      <div className="text-[10px] text-slate-500 truncate">{m.label}</div>
      <div className="text-lg font-bold font-mono tabular-nums">
        {m.value === null ? "—" : fmt(m.value)}
        <span className="text-[10px] text-slate-500 ml-1">{m.unit}</span>
      </div>
      <div className="text-[10px] font-mono">
        <span className="text-slate-500">ngành </span>
        <span className="text-amber-300">{m.industry === null ? "—" : fmt(m.industry)}</span>
        {m.vsIndustry !== null ? (
          <span className={good === null ? "text-slate-500" : good ? "text-emerald-400 ml-1" : "text-rose-400 ml-1"}>
            {m.vsIndustry >= 0 ? "+" : ""}
            {fmt(m.vsIndustry, 0)}%
          </span>
        ) : null}
      </div>
      <div className="text-[9px] text-slate-600 truncate mt-0.5">{m.verdict}</div>
    </div>
  );
}

export function FootballField({ valuation }: { valuation: ValuationVM }) {
  const rows = useMemo(
    () =>
      valuation.methods.map((m) => ({
        name: m.label,
        low: m.low ?? m.valuePerShare ?? 0,
        high: m.high ?? m.valuePerShare ?? 0,
        mid: m.valuePerShare ?? 0,
        weight: m.weight,
        formula: m.formula,
        note: m.note,
      })),
    [valuation.methods],
  );

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
          barCategoryGap={10}
        >
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} unit="k" />
          <YAxis type="category" dataKey="name" tick={{ fill: "#b8cfe2", fontSize: 10 }} axisLine={false} tickLine={false} width={140} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={((v: number, name: string) => [
              `${Number(v).toLocaleString("vi-VN")} nghìn VND`,
              name,
            ]) as never}
            labelFormatter={(_l, payload) => {
              const p = (payload?.[0]?.payload ?? {}) as { formula?: string; note?: string; mid?: number; weight?: number };
              return `${p.formula ?? ""} · trọng số ${((p.weight ?? 0) * 100).toFixed(0)}%`;
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#b8cfe2" }} />
          <Bar dataKey="low" stackId="range" fill="transparent" name="Từ" />
          <Bar dataKey={(row: { low: number; high: number }) => row.high - row.low} stackId="range" name="Khoảng giá trị" radius={[3, 3, 3, 3]}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.mid >= (valuation.price ?? 0) ? "rgba(52,211,153,0.55)" : "rgba(251,113,133,0.5)"} />
            ))}
          </Bar>
          {valuation.price !== null ? (
            <ReferenceLine x={valuation.price} stroke={CYAN} strokeWidth={2} strokeDasharray="5 4" label={{ value: `Giá ${valuation.price.toLocaleString("vi-VN")}`, fill: CYAN, fontSize: 10, position: "insideTopRight" }} />
          ) : null}
          {valuation.targetPrice.mid !== null ? (
            <ReferenceLine x={valuation.targetPrice.mid} stroke={AMBER} strokeWidth={2} strokeDasharray="2 3" label={{ value: `Mục tiêu ${valuation.targetPrice.mid.toFixed(0)}`, fill: AMBER, fontSize: 10, position: "insideBottomRight" }} />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SensitivityHeatmap({ valuation }: { valuation: ValuationVM }) {
  const { waccSteps, growthSteps, cells } = valuation.sensitivity;
  const values = cells.map((c) => c.valuePerShare).filter((v): v is number => v !== null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const price = valuation.price ?? null;

  const colorOf = (v: number | null) => {
    if (v === null) return "rgba(100,116,139,0.15)";
    if (price === null) return "rgba(0,212,255,0.25)";
    const diff = (v - price) / price;
    if (diff >= 0.2) return "rgba(52,211,153,0.6)";
    if (diff >= 0.05) return "rgba(52,211,153,0.35)";
    if (diff > -0.05) return "rgba(251,191,36,0.3)";
    if (diff > -0.2) return "rgba(251,146,60,0.35)";
    return "rgba(251,113,133,0.5)";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] font-mono border-collapse">
        <thead>
          <tr>
            <th className="text-left text-slate-500 font-normal p-1">WACC ↓ / g →</th>
            {growthSteps.map((g) => (
              <th key={g} className="text-slate-400 font-normal p-1">
                {(g * 100).toFixed(2)}%
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {waccSteps.map((w) => (
            <tr key={w}>
              <td className="text-slate-400 p-1 whitespace-nowrap">{(w * 100).toFixed(2)}%</td>
              {growthSteps.map((g) => {
                const cell = cells.find((c) => c.wacc === w && c.terminalGrowth === g);
                const isBase = Math.abs(w - (valuation.wacc.value ?? 0)) < 1e-6 && Math.abs(g - valuation.dcf.terminalGrowth) < 1e-6;
                return (
                  <td
                    key={g}
                    className={`p-1 text-center tabular-nums ${isBase ? "ring-1 ring-cyan-400/70" : ""}`}
                    style={{ background: colorOf(cell?.valuePerShare ?? null) }}
                    title={`WACC ${(w * 100).toFixed(2)}%, g ${(g * 100).toFixed(2)}%`}
                  >
                    {cell?.valuePerShare === null || cell?.valuePerShare === undefined ? "—" : cell.valuePerShare.toFixed(0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-slate-500">
        Ô = giá trị hợp lý mỗi CP (nghìn VND) theo DCF FCFF. Màu xanh: cao hơn giá hiện tại {price === null ? "" : `(${price.toLocaleString("vi-VN")})`}. Ô viền xanh dương là kịch bản cơ sở.
        Dải WACC: {((min || 0) > 0 ? "" : "")}{(waccSteps[0] * 100).toFixed(2)}% – {(waccSteps[waccSteps.length - 1] * 100).toFixed(2)}%;
        dải g: {(growthSteps[0] * 100).toFixed(2)}% – {(growthSteps[growthSteps.length - 1] * 100).toFixed(2)}%.
      </p>
    </div>
  );
}

export function ValuationCard({ valuation }: { valuation: ValuationVM }) {
  const ratingColor = RATING_COLOR[valuation.rating] ?? "#64748b";
  const upsideColor =
    valuation.upsidePct === null ? "#64748b" : valuation.upsidePct >= 0 ? UP : DOWN;

  return (
    <div className="space-y-5">
      {/* Kết luận */}
      <div className="panel p-4 bg-gradient-to-br from-[#0a1d33] to-[#0A2540] reveal">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
              Kết luận định giá · LTM {valuation.asOfPeriod}
            </div>
            <p className="text-slate-200 text-sm leading-relaxed font-display">{valuation.verdictVi}</p>
          </div>
          <div className="text-right">
            <div className="font-display text-3xl font-extrabold" style={{ color: ratingColor }}>
              {valuation.rating}
            </div>
            <div className="font-mono text-xs" style={{ color: upsideColor }}>
              {valuation.upsidePct === null ? "—" : `${valuation.upsidePct >= 0 ? "+" : ""}${fmt(valuation.upsidePct, 1)}%`}
            </div>
            <div className="font-mono text-[9px] text-slate-500">upside so với giá hiện tại</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-2 text-[10px] font-mono">
          {[
            ["Giá hiện tại", valuation.price === null ? "—" : `${valuation.price.toLocaleString("vi-VN")}k`],
            ["Giá trị hợp lý", valuation.targetPrice.mid === null ? "—" : `${valuation.targetPrice.mid.toFixed(0)}k`],
            ["Biên an toàn", valuation.marginOfSafetyPct === null ? "—" : `${fmt(valuation.marginOfSafetyPct, 1)}%`],
            ["Vốn hoá", valuation.marketCapBillionVnd === null ? "—" : `${valuation.marketCapBillionVnd.toLocaleString("vi-VN")} tỷ`],
            ["EV", valuation.enterpriseValueBillionVnd === null ? "—" : `${valuation.enterpriseValueBillionVnd.toLocaleString("vi-VN")} tỷ`],
            ["Nợ ròng", valuation.netDebtBillionVnd === null ? "—" : `${valuation.netDebtBillionVnd.toLocaleString("vi-VN")} tỷ`],
          ].map(([label, value]) => (
            <div key={label} className="bg-slate-800/50 rounded px-2 py-1.5">
              <div className="text-slate-500">{label}</div>
              <div className="text-slate-200 text-[11px] tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bội số */}
      <div className="panel p-4 reveal">
        <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-3">
          Bội số định giá vs ngành ({valuation.industryMultiples.source})
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {valuation.multiples.map((m) => (
            <MultipleCard key={m.key} m={m} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono text-slate-400">
          <span>EPS LTM: <span className="text-slate-200">{valuation.epsLtm === null ? "—" : fmt(valuation.epsLtm, 2)}k</span></span>
          <span>BVPS: <span className="text-slate-200">{valuation.bvps === null ? "—" : fmt(valuation.bvps, 2)}k</span></span>
          <span>DPS LTM: <span className="text-slate-200">{valuation.dpsLtm === null ? "—" : fmt(valuation.dpsLtm, 2)}k</span></span>
          <span>FCF/CP LTM: <span className="text-slate-200">{valuation.fcfPerShare === null ? "—" : fmt(valuation.fcfPerShare, 2)}k</span></span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* WACC */}
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Chi phí vốn (CAPM / WACC)
          </div>
          <div className="text-3xl font-display font-extrabold text-cyan-300 mb-2">
            {valuation.wacc.value === null ? "—" : `${(valuation.wacc.value * 100).toFixed(2)}%`}
            <span className="text-xs text-slate-500 ml-2">WACC</span>
          </div>
          <div className="space-y-1 text-[11px] font-mono text-slate-400">
            <div className="flex justify-between"><span>Ke = Rf + β × ERP</span><span className="text-slate-200">{valuation.wacc.costOfEquity === null ? "—" : `${(valuation.wacc.costOfEquity * 100).toFixed(2)}%`}</span></div>
            <div className="flex justify-between"><span>β</span><span className="text-slate-200">{valuation.wacc.beta ?? "—"}</span></div>
            <div className="flex justify-between"><span>Rf (TPCP 10 năm)</span><span className="text-slate-200">{(valuation.wacc.riskFreeRate * 100).toFixed(2)}%</span></div>
            <div className="flex justify-between"><span>ERP</span><span className="text-slate-200">{(valuation.wacc.equityRiskPremium * 100).toFixed(2)}%</span></div>
            <div className="flex justify-between"><span>Kd sau thuế</span><span className="text-slate-200">{valuation.wacc.costOfDebtAfterTax === null ? "9.00% (mặc định)" : `${(valuation.wacc.costOfDebtAfterTax * 100).toFixed(2)}%`}</span></div>
            <div className="flex justify-between"><span>Thuế suất hiệu dụng</span><span className="text-slate-200">{(valuation.wacc.taxRate * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between"><span>Tỷ trọng E / D</span><span className="text-slate-200">{valuation.wacc.equityWeight === null ? "—" : `${((valuation.wacc.equityWeight ?? 0) * 100).toFixed(1)}% / ${((valuation.wacc.debtWeight ?? 0) * 100).toFixed(1)}%`}</span></div>
          </div>
          <div className="mt-2 space-y-1 text-[10px] text-slate-500">
            {valuation.wacc.formula.map((f) => (
              <div key={f}>{f}</div>
            ))}
          </div>
        </div>

        {/* DCF */}
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">DCF 2 giai đoạn (FCFF)</div>
          {valuation.dcf.available ? (
            <>
              <div className="text-3xl font-display font-extrabold text-emerald-300 mb-1">
                {valuation.dcf.valuePerShare === null ? "—" : valuation.dcf.valuePerShare.toFixed(0)}
                <span className="text-xs text-slate-500 ml-2">nghìn VND/CP</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 mb-2">
                bi quan {valuation.dcf.scenarios.pessimistic?.toFixed(0) ?? "—"} · cơ sở {valuation.dcf.scenarios.base?.toFixed(0) ?? "—"} · lạc quan {valuation.dcf.scenarios.optimistic?.toFixed(0) ?? "—"}
              </div>
              <div className="space-y-1 text-[11px] font-mono text-slate-400">
                <div className="flex justify-between"><span>FCF cơ sở (LTM)</span><span className="text-slate-200">{fmt(valuation.dcf.baseFcf, 0)} tỷ</span></div>
                <div className="flex justify-between"><span>Tăng trưởng GĐ1 ({valuation.assumptions.stageOneYears} năm)</span><span className="text-slate-200">{fmt((valuation.dcf.stageOneGrowth ?? 0) * 100, 1)}%</span></div>
                <div className="flex justify-between"><span>Tăng trưởng vĩnh cửu g</span><span className="text-slate-200">{(valuation.dcf.terminalGrowth * 100).toFixed(2)}%</span></div>
                <div className="flex justify-between"><span>Suất chiết khấu</span><span className="text-slate-200">{((valuation.dcf.wacc ?? 0) * 100).toFixed(2)}%</span></div>
                <div className="flex justify-between"><span>Giá trị doanh nghiệp (EV)</span><span className="text-slate-200">{fmt(valuation.dcf.enterpriseValue, 0)} tỷ</span></div>
                <div className="flex justify-between"><span>Trừ nợ ròng</span><span className="text-slate-200">{fmt(valuation.dcf.netDebt, 0)} tỷ</span></div>
                <div className="flex justify-between"><span>Giá trị VCSH</span><span className="text-slate-200">{fmt(valuation.dcf.equityValue, 0)} tỷ</span></div>
                <div className="flex justify-between"><span>Giá trị cuối chiếm</span><span className={valuation.dcf.terminalValueSharePct !== null && valuation.dcf.terminalValueSharePct > 80 ? "text-amber-400" : "text-slate-200"}>{valuation.dcf.terminalValueSharePct === null ? "—" : `${fmt(valuation.dcf.terminalValueSharePct, 0)}%`}</span></div>
              </div>
            </>
          ) : (
            <div className="text-[12px] text-slate-400 py-6">{valuation.dcf.note}</div>
          )}
          <p className="mt-2 text-[10px] text-slate-500">{valuation.dcf.note}</p>
        </div>
      </div>

      {/* Football field */}
      <div className="panel p-4 reveal">
        <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
          Dải giá trị hợp lý theo từng phương pháp
        </div>
        {valuation.methods.length > 0 ? (
          <FootballField valuation={valuation} />
        ) : (
          <div className="text-[12px] text-slate-400 py-6">Chưa có phương pháp định giá nào khả dụng.</div>
        )}
        <div className="mt-3 space-y-1.5">
          {valuation.methods.map((m) => (
            <div key={m.key} className="flex items-start gap-2 text-[10px]">
              <span className="w-44 text-slate-400 truncate">{m.label}</span>
              <span className="w-24 font-mono text-slate-200 tabular-nums">
                {m.valuePerShare === null ? "—" : m.valuePerShare.toFixed(0)}k
              </span>
              <span className="w-14 font-mono text-slate-500">{(m.weight * 100).toFixed(0)}%</span>
              <span className="flex-1 text-slate-500 truncate" title={m.note}>
                {m.formula}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Lưới độ nhạy WACC × g
          </div>
          <SensitivityHeatmap valuation={valuation} />
        </div>

        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
            Các mô hình khác
          </div>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400" title={valuation.ddm.formula}>DDM Gordon (cổ tức)</span>
              <span className="font-mono text-slate-200">{valuation.ddm.valuePerShare === null ? "—" : `${valuation.ddm.valuePerShare.toFixed(0)}k`}</span>
            </div>
            <p className="text-[10px] text-slate-500 -mt-1">{valuation.ddm.note}</p>

            <div className="flex justify-between">
              <span className="text-slate-400" title="√(22.5 × EPS × BVPS)">Graham Number</span>
              <span className="font-mono text-slate-200">{valuation.grahamNumber === null ? "—" : `${valuation.grahamNumber.toFixed(0)}k`}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400" title={valuation.fcfe.note}>DCF trên FCFE (chiết khấu Ke)</span>
              <span className="font-mono text-slate-200">{valuation.fcfe.valuePerShare === null ? "—" : `${valuation.fcfe.valuePerShare.toFixed(0)}k`}</span>
            </div>

            <div className="pt-2 border-t border-slate-700/50">
              <div className="flex justify-between">
                <span className="text-slate-400">Reverse DCF — tăng trưởng thị trường kỳ vọng</span>
                <span className="font-mono text-cyan-300">
                  {valuation.reverseDcf.impliedGrowthPct === null ? "—" : `${fmt(valuation.reverseDcf.impliedGrowthPct, 1)}%/năm`}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">{valuation.reverseDcf.verdictVi}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Phương pháp luận */}
      <div className="panel p-4 reveal">
        <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">Phương pháp luận & giả định</div>
        <ul className="text-[11px] text-slate-400 space-y-1 list-disc pl-4">
          {valuation.methodology.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-slate-500">
          {Object.entries(valuation.assumptions).map(([k, v]) => (
            <span key={k} className="rounded bg-slate-800/70 px-2 py-0.5">
              {k}: {String(v)}
            </span>
          ))}
        </div>
      </div>

      {valuation.warnings.length > 0 && (
        <div className="panel p-3 border-l-2 border-amber-500/60">
          <div className="font-mono text-[10px] tracking-[0.2em] text-amber-400 uppercase mb-1">Cảnh báo định giá</div>
          <ul className="text-[11px] text-slate-400 space-y-1 list-disc pl-4">
            {valuation.warnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
