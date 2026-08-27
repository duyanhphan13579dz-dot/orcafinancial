import { describe, expect, it } from "vitest";
import { validateFact, type SourceDocument, type SourceFact } from "@/lib/financial-ingestion";

const document: SourceDocument = {
  source: "cafef",
  symbol: "VND",
  documentType: "financial_statement",
  documentUrl: "https://example.com/vnd-q2-2026.pdf",
  sourceContent: "Báo cáo tài chính Q2/2026",
  payload: { id: "vnd-q2-2026" },
};

function fact(overrides: Partial<SourceFact> = {}): SourceFact {
  return {
    statementType: "income",
    period: "Q2/2026",
    fiscalYear: 2026,
    reportScope: "consolidated",
    data: { revenue: 1000 },
    evidence: { revenue: { sourceValue: 1000, normalizedValue: 1000 } },
    ...overrides,
  };
}

describe("financial source reconciliation gate", () => {
  it("accepts a fact only when source and normalized values agree", () => {
    expect(validateFact(document, fact()).reason).toBeUndefined();
  });

  it("rejects a fact without source document content", () => {
    expect(validateFact({ ...document, sourceContent: undefined }, fact()).reason).toContain("nội dung báo cáo gốc");
  });

  it("rejects a fact without evidence mapping", () => {
    expect(validateFact(document, fact({ evidence: undefined })).reason).toContain("bảng đối soát");
  });

  it("rejects a mismatched source value", () => {
    expect(validateFact(document, fact({ evidence: { revenue: { sourceValue: 1000, normalizedValue: 900 } } })).reason).toContain("Sai lệch đối soát");
  });
});
