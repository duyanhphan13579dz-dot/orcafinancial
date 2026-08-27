#!/usr/bin/env node

/**
 * Import normalized reported financial statements into ORCA.
 *
 * Supported input:
 *  1. CSV file or URL with one row per quarter.
 *  2. JSON file or URL shaped as { quarters: [...] } or an array of quarters.
 *
 * CSV columns use prefixes: income_, balance_, cashflow_. Required metadata:
 * symbol, period, quarter, fiscalYear. All financial fields must be numeric.
 *
 * Examples:
 *   node scripts/import-financials.mjs --file ./fpt.csv --api-url https://app/api/v1/stocks/FPT/financials --token "$ORCA_FINANCIAL_IMPORT_TOKEN"
 *   node scripts/import-financials.mjs --url https://source/report.csv --symbol FPT --api-url ... --token "$TOKEN"
 */

import fs from "node:fs/promises";
import process from "node:process";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const value = process.argv[i];
  if (value.startsWith("--")) args.set(value.slice(2), process.argv[i + 1]?.startsWith("--") ? "" : process.argv[++i] || "");
}

const inputPath = args.get("file");
const inputUrl = args.get("url");
const apiUrl = args.get("api-url") || process.env.ORCA_FINANCIAL_IMPORT_URL;
const token = args.get("token") || process.env.ORCA_FINANCIAL_IMPORT_TOKEN;
const symbolOverride = (args.get("symbol") || "").trim().toUpperCase();
const sourceUrl = args.get("source-url") || inputUrl || undefined;
const source = args.get("source") || "reported-import";

if ((!inputPath && !inputUrl) || !apiUrl || !token) {
  console.error("Usage: --file/--url INPUT --api-url URL --token TOKEN [--symbol FPT] [--source-url URL]");
  process.exit(2);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one data row");
  const headers = rows[0].map((header) => header.replace(/^\ufeff/, "").trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

const incomeFields = ["revenue", "costOfGoodsSold", "grossProfit", "operatingExpenses", "operatingIncome", "interestExpense", "otherIncome", "pretaxIncome", "incomeTax", "netIncome", "ebitda", "depreciation", "eps", "sharesOutstanding"];
const balanceFields = ["cashAndEquivalents", "shortTermInvestments", "receivables", "inventory", "currentAssets", "fixedAssets", "longTermInvestments", "totalAssets", "currentLiabilities", "longTermDebt", "totalLiabilities", "equity", "retainedEarnings", "totalLiabilitiesEquity", "bookValuePerShare"];
const cashflowFields = ["netIncome", "depreciation", "changeWorkingCapital", "operatingCashFlow", "capex", "investingCashFlow", "debtIssuance", "dividendsPaid", "financingCashFlow", "netChangeCash", "freeCashFlow"];

function number(value, name) {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  const parsed = Number(normalized);
  if (!normalized || !Number.isFinite(parsed)) throw new Error(`Invalid numeric field ${name}`);
  return parsed;
}

function rowToQuarter(row) {
  const symbol = (symbolOverride || row.symbol || "").trim().toUpperCase();
  const quarter = Number(row.quarter || String(row.period || "").match(/Q([1-4])/i)?.[1]);
  const fiscalYear = Number(row.fiscalYear || row.fiscal_year || String(row.period || "").match(/(19|20)\d{2}/)?.[0]);
  if (!symbol || !/^Q[1-4]$/i.test(`Q${quarter}`) || !Number.isInteger(fiscalYear)) throw new Error(`Invalid period metadata in row: ${JSON.stringify(row)}`);
  const group = (prefix, fields) => Object.fromEntries(fields.map((field) => [field, number(row[`${prefix}_${field}`], `${prefix}_${field}`)]));
  return {
    period: row.period || `Q${quarter}/${fiscalYear}`,
    quarter,
    fiscalYear,
    income: group("income", incomeFields),
    balance: group("balance", balanceFields),
    cashflow: group("cashflow", cashflowFields),
  };
}

async function loadInput() {
  const text = inputUrl
    ? await (await fetch(inputUrl)).text()
    : await fs.readFile(inputPath, "utf8");
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed.quarters;
  }
  return parseCsv(trimmed).map(rowToQuarter);
}

const quarters = await loadInput();
if (!Array.isArray(quarters) || quarters.length === 0) throw new Error("No quarters found");
const symbol = symbolOverride || String(quarters[0].symbol || "").toUpperCase();
if (!symbol) throw new Error("--symbol is required for JSON input without symbol metadata");
const response = await fetch(apiUrl, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ source, sourceUrl, reportedAt: new Date().toISOString(), quarters }),
});
const body = await response.text();
if (!response.ok) {
  console.error(`Import failed: HTTP ${response.status}`);
  console.error(body.slice(0, 500));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, symbol, imported: quarters.length, response: JSON.parse(body) }, null, 2));
