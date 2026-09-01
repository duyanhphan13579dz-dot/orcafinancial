/** TCBS mock removed — stubs keep market.ts compiling; always disabled. */
import type { Quote } from "@/lib/connectors/core";

export function isTcbsMockEnabled(): boolean {
  return false;
}

export function tcbsMockQuote(symbol: string): Quote {
  throw new Error(`TCBS mock is disabled (${symbol})`);
}
