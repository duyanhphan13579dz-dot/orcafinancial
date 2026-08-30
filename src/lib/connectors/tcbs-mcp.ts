import type { VndirectFinancialImport, VndirectFinancialQuarter } from "@/lib/connectors/vndirect-financials";

type Json = Record<string, unknown>;

export async function fetchTcbsMcpFinancialStatements(symbol: string): Promise<VndirectFinancialImport> {
  const { fetchVndirectFinancialStatements } = await import("@/lib/connectors/vndirect-financials");
  return fetchVndirectFinancialStatements(symbol);
}
