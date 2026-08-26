import PDFDocument from "pdfkit";
import type { ReportMetadata } from "./report-contract";

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\u00a0/g, " ")
    .split("\n").map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean).join("\n");
}

export function renderReportPdf(html: string, metadata: ReportMetadata): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 72, bottom: 60, left: 54, right: 54 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    try { doc.font(font); } catch { doc.font("Helvetica"); }
    doc.fillColor("#0A2540").fontSize(9).text("ORCA FINANCIAL · RESEARCH ENGINE", { characterSpacing: 0.6 });
    doc.moveDown(0.35);
    doc.fontSize(20).font("Helvetica-Bold").text(metadata.type === "morning" ? "Morning Brief" : "Market Summary");
    doc.fontSize(9).font("Helvetica").fillColor("#5c7794").text(`Report ID: ${metadata.reportId} · Version ${metadata.version} · Engine ${metadata.engineVersion}`);
    doc.text(`Generated: ${metadata.generatedAt} · Quality: ${metadata.quality.score}/100`);
    doc.moveDown(0.8);
    doc.strokeColor("#cfdcec").moveTo(54, doc.y).lineTo(541, doc.y).stroke();
    doc.moveDown(0.7);

    const text = htmlToText(html);
    for (const paragraph of text.split("\n")) {
      const clean = paragraph.trim();
      if (!clean) continue;
      const heading = /^(ORCA|MARKET SUMMARY|MORNING BRIEF|\d{2}\s*[·.]|CẢNH BÁO|KẾT LUẬN|KHUYẾN NGHỊ|ĐÁNH GIÁ|REPORT ID|DATA|QUALITY)/i.test(clean);
      if (heading) {
        if (doc.y > 700) doc.addPage();
        doc.moveDown(0.45).font("Helvetica-Bold").fontSize(11).fillColor("#0A2540").text(clean, { paragraphGap: 2 });
      } else {
        doc.font("DejaVuSans").fontSize(9.5).fillColor("#0b1e33").text(clean, { lineGap: 2, paragraphGap: 4 });
      }
    }
    doc.moveDown(1);
    doc.font("DejaVuSans").fontSize(8).fillColor("#5c7794").text("Disclaimer: Báo cáo chỉ nhằm mục đích nghiên cứu, không phải lời khuyên đầu tư.");

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("DejaVuSans").fontSize(8).fillColor("#5c7794");
      doc.text(`ORCA FINANCIAL · ${metadata.reportId}`, 54, 790, { width: 330, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, 420, 790, { width: 121, align: "right", lineBreak: false });
    }
    doc.end();
  });
}
