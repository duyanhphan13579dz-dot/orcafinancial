"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, CandlestickSeries, HistogramSeries, Time } from "lightweight-charts";

export interface Bar {
  time: number; // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function CandleChart({ bars, height = 380 }: { bars: Bar[]; height?: number }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || bars.length === 0) return;

    // 1. Khá»Ÿi táº¡o biá»ƒu Ä‘á»“ TradingView
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7aa8d4", // ORCA muted text
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(26, 53, 88, 0.4)" }, // ORCA border color
        horzLines: { color: "rgba(26, 53, 88, 0.4)" },
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
      width: chartContainerRef.current.clientWidth,
      height: height,
    });

    // 2. ThÃªm chuá»—i dá»¯ liá»‡u Náº¿n (Candlesticks)
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399", // emerald-400
      downColor: "#fb7185", // rose-400
      borderVisible: false,
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
    });

    const candleData = bars.map((b) => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    candlestickSeries.setData(candleData);

    // 3. ThÃªm chuá»—i dá»¯ liá»‡u Khá»‘i lÆ°á»£ng (Volume Histogram)
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

    const volumeData = bars.map((b) => ({
      time: b.time as Time,
      value: b.volume,
      color: b.close >= b.open ? "rgba(52, 211, 153, 0.3)" : "rgba(251, 113, 133, 0.3)",
    }));
    volumeSeries.setData(volumeData);

    // 4. Khá»›p khung nhÃ¬n vÃ  xá»­ lÃ½ Resize
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    // Dá»n dáº¹p bá»™ nhá»› khi component bá»‹ unmount
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [bars, height]);

  if (bars.length === 0) {
    return <div className="flex items-center justify-center text-slate-500 text-sm" style={{ height }}>KhÃ´ng cÃ³ dá»¯ liá»‡u</div>;
  }

  return <div ref={chartContainerRef} className="w-full relative" />;
}

// Giá»¯ nguyÃªn Sparkline cÅ© dÃ¹ng SVG vÃ¬ nÃ³ ráº¥t nhá» vÃ  hiá»‡u quáº£ cho Dashboard
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
