"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  Time,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LogicalRange,
} from "lightweight-charts";

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorToggles {
  ma20?: boolean;
  ma50?: boolean;
  ma200?: boolean;
  ema12?: boolean;
  bollinger?: boolean;
  volume?: boolean;
}

interface CandleChartProps {
  /**
   * Historical OHLCV data.
   * Bars MUST be sorted ascending by time.
   */
  bars: Bar[];

  /**
   * Chart height.
   */
  height?: number;

  /**
   * Called when the user scrolls close to the beginning of the loaded dataset.
   */
  onLoadMore?: () => void;

  /**
   * Prevent duplicate historical requests.
   */
  loadingMore?: boolean;

  /**
   * Whether more historical data exists.
   */
  hasMore?: boolean;

  /**
   * How close to the left edge the user must scroll before requesting more data.
   */
  loadMoreThreshold?: number;

  /**
   * Initial active indicator toggles.
   */
  defaultIndicators?: IndicatorToggles;

  /**
   * Optional callback when visible logical range changes.
   */
  onVisibleRangeChange?: (range: LogicalRange | null) => void;
}

function toCandleData(bar: Bar): CandlestickData<Time> {
  return {
    time: bar.time as Time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
}

function toVolumeData(bar: Bar): HistogramData<Time> {
  return {
    time: bar.time as Time,
    value: bar.volume,
    color: bar.close >= bar.open ? "rgba(52, 211, 153, 0.3)" : "rgba(251, 113, 133, 0.3)",
  };
}

function calcSMA(bars: Bar[], period: number) {
  if (bars.length < period) return [];
  const result = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += bars[i - j].close;
    }
    const avg = Math.round((sum / period) * 100) / 100;
    result.push({ time: bars[i].time as Time, value: avg });
  }
  return result;
}

function calcEMA(bars: Bar[], period: number) {
  if (bars.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += bars[i].close;
  let ema = sum / period;
  result.push({ time: bars[period - 1].time as Time, value: Math.round(ema * 100) / 100 });

  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    result.push({ time: bars[i].time as Time, value: Math.round(ema * 100) / 100 });
  }
  return result;
}

function calcBollinger(bars: Bar[], period = 20, multiplier = 2) {
  if (bars.length < period) return { upper: [], lower: [] };
  const upper = [];
  const lower = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += bars[i - j].close;
    const mean = sum / period;
    let variance = 0;
    for (let j = 0; j < period; j++) {
      const diff = bars[i - j].close - mean;
      variance += diff * diff;
    }
    const stdDev = Math.sqrt(variance / period);
    upper.push({ time: bars[i].time as Time, value: Math.round((mean + multiplier * stdDev) * 100) / 100 });
    lower.push({ time: bars[i].time as Time, value: Math.round((mean - multiplier * stdDev) * 100) / 100 });
  }
  return { upper, lower };
}

function barsAreEqual(a: Bar | undefined, b: Bar | undefined) {
  if (!a || !b) return false;
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}

function isSameBars(previous: Bar[], next: Bar[]) {
  if (previous.length !== next.length) return false;
  if (previous.length === 0) return true;
  if (
    previous[0]?.time !== next[0]?.time ||
    previous[previous.length - 1]?.time !== next[next.length - 1]?.time
  ) {
    return false;
  }
  for (let i = 0; i < next.length; i++) {
    if (!barsAreEqual(previous[i], next[i])) return false;
  }
  return true;
}

function isLastCandleUpdate(previous: Bar[], next: Bar[]) {
  if (previous.length === 0 || previous.length !== next.length) return false;
  for (let i = 0; i < next.length - 1; i++) {
    if (!barsAreEqual(previous[i], next[i])) return false;
  }
  const previousLast = previous[previous.length - 1];
  const nextLast = next[next.length - 1];
  if (!previousLast || !nextLast) return false;
  return previousLast.time === nextLast.time;
}

function getAppendedBars(previous: Bar[], next: Bar[]): Bar[] | null {
  if (previous.length === 0 || next.length <= previous.length) return null;
  for (let i = 0; i < previous.length; i++) {
    if (!barsAreEqual(previous[i], next[i])) return null;
  }
  return next.slice(previous.length);
}

function getPrependedCount(previous: Bar[], next: Bar[]): number {
  if (previous.length === 0 || next.length <= previous.length) return 0;
  const additional = next.length - previous.length;
  for (let i = 0; i < previous.length; i++) {
    if (!barsAreEqual(previous[i], next[i + additional])) return 0;
  }
  return additional;
}

