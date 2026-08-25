"use client";

import { memo, useEffect, useRef } from "react";
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

interface CandleChartProps {
  /**
   * Historical OHLCV data.
   *
   * Bars MUST be sorted ascending by time.
   */
  bars: Bar[];

  /**
   * Chart height.
   */
  height?: number;

  /**
   * Called when the user scrolls close to the
   * beginning of the loaded dataset.
   *
   * Parent component is responsible for fetching
   * older bars and merging them into `bars`.
   */
  onLoadMore?: () => void;

  /**
   * Prevent duplicate historical requests.
   */
  loadingMore?: boolean;

  /**
   * Whether more historical data exists.
   *
   * If false, onLoadMore will no longer be triggered.
   */
  hasMore?: boolean;

  /**
   * How close to the left edge the user must scroll
   * before requesting more data.
   *
   * Example:
   * 30 = request more when fewer than ~30 logical
   * bars remain before the left edge.
   */
  loadMoreThreshold?: number;

  /**
   * Optional callback when visible logical range changes.
   *
   * Useful for debugging or future chart state management.
   */
  onVisibleRangeChange?: (
    range: LogicalRange | null,
  ) => void;
}

function toCandleData(
  bar: Bar,
): CandlestickData<Time> {
  return {
    time: bar.time as Time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
}

function toVolumeData(
  bar: Bar,
): HistogramData<Time> {
  return {
    time: bar.time as Time,
    value: bar.volume,

    color:
      bar.close >= bar.open
        ? "rgba(52, 211, 153, 0.3)"
        : "rgba(251, 113, 133, 0.3)",
  };
}

function barsAreEqual(
  a: Bar | undefined,
  b: Bar | undefined,
) {
  if (!a || !b) {
    return false;
  }

  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
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

  if (
    previous[0]?.time !== next[0]?.time ||
    previous[previous.length - 1]?.time !==
      next[next.length - 1]?.time
  ) {
    return false;
  }

  for (let i = 0; i < next.length; i++) {
    if (
      !barsAreEqual(
        previous[i],
        next[i],
      )
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Detects the common realtime case:
 *
 * previous:
 * [1, 2, 3, 4]
 *
 * next:
 * [1, 2, 3, 4]
 *
 * Only candle #4 changed.
 */
function isLastCandleUpdate(
  previous: Bar[],
  next: Bar[],
) {
  if (
    previous.length === 0 ||
    previous.length !== next.length
  ) {
    return false;
  }

  for (
    let i = 0;
    i < next.length - 1;
    i++
  ) {
    if (
      !barsAreEqual(
        previous[i],
        next[i],
      )
    ) {
      return false;
    }
  }

  const previousLast =
    previous[previous.length - 1];

  const nextLast =
    next[next.length - 1];

  if (
    !previousLast ||
    !nextLast
  ) {
    return false;
  }

  return (
    previousLast.time ===
    nextLast.time
  );
}

/**
 * Detects newly appended candles.
 *
 * previous:
 * [1, 2, 3, 4]
 *
 * next:
 * [1, 2, 3, 4, 5]
 */
function getAppendedBars(
  previous: Bar[],
  next: Bar[],
): Bar[] | null {
  if (
    previous.length === 0 ||
    next.length <= previous.length
  ) {
    return null;
  }

  for (
    let i = 0;
    i < previous.length;
    i++
  ) {
    if (
      !barsAreEqual(
        previous[i],
        next[i],
      )
    ) {
      return null;
    }
  }

  return next.slice(
    previous.length,
  );
}

/**
 * Detects newly prepended historical candles.
 *
 * previous:
 * [4, 5, 6, 7]
 *
 * next:
 * [1, 2, 3, 4, 5, 6, 7]
 *
 * Returns the number of newly inserted bars.
 */
function getPrependedCount(
  previous: Bar[],
  next: Bar[],
): number {
  if (
    previous.length === 0 ||
    next.length <= previous.length
  ) {
    return 0;
  }

  const additional =
    next.length -
    previous.length;

  for (
    let i = 0;
    i < previous.length;
    i++
  ) {
    if (
      !barsAreEqual(
        previous[i],
        next[
          i + additional
        ],
      )
    ) {
      return 0;
    }
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
  onVisibleRangeChange,
}: CandleChartProps) {
  const chartContainerRef =
    useRef<HTMLDivElement>(null);

  const chartRef =
    useRef<IChartApi | null>(null);

  const candleSeriesRef =
    useRef<
      ISeriesApi<"Candlestick"> | null
    >(null);

  const volumeSeriesRef =
    useRef<
      ISeriesApi<"Histogram"> | null
    >(null);

  /**
   * Last dataset rendered by the chart.
   */
  const previousBarsRef =
    useRef<Bar[]>([]);

  /**
   * Prevents chart recreation.
   */
  const initializedRef =
    useRef(false);

  /**
   * Used to avoid repeatedly calling
   * onLoadMore while the user remains
   * near the left edge.
   */
  const loadMoreTriggeredRef =
    useRef(false);

  /**
   * Stores the logical range before
   * prepending historical candles.
   *
   * This allows us to preserve the user's
   * viewport after new candles are inserted
   * before the current dataset.
   */
  const pendingPrependRangeRef =
    useRef<LogicalRange | null>(null);

  /**
   * --------------------------------------------------------------
   * CREATE CHART
   * --------------------------------------------------------------
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

    const chart =
      createChart(
        container,
        {
          layout: {
            background: {
              type:
                ColorType.Solid,
              color:
                "transparent",
            },

            textColor:
              "#7aa8d4",

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
            mode:
              CrosshairMode.Normal,
          },

          rightPriceScale: {
            borderColor:
              "rgba(26, 53, 88, 0.8)",
          },

          timeScale: {
            borderColor:
              "rgba(26, 53, 88, 0.8)",

            timeVisible: true,

            secondsVisible: false,

            rightOffset: 5,

            /**
             * Enables smooth scrolling/zooming.
             */
            fixLeftEdge: false,

            fixRightEdge: false,
          },

          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true,
          },

          handleScale: {
            axisPressedMouseMove: true,
            mouseWheel: true,
            pinch: true,
          },

          width:
            container.clientWidth,

          height,
        },
      );

    /**
     * ------------------------------------------------------------
     * CANDLE SERIES
     * ------------------------------------------------------------
     */
    const candlestickSeries =
      chart.addSeries(
        CandlestickSeries,
        {
          upColor:
            "#34d399",

          downColor:
            "#fb7185",

          borderVisible:
            false,

          wickUpColor:
            "#34d399",

          wickDownColor:
            "#fb7185",

          priceLineVisible:
            true,

          lastValueVisible:
            true,
        },
      );

    /**
     * ------------------------------------------------------------
     * VOLUME SERIES
     * ------------------------------------------------------------
     */
    const volumeSeries =
      chart.addSeries(
        HistogramSeries,
        {
          color:
            "#26a69a",

          priceFormat: {
            type:
              "volume",
          },

          priceScaleId:
            "",
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

    chartRef.current =
      chart;

    candleSeriesRef.current =
      candlestickSeries;

    volumeSeriesRef.current =
      volumeSeries;

    initializedRef.current =
      true;

    /**
     * ------------------------------------------------------------
     * VISIBLE RANGE / LOAD MORE
     * ------------------------------------------------------------
     */
    const timeScale =
      chart.timeScale();

    const handleVisibleRangeChange =
      (
        range: LogicalRange | null,
      ) => {
        onVisibleRangeChange?.(
          range,
        );

        if (
          !range ||
          !onLoadMore ||
          !hasMore ||
          loadingMore
        ) {
          return;
        }

        /**
         * The user is close to the beginning
         * of the currently loaded dataset.
         */
        if (
          range.from <=
          loadMoreThreshold
        ) {
          /**
           * Prevent duplicate requests
           * while the same range is visible.
           */
          if (
            loadMoreTriggeredRef.current
          ) {
            return;
          }

          /**
           * Save current viewport before
           * parent prepends historical bars.
           */
          pendingPrependRangeRef.current =
            {
              from: range.from,
              to: range.to,
            };

          loadMoreTriggeredRef.current =
            true;

          onLoadMore();
        } else {
          /**
           * User moved away from the left edge.
           *
           * Allow another load-more request
           * when they approach the edge again.
           */
          loadMoreTriggeredRef.current =
            false;
        }
      };

    timeScale.subscribeVisibleLogicalRangeChange(
      handleVisibleRangeChange,
    );

    /**
     * ------------------------------------------------------------
     * RESPONSIVE WIDTH
     * ------------------------------------------------------------
     */
    const resizeObserver =
      new ResizeObserver(
        () => {
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
        },
      );

    resizeObserver.observe(
      container,
    );

    /**
     * ------------------------------------------------------------
     * CLEANUP
     * ------------------------------------------------------------
     */
    return () => {
      resizeObserver.disconnect();

      timeScale.unsubscribeVisibleLogicalRangeChange(
        handleVisibleRangeChange,
      );

      chart.remove();

      chartRef.current =
        null;

      candleSeriesRef.current =
        null;

      volumeSeriesRef.current =
        null;

      initializedRef.current =
        false;

      previousBarsRef.current =
        [];

      pendingPrependRangeRef.current =
        null;

      loadMoreTriggeredRef.current =
        false;
    };
  }, [
    height,
    onLoadMore,
    hasMore,
    loadingMore,
    loadMoreThreshold,
    onVisibleRangeChange,
  ]);

  /**
   * --------------------------------------------------------------
   * RESET LOAD-MORE LOCK AFTER REQUEST COMPLETES
   * --------------------------------------------------------------
   */
  useEffect(() => {
    if (!loadingMore) {
      loadMoreTriggeredRef.current =
        false;
    }
  }, [loadingMore]);

  /**
   * --------------------------------------------------------------
   * UPDATE DATA
   * --------------------------------------------------------------
   */
  useEffect(() => {
    if (
      !initializedRef.current ||
      !candleSeriesRef.current ||
      !volumeSeriesRef.current
    ) {
      return;
    }

    const candleSeries =
      candleSeriesRef.current;

    const volumeSeries =
      volumeSeriesRef.current;

    const previous =
      previousBarsRef.current;

    /**
     * No data.
     */
    if (bars.length === 0) {
      return;
    }

    /**
     * ------------------------------------------------------------
     * NOTHING CHANGED
     * ------------------------------------------------------------
     */
    if (
      previous.length > 0 &&
      isSameBars(
        previous,
        bars,
      )
    ) {
      return;
    }

    /**
     * ------------------------------------------------------------
     * FIRST LOAD
     * ------------------------------------------------------------
     */
    if (
      previous.length === 0
    ) {
      candleSeries.setData(
        bars.map(
          toCandleData,
        ),
      );

      volumeSeries.setData(
        bars.map(
          toVolumeData,
        ),
      );

      /**
       * Only the first dataset is fitted.
       *
       * After this we NEVER automatically
       * call fitContent().
       */
      chartRef.current
        ?.timeScale()
        .fitContent();

      previousBarsRef.current =
        bars.map(
          (bar) => ({
            ...bar,
          }),
        );

      return;
    }

    /**
     * ------------------------------------------------------------
     * REALTIME LAST-CANDLE UPDATE
     * ------------------------------------------------------------
     *
     * Example:
     *
     * previous:
     * 1 2 3 4
     *
     * next:
     * 1 2 3 4*
     */
    if (
      isLastCandleUpdate(
        previous,
        bars,
      )
    ) {
      const last =
        bars[
          bars.length - 1
        ];

      if (last) {
        candleSeries.update(
          toCandleData(last),
        );

        volumeSeries.update(
          toVolumeData(last),
        );
      }

      previousBarsRef.current =
        bars.map(
          (bar) => ({
            ...bar,
          }),
        );

      return;
    }

    /**
     * ------------------------------------------------------------
     * APPEND NEW CANDLES
     * ------------------------------------------------------------
     *
     * previous:
     * 1 2 3 4
     *
     * next:
     * 1 2 3 4 5 6
     */
    const appended =
      getAppendedBars(
        previous,
        bars,
      );

    if (
      appended &&
      appended.length > 0
    ) {
      for (
        const bar of appended
      ) {
        candleSeries.update(
          toCandleData(bar),
        );

        volumeSeries.update(
          toVolumeData(bar),
        );
      }

      previousBarsRef.current =
        bars.map(
          (bar) => ({
            ...bar,
          }),
        );

      return;
    }

    /**
     * ------------------------------------------------------------
     * PREPEND HISTORICAL DATA
     * ------------------------------------------------------------
     *
     * previous:
     * 4 5 6 7
     *
     * next:
     * 1 2 3 4 5 6 7
     *
     * Lightweight Charts does not have a native prepend
     * operation.
     *
     * Therefore we set the complete dataset again,
     * then restore the user's logical viewport.
     *
     * This only happens when loading older history,
     * not during normal realtime updates.
     */
    const prependedCount =
      getPrependedCount(
        previous,
        bars,
      );

    if (
      prependedCount > 0
    ) {
      const savedRange =
        pendingPrependRangeRef.current;

      candleSeries.setData(
        bars.map(
          toCandleData,
        ),
      );

      volumeSeries.setData(
        bars.map(
          toVolumeData,
        ),
      );

      /**
       * Restore viewport after prepending.
       *
       * Because N candles were inserted
       * before the previous dataset, logical
       * indexes move forward by N.
       */
      if (savedRange) {
        requestAnimationFrame(
          () => {
            chartRef.current
              ?.timeScale()
              .setVisibleLogicalRange(
                {
                  from:
                    savedRange.from +
                    prependedCount,

                  to:
                    savedRange.to +
                    prependedCount,
                },
              );
          },
        );
      }

      pendingPrependRangeRef.current =
        null;

      previousBarsRef.current =
        bars.map(
          (bar) => ({
            ...bar,
          }),
        );

      /**
       * Allow another historical request
       * after the current dataset has been
       * successfully merged.
       */
      loadMoreTriggeredRef.current =
        false;

      return;
    }

    /**
     * ------------------------------------------------------------
     * FULL DATA RESET
     * ------------------------------------------------------------
     *
     * Used for:
     *
     * - timeframe changes
     * - range changes
     * - completely different datasets
     */
    candleSeries.setData(
      bars.map(
        toCandleData,
      ),
    );

    volumeSeries.setData(
      bars.map(
        toVolumeData,
      ),
    );

    /**
     * IMPORTANT:
     *
     * Do NOT call fitContent() here.
     *
     * The user may already be zoomed/panned.
     */
    previousBarsRef.current =
      bars.map(
        (bar) => ({
          ...bar,
        }),
      );
  }, [bars]);

  /**
   * --------------------------------------------------------------
   * EMPTY STATE
   * --------------------------------------------------------------
   */
  if (
    bars.length === 0
  ) {
    return (
      <div
        className="flex items-center justify-center text-slate-500 text-sm"
        style={{
          height,
        }}
      >
        Không có dữ liệu
      </div>
    );
  }

  return (
    <div
      className="relative w-full"
      style={{
        height,
      }}
    >
      <div
        ref={
          chartContainerRef
        }
        className="absolute inset-0"
      />

      {/**
       * ----------------------------------------------------------
       * LOAD MORE INDICATOR
       * ----------------------------------------------------------
       */}
      {loadingMore && (
        <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-1 text-[10px] text-slate-400 shadow-lg backdrop-blur">
          Đang tải thêm dữ liệu…
        </div>
      )}

      {/**
       * ----------------------------------------------------------
       * END OF HISTORY
       * ----------------------------------------------------------
       */}
      {!hasMore &&
        !loadingMore && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-slate-800 bg-slate-950/80 px-2 py-0.5 text-[9px] text-slate-600">
            Đã tải hết lịch sử
          </div>
        )}
    </div>
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
  if (
    bars.length < 2
  ) {
    return null;
  }

  const closes =
    bars.map(
      (bar) =>
        bar.close,
    );

  const min =
    Math.min(
      ...closes,
    );

  const max =
    Math.max(
      ...closes,
    );

  const range =
    max - min || 1;

  const points =
    closes.map(
      (
        close,
        index,
      ) => {
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
    ] >=
    closes[0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points.join(
          " ",
        )}
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

export const MemoCandleChart = memo(CandleChart);
