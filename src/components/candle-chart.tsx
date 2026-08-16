"use client";

import { useMemo, useState } from "react";
import { fmtNum, fmtVol } from "@/lib/client";

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function CandleChart({ bars, height = 380 }: { bars: Bar[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 900;
  const padTop = 12;
  const volH = 70;
  const priceH = height - volH - padTop - 20;

  const view = useMemo(() => {
    const data = bars.slice(-160);
    if (data.length === 0) return null;
    const min = Math.min(...data.map((b) => b.low));
    const max = Math.max(...data.map((b) => b.high));
    const maxVol = Math.max(...data.map((b) => b.volume), 1);
    const range = max - min || 1;
    const step = width / data.length;
    const y = (p: number) => padTop + ((max - p) / range) * priceH;
    const vy = (v: number) => height - 20 - (v / maxVol) * volH;
    return { data, min, max, step, y, vy };
  }, [bars, priceH, height]);

  if (!view) return <div className="flex h-64 items-center justify-center text-slate-500">Không có dữ liệu</div>;

  const { data, min, max, step, y, vy } = view;
  const hovered = hover !== null ? data[hover] : null;
  const gridLines = 5;

  return (
    <div className="relative w-full">
      {hovered && (
        <div className="absolute left-2 top-2 z-10 rounded bg-slate-900/90 border border-slate-700 px-3 py-1.5 text-xs space-x-3">
          <span className="text-slate-400">{new Date(hovered.time * 1000).toLocaleDateString("vi-VN")}</span>
          <span>O {fmtNum(hovered.open)}</span>
          <span>H {fmtNum(hovered.high)}</span>
          <span>L {fmtNum(hovered.low)}</span>
          <span className={hovered.close >= hovered.open ? "text-emerald-400" : "text-rose-400"}>
            C {fmtNum(hovered.close)}
          </span>
          <span className="text-slate-400">Vol {fmtVol(hovered.volume)}</span>
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width;
          setHover(Math.max(0, Math.min(data.length - 1, Math.floor(x / step))));
        }}
      >
        {Array.from({ length: gridLines + 1 }, (_, i) => {
          const price = max - ((max - min) / gridLines) * i;
          const yy = y(price);
          return (
            <g key={i}>
              <line x1={0} x2={width} y1={yy} y2={yy} stroke="#1c2536" strokeWidth={1} />
              <text x={width - 4} y={yy - 3} textAnchor="end" fontSize={10} fill="#64748b">
                {fmtNum(price)}
              </text>
            </g>
          );
        })}
        {data.map((b, i) => {
          const up = b.close >= b.open;
          const color = up ? "#34d399" : "#fb7185";
          const cx = i * step + step / 2;
          const bodyTop = y(Math.max(b.open, b.close));
          const bodyBot = y(Math.min(b.open, b.close));
          return (
            <g key={b.time} opacity={hover === null || hover === i ? 1 : 0.55}>
              <line x1={cx} x2={cx} y1={y(b.high)} y2={y(b.low)} stroke={color} strokeWidth={1} />
              <rect
                x={cx - Math.max(1, step * 0.32)}
                y={bodyTop}
                width={Math.max(2, step * 0.64)}
                height={Math.max(1, bodyBot - bodyTop)}
                fill={color}
              />
              <rect
                x={cx - Math.max(1, step * 0.32)}
                y={vy(b.volume)}
                width={Math.max(2, step * 0.64)}
                height={height - 20 - vy(b.volume)}
                fill={color}
                opacity={0.35}
              />
            </g>
          );
        })}
        {hover !== null && (
          <line
            x1={hover * step + step / 2}
            x2={hover * step + step / 2}
            y1={padTop}
            y2={height - 20}
            stroke="#475569"
            strokeDasharray="3,3"
          />
        )}
      </svg>
    </div>
  );
}

export function Sparkline({ bars, width = 120, height = 36 }: { bars: Bar[]; width?: number; height?: number }) {
  if (bars.length < 2) return null;
  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pts = closes.map((c, i) => `${(i / (closes.length - 1)) * width},${height - ((c - min) / range) * (height - 4) - 2}`);
  const up = closes[closes.length - 1] >= closes[0];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "#34d399" : "#fb7185"} strokeWidth={1.5} />
    </svg>
  );
}
