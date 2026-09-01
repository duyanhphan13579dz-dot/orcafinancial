/**
 * Source priority & synthetic detection
 * Official company filings rank highest.
 */

export const SOURCE_PRIORITY = {
  OFFICIAL_FILING: 100,
  PROFESSIONAL_DATA: 90, // e.g. VnDirect authorized feed
  VERIFIED_PROVIDER: 80, // Vietstock
  UNVERIFIED_PROVIDER: 40,
  SYNTHETIC: 0,
} as const;

export type SourcePriorityLevel = keyof typeof SOURCE_PRIORITY;

const SOURCE_ALIASES: Array<{ match: RegExp; level: SourcePriorityLevel }> = [
  { match: /filing|ssc|hsx|hnx|official|cafef-filing|company-ir/i, level: "OFFICIAL_FILING" },
  { match: /vndirect|fmp|daloopa|fiscal-?ai|professional/i, level: "PROFESSIONAL_DATA" },
  { match: /vietstock|cafef|verified/i, level: "VERIFIED_PROVIDER" },
  { match: /sector-synthetic|synthetic|model|estimate|benchmark/i, level: "SYNTHETIC" },
];

export function sourcePriorityLevelOf(source: string): SourcePriorityLevel {
  const s = (source ?? "").trim();
  if (!s) return "UNVERIFIED_PROVIDER";
  for (const { match, level } of SOURCE_ALIASES) {
    if (match.test(s)) return level;
  }
  return "UNVERIFIED_PROVIDER";
}

export function sourcePriorityOf(source: string): number {
  return SOURCE_PRIORITY[sourcePriorityLevelOf(source)];
}

export function isSyntheticSource(source: string): boolean {
  const s = (source ?? "").trim().toLowerCase();
  return (
    s.startsWith("sector-synthetic") ||
    s.includes("synthetic") ||
    s === "synthetic-sector-model" ||
    s === "synthetic-fallback"
  );
}

export function pickPreferredRecord<
  T extends {
    source: string;
    verificationStatus?: string | null;
    qualityStatus?: string | null;
    updatedAt?: Date | string | null;
    normalizedAt?: Date | string | null;
  },
>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((c) => {
    const priority = sourcePriorityOf(c.source);
    const verifiedBoost =
      c.verificationStatus === "verified" && c.qualityStatus === "accepted" ? 5 : 0;
    const ts = new Date(c.updatedAt ?? c.normalizedAt ?? 0).getTime() || 0;
    return { c, score: priority + verifiedBoost, ts };
  });
  scored.sort((a, b) => b.score - a.score || b.ts - a.ts);
  const nonSynthetic = scored.filter((s) => !isSyntheticSource(s.c.source));
  if (nonSynthetic.length > 0) return nonSynthetic[0].c;
  return scored[0].c;
}
