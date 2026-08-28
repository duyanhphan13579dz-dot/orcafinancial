#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

const required = (name) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; };
const url = required("TCBS_DATAPACK_URL");
const appUrl = required("ORCA_APP_URL").replace(/\/$/, "");
const secret = required("FINANCIAL_AUDIT_SECRET");
const symbol = (process.env.TCBS_CRAWL_SYMBOL || "TCX").trim().toUpperCase();
const period = process.env.TCBS_DATAPACK_PERIOD?.trim() || "Q2/2026";
const dryRun = process.env.TCBS_DATAPACK_DRY_RUN === "true" || process.env.TCBS_DATAPACK_DRY_RUN === "1";
const lockDir = process.env.TCBS_DATAPACK_LOCK_DIR?.trim() || join(tmpdir(), "orca-tcbs-datapack.lock");
const maxBytes = Number(process.env.TCBS_CRAWL_MAX_BYTES || 15_000_000);
const retries = Math.min(5, Math.max(1, Number(process.env.TCBS_WORKER_RETRIES || 3)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withLock() {
  try { await mkdir(lockDir); } catch { throw new Error(`quarterly worker already locked: ${lockDir}`); }
  return async () => { await rm(lockDir, { recursive: true, force: true }); };
}
async function fetchWorkbook() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.TCBS_WORKER_HTTP_TIMEOUT_MS || 60000));
  let response;
  try {
    response = await fetch(url, { headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "user-agent": "ORCA-TCBS-DataPack-Worker/1.0" }, cache: "no-store", signal: controller.signal });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error(`Data Pack download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Data Pack exceeds ${maxBytes} bytes`);
  if (bytes.subarray(0, 2).toString() !== "PK") throw new Error("Downloaded file is not an XLSX zip package");
  return bytes;
}
async function main() {
  const unlock = await withLock();
  const work = await mkdtemp(join(tmpdir(), "orca-tcbs-worker-"));
  try {
    const bytes = await fetchWorkbook();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const xlsx = join(work, `${symbol}-${period.replace(/[^A-Z0-9]+/gi, "-")}.xlsx`);
    const parsed = join(work, "parsed.json");
    await writeFile(xlsx, bytes, { mode: 0o600 });
    await execFileAsync(process.execPath, ["scripts/parse-tcbs-datapack.mjs", xlsx], { cwd: process.cwd(), env: { ...process.env, TCBS_CRAWL_SYMBOL: symbol, TCBS_DATAPACK_PERIOD: period, TCBS_DATAPACK_SOURCE_URL: url, TCBS_DATAPACK_OUTPUT: parsed } });
    const document = JSON.parse(await readFile(parsed, "utf8"));
    if (!document.quality?.complete || document.facts?.length !== 2) throw new Error(`quality gate failed: ${JSON.stringify(document.quality ?? {})}`);
    if (dryRun) { console.log(JSON.stringify({ ok: true, dryRun: true, symbol, period, sha256: hash, facts: document.facts.map((fact) => ({ statementType: fact.statementType, fields: Object.keys(fact.data) })) })); return; }
    let lastError = "";
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Number(process.env.TCBS_WORKER_HTTP_TIMEOUT_MS || 60000));
        const response = await fetch(`${appUrl}/api/internal/financial-ingest/datapack`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify({ documents: [{ ...document, payload: { ...document.payload, workerSha256: hash } }] }), cache: "no-store", signal: controller.signal });
        clearTimeout(timeout);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`database import failed: HTTP ${response.status} ${payload.error || ""}`);
        console.log(JSON.stringify({ ok: true, dryRun: false, symbol, period, sha256: hash, attempt, result: payload }));
        return;
      } catch (error) { lastError = error instanceof Error ? error.message : String(error); if (attempt < retries) await sleep(attempt * 2_000); }
    }
    throw new Error(lastError);
  } finally { await rm(work, { recursive: true, force: true }); await unlock(); }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
