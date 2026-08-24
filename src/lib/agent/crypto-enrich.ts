/**
 * Phase 6 — inject ORCA crypto intelligence into agent data context.
 */
import {
  buildCryptoAiContextForAgent,
  extractCryptoSymbols,
  isLikelyCryptoSymbol,
} from "@/lib/crypto/ai-context";
import { logger } from "@/lib/logger";

export async function enrichAgentWithCrypto(
  message: string,
  stockCandidates: string[],
): Promise<{
  cryptoSymbols: string[];
  block: string;
  layersOk: string[];
}> {
  const fromMsg = extractCryptoSymbols(message, 2);
  const fromCandidates = stockCandidates.filter(isLikelyCryptoSymbol);
  const symbols = [...new Set([...fromMsg, ...fromCandidates])].slice(0, 2);

  if (!symbols.length && !/crypto|bitcoin|ethereum|solana|binance|funding|open interest|whale|launchpool/i.test(message)) {
    return { cryptoSymbols: [], block: "", layersOk: [] };
  }

  // Default BTC if user asks generic crypto without ticker
  const targets =
    symbols.length > 0
      ? symbols
      : /crypto|bitcoin|binance|funding|whale|launchpool/i.test(message)
        ? ["BTC"]
        : [];

  if (!targets.length) return { cryptoSymbols: [], block: "", layersOk: [] };

  try {
    const result = await Promise.race([
      buildCryptoAiContextForAgent(targets, message),
      new Promise<{ block: string; symbols: string[]; layersOk: string[] }>((_, rej) =>
        setTimeout(() => rej(new Error("crypto_enrich_timeout")), 12_000),
      ),
    ]);
    logger.info("agent_crypto_enriched", {
      symbols: result.symbols,
      layersOk: result.layersOk,
      chars: result.block.length,
    });
    return {
      cryptoSymbols: result.symbols,
      block: result.block,
      layersOk: result.layersOk,
    };
  } catch (e) {
    logger.warn("agent_crypto_enrich_failed", {
      error: e instanceof Error ? e.message : String(e),
      targets,
    });
    return { cryptoSymbols: targets, block: "", layersOk: [] };
  }
}
