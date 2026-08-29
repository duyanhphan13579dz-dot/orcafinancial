/**
 * Vietnam timezone helpers (Asia/Ho_Chi_Minh, UTC+7, no DST).
 *
 * We deliberately avoid pulling in a date library: VN has a fixed offset with
 * no daylight-saving transitions, so a constant is exact and dependency-free.
 */

import { getRealtimeContext, type RealtimeContext } from "@/lib/realtime-time";

export const VN_OFFSET_MINUTES = 7 * 60;

/** Current instant (a normal Date; JS Dates are absolute instants). */
export function vnNow(): Date {
  return new Date();
}

/** Wall-clock parts as seen in Vietnam. */
export function vnParts(d: Date = new Date()) {
  const shifted = new Date(d.getTime() + VN_OFFSET_MINUTES * 60_000);
  const month = shifted.getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3) as 1 | 2 | 3 | 4;
  return {
    year: shifted.getUTCFullYear(),
    quarter,
    month,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(), // 0=Sun
  };
}

/** "YYYY-MM-DD" for the VN calendar day containing `d`. */
export function vnDateKey(d: Date = new Date()): string {
  const p = vnParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:MM:SS" VN wall-clock. */
export function vnTimeKey(d: Date = new Date()): string {
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`;
}

/** Human label, e.g. "16/08/2026 18:42:05 (GMT+7)". */
export function vnLabel(d: Date = new Date()): string {
  const p = vnParts(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year} ${vnTimeKey(d)} (GMT+7)`;
}

/** UTC instant corresponding to VN midnight of the day containing `d`. */
export function vnStartOfDay(d: Date = new Date()): Date {
  const p = vnParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) - VN_OFFSET_MINUTES * 60_000);
}

/** Truncate to the start of the minute — used as the snapshot bucket key. */
export function truncateToMinute(d: Date = new Date()): Date {
  const t = new Date(d);
  t.setUTCSeconds(0, 0);
  return t;
}

export function isVnWeekday(d: Date = new Date()): boolean {
  const w = vnParts(d).weekday;
  return w >= 1 && w <= 5;
}

export function vnRealtimeContext(d: Date = new Date()): RealtimeContext {
  return getRealtimeContext(d);
}
