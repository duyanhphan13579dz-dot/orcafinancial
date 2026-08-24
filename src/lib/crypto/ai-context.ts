/**
 * Phase 6 — ORCA AI Crypto Intelligence
 *
 * Aggregates Phase 0–5 + on-chain into a compact LLM context block.
 * Soft-fail: missing layers never block the prompt.
 */
import { forProvider } from "@/lib/logger";
import { getCryptoMarketSnapshot, getCryptoCoin } from "./service";
import { fetchOrderFlow } from "./order-flow";
import { fetchWhaleLiquidation } from "./whale-engine";
import { fetchCryptoSentimentIntelligence } from "./sentiment-engine";
import { fetchOnChainIntelligence, formatOnChainForAgent } from "./onchain";
import { formatLaunchpadForAgent, fetchLaunchpadIntelligence } from "./launchpad";
import type {
  CryptoMarketSnapshot,
  FuturesIntelligence,
  OrderFlowIntelligence,
  WhaleLiquidationIntelligence,
  CryptoSentimentIntelligence,
  OnChainIntelligence,
  LaunchpadIntelligence,
} from "./types";

const log = forProvider("crypto-ai");

const CRYPTO_BASES = new Set([
  "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "TRX", "AVAX", "DOT",
  "LINK", "MATIC", "POL", "LTC", "BCH", "ATOM", "NEAR", "APT", "SUI", "ARB",
  "OP", "INJ", "TIA", "SEI", "TON", "UNI", "AAVE", "MKR", "CRV", "LDO",
  "GMX", "PENDLE", "JUP", "RAY", "RUNE", "FIL", "ICP", "HBAR", "VET",
  "ALGO", "EGLD", "FTM", "SAND", "MANA", "AXS", "PEPE", "WIF", "BONK",
]);

export function isLikelyCryptoSymbol(sym: string): boolean {
  const s = sym.trim().toUpperCase().replace(/USDT$/i, "");
  if (CRYPTO_BASES.has(s)) return true;
  // 2–5 letter all-caps tickers often used as crypto base
  return /^[A-Z]{2,5}$/.test(s) && !["USD", "VND", "API", "CEO", "IPO", "ETF", "GDP"].includes(s);
}

export function extractCryptoSymbols(message: string, max = 2): string[] {
  const upper = message.toUpperCase();
  const found: string[] = [];
  // Explicit pairs
  for (const m of upper.matchAll(/\b([A-Z]{2,5})USDT\b/g)) {
    const b = m[1];
    if (!found.includes(b) && isLikelyCryptoSymbol(b)) found.push(b);
  }
  // Word tokens
  for (const m of upper.matchAll(/\b([A-Z]{2,5})\b/g)) {
    const b = m[1];
    if (CRYPTO_BASES.has(b) && !found.includes(b)) found.push(b);
  }
  // Vietnamese aliases
  const aliases: Record<string, string> = {
    BITCOIN: "BTC",
    ETHEREUM: "ETH",
    SOLANA: "SOL",
  };
  for (const [word, sym] of Object.entries(aliases)) {
    if (upper.includes(word) && !found.includes(sym)) found.push(sym);
  }
  return found.slice(0, max);
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(d);
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatFutures(f: FuturesIntelligence | null | undefined): string {
  if (!f?.available) return "futures:unavailable";
  return [
    `futures funding=${fmt(f.funding.ratePct, 4)}% bias=${f.funding.bias}`,
    `ls=${fmt(f.longShort.longAccountPct, 0)}/${fmt(f.longShort.shortAccountPct, 0)} ratio=${fmt(f.longShort.ratio, 2)}`,
    `oi=${fmtUsd(f.openInterest.openInterestUsd)} Δ=${fmt(f.openInterest.changePct)}% setup=${f.openInterest.setup}`,
    f.openInterest.insight?.slice(0, 120) ?? "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatOrderFlow(o: OrderFlowIntelligence | null | undefined): string {
  if (!o?.available || !o.orderBook) return "orderflow:unavailable";
  const im = o.orderBook.imbalance;
  return `orderflow bid=${fmt(im.bidPct, 0)}% ask=${fmt(im.askPct, 0)}% bias=${im.bias} whaleNet=${fmtUsd(o.whaleSummary.netFlow)}`;
}

function formatWhale(w: WhaleLiquidationIntelligence | null | undefined): string {
  if (!w?.available) return "whale:unavailable";
  return `whale buy=${fmtUsd(w.whale.buyNotional)} sell=${fmtUsd(w.whale.sellNotional)} net=${fmtUsd(w.whale.netFlow)} bias=${w.whale.bias} | ${w.assessment.slice(0, 140)}`;
}

function formatSentiment(s: CryptoSentimentIntelligence | null | undefined): string {
  if (!s?.available) return "sentiment:unavailable";
  return `sentiment ${s.label} score=${fmt(s.score, 3)} conf=${fmt(s.confidence * 100, 0)}% div=${s.divergence.code} · ${s.divergence.insight.slice(0, 100)}`;
}

export interface CryptoAiBundle {
  symbol: string;
  snapshot: CryptoMarketSnapshot | null;
  orderFlow: OrderFlowIntelligence | null;
  whale: WhaleLiquidationIntelligence | null;
  sentimentIntel: CryptoSentimentIntelligence | null;
  onChain: OnChainIntelligence | null;
  launchpad: LaunchpadIntelligence | null;
  contextBlock: string;
  layersOk: string[];
  layersFailed: string[];
}

async function timed<T>(
  label: string,
  ms: number,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`${label}_timeout`)), ms),
      ),
    ]);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 100) };
  }
}