export function CandleChart({
  bars,
  height = 380,
  onLoadMore,
  loadingMore = false,
  hasMore = true,
  loadMoreThreshold = 30,
  defaultIndicators = { ma20: true, ma50: true, volume: true },
  onVisibleRangeChange,
}: CandleChartProps) {
  const [indicators, setIndicators] = useState<IndicatorToggles>(defaultIndicators);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const ma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma200SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema12SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const previousBarsRef = useRef<Bar[]>([]);
  const initializedRef = useRef(false);
  const loadMoreTriggeredRef = useRef(false);
  const pendingPrependRangeRef = useRef<LogicalRange | null>(null);

  const onLoadMoreRef = useRef(onLoadMore);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);
  const loadMoreThresholdRef = useRef(loadMoreThreshold);
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
    hasMoreRef.current = hasMore;
    loadingMoreRef.current = loadingMore;
    loadMoreThresholdRef.current = loadMoreThreshold;
    onVisibleRangeChangeRef.current = onVisibleRangeChange;
    if (!loadingMore) loadMoreTriggeredRef.current = false;
  }, [onLoadMore, hasMore, loadingMore, loadMoreThreshold, onVisibleRangeChange]);

  useEffect(() => {
    if (!chartContainerRef.current || initializedRef.current) return;

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7aa8d4",
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(26, 53, 88, 0.4)" },
        horzLines: { color: "rgba(26, 53, 88, 0.4)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(26, 53, 88, 0.8)" },
      timeScale: {
        borderColor: "rgba(26, 53, 88, 0.8)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      width: container.clientWidth,
      height,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      borderVisible: false,
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
      priceLineVisible: true,
      lastValueVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#26a69a",
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const ma20Series = chart.addSeries(LineSeries, {
      color: "#00d4ff",
      lineWidth: 1,
      title: "MA20",
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const ma50Series = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 1,
      title: "MA50",
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const ma200Series = chart.addSeries(LineSeries, {
      color: "#a855f7",
      lineWidth: 1,
      title: "MA200",
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const ema12Series = chart.addSeries(LineSeries, {
      color: "#f97316",
      lineWidth: 1,
      title: "EMA12",
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const bbUpperSeries = chart.addSeries(LineSeries, {
      color: "#38bdf8",
      lineWidth: 1,
      lineStyle: 2,
      title: "BB Upper",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbLowerSeries = chart.addSeries(LineSeries, {
      color: "#38bdf8",
      lineWidth: 1,
      lineStyle: 2,
      title: "BB Lower",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;

    ma20SeriesRef.current = ma20Series;
    ma50SeriesRef.current = ma50Series;
    ma200SeriesRef.current = ma200Series;
    ema12SeriesRef.current = ema12Series;
    bbUpperSeriesRef.current = bbUpperSeries;
    bbLowerSeriesRef.current = bbLowerSeries;

    initializedRef.current = true;

    const timeScale = chart.timeScale();
    const handleVisibleRangeChange = (range: LogicalRange | null) => {
      onVisibleRangeChangeRef.current?.(range);
      if (!range || !onLoadMoreRef.current || !hasMoreRef.current || loadingMoreRef.current) return;
      if (range.from <= loadMoreThresholdRef.current) {
        if (loadMoreTriggeredRef.current) return;
        pendingPrependRangeRef.current = { from: range.from, to: range.to };
        loadMoreTriggeredRef.current = true;
        onLoadMoreRef.current();
      } else {
        loadMoreTriggeredRef.current = false;
      }
    };

    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return;
      const width = chartContainerRef.current.clientWidth;
      if (width > 0) chartRef.current.applyOptions({ width });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ma20SeriesRef.current = null;
      ma50SeriesRef.current = null;
      ma200SeriesRef.current = null;
      ema12SeriesRef.current = null;
      bbUpperSeriesRef.current = null;
      bbLowerSeriesRef.current = null;
      initializedRef.current = false;
      previousBarsRef.current = [];
      pendingPrependRangeRef.current = null;
      loadMoreTriggeredRef.current = false;
    };
  }, [height]);

  useEffect(() => {
    if (!loadingMore) loadMoreTriggeredRef.current = false;
  }, [loadingMore]);

  // Update indicators
  useEffect(() => {
    if (!initializedRef.current || bars.length === 0) return;

    if (ma20SeriesRef.current) {
      ma20SeriesRef.current.setData(indicators.ma20 ? calcSMA(bars, 20) : []);
    }
    if (ma50SeriesRef.current) {
      ma50SeriesRef.current.setData(indicators.ma50 ? calcSMA(bars, 50) : []);
    }
    if (ma200SeriesRef.current) {
      ma200SeriesRef.current.setData(indicators.ma200 ? calcSMA(bars, 200) : []);
    }
    if (ema12SeriesRef.current) {
      ema12SeriesRef.current.setData(indicators.ema12 ? calcEMA(bars, 12) : []);
    }
    if (bbUpperSeriesRef.current && bbLowerSeriesRef.current) {
      if (indicators.bollinger) {
        const bb = calcBollinger(bars, 20, 2);
        bbUpperSeriesRef.current.setData(bb.upper);
        bbLowerSeriesRef.current.setData(bb.lower);
      } else {
        bbUpperSeriesRef.current.setData([]);
        bbLowerSeriesRef.current.setData([]);
      }
    }
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(indicators.volume !== false ? bars.map(toVolumeData) : []);
    }
  }, [bars, indicators]);

  // Update candles & history
  useEffect(() => {
    if (!initializedRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const previous = previousBarsRef.current;

    if (bars.length === 0) return;

    if (previous.length > 0 && isSameBars(previous, bars)) return;

    if (previous.length === 0) {
      candleSeries.setData(bars.map(toCandleData));
      if (indicators.volume !== false) volumeSeries.setData(bars.map(toVolumeData));
      chartRef.current?.timeScale().fitContent();
      previousBarsRef.current = bars.map((b) => ({ ...b }));
      return;
    }

    if (isLastCandleUpdate(previous, bars)) {
      const last = bars[bars.length - 1];
      if (last) {
        candleSeries.update(toCandleData(last));
        if (indicators.volume !== false) volumeSeries.update(toVolumeData(last));
      }
      previousBarsRef.current = bars.map((b) => ({ ...b }));
      return;
    }

    const appended = getAppendedBars(previous, bars);
    if (appended && appended.length > 0) {
      for (const bar of appended) {
        candleSeries.update(toCandleData(bar));
        if (indicators.volume !== false) volumeSeries.update(toVolumeData(bar));
      }
      previousBarsRef.current = bars.map((b) => ({ ...b }));
      return;
    }

    const prependedCount = getPrependedCount(previous, bars);
    if (prependedCount > 0) {
      const savedRange = pendingPrependRangeRef.current;
      candleSeries.setData(bars.map(toCandleData));
      if (indicators.volume !== false) volumeSeries.setData(bars.map(toVolumeData));

      if (savedRange) {
        requestAnimationFrame(() => {
          chartRef.current?.timeScale().setVisibleLogicalRange({
            from: savedRange.from + prependedCount,
            to: savedRange.to + prependedCount,
          });
        });
      }
      pendingPrependRangeRef.current = null;
      previousBarsRef.current = bars.map((b) => ({ ...b }));
      loadMoreTriggeredRef.current = false;
      return;
    }

    candleSeries.setData(bars.map(toCandleData));
    if (indicators.volume !== false) volumeSeries.setData(bars.map(toVolumeData));
    previousBarsRef.current = bars.map((b) => ({ ...b }));
  }, [bars, indicators.volume]);

  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center text-slate-500 text-sm" style={{ height }}>
        Không có dữ liệu
      </div>
    );
  }

  return (
    <div className="relative w-full space-y-2">
      {/* Indicator Toggle Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#061527] px-2.5 py-1.5 font-mono text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-400">
          <span className="font-bold text-cyan-300">Chỉ báo kỹ thuật (Indicators):</span>
        </div>
        <div className="no-scrollbar flex flex-wrap items-center gap-1">
          {[
            { key: "ma20", label: "MA20", color: "text-[#00d4ff] border-[#00d4ff]/40" },
            { key: "ma50", label: "MA50", color: "text-[#f59e0b] border-[#f59e0b]/40" },
            { key: "ma200", label: "MA200", color: "text-[#a855f7] border-[#a855f7]/40" },
            { key: "ema12", label: "EMA12", color: "text-[#f97316] border-[#f97316]/40" },
            { key: "bollinger", label: "BBands", color: "text-[#38bdf8] border-[#38bdf8]/40" },
            { key: "volume", label: "Volume", color: "text-[#34d399] border-[#34d399]/40" },
          ].map((item) => {
            const active = Boolean(indicators[item.key as keyof typeof indicators]);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() =>
                  setIndicators((prev) => ({
                    ...prev,
                    [item.key]: !prev[item.key as keyof typeof prev],
                  }))
                }
                className={`rounded border px-2 py-0.5 font-mono font-bold transition-all ${
                  active
                    ? `bg-white/10 ${item.color} shadow-sm`
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative w-full" style={{ height }}>
        <div ref={chartContainerRef} className="absolute inset-0" />

        {loadingMore && (
          <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-1 text-[10px] text-slate-400 shadow-lg backdrop-blur">
            Đang tải thêm dữ liệu…
          </div>
        )}

        {!hasMore && !loadingMore && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-slate-800 bg-slate-950/80 px-2 py-0.5 text-[9px] text-slate-600">
            Đã tải hết lịch sử
          </div>
        )}
      </div>
    </div>
  );
}

export function Sparkline({ bars, width = 120, height = 36 }: { bars: Bar[]; width?: number; height?: number }) {
  if (bars.length < 2) return null;
  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const points = closes.map((close, index) => {
    const x = (index / (closes.length - 1)) * width;
    const y = height - ((close - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const up = closes[closes.length - 1] >= closes[0];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={up ? "#34d399" : "#fb7185"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const MemoCandleChart = memo(CandleChart);
