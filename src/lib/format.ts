/**
 * Period formatting helpers.
 *
 * Internal storage uses two columns: `period` ("Q1".."Q4" or "FY") and `fiscalYear` (int).
 * The public API always exposes a composite `displayPeriod` ("Q1/2026") and a Vietnamese
 * label `displayPeriodVi` ("Quý 1 / 2026") so frontends never have to stitch strings.
 */

export interface PeriodLabels {
  /** Composite code, e.g. "Q1/2026" or "FY/2025". */
  displayPeriod: string;
  /** Vietnamese human label, e.g. "Quý 1 / 2026" or "Cả năm 2025". */
  displayPeriodVi: string;
  /** Short tag, e.g. "1Q26" or "FY25". */
  shortTag: string;
}

export function formatPeriod(period: string, fiscalYear: number): PeriodLabels {
  const y = Number(fiscalYear);
  const p = (period ?? "").toUpperCase();
  if (p === "FY" || p === "YEAR" || p === "") {
    return {
      displayPeriod: `FY/${y}`,
      displayPeriodVi: `Cả năm ${y}`,
      shortTag: `FY${String(y).slice(-2)}`,
    };
  }
  const qMatch = p.match(/^Q?(\d)$/);
  if (qMatch) {
    const q = parseInt(qMatch[1], 10);
    return {
      displayPeriod: `Q${q}/${y}`,
      displayPeriodVi: `Quý ${q} / ${y}`,
      shortTag: `${q}Q${String(y).slice(-2)}`,
    };
  }
  return { displayPeriod: `${p}/${y}`, displayPeriodVi: `${p} ${y}`, shortTag: `${p}${String(y).slice(-2)}` };
}

/** Accepts either "Q3/2026" (already composite) or {period, fiscalYear}. */
export function formatPeriodFromComposite(input: string | { period: string; fiscalYear: number }): PeriodLabels {
  if (typeof input === "string") {
    const m = input.match(/^(Q?\d|FY)\/(\d{4})$/i);
    if (!m) return { displayPeriod: input, displayPeriodVi: input, shortTag: input };
    return formatPeriod(m[1], parseInt(m[2], 10));
  }
  return formatPeriod(input.period, input.fiscalYear);
}
