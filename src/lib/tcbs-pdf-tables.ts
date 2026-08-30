export type FinancialPdfTableKind = "income_statement" | "balance_sheet";

export interface ParsedFinancialTableRow {
  key: string;
  label: string;
  values: number[];
  sourceLine: string;
}

export interface ParsedFinancialTable {
  kind: FinancialPdfTableKind;
  title: string;
  unit: string | null;
  periods: string[];
  rows: ParsedFinancialTableRow[];
  complete: boolean;
  warnings: string[];
}

const INCOME_LABELS: Record<string, RegExp> = {
  revenue: /net revenue|revenue|doanh thu thuần|doanh thu/i,
  grossProfit: /gross profit|lợi nhuận gộp/i,
  operatingIncome: /operating profit|operating income|lợi nhuận hoạt động/i,
  pretaxIncome: /profit before tax|pretax income|lợi nhuận trước thuế/i,
  netIncome: /profit after tax|net income|lợi nhuận sau thuế/i,
};

const BALANCE_LABELS: Record<string, RegExp> = {
  cashAndEquivalents: /cash and cash equivalents|cash equivalents|tiền và các khoản tương đương tiền/i,
  receivables: /receivables|accounts receivable|phải thu/i,
  inventory: /inventories|inventory|hàng tồn kho/i,
  currentAssets: /current assets|tài sản ngắn hạn/i,
  fixedAssets: /fixed assets|tài sản cố định/i,
  totalAssets: /total assets|tổng tài sản/i,
  currentLiabilities: /current liabilities|nợ ngắn hạn/i,
  longTermDebt: /long[- ]term debt|nợ dài hạn/i,
  totalLiabilities: /total liabilities|tổng nợ phải trả/i,
  equity: /total equity|shareholders'? equity|vốn chủ sở hữu/i,
};

function numbers(line: string): number[] {
  return [...line.matchAll(/\(?-?\d[\d,.]*\)?/g)].map((match) => {
    const raw = match[0].replace(/,/g, "");
    const negative = raw.startsWith("(") && raw.endsWith(")");
    const parsed = Number(raw.replace(/[()]/g, ""));
    return negative ? -parsed : parsed;
  }).filter(Number.isFinite);
}

function periods(text: string): string[] {
  const found = [...text.matchAll(/(?:Q|quarter|quý)\s*([1-4])[^0-9]{0,10}(20\d{2})/gi)].map((match) => `Q${match[1]}/${match[2]}`);
  return [...new Set(found)];
}

function parseKind(text: string, kind: FinancialPdfTableKind): ParsedFinancialTable {
  const labels = kind === "income_statement" ? INCOME_LABELS : BALANCE_LABELS;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = Object.entries(labels).flatMap(([key, pattern]) => {
    const line = lines.find((candidate) => pattern.test(candidate));
    if (!line) return [];
    const values = numbers(line);
    if (!values.length) return [];
    return [{ key, label: line.replace(/\(?-?\d[\d,.]*\)?/g, " ").replace(/\s+/g, " ").trim(), values, sourceLine: line }];
  });
  const warnings: string[] = [];
  if (!rows.length) warnings.push(`Không nhận diện được dòng số liệu cho ${kind}.`);
  if (periods(text).length === 0) warnings.push("Không nhận diện được kỳ báo cáo từ nội dung bảng.");
  const required = kind === "income_statement" ? ["revenue", "pretaxIncome", "netIncome"] : ["totalAssets", "totalLiabilities", "equity"];
  const complete = required.every((key) => rows.some((row) => row.key === key));
  if (!complete) warnings.push(`Thiếu một hoặc nhiều dòng bắt buộc: ${required.join(", ")}.`);
  return { kind, title: kind === "income_statement" ? "Income Statement" : "Balance Sheet", unit: text.match(/(?:unit|đơn vị)\s*[:：]?\s*([^\n]+)/i)?.[1]?.trim() ?? null, periods: periods(text), rows, complete, warnings };
}

export function extractPdfTables(text: string): ParsedFinancialTable[] {
  return [parseKind(text, "income_statement"), parseKind(text, "balance_sheet")];
}

export function extractTcbsTables(text: string): ParsedFinancialTable[] {
  return extractPdfTables(text);
}

export function tableToRecord(table: ParsedFinancialTable, period: string): Record<string, number> {
  return Object.fromEntries(table.rows.map((row) => [row.key, row.values[0]]).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}
