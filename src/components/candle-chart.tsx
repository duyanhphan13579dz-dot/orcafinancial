"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  Time,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function CandleChart({
  bars,
  height = 380,
}: {
  bars: Bar[];
  height?: number;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const chartRef = useRef<IChartApi | null>(null);

  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const initializedRef = useRef(false);

  // 1. Create chart ONCE
  useEffect(() => {
    if (!chartContainerRef.current || initializedRef.current) return;

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      layout: {
        background: {
          type: ColorType.Solid,
          color: "transparent",
        },
        textColor: "#7aa8d4",
        fontFamily: "'JetBrains Mono', monospace",
      },

      grid: {
        vertLines: {
          color: "rgba(26, 53, 88, 0.4)",
        },
        horzLines: {
          color: "rgba(26, 53, 88, 0.4)",
        },
      },

      crosshair: {
        mode: CrosshairMode.Normal,
      },

      rightPriceScale: {
        borderColor: "rgba(26, 53, 88, 0.8)",
      },

      timeScale: {
        borderColor: "rgba(26, 53, 88, 0.8)",
        timeVisible: true,
      },

      width: container.clientWidth,
      height,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      borderVisible: false,
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#26a69a",
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "",
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;
    initializedRef.current = true;

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return;

      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();

      chart.remove();

      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      initializedRef.current = false;
    };
  }, [height]);

  // 2. Update data WITHOUT recreating chart
  useEffect(() => {
    if (
      !initializedRef.current ||
      !candleSeriesRef.current ||
      !volumeSeriesRef.current ||
      bars.length === 0
    ) {
      return;
    }

    const candleData = bars.map((bar) => ({
      time: bar.time as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));

    const volumeData = bars.map((bar) => ({
      time: bar.time as Time,
      value: bar.volume,
      color:
        bar.close >= bar.open
          ? "rgba(52, 211, 153, 0.3)"
          : "rgba(251, 113, 133, 0.3)",
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  if (bars.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-slate-500 text-sm"
        style={{ height }}
      >
        Không có dữ liệu
      </div>
    );
  }

  return (
    <div
      ref={chartContainerRef}
      className="w-full relative"
      style={{ height }}
    />
  );
}

// Sparkline giữ nguyên
export function Sparkline({
  bars,
  width = 120,
  height = 36,
}: {
  bars: Bar[];
  width?: number;
  height?: number;
}) {
  if (bars.length < 2) return null;

  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const pts = closes.map(
    (c, i) =>
      `${(i / (closes.length - 1)) * width},${
        height - ((c - min) / range) * (height - 4) - 2
      }`,
  );

  const up = closes[closes.length - 1] >= closes[0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
    >
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={up ? "#34d399" : "#fb7185"}
        strokeWidth={1.5}
      />
    </svg>
  );
}
