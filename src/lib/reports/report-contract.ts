export type ReportType = "morning" | "summary";

export type DataAvailability = "LIVE" | "DELAYED" | "UNAVAILABLE" | "STALE" | "ERROR";

export interface ReportSource {
  name: string;
  url?: string | null;
  observedAt?: string | null;
  status: DataAvailability;
}

export interface ReportDataTimestamps {
  marketData: string | null;
  news: string | null;
  macro: string | null;
  generated: string;
}

export interface ReportQuality {
  score: number;
  dataCompleteness: number;
  sourceQuality: number;
  marketData: number;
  newsFreshness: number;
  aiValidation: number;
  missing: string[];
}

export interface ReportMetadata {
  reportId: string;
  engineVersion: string;
  type: ReportType;
  date: string;
  publicationTime: string;
  timestamps: ReportDataTimestamps;
  availability: Record<string, DataAvailability>;
  sources: ReportSource[];
  quality: ReportQuality;
  generatedAt: string;
  version: number;
}

export function reportId(type: ReportType, date: string, version = 1): string {
  const prefix = type === "morning" ? "ORCA-MB" : "ORCA-MS";
  return `${prefix}-${date.replaceAll("-", "")}${version > 1 ? `-V${version}` : ""}`;
}

export function availabilityFor(value: unknown, ageSeconds?: number | null): DataAvailability {
  if (value == null) return "UNAVAILABLE";
  if (ageSeconds != null && ageSeconds > 60 * 60 * 6) return "STALE";
  if (ageSeconds != null && ageSeconds > 60 * 15) return "DELAYED";
  return "LIVE";
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildReportQuality(input: {
  marketAvailable: boolean;
  newsCount: number;
  macroAvailable: boolean;
  sourceCount: number;
  aiValidated: boolean;
  missing?: string[];
}): ReportQuality {
  const missing = input.missing ?? [];
  const dataCompleteness = clampScore(
    (input.marketAvailable ? 45 : 0) + (input.newsCount > 0 ? 25 : 0) + (input.macroAvailable ? 20 : 0) + (missing.length === 0 ? 10 : 0),
  );
  const sourceQuality = clampScore(input.sourceCount > 0 ? Math.min(100, 65 + input.sourceCount * 7) : 0);
  const marketData = input.marketAvailable ? 98 : 25;
  const newsFreshness = input.newsCount > 0 ? 91 : 20;
  const aiValidation = input.aiValidated ? 90 : 72;
  return {
    score: clampScore((dataCompleteness + sourceQuality + marketData + newsFreshness + aiValidation) / 5),
    dataCompleteness,
    sourceQuality,
    marketData,
    newsFreshness,
    aiValidation,
    missing,
  };
}

export function formatIct(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "medium",
    hour12: false,
  }).format(new Date(iso));
}

export function enrichReportHtml(html: string, metadata: ReportMetadata): string {
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const sourceText = metadata.sources.length
    ? metadata.sources.map((s) => `${s.name} (${s.status})`).join(" · ")
    : "Không có nguồn khả dụng";
  const quality = metadata.quality;
  const audit = `<section class="orca-audit" aria-label="Report metadata"><div><strong>REPORT ID</strong> ${esc(metadata.reportId)} · <strong>ENGINE</strong> ${esc(metadata.engineVersion)} · <strong>VERSION</strong> ${metadata.version}</div><div><strong>DATA</strong> Market ${esc(metadata.timestamps.marketData ? formatIct(metadata.timestamps.marketData) : "N/A")} · News ${esc(metadata.timestamps.news ? formatIct(metadata.timestamps.news) : "N/A")} · Macro ${esc(metadata.timestamps.macro ? formatIct(metadata.timestamps.macro) : "N/A")}</div><div><strong>QUALITY</strong> ${quality.score}/100 · <strong>SOURCES</strong> ${esc(sourceText)}</div></section>`;
  const style = `<style>.orca-audit{margin:14px 0;padding:10px 12px;border:1px solid #cfdcec;background:#f8fbfe;color:#35516e;font:8.5pt/1.5 system-ui,sans-serif}.orca-audit strong{color:#0A2540;letter-spacing:.06em}.orca-audit div+div{margin-top:3px}@media print{.orca-audit{break-inside:avoid}.sec,.sc-card,.box-warn,.box-rec,.box-overview{break-inside:avoid}h1,.sec-title{break-after:avoid}}</style>`;
  return html.replace("</head>", `${style}</head>`).replace(/<body([^>]*)>/i, `<body$1>${audit}`);
}

export const REPORT_DISCLAIMER = "Báo cáo chỉ nhằm mục đích nghiên cứu, không phải lời khuyên đầu tư. Số liệu có thể bị trễ hoặc unavailable khi nguồn upstream gặp sự cố.";

export interface NormalizedNews { title: string; link: string; sourceName: string; publishedAt?: string | Date | null; }

export function normalizeAndDeduplicateNews<T extends NormalizedNews>(items: T[], limit = 50): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const normalized = item.title.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const key = item.link?.trim().toLowerCase() || normalized;
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...item, title: item.title.trim(), sourceName: item.sourceName.trim() });
    if (result.length >= limit) break;
  }
  return result;
}
