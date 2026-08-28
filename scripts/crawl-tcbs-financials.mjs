#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { extractTcbsTables } from "./tcbs-pdf-tables.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INDEX_URL = process.env.TCBS_IR_URL?.trim() || "https://www.tcbs.com.vn/en/investors/";
const OUTPUT_DIR = process.env.TCBS_CRAWL_OUTPUT_DIR?.trim() || "data/tcbs-financials";
const SYMBOL = (process.env.TCBS_CRAWL_SYMBOL?.trim() || "TCX").toUpperCase();
const MAX_DOCUMENTS = Math.min(30, Math.max(1, Number(process.env.TCBS_CRAWL_MAX_DOCUMENTS || 12)));
const MAX_BYTES = Math.min(25_000_000, Math.max(100_000, Number(process.env.TCBS_CRAWL_MAX_BYTES || 15_000_000)));
const USER_AGENT = "ORCA-Financial-TCBS-IR-Crawler/1.0 (+authorized-public-document-retrieval)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const absolute = (href) => new URL(href, INDEX_URL).toString();
const allowedHost = (url) => new URL(url).hostname === new URL(INDEX_URL).hostname;
const isStatementLink = (url, label) => {
  const value = `${url} ${label}`.toLowerCase();
  if (!/\.pdf(?:\?|$)/i.test(url)) return false;
  if (/(corporate[-_ ]presentation|prospectus|ipo|company[-_ ]profile)/i.test(value)) return false;
  return /(financial[-_ ]statement|financials|bctc|earnings report|quarterly report|annual report)/i.test(value);
};

function periodFromText(text) {
  const normalized = text.replace(/\s+/g, " ");
  const quarter = normalized.match(/(?:Q|quarter|quý)\s*([1-4])[^0-9]{0,12}(20\d{2})/i) || normalized.match(/(20\d{2})[^0-9]{0,8}(?:Q|quarter|quý)\s*([1-4])/i);
  if (quarter) {
    const q = quarter[1].match(/^\d$/) ? quarter[1] : quarter[2];
    const year = quarter[1].match(/^\d$/) ? quarter[2] : quarter[1];
    return `Q${q}/${year}`;
  }
  const year = normalized.match(/(?:20\d{2})/);
  return year ? `FY/${year[0]}` : null;
}

function extractLinks(html) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = match[1].replace(/&amp;/g, "&");
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    try {
      const url = absolute(href);
      if (allowedHost(url) && isStatementLink(url, label)) links.push({ url, label });
    } catch { /* ignore malformed links */ }
  }
  return [...new Map(links.map((item) => [item.url, item])).values()].slice(0, MAX_DOCUMENTS);
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { accept: "application/pdf, text/html", "user-agent": USER_AGENT }, redirect: "follow" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_BYTES) throw new Error(`document exceeds ${MAX_BYTES} bytes`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error(`document exceeds ${MAX_BYTES} bytes`);
  return { buffer, contentType: response.headers.get("content-type") || "application/pdf" };
}

async function pdfText(file) {
  const { stdout } = await execFileAsync("pdftotext", ["-layout", file, "-"]); 
  return stdout;
}

function extractTextFacts(text) {
  const facts = [];
  const patterns = {
    revenue: [/net revenue|revenue|doanh thu thuần|doanh thu/i],
    grossProfit: [/gross profit|lợi nhuận gộp/i],
    operatingIncome: [/operating profit|operating income|lợi nhuận hoạt động/i],
    pretaxIncome: [/profit before tax|pretax income|lợi nhuận trước thuế/i],
    netIncome: [/profit after tax|net income|lợi nhuận sau thuế/i],
    operatingCashFlow: [/net cash from operating activities|dòng tiền từ hoạt động kinh doanh/i],
    investingCashFlow: [/net cash from investing activities|dòng tiền từ hoạt động đầu tư/i],
    financingCashFlow: [/net cash from financing activities|dòng tiền từ hoạt động tài chính/i],
  };
  for (const [key, labels] of Object.entries(patterns)) {
    const line = text.split(/\r?\n/).find((candidate) => labels.some((label) => label.test(candidate)));
    if (!line) continue;
    const numbers = [...line.matchAll(/(?:\(|-)?\d[\d,.]*(?:\)|\d)/g)].map((m) => Number(m[0].replace(/[(),]/g, (c) => c === "(" ? "-" : "").replace(/,/g, ""))).filter(Number.isFinite);
    const value = numbers.at(-1);
    if (value !== undefined) facts.push({ key, value, sourceLine: line.trim() });
  }
  return facts;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const indexResponse = await fetch(INDEX_URL, { headers: { accept: "text/html", "user-agent": USER_AGENT }, redirect: "follow" });
  if (!indexResponse.ok) throw new Error(`Investor Relations index failed: HTTP ${indexResponse.status}`);
  const html = await indexResponse.text();
  const configured = (process.env.TCBS_CRAWL_DOCUMENT_URLS ?? "").split(",").map((url) => url.trim()).filter(Boolean).map((url) => ({ url, label: "configured financial statement" }));
  const candidates = [...new Map([...configured, ...extractLinks(html)].filter((item) => allowedHost(item.url) && isStatementLink(item.url, item.label)).map((item) => [item.url, item])).values()].slice(0, MAX_DOCUMENTS);
  if (!candidates.length) throw new Error("No allowed BCTC PDF links found on Investor Relations page");
  const documents = [];
  for (const candidate of candidates) {
    await sleep(Number(process.env.TCBS_CRAWL_DELAY_MS || 750));
    try {
      const { buffer, contentType } = await fetchBytes(candidate.url);
      const hash = sha256(buffer);
      const file = join(OUTPUT_DIR, `${hash}.pdf`);
      await writeFile(file, buffer, { flag: "wx" }).catch(() => {});
      const text = await pdfText(file);
      const period = periodFromText(`${candidate.label} ${basename(new URL(candidate.url).pathname)} ${text.slice(0, 5000)}`);
      const extractedFacts = extractTextFacts(text);
      const tables = extractTcbsTables(text);
      const record = { source: "tcbs", symbol: SYMBOL, documentType: "financial_statement", documentUrl: candidate.url, reportType: "tcbs_investor_relations", period, contentType, payload: { title: candidate.label, file, sha256: hash, extractedFacts, tables }, sourceContent: text };
      documents.push(record);
      await writeFile(join(OUTPUT_DIR, `${hash}.json`), `${JSON.stringify(record, null, 2)}\n`);
    } catch (error) {
      documents.push({ source: "tcbs", symbol: SYMBOL, documentType: "financial_statement", documentUrl: candidate.url, payload: {}, warning: error instanceof Error ? error.message : String(error) });
    }
  }
  const manifest = { ok: true, source: "tcbs", symbol: SYMBOL, indexUrl: INDEX_URL, crawledAt: new Date().toISOString(), documentCount: documents.length, documents };
  await writeFile(join(OUTPUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, symbol: SYMBOL, indexUrl: INDEX_URL, discovered: candidates.length, processed: documents.length, outputDir: OUTPUT_DIR, manifest: join(OUTPUT_DIR, "manifest.json"), note: "Extracted facts require validation against statement columns before import; no values are silently promoted to reported facts." }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
