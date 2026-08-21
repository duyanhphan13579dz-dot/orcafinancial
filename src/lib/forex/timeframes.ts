/**
 * Forex timeframe sets.
 *
 * Standard pairs: short intraday + daily.
 * DXY (US Dollar Index): higher timeframe only — 4H → 1D → 1W → 1M → 12M.
 */

export const FOREX_STANDARD_TFS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

/** API codes for Dollar Index (display labels differ). */
export const DXY_TFS = ["4h", "1d", "1w", "1mo", "12mo"] as const;

export type ForexStandardTf = (typeof FOREX_STANDARD_TFS)[number];
export type DxyTf = (typeof DXY_TFS)[number];
export type ForexTf = ForexStandardTf | DxyTf;

const STANDARD_SET = new Set<string>(FOREX_STANDARD_TFS);
const DXY_SET = new Set<string>(DXY_TFS);
const ALL_SET = new Set<string>([...FOREX_STANDARD_TFS, ...DXY_TFS]);

export function isDxySymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase() === "DXY";
}

export function timeframesFor(symbol: string): readonly string[] {
  return isDxySymbol(symbol) ? DXY_TFS : FOREX_STANDARD_TFS;
}

export function defaultTimeframe(symbol: string): string {
  return isDxySymbol(symbol) ? "1d" : "1h";
}

/** Accept any known TF (routes validate further per symbol if needed). */
export function isValidTimeframe(tf: string, symbol?: string): boolean {
  if (symbol && isDxySymbol(symbol)) return DXY_SET.has(tf);
  if (symbol) return STANDARD_SET.has(tf);
  return ALL_SET.has(tf);
}

/** Button label shown in UI. */
export function timeframeLabel(tf: string): string {
  switch (tf) {
    case "1mo":
      return "1M";
    case "12mo":
      return "12M";
    case "1w":
      return "1W";
    case "1d":
      return "1D";
    case "4h":
      return "4H";
    default:
      return tf;
  }
}
