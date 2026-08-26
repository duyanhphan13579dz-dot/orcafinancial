import { NextResponse } from "next/server";
import { getStoredReportWithMetadata, triggerMorning, triggerSummary } from "@/lib/reports/generator";
import { renderReportPdf } from "@/lib/reports/pdf-renderer";
import { reportId, type ReportType } from "@/lib/reports/report-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ type: string }> }) {
  const { type: rawType } = await context.params;
  const type = rawType as ReportType;
  if (type !== "morning" && type !== "summary") return NextResponse.json({ error: "Loại report không hợp lệ" }, { status: 400 });
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  let stored = await getStoredReportWithMetadata(type, date);
  if (!stored) {
    await (type === "morning" ? triggerMorning(new Date()) : triggerSummary(new Date()));
    stored = await getStoredReportWithMetadata(type, date);
  }
  if (!stored) return NextResponse.json({ error: "Không có report để xuất PDF" }, { status: 404 });
  const metadata = stored.metadata ?? {
    reportId: reportId(type, date), engineVersion: "2.4.0", type, date, publicationTime: new Date().toISOString(),
    timestamps: { marketData: null, news: null, macro: null, generated: new Date().toISOString() }, availability: {}, sources: [],
    quality: { score: 0, dataCompleteness: 0, sourceQuality: 0, marketData: 0, newsFreshness: 0, aiValidation: 0, missing: ["legacy metadata"] }, generatedAt: new Date().toISOString(), version: 1,
  };
  const pdf = await renderReportPdf(stored.html, metadata);
  return new NextResponse(pdf as BodyInit, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="ORCA_${type}_${date}.pdf"`, "Cache-Control": "no-store" } });
}