/** Full multi-layer crypto context for one symbol (Phase 6). */
export async function buildCryptoAiBundle(
  symbol: string,
  opts: { includeLaunchpad?: boolean } = {},
): Promise<CryptoAiBundle> {
  const sym = symbol.trim().toUpperCase().replace(/USDT$/i, "");
  const layersOk: string[] = [];
  const layersFailed: string[] = [];

  const [snapR, ofR, whaleR, sentR, onR, launchR] = await Promise.all([
    timed("snapshot", 8_000, () => getCryptoMarketSnapshot(sym, "1h")),
    timed("orderflow", 6_000, () => fetchOrderFlow(sym)),
    timed("whale", 8_000, () => fetchWhaleLiquidation(sym)),
    timed("sentiment", 10_000, () => fetchCryptoSentimentIntelligence(sym)),
    timed("onchain", 10_000, async () => {
      let cg: string | null = null;
      try {
        const d = await getCryptoCoin(sym);
        cg = (d?.coin as { coingeckoId?: string | null })?.coingeckoId ?? null;
      } catch {
        /* */
      }
      return fetchOnChainIntelligence(sym, { coingeckoId: cg });
    }),
    opts.includeLaunchpad
      ? timed("launchpad", 8_000, () => fetchLaunchpadIntelligence())
      : Promise.resolve({ ok: false as const, error: "skipped" }),
  ]);

  const snapshot = snapR.ok ? snapR.value : null;
  if (snapR.ok) layersOk.push("snapshot");
  else layersFailed.push(`snapshot:${snapR.error}`);

  const orderFlow = ofR.ok ? ofR.value : null;
  if (ofR.ok && ofR.value.available) layersOk.push("orderflow");
  else if (!ofR.ok) layersFailed.push(`orderflow:${ofR.error}`);

  const whale = whaleR.ok ? whaleR.value : null;
  if (whaleR.ok && whaleR.value.available) layersOk.push("whale");
  else if (!whaleR.ok) layersFailed.push(`whale:${whaleR.error}`);

  const sentimentIntel = sentR.ok ? sentR.value : null;
  if (sentR.ok && sentR.value.available) layersOk.push("sentiment");
  else if (!sentR.ok) layersFailed.push(`sentiment:${sentR.error}`);

  const onChain = onR.ok ? onR.value : null;
  if (onR.ok && onR.value.available) layersOk.push("onchain");
  else if (!onR.ok) layersFailed.push(`onchain:${onR.error}`);

  const launchpad = launchR.ok ? launchR.value : null;
  if (launchR.ok && launchR.value.available) layersOk.push("launchpad");

  const lines: string[] = [];
  lines.push(`=== ORCA CRYPTO INTEL ${sym} ===`);

  if (snapshot) {
    lines.push(
      `spot price=${fmt(snapshot.spot.price, snapshot.spot.price && snapshot.spot.price < 1 ? 6 : 2)} d1=${fmt(snapshot.spot.change24h)}% vol=${fmtUsd(snapshot.spot.volume24h)} mcap=${fmtUsd(snapshot.spot.marketCap)}`,
    );
    if (snapshot.technical) {
      lines.push(
        `tech rec=${snapshot.technical.recommendation} conf=${fmt((snapshot.technical.confidence ?? 0) * 100, 0)}% · ${(snapshot.technical.reasons ?? []).slice(0, 3).join("; ")}`,
      );
    }
    if (snapshot.sentiment) {
      lines.push(`rss_sentiment=${snapshot.sentiment.label} score=${fmt(snapshot.sentiment.score, 3)}`);
    }
    lines.push(formatFutures(snapshot.futures));
  } else {
    lines.push("snapshot:unavailable");
  }

  lines.push(formatOrderFlow(orderFlow));
  lines.push(formatWhale(whale));
  lines.push(formatSentiment(sentimentIntel));
  if (onChain) lines.push(formatOnChainForAgent(onChain));
  else lines.push("onchain:unavailable");
  if (launchpad?.available) lines.push(formatLaunchpadForAgent(launchpad));

  lines.push(
    "guidance: Combine funding/OI + order imbalance + whale net + social divergence + on-chain TVL. Do NOT invent numbers. State uncertainty when layers missing. Not financial advice.",
  );
  lines.push(`layers_ok=${layersOk.join(",") || "none"}`);

  const contextBlock = lines.join("\n");
  log.info("crypto_ai_bundle", {
    symbol: sym,
    layersOk,
    layersFailed: layersFailed.slice(0, 4),
    chars: contextBlock.length,
  });

  return {
    symbol: sym,
    snapshot,
    orderFlow,
    whale,
    sentimentIntel,
    onChain,
    launchpad,
    contextBlock,
    layersOk,
    layersFailed,
  };
}

/** Multi-symbol context string for agent prompt. */
export async function buildCryptoAiContextForAgent(
  symbols: string[],
  message: string,
): Promise<{ block: string; symbols: string[]; layersOk: string[] }> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 2);
  if (!unique.length) {
    // still try extract from message
    unique.push(...extractCryptoSymbols(message, 2));
  }
  if (!unique.length) return { block: "", symbols: [], layersOk: [] };

  const includeLaunch =
    /launchpool|launchpad|listing|niêm\s*yết|airdrop|hodler/i.test(message);

  const bundles = await Promise.all(
    unique.map((s) => buildCryptoAiBundle(s, { includeLaunchpad: includeLaunch })),
  );

  const block = bundles.map((b) => b.contextBlock).join("\n\n").slice(0, 4500);
  const layersOk = [...new Set(bundles.flatMap((b) => b.layersOk))];
  return { block, symbols: unique, layersOk };
}
