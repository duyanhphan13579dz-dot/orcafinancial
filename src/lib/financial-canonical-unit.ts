/**
 * Phase 2 — Canonical unit strategy
 *
 * Database stores absolute VND when possible.
 * Raw value + raw unit are retained for forensic audit.
 * Frontend only formats; it must not guess business units.
 */

export type KnownUnit =
  | "VND"
  | "THOUSAND_VND"
  | "MILLION_VND"
  | "BILLION_VND"
  | "reported"
  | "as_reported"
  | "unknown";

export interface CanonicalUnitResult {
  rawValue: number;
  rawUnit: KnownUnit | string;
  canonicalVnd: number;
  multiplier: number;
  confidence: number;
}

const UNIT_MULTIPLIER: Record<string, number> = {
  VND: 1,
  DONG: 1,
  THOUSAND_VND: 1_000,
  THOUSAND: 1_000,
  "NGHÌN VND": 1_000,
  MILLION_VND: 1_000_000,
  MILLION: 1_000_000,
  "TRIỆU VND": 1_000_000,
  BILLION_VND: 1_000_000_000,
  BILLION: 1_000_000_000,
  "TỶ VND": 1_000_000_000,
  "TY VND": 1_000_000_000,
  REPORTED_BILLION: 1_000_000_000,
};

export function detectUnit(raw: string | null | undefined): KnownUnit | string {
  if (!raw || !raw.trim()) return "unknown";
  const u = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (u === "REPORTED" || u === "AS_REPORTED") return "reported";
  if (UNIT_MULTIPLIER[u] != null) {
    if (UNIT_MULTIPLIER[u] === 1) return "VND";
    if (UNIT_MULTIPLIER[u] === 1_000) return "THOUSAND_VND";
    if (UNIT_MULTIPLIER[u] === 1_000_000) return "MILLION_VND";
    if (UNIT_MULTIPLIER[u] === 1_000_000_000) return "BILLION_VND";
  }
  if (/t[ỷy]/i.test(raw) || /billion/i.test(raw)) return "BILLION_VND";
  if (/tri[ệe]u|million/i.test(raw)) return "MILLION_VND";
  if (/ngh[ìi]n|thousand/i.test(raw)) return "THOUSAND_VND";
  return raw.trim();
}

export function toCanonicalVnd(
  rawValue: number,
  unit: string | null | undefined,
  opts?: { assumeBillionWhenReported?: boolean },
): CanonicalUnitResult {
  const detected = detectUnit(unit);
  let multiplier = 1;
  let confidence = 0.95;

  const key = String(detected).toUpperCase().replace(/\s+/g, "_");
  if (UNIT_MULTIPLIER[key] != null) {
    multiplier = UNIT_MULTIPLIER[key];
  } else if (detected === "reported" || detected === "as_reported" || detected === "unknown") {
    if (opts?.assumeBillionWhenReported) {
      multiplier = 1_000_000_000;
      confidence = 0.4;
    } else {
      multiplier = 1;
      confidence = 0.5;
    }
  } else if (UNIT_MULTIPLIER[String(unit ?? "").toUpperCase().replace(/\s+/g, "_")] != null) {
    multiplier = UNIT_MULTIPLIER[String(unit).toUpperCase().replace(/\s+/g, "_")];
  } else {
    confidence = 0.3;
  }

  return {
    rawValue,
    rawUnit: detected,
    canonicalVnd: rawValue * multiplier,
    multiplier,
    confidence,
  };
}

export function formatVndDisplay(canonicalVnd: number): { value: number; suffix: string; label: string } {
  const abs = Math.abs(canonicalVnd);
  if (abs >= 1_000_000_000_000) {
    return { value: canonicalVnd / 1_000_000_000_000, suffix: "nghìn tỷ", label: `${(canonicalVnd / 1_000_000_000_000).toFixed(2)} nghìn tỷ VND` };
  }
  if (abs >= 1_000_000_000) {
    return { value: canonicalVnd / 1_000_000_000, suffix: "tỷ", label: `${(canonicalVnd / 1_000_000_000).toFixed(2)} tỷ VND` };
  }
  if (abs >= 1_000_000) {
    return { value: canonicalVnd / 1_000_000, suffix: "triệu", label: `${(canonicalVnd / 1_000_000).toFixed(2)} triệu VND` };
  }
  return { value: canonicalVnd, suffix: "VND", label: `${canonicalVnd.toFixed(0)} VND` };
}
