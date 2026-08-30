import { fetchVndirectFinancialStatements, VndirectFinancialImport, VndirectFinancialQuarter } from "@/lib/connectors/vndirect-financials";

export type { VndirectFinancialQuarter, VndirectFinancialImport };

export async function fetchFinancialStatementsFromVndirect(symbol: string): Promise<VndirectFinancialImport> {
  return fetchVndirectFinancialStatements(symbol);
}

export async function fetchTcbsFinancialStatements(symbol: string): Promise<VndirectFinancialImport> {
  return fetchVndirectFinancialStatements(symbol);
}
