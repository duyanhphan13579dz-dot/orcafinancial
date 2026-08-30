import { fallbackQuote, VNDIRECT_MOCK_SOURCE } from "@/lib/connectors/vndirect-mock";

export { fallbackQuote };
export const tcbsMockQuote = fallbackQuote;
export const TCBS_MOCK_SOURCE = VNDIRECT_MOCK_SOURCE;

export function isTcbsMockEnabled(): boolean {
  return false;
}
