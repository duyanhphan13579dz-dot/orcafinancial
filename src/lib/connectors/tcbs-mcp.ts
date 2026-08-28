import type { TcbsFinancialImport, TcbsFinancialQuarter } from "@/lib/connectors/tcbs-financials";

const DEFAULT_URL = "https://mcp.tcbs.com.vn/mcp/tcinvest/";
const PROTOCOL_VERSION = "2025-03-26";

type Json = Record<string, unknown>;

interface McpResponse {
  result?: Json;
  error?: { code?: number; message?: string; data?: unknown };
}

function envBool(name: string): boolean {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function endpoint(): string {
  return process.env.TCBS_MCP_URL?.trim() || DEFAULT_URL;
}

function token(): string | undefined {
  return process.env.TCBS_MCP_ACCESS_TOKEN?.trim() || undefined;
}

function parseResponse(text: string): McpResponse {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as McpResponse;
  } catch {
    const dataLine = trimmed.split("\n").map((line) => line.trim()).find((line) => line.startsWith("data:"));
    if (dataLine) return JSON.parse(dataLine.slice(5).trim()) as McpResponse;
    throw new Error("TCBS MCP returned an unsupported response format");
  }
}

async function post(message: Json, sessionId?: string): Promise<{ payload: McpResponse; sessionId?: string }> {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });
  if (token()) headers.set("authorization", `Bearer ${token()}`);
  if (sessionId) headers.set("mcp-session-id", sessionId);
  const response = await fetch(endpoint(), { method: "POST", headers, body: JSON.stringify(message), cache: "no-store" });
  const body = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`TCBS MCP authorization failed (${response.status}); complete OAuth and set TCBS_MCP_ACCESS_TOKEN`);
    }
    throw new Error(`TCBS MCP HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  return { payload: parseResponse(body), sessionId: response.headers.get("mcp-session-id") ?? sessionId };
}

function assertResult(response: McpResponse): Json {
  if (response.error) throw new Error(`TCBS MCP ${response.error.code ?? "error"}: ${response.error.message ?? "request failed"}`);
  return response.result ?? {};
}

function toolText(result: Json): unknown {
  if (Array.isArray(result.structuredContent)) return result.structuredContent;
  const content = result.content;
  if (Array.isArray(content)) {
    const text = content.find((item) => item && typeof item === "object" && (item as Json).type === "text") as Json | undefined;
    if (typeof text?.text === "string") {
      try { return JSON.parse(text.text); } catch { return text.text; }
    }
  }
  return result;
}

function argumentName(tool: Json): string {
  const properties = (((tool.inputSchema as Json | undefined)?.properties ?? {}) as Json);
  const candidates = ["symbol", "ticker", "stockCode", "code", "tickerSymbol"];
  return candidates.find((name) => properties[name] !== undefined) ?? process.env.TCBS_MCP_SYMBOL_ARGUMENT?.trim() ?? "symbol";
}

export async function tcbsMcpTools(): Promise<Json[]> {
  const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "orca-financial", version: "1.0.0" } } });
  const sessionId = initialized.sessionId;
  const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId);
  const result = assertResult(listed.payload);
  return Array.isArray(result.tools) ? result.tools as Json[] : [];
}

export async function callTcbsMcpTool(name: string, args: Json): Promise<unknown> {
  const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "orca-financial", version: "1.0.0" } } });
  const called = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, initialized.sessionId);
  return toolText(assertResult(called.payload));
}

export async function fetchTcbsMcpFinancialStatements(symbol: string): Promise<TcbsFinancialImport> {
  if (!envBool("TCBS_MCP_ENABLED")) throw new Error("TCBS_MCP_ENABLED is false");
  const tools = await tcbsMcpTools();
  const bank = envBool("TCBS_MCP_BANK");
  const names = bank
    ? { income: process.env.TCBS_MCP_BANK_INCOME_TOOL?.trim() || "getIncomeStatementForBank", balance: process.env.TCBS_MCP_BANK_BALANCE_TOOL?.trim() || "getBalanceSheetForBank", cashflow: process.env.TCBS_MCP_BANK_CASHFLOW_TOOL?.trim() || "getCashFlowForBank" }
    : { income: process.env.TCBS_MCP_INCOME_TOOL?.trim() || "getIncomeStatementForNonBank", balance: process.env.TCBS_MCP_BALANCE_TOOL?.trim() || "getBalanceSheetForNonBank", cashflow: process.env.TCBS_MCP_CASHFLOW_TOOL?.trim() || "getCashFlowForNonBank" };
  const available = new Set(tools.map((tool) => String(tool.name)));
  const calls = Object.entries(names).map(async ([section, name]) => {
    if (!available.has(name)) throw new Error(`TCBS MCP tool not found: ${name}`);
    const tool = tools.find((item) => item.name === name) ?? {};
    const argument = argumentName(tool);
    return [section, await callTcbsMcpTool(name, { [argument]: symbol.toUpperCase() })] as const;
  });
  const results = Object.fromEntries(await Promise.all(calls));
  const rows = Array.isArray(results.income) ? results.income as Json[] : [results.income as Json];
  const quarters = rows.flatMap((row, index) => {
    const fiscalYear = Number(row?.fiscalYear ?? row?.year ?? row?.calendarYear);
    const q = Number(String(row?.quarter ?? row?.period ?? row?.quy ?? "").replace(/\D/g, "")) || index + 1;
    if (!Number.isInteger(fiscalYear) || q < 1 || q > 4) return [];
    const quarter: TcbsFinancialQuarter = { period: `Q${q}/${fiscalYear}`, quarter: q, fiscalYear, income: (row.income ?? row.incomeStatement ?? row) as Record<string, number>, balance: ((Array.isArray(results.balance) ? (results.balance as Json[])[index] : results.balance) as Json ?? {}) as Record<string, number>, cashflow: ((Array.isArray(results.cashflow) ? (results.cashflow as Json[])[index] : results.cashflow) as Json ?? {}) as Record<string, number> };
    return [quarter];
  });
  if (!quarters.length) throw new Error(`TCBS MCP returned no valid financial quarters for ${symbol}`);
  return { symbol: symbol.toUpperCase(), source: "reported-api", sourceUrl: endpoint(), reportedAt: new Date().toISOString(), quarters };
}
