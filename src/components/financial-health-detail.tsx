"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";

interface Indicator {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  score: number;
  verdict: string;
}
interface Group {
  key: string;
  label: string;
  weight: number;
  score: number;
  weighted: number;
  narrative: string;
  indicators: Indicator[];
}
export interface HealthDetail {
  symbol: string;
  overall: number;
  rating: string;
  groups: Group[];
  summary: string;
}

const GROUP_TINT: Record<string, string> = {
  liquidity: "from-cyan-500/15",
  leverage: "from-rose-500/15",
  efficiency: "from-amber-500/15",
  profitability: "from-emerald-500/15",
  growth: "from-violet-500/15",
  cashflow: "from-sky-500/15",
};

function scoreColor(score: number): string {
  if (score >= 70) return "#34d399";
  if (score >= 45) return "#fbbf24";
  return "#fb7185";
}

export function HealthRadar({ groups }: { groups: Group[] }) {
  const data = groups.map((g) => ({ group: g.label, score: g.score, fullMark: 100 }));
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid stroke="rgba(122,168,212,0.18)" />
          <PolarAngleAxis dataKey="group" tick={{ fill: "#b8cfe2", fontSize: 11, fontFamily: "var(--font-mono)" }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#7aa8d4", fontSize: 9 }} stroke="rgba(122,168,212,0.18)" />
          <Radar name="Điểm" dataKey="score" stroke="#00d4ff" fill="#00d4ff" fillOpacity={0.28} strokeWidth={2} dot={{ r: 3, fill: "#00d4ff" }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HealthDetailCard({ detail }: { detail: HealthDetail }) {
  return (
    <div className="space-y-5">
      <div className="panel p-4 bg-gradient-to-br from-[#0a1d33] to-[#0A2540] reveal">
        <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">Diagnostic summary</div>
        <p className="text-slate-200 text-sm leading-relaxed font-display">{detail.summary}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">Radar 6 trụ cột</div>
          <HealthRadar groups={detail.groups} />
        </div>

        <div className="panel p-4 reveal">
          <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">Trọng số nhóm</div>
          <div className="space-y-2.5 mt-3">
            {detail.groups.map((g) => (
              <div key={g.key}>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-slate-300 font-display">{g.label}</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {g.score}/100 <span className="text-slate-600">× {(g.weight * 100).toFixed(0)}%</span> = <span style={{ color: scoreColor(g.score) }}>{g.weighted.toFixed(1)}</span>
                  </span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${g.score}%`, background: scoreColor(g.score) }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="reveal-stagger grid grid-cols-1 md:grid-cols-2 gap-4">
        {detail.groups.map((g) => (
          <div key={g.key} className={`panel p-4 bg-gradient-to-br ${GROUP_TINT[g.key] ?? "from-transparent"} to-transparent relative overflow-hidden`}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-display text-base font-bold text-white">{g.label}</div>
              <div className="font-display text-2xl font-extrabold" style={{ color: scoreColor(g.score) }}>{g.score}</div>
            </div>
            <p className="text-[12px] text-slate-300 leading-relaxed mb-3 italic">{g.narrative}</p>
            <div className="space-y-1.5">
              {g.indicators.map((ind) => (
                <div key={ind.key} className="flex items-center gap-3 text-[11px]">
                  <div className="w-32 text-slate-400 truncate" title={ind.label}>{ind.label}</div>
                  <div className="flex-1 bar-track">
                    <div className="bar-fill" style={{ width: `${ind.score}%`, background: scoreColor(ind.score) }} />
                  </div>
                  <div className="w-20 text-right font-mono tabular-nums text-slate-200">
                    {ind.value === null ? "—" : ind.value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}
                    <span className="text-slate-500 ml-0.5">{ind.unit}</span>
                  </div>
                  <div className="w-14 text-right font-mono text-[10px]" style={{ color: scoreColor(ind.score) }}>{ind.score}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
