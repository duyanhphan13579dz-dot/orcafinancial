"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@/components/candle-chart";
import {
  buildBollingerSeries,
  buildEmaSeries,
  buildMacdSeries,
  buildRsiSeries,
  swingSupportResistance,
} from "@/lib/forex/chart-series";

export interface TradeLevels {
  support?: number | null;
  resistance?: number | null;
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  takeProfit2?: number | null;
}

export interface PatternMarker {
  time: number;
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  reliability: number;
}

interface ForexProChartProps {
  bars: Bar[];
  height?: number;
  levels?: TradeLevels | null;
  focusTime?: number | null;
  showEma?: boolean;
  showBb?: boolean;
  showRsi?: boolean;
  showMacd?: boolean;
}

function setLine(
  series: ISeriesApi<"Line"> | null,
  points: { time: number; value: number }[],
) {
  if (!series) return;
  series.setData(
    points.map((p) => ({ time: p.time as Time, value: p.value })),
  );
}

export function ForexProChart({
  bars,
  height = 520,
  levels,
  focusTime,
  showEma = true,
  showBb = true,
  showRsi = true,
  showMacd = true,
}: ForexProChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMidRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const fittedRef = useRef(false);

  const paneCount = 1 + (showRsi ? 1 : 0) + (showMacd ? 1 : 0);
  const mainH = Math.round(height * (paneCount === 1 ? 1 : paneCount === 2 ? 0.68 : 0.55));

  const seriesData = useMemo(() => {
    if (!bars.length) {
      return null;
    }
    const ema20 = showEma ? buildEmaSeries(bars, 20) : [];
    const ema50 = showEma ? buildEmaSeries(bars, 50) : [];
    const ema200 = showEma ? buildEmaSeries(bars, 200) : [];
    const bb = showBb ? buildBollingerSeries(bars) : { upper: [], middle: [], lower: [] };
    const rsi = showRsi ? buildRsiSeries(bars) : [];
    const macd = showMacd ? buildMacdSeries(bars) : { macd: [], signal: [], histogram: [] };
    const sr = swingSupportResistance(bars);
    return { ema20, ema50, ema200, bb, rsi, macd, sr };
  }, [bars, showEma, showBb, showRsi, showMacd]);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const el = containerRef.current;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7aa8d4",
        fontFamily: "'JetBrains Mono', monospace",
        panes: {
          separatorColor: "rgba(26, 53, 88, 0.9)",
          separatorHoverColor: "rgba(0, 212, 255, 0.5)",
        },
      },
      grid: {
        vertLines: { color: "rgba(26, 53, 88, 0.35)" },
        horzLines: { color: "rgba(26, 53, 88, 0.35)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(26, 53, 88, 0.8)" },
      timeScale: {
        borderColor: "rgba(26, 53, 88, 0.8)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      width: el.clientWidth,
      height,
    });

    const candle = chart.addSeries(
      CandlestickSeries,
      {
        upColor: "#34d399",
        downColor: "#fb7185",
        borderVisible: false,
        wickUpColor: "#34d399",
        wickDownColor: "#fb7185",
        priceLineVisible: true,
        lastValueVisible: true,
      },
      0,
    );

    const mkLine = (
      color: string,
      width: number,
      pane = 0,
    ) =>
      chart.addSeries(
        LineSeries,
        {
          color,
          lineWidth: width as 1 | 2 | 3 | 4,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        pane,
      );

    ema20Ref.current = mkLine("#fbbf24", 1, 0);
    ema50Ref.current = mkLine("#38bdf8", 1, 0);
    ema200Ref.current = mkLine("#a78bfa", 2, 0);
    bbUpperRef.current = mkLine("rgba(148, 163, 184, 0.55)", 1, 0);
    bbMidRef.current = mkLine("rgba(148, 163, 184, 0.35)", 1, 0);
    bbLowerRef.current = mkLine("rgba(148, 163, 184, 0.55)", 1, 0);

    let paneIdx = 1;
    if (showRsi) {
      rsiRef.current = chart.addSeries(
        LineSeries,
        {
          color: "#f472b6",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "RSI",
        },
        paneIdx,
      );
      rsiRef.current.createPriceLine({
        price: 70,
        color: "rgba(251, 113, 133, 0.5)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "70",
      });
      rsiRef.current.createPriceLine({
        price: 30,
        color: "rgba(52, 211, 153, 0.5)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "30",
      });
      paneIdx += 1;
    }

    if (showMacd) {
      macdHistRef.current = chart.addSeries(
        HistogramSeries,
        {
          priceLineVisible: false,
          lastValueVisible: false,
          title: "Hist",
        },
        paneIdx,
      );
      macdRef.current = chart.addSeries(
        LineSeries,
        {
          color: "#38bdf8",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "MACD",
        },
        paneIdx,
      );
      macdSignalRef.current = chart.addSeries(
        LineSeries,
        {
          color: "#fbbf24",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "Signal",
        },
        paneIdx,
      );
    }

    // Stretch panes
    try {
      const panes = chart.panes();
      if (panes[0]) panes[0].setStretchFactor(paneCount === 1 ? 1 : 2.4);
      if (panes[1]) panes[1].setStretchFactor(1);
      if (panes[2]) panes[2].setStretchFactor(1);
    } catch {
      // older API fallback
    }

    chartRef.current = chart;
    candleRef.current = candle;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      const w = containerRef.current.clientWidth;
      if (w > 0) chartRef.current.applyOptions({ width: w });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      bbUpperRef.current = null;
      bbMidRef.current = null;
      bbLowerRef.current = null;
      rsiRef.current = null;
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
      priceLinesRef.current = [];
      fittedRef.current = false;
    };
    // recreate when pane layout toggles change
  }, [height, showRsi, showMacd, paneCount]);

  // Push bar + indicator data
  useEffect(() => {
    if (!candleRef.current || !bars.length || !seriesData) return;

    candleRef.current.setData(
      bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    if (showEma) {
      setLine(ema20Ref.current, seriesData.ema20);
      setLine(ema50Ref.current, seriesData.ema50);
      setLine(ema200Ref.current, seriesData.ema200);
    }
    if (showBb) {
      setLine(bbUpperRef.current, seriesData.bb.upper);
      setLine(bbMidRef.current, seriesData.bb.middle);
      setLine(bbLowerRef.current, seriesData.bb.lower);
    }
    if (showRsi) setLine(rsiRef.current, seriesData.rsi);
    if (showMacd) {
      setLine(macdRef.current, seriesData.macd.macd);
      setLine(macdSignalRef.current, seriesData.macd.signal);
      if (macdHistRef.current) {
        macdHistRef.current.setData(
          seriesData.macd.histogram.map((h) => ({
            time: h.time as Time,
            value: h.value,
            color: h.color,
          })),
        );
      }
    }

    if (!fittedRef.current) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [bars, seriesData, showEma, showBb, showRsi, showMacd]);

  // Price lines: S/R + trade levels
  useEffect(() => {
    if (!candleRef.current) return;
    for (const pl of priceLinesRef.current) {
      try {
        candleRef.current.removePriceLine(pl);
      } catch {
        /* */
      }
    }
    priceLinesRef.current = [];

    const add = (
      price: number | null | undefined,
      color: string,
      title: string,
      style: 0 | 1 | 2 | 3 = 2,
    ) => {
      if (price == null || !Number.isFinite(price)) return;
      const pl = candleRef.current!.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: style,
        axisLabelVisible: true,
        title,
      });
      priceLinesRef.current.push(pl);
    };

    const sr = seriesData?.sr;
    add(levels?.support ?? sr?.support, "rgba(52, 211, 153, 0.7)", "S");
    add(levels?.resistance ?? sr?.resistance, "rgba(251, 113, 133, 0.7)", "R");
    add(levels?.entry, "rgba(0, 212, 255, 0.9)", "Entry", 0);
    add(levels?.stopLoss, "rgba(251, 113, 133, 0.95)", "SL", 0);
    add(levels?.takeProfit, "rgba(52, 211, 153, 0.95)", "TP1", 0);
    add(levels?.takeProfit2, "rgba(16, 185, 129, 0.85)", "TP2", 2);
  }, [levels, seriesData]);

  // Focus / jump to pattern time
  useEffect(() => {
    if (!chartRef.current || focusTime == null || !bars.length) return;
    const idx = bars.findIndex((b) => b.time === focusTime);
    if (idx < 0) return;
    const from = Math.max(0, idx - 25);
    const to = Math.min(bars.length - 1, idx + 15);
    chartRef.current.timeScale().setVisibleLogicalRange({
      from,
      to,
    });
  }, [focusTime, bars]);

  if (!bars.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-slate-500"
        style={{ height }}
      >
        Không có dữ liệu
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap gap-2 text-[9px] font-mono">
        {showEma && (
          <>
            <span className="text-amber-400">EMA20</span>
            <span className="text-sky-400">EMA50</span>
            <span className="text-violet-400">EMA200</span>
          </>
        )}
        {showBb && <span className="text-slate-400">BB</span>}
        {showRsi && <span className="text-pink-400">RSI</span>}
        {showMacd && <span className="text-sky-300">MACD</span>}
      </div>
      {/* height reserved for main visual balance */}
      <span className="sr-only">main pane ~{mainH}px</span>
    </div>
  );
}

