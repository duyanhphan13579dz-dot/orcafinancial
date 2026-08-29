/**
 * ORCA Realtime Time & Scanning Engine
 *
 * Provides exact wall-clock time breakdown (year, quarter, month, day, hour, minute, second)
 * and cutoff enforcement for realtime data scanning across Vietnam (UTC+7) and global markets.
 */

export interface RealtimeContext {
  /** UTC instant Date object */
  asOf: Date;
  /** Year (e.g. 2026) */
  year: number;
  /** Quarter (1-4) based on month */
  quarter: 1 | 2 | 3 | 4;
  /** Month (1-12) */
  month: number;
  /** Day of month (1-31) */
  day: number;
  /** Hour (0-23) */
  hour: number;
  /** Minute (0-59) */
  minute: number;
  /** Second (0-59) */
  second: number;
  /** Current quarter composite tag (e.g. "Q3/2026") */
  currentQuarterPeriod: string;
  /** Latest completed quarter composite tag (e.g. "Q2/2026") */
  latestCompletedPeriod: string;
  /** Latest completed quarter object */
  latestCompletedQuarter: { fiscalYear: number; quarter: 1 | 2 | 3 | 4 };
  /** Vietnam wall-clock parts */
  vnParts: {
    year: number;
    quarter: 1 | 2 | 3 | 4;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    weekday: number;
  };
  /** ISO string of the exact cutoff timestamp */
  cutoffIso: string;
  /** Unix timestamp in seconds */
  cutoffTimestamp: number;
}

export const VN_OFFSET_MINUTES = 7 * 60;

/** Current real-time context down to second precision. */
export function getRealtimeContext(asOf = new Date()): RealtimeContext {
  const year = asOf.getFullYear();
  const month = asOf.getMonth() + 1;
  const day = asOf.getDate();
  const hour = asOf.getHours();
  const minute = asOf.getMinutes();
  const second = asOf.getSeconds();

  const quarter = Math.ceil(month / 3) as 1 | 2 | 3 | 4;
  const currentQuarterPeriod = `Q${quarter}/${year}`;

  // Latest completed quarter logic:
  // Month 1-3 (Q1 in-progress) -> Q4 of previous year
  // Month 4-6 (Q2 in-progress) -> Q1 of current year
  // Month 7-9 (Q3 in-progress) -> Q2 of current year
  // Month 10-12 (Q4 in-progress) -> Q3 of current year
  let completedQ: number = quarter - 1;
  let completedYear = year;
  if (completedQ === 0) {
    completedQ = 4;
    completedYear -= 1;
  }
  const latestCompletedQuarter = {
    fiscalYear: completedYear,
    quarter: completedQ as 1 | 2 | 3 | 4,
  };
  const latestCompletedPeriod = `Q${completedQ}/${completedYear}`;

  // Vietnam wall-clock calculation (UTC+7)
  const shifted = new Date(asOf.getTime() + VN_OFFSET_MINUTES * 60_000);
  const vnMonth = shifted.getUTCMonth() + 1;
  const vnQuarter = Math.ceil(vnMonth / 3) as 1 | 2 | 3 | 4;

  const vnParts = {
    year: shifted.getUTCFullYear(),
    quarter: vnQuarter,
    month: vnMonth,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };

  return {
    asOf,
    year,
    quarter,
    month,
    day,
    hour,
    minute,
    second,
    currentQuarterPeriod,
    latestCompletedPeriod,
    latestCompletedQuarter,
    vnParts,
    cutoffIso: asOf.toISOString(),
    cutoffTimestamp: Math.floor(asOf.getTime() / 1000),
  };
}

/** Check whether a given period string (e.g. "Q4/2026") exceeds the realtime completed quarter cutoff. */
export function isFuturePeriod(periodStr: string, fiscalYear?: number, asOf = new Date()): boolean {
  const match = /^(Q[1-4]|FY|H1|H2|9M)\/?(\d{4})?$/i.exec(periodStr.trim());
  if (!match) return true;

  const qType = match[1].toUpperCase();
  const year = match[2] ? Number(match[2]) : fiscalYear;
  if (!year) return true;

  const { latestCompletedQuarter } = getRealtimeContext(asOf);

  if (year > latestCompletedQuarter.fiscalYear) return true;
  if (year < latestCompletedQuarter.fiscalYear) return false;

  if (qType === "FY") return false;

  let quarterNum = 0;
  if (qType.startsWith("Q")) {
    quarterNum = Number(qType.slice(1));
  } else if (qType === "H1") {
    quarterNum = 2;
  } else if (qType === "H2") {
    quarterNum = 4;
  } else if (qType === "9M") {
    quarterNum = 3;
  }

  return quarterNum > latestCompletedQuarter.quarter;
}

/** Filter array of records by a timestamp accessor to ensure no record exceeds cutoff. */
export function filterRealtimeDataUpToCutoff<T>(
  records: T[],
  getTimestamp: (item: T) => Date | number | string | null | undefined,
  asOf = new Date()
): T[] {
  const cutoffMs = asOf.getTime();
  return records.filter((item) => {
    const raw = getTimestamp(item);
    if (!raw) return true;
    let timeMs: number;
    if (typeof raw === "number") {
      timeMs = raw > 1e11 ? raw : raw * 1000;
    } else if (raw instanceof Date) {
      timeMs = raw.getTime();
    } else {
      timeMs = new Date(raw).getTime();
    }
    return Number.isFinite(timeMs) && timeMs <= cutoffMs;
  });
}
