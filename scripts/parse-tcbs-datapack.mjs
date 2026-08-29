#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const file = process.argv[2];
const url = process.env.TCBS_DATAPACK_SOURCE_URL || "";
const symbol = (process.env.TCBS_CRAWL_SYMBOL || "TCX").toUpperCase();
const period = process.env.TCBS_DATAPACK_PERIOD || "Q2/2026";
if (!file) throw new Error("Usage: node scripts/parse-tcbs-datapack.mjs <file.xlsx>");

const numeric = (value) => {
  if (value === null || value === undefined || value === "" || value === "-") return 0;
  const raw = String(value).trim().replace(/,/g, "");
  const negative = raw.startsWith("(") && raw.endsWith(")");
  const parsed = Number(raw.replace(/[()]/g, ""));
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : undefined;
};
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const findSheet = (wb, patterns) => wb.SheetNames.find((name) => patterns.some((pattern) => pattern.test(name)));
const rowText = (row) => row.slice(0, 3).map(clean).join(" | ");
const findRow = (rows, patterns) => rows.find((row) => patterns.some((pattern) => pattern.test(rowText(row))));

function parseStatement(rows, statementType, fields) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /CHỈ TIÊU|Items/i.test(clean(cell))));
  if (headerIndex < 0) throw new Error(`${statementType}: header not found`);
  const header = rows[headerIndex];
  const nextHeader = rows[headerIndex + 1] ?? [];
  const periodMatch = /^Q([1-4])\/(\d{4})$/i.exec(period.trim());
  const qNum = periodMatch ? Number(periodMatch[1]) : 2;
  const qYear = periodMatch ? periodMatch[2] : "2026";
  const endMonth = String(qNum * 3).padStart(2, "0");
  const columnRegex = new RegExp(`${qYear}|${endMonth}\\/${qYear}|3[01]\\/${endMonth}|quý\\s*${qNum}`, "i");
  const currentColumn = header.findIndex((cell, index) => columnRegex.test(clean(cell)) || (/năm nay/i.test(clean(nextHeader[index])) && index >= 3));
  if (currentColumn < 0) throw new Error(`${statementType}: ${period} column not found`);
  const data = {};
  const evidence = {};
  for (const [key, patterns] of Object.entries(fields)) {
    const row = findRow(rows.slice(headerIndex + 1), patterns);
    if (!row) continue;
    const value = numeric(row[currentColumn]);
    if (value === undefined) continue;
    data[key] = value;
    evidence[key] = { sourceValue: value, normalizedValue: value, label: rowText(row) };
  }
  const required = statementType === "income" ? ["revenue", "pretaxIncome", "netIncome"] : ["totalAssets", "totalLiabilities", "equity"];
  return {
    statementType,
    period,
    fiscalYear: Number(period.slice(-4)),
    reportScope: "consolidated",
    currency: "VND",
    unit: clean(rows.slice(0, headerIndex).flat().find((cell) => /VND|VNĐ/i.test(clean(cell))) || "VND"),
    data,
    evidence,
    complete: required.every((key) => key in data),
    warnings: required.filter((key) => !(key in data)).map((key) => `Thiếu dòng bắt buộc ${key}`),
  };
}

const workbook = XLSX.read(await readFile(file), { type: "buffer", raw: false, cellDates: true });
const balanceName = findSheet(workbook, [/tình hình tài chính/i, /balance sheet/i]);
const incomeName = findSheet(workbook, [/kết quả hoạt động/i, /income statement/i]);
if (!balanceName || !incomeName) throw new Error(`Không tìm thấy sheet BCTC: ${workbook.SheetNames.join(", ")}`);
const rows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: null });
const income = parseStatement(rows(incomeName), "income", {
  revenue: [/total operating income|cộng doanh thu hoạt động/i],
  grossProfit: [/gross profit|lợi nhuận gộp/i],
  operatingIncome: [/operating profit|kết quả hoạt động/i],
  pretaxIncome: [/profit before tax|lợi nhuận kế toán trước thuế/i],
  netIncome: [/profit after tax|lợi nhuận kế toán sau thuế/i],
});
const balance = parseStatement(rows(balanceName), "balance", {
  cashAndEquivalents: [/cash and cash equivalents|tiền và các khoản tương đương tiền/i],
  currentAssets: [/current assets|tài sản ngắn hạn/i],
  fixedAssets: [/fixed assets|tài sản cố định/i],
  totalAssets: [/total assets|tổng tài sản/i],
  currentLiabilities: [/current liabilities|nợ ngắn hạn/i],
  totalLiabilities: [/total liabilities|tổng nợ phải trả/i],
  equity: [/total equity|shareholders'? equity|vốn chủ sở hữu/i],
});
const raw = await readFile(file);
const document = {
  source: "tcbs",
  symbol,
  documentType: "financial_statement",
  documentUrl: url || `file://${file}`,
  reportType: "tcbs_excel_data_pack",
  period,
  fiscalYear: Number(period.slice(-4)),
  filingDate: new Date().toISOString(),
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  payload: { file, sha256: createHash("sha256").update(raw).digest("hex"), workbookSheets: workbook.SheetNames, source: "TCBS Investor Relations Excel Data Pack", tables: { income, balance } },
  sourceContent: JSON.stringify({ workbookSheets: workbook.SheetNames, income, balance }),
  facts: [income, balance].map(({ complete, warnings, ...fact }) => fact),
  quality: { complete: income.complete && balance.complete, warnings: [...income.warnings, ...balance.warnings] },
};
const output = process.env.TCBS_DATAPACK_OUTPUT || `${file}.json`;
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, symbol, period, sheets: workbook.SheetNames, incomeComplete: income.complete, balanceComplete: balance.complete, facts: document.facts.map((fact) => ({ statementType: fact.statementType, fields: Object.keys(fact.data) })), output }));
