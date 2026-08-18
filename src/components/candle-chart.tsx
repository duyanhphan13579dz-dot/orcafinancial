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
  type CandlestickData,
  type HistogramData,
} from "lightweight-charts";

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandleChartProps {
  bars: Bar[];
  height?: number;
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
    color:
      bar.close >= bar.open
        ? "rgba(52, 211, 153, 0.3)"
        : "rgba(251, 113, 133, 0.3)",
  };
}

function barsAreEqual(a: Bar, b: Bar) {
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}

function isAppendOnlyUpdate(
  previous: Bar[],
  next: Bar[],
) {
  if (previous.length === 0) return false;

  /*
   * Trường hợp phổ biến nhất:
   *
   * previous:
   * [1, 2, 3, 4]
   *
   * next:
   * [1, 2, 3, 4]
   *
   * chỉ candle cuối thay đổi.
   */
  if (next.length !== previous.length) {
    return false;
  }

  if (next.length === 0) {
    return false;
  }

  /*
   * Tất cả candle trước candle cuối phải giống nhau.
   */
  for (let i = 0; i < next.length - 1; i++) {
    if (!barsAreEqual(previous[i], next[i])) {
      return false;
    }
  }

  /*
   * Timestamp candle cuối phải giống nhau.
   * Nếu timestamp thay đổi thì đây có thể là candle mới.
   */
  return (
    previous[next.length - 1]?.time ===
    next[next.length - 1]?.time
  );
}

function isSameBars(
  previous: Bar[],
  next: Bar[],
) {
  if (previous.length !== next.length) {
    return false;
  }

  if (previous.length === 0) {
    return true;
  }

  /*
   * Kiểm tra nhanh timestamp đầu/cuối trước.
   */
  if (
    previous[0]?.time !== next[0]?.time ||
    previous[previous.length - 1]?.time !==
      next[next.length - 1]?.time
  ) {
    return false;
  }

  /*
   * Chỉ khi cần mới kiểm tra toàn bộ.
   */
  for (let i = 0; i < next.length; i++) {
    if (!barsAreEqual(previous[i], next[i])) {
      return false;
    }
  }

  return true;
}