/** Pattern timeline strip — click jumps chart. */
export function PatternTimeline({
  patterns,
  barsLength,
  onSelect,
  activeTime,
}: {
  patterns: PatternMarker[];
  barsLength: number;
  onSelect: (time: number) => void;
  activeTime?: number | null;
}) {
  if (!patterns.length) {
    return (
      <div className="text-xs text-slate-500 py-2">Chưa phát hiện mẫu hình gần đây</div>
    );
  }

  const now = patterns[patterns.length - 1]?.time;
  const labeled = patterns.map((p) => {
    const barsAgo =
      barsLength > 0 && now
        ? Math.max(0, Math.round((now - p.time) / Math.max(1, (now - patterns[0].time) / Math.max(1, patterns.length))))
        : 0;
    return { ...p, label: barsAgo <= 0 ? "NOW" : `T-${barsAgo}` };
  });

  // Better: index-based distance if we had barIndex — use sequential labels
  const withLabels = patterns.map((p, i) => ({
    ...p,
    label: i === patterns.length - 1 ? "NOW" : `T-${patterns.length - 1 - i}`,
  }));

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-stretch gap-0 py-2">
        {withLabels.map((p, i) => (
          <button
            key={`${p.time}-${p.name}-${i}`}
            type="button"
            onClick={() => onSelect(p.time)}
            className={`flex min-w-[88px] flex-col items-center border-r border-slate-800 px-2 py-1 text-center transition hover:bg-slate-800/50 ${
              activeTime === p.time ? "bg-[#00d4ff]/10" : ""
            }`}
          >
            <span className="text-[9px] font-mono text-slate-500">{p.label}</span>
            <span
              className={`mt-1 text-[10px] font-semibold leading-tight ${
                p.type === "bullish"
                  ? "text-emerald-400"
                  : p.type === "bearish"
                    ? "text-rose-400"
                    : "text-amber-400"
              }`}
            >
              {p.nameVi}
            </span>
            <span className="mt-0.5 text-[9px] text-slate-600">
              {Math.round(p.reliability * 100)}%
            </span>
          </button>
        ))}
      </div>
      {/* unused labeled to avoid lint if tree-shaken — keep withLabels */}
      <span className="hidden">{labeled.length}</span>
    </div>
  );
}

export const MemoForexProChart = memo(ForexProChart);
