const INCOME_LABELS = {
  revenue: /net revenue|revenue|doanh thu thuần|doanh thu/i,
  grossProfit: /gross profit|lợi nhuận gộp/i,
  operatingIncome: /operating profit|operating income|lợi nhuận hoạt động/i,
  pretaxIncome: /profit before tax|pretax income|lợi nhuận trước thuế/i,
  netIncome: /profit after tax|net income|lợi nhuận sau thuế/i,
};
const BALANCE_LABELS = {
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
function numbers(line) {
  return [...line.matchAll(/\(?-?\d[\d,.]*\)?/g)].map((match) => {
    const raw = match[0].replace(/,/g, "");
    const negative = raw.startsWith("(") && raw.endsWith(")");
    const parsed = Number(raw.replace(/[()]/g, ""));
    return negative ? -parsed : parsed;
  }).filter(Number.isFinite);
}
function periods(text) {
  return [...new Set([...text.matchAll(/(?:Q|quarter|quý)\s*([1-4])[^0-9]{0,10}(20\d{2})/gi)].map((match) => `Q${match[1]}/${match[2]}`))];
}
function parseKind(text, kind) {
  const labels = kind === "income_statement" ? INCOME_LABELS : BALANCE_LABELS;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = Object.entries(labels).flatMap(([key, pattern]) => {
    const line = lines.find((candidate) => pattern.test(candidate));
    if (!line) return [];
    const values = numbers(line);
    return values.length ? [{ key, label: line.replace(/\(?-?\d[\d,.]*\)?/g, " ").replace(/\s+/g, " ").trim(), values, sourceLine: line }] : [];
  });
  const required = kind === "income_statement" ? ["revenue", "pretaxIncome", "netIncome"] : ["totalAssets", "totalLiabilities", "equity"];
  const warnings = [];
  if (!rows.length) warnings.push(`Không nhận diện được dòng số liệu cho ${kind}.`);
  if (!periods(text).length) warnings.push("Không nhận diện được kỳ báo cáo từ nội dung bảng.");
  if (!required.every((key) => rows.some((row) => row.key === key))) warnings.push(`Thiếu dòng bắt buộc: ${required.join(", ")}.`);
  return { kind, title: kind === "income_statement" ? "Income Statement" : "Balance Sheet", unit: text.match(/(?:unit|đơn vị)\s*[:：]?\s*([^\n]+)/i)?.[1]?.trim() ?? null, periods: periods(text), rows, complete: warnings.length === 0, warnings };
}
export function extractTcbsTables(text) { return [parseKind(text, "income_statement"), parseKind(text, "balance_sheet")]; }