export function CandleChart({
  bars,
  height = 380,
}: CandleChartProps) {
  const chartContainerRef =
    useRef<HTMLDivElement>(null);

  const chartRef =
    useRef<IChartApi | null>(null);

  const candleSeriesRef =
    useRef<ISeriesApi<"Candlestick"> | null>(null);

  const volumeSeriesRef =
    useRef<ISeriesApi<"Histogram"> | null>(null);

  /*
   * Lưu dữ liệu đã render gần nhất.
   */
  const previousBarsRef =
    useRef<Bar[]>([]);

  /*
   * Đánh dấu chart đã được khởi tạo.
   */
  const initializedRef =
    useRef(false);

  /*
   * Lần đầu load chart thì fitContent().
   * Sau đó không tự động fit lại nữa.
   */
  const firstDataRenderRef =
    useRef(true);

  /*
   * ------------------------------------------------------------------
   * CREATE CHART
   * ------------------------------------------------------------------
   *
   * Chart chỉ được tạo một lần.
   */
  useEffect(() => {
    if (
      !chartContainerRef.current ||
      initializedRef.current
    ) {
      return;
    }

    const container =
      chartContainerRef.current;

    const chart = createChart(
      container,
      {
        layout: {
          background: {
            type: ColorType.Solid,
            color: "transparent",
          },
          textColor: "#7aa8d4",
          fontFamily:
            "'JetBrains Mono', monospace",
        },

        grid: {
          vertLines: {
            color:
              "rgba(26, 53, 88, 0.4)",
          },
          horzLines: {
            color:
              "rgba(26, 53, 88, 0.4)",
          },
        },

        crosshair: {
          mode: CrosshairMode.Normal,
        },

        rightPriceScale: {
          borderColor:
            "rgba(26, 53, 88, 0.8)",
        },

        timeScale: {
          borderColor:
            "rgba(26, 53, 88, 0.8)",

          timeVisible: true,

          /*
           * Cho phép người dùng zoom/pan.
           */
          rightOffset: 5,
        },

        width: container.clientWidth,
        height,
      },
    );

    const candlestickSeries =
      chart.addSeries(
        CandlestickSeries,
        {
          upColor: "#34d399",
          downColor: "#fb7185",
          borderVisible: false,
          wickUpColor: "#34d399",
          wickDownColor: "#fb7185",
        },
      );

    const volumeSeries =
      chart.addSeries(
        HistogramSeries,
        {
          color: "#26a69a",

          priceFormat: {
            type: "volume",
          },

          /*
           * Volume nằm trên price scale riêng.
           */
          priceScaleId: "",
        },
      );

    volumeSeries
      .priceScale()
      .applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });

    chartRef.current = chart;

    candleSeriesRef.current =
      candlestickSeries;

    volumeSeriesRef.current =
      volumeSeries;

    initializedRef.current = true;

    /*
     * Responsive chart.
     */
    const resizeObserver =
      new ResizeObserver(() => {
        const currentContainer =
          chartContainerRef.current;

        const currentChart =
          chartRef.current;

        if (
          !currentContainer ||
          !currentChart
        ) {
          return;
        }

        const width =
          currentContainer.clientWidth;

        if (width <= 0) {
          return;
        }

        currentChart.applyOptions({
          width,
        });
      });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();

      chart.remove();

      chartRef.current = null;

      candleSeriesRef.current =
        null;

      volumeSeriesRef.current =
        null;

      initializedRef.current =
        false;

      previousBarsRef.current = [];

      firstDataRenderRef.current =
        true;
    };
  }, [height]);

  /*
   * ------------------------------------------------------------------
   * UPDATE DATA
   * ------------------------------------------------------------------
   */
  useEffect(() => {
    if (
      !initializedRef.current ||
      !candleSeriesRef.current ||
      !volumeSeriesRef.current ||
      bars.length === 0
    ) {
      return;
    }

    const previous =
      previousBarsRef.current;

    /*
     * Không làm gì nếu dữ liệu hoàn toàn giống nhau.
     *
     * Điều này rất hữu ích vì frontend đang polling API.
     */
    if (
      previous.length > 0 &&
      isSameBars(previous, bars)
    ) {
      return;
    }

    const candleSeries =
      candleSeriesRef.current;

    const volumeSeries =
      volumeSeriesRef.current;

    /*
     * --------------------------------------------------------------
     * FIRST LOAD
     * --------------------------------------------------------------
     */
    if (previous.length === 0) {
      const candleData =
        bars.map(toCandleData);

      const volumeData =
        bars.map(toVolumeData);

      candleSeries.setData(
        candleData,
      );

      volumeSeries.setData(
        volumeData,
      );

      /*
       * Chỉ fit một lần.
       */
      chartRef.current
        ?.timeScale()
        .fitContent();

      previousBarsRef.current =
        bars.map((bar) => ({
          ...bar,
        }));

      firstDataRenderRef.current =
        false;

      return;
    }

    /*
     * --------------------------------------------------------------
     * ONLY LAST CANDLE CHANGED
     * --------------------------------------------------------------
     *
     * Đây là trường hợp quan trọng nhất cho realtime.
     *
     * Thay vì:
     *
     * setData(200 candles)
     *
     * chúng ta chỉ:
     *
     * update(last candle)
     */
    if (
      isAppendOnlyUpdate(
        previous,
        bars,
      )
    ) {
      const last =
        bars[bars.length - 1];

      candleSeries.update(
        toCandleData(last),
      );

      volumeSeries.update(
        toVolumeData(last),
      );

      previousBarsRef.current =
        bars.map((bar) => ({
          ...bar,
        }));

      return;
    }

    /*
     * --------------------------------------------------------------
     * NEW CANDLE APPENDED
     * --------------------------------------------------------------
     *
     * Ví dụ:
     *
     * trước:
     * 1 2 3 4
     *
     * sau:
     * 1 2 3 4 5
     */
    if (
      bars.length >
        previous.length &&
      bars
        .slice(
          0,
          previous.length,
        )
        .every(
          (bar, index) =>
            barsAreEqual(
              bar,
              previous[index],
            ),
        )
    ) {
      const newBars =
        bars.slice(
          previous.length,
        );

      for (const bar of newBars) {
        candleSeries.update(
          toCandleData(bar),
        );

        volumeSeries.update(
          toVolumeData(bar),
        );
      }

      previousBarsRef.current =
        bars.map((bar) => ({
          ...bar,
        }));

      return;
    }

    /*
     * --------------------------------------------------------------
     * FULL RESET
     * --------------------------------------------------------------
     *
     * Chỉ xảy ra khi:
     *
     * - đổi timeframe
     * - dữ liệu lịch sử thay đổi
     * - API trả về bộ candles khác hoàn toàn
     */
    const candleData =
      bars.map(toCandleData);

    const volumeData =
      bars.map(toVolumeData);

    candleSeries.setData(
      candleData,
    );

    volumeSeries.setData(
      volumeData,
    );

    /*
     * Quan trọng:
     *
     * Không gọi fitContent() ở đây.
     *
     * Nếu user đang zoom chart,
     * chúng ta không phá zoom của họ.
     */
    previousBarsRef.current =
      bars.map((bar) => ({
        ...bar,
      }));
  }, [bars]);

  /*
   * Khi không có dữ liệu.
   */
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

/* -------------------------------------------------------------------------- */
/*                                  SPARKLINE                                 */
/* -------------------------------------------------------------------------- */

export function Sparkline({
  bars,
  width = 120,
  height = 36,
}: {
  bars: Bar[];
  width?: number;
  height?: number;
}) {
  if (bars.length < 2) {
    return null;
  }

  const closes =
    bars.map((bar) => bar.close);

  const min =
    Math.min(...closes);

  const max =
    Math.max(...closes);

  const range =
    max - min || 1;

  const points =
    closes.map(
      (close, index) => {
        const x =
          (index /
            (closes.length - 1)) *
          width;

        const y =
          height -
          ((close - min) /
            range) *
            (height - 4) -
          2;

        return `${x},${y}`;
      },
    );

  const up =
    closes[
      closes.length - 1
    ] >= closes[0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={
          up
            ? "#34d399"
            : "#fb7185"
        }
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
