/**
 * On-chain intelligence layer (soft-fail).
 *
 * Sources (no paid key required):
 * - DefiLlama free API → protocol / chain TVL
 * - CoinGecko free → supply, market structure, community proxies
 * - mempool.space → Bitcoin fees & hashrate (BTC only)
 *
 * True exchange netflow / address clusters need paid providers (Glassnode,
 * CryptoQuant). We surface what is free and label estimates clearly.
 */
import { forProvider } from "@/lib/logger";
import {
  fetchWithRetry,
  getBreaker,
  readJsonSafe,
} from "@/lib/connectors/core";
import type { OnChainIntelligence } from "./types";

const log = forProvider("crypto-onchain");
const LLAMA = "defillama-onchain";
const GECKO = "coingecko-onchain";
const MEMPOOL = "mempool-onchain";

/** Map base symbol → DefiLlama protocol slug(s) when 1:1. */
const PROTOCOL_SLUG: Record<string, string> = {
  ETH: "lido", // dominant liquid staking proxy for ETH ecosystem weight
  STETH: "lido",
  SOL: "marinade-finance",
  AVAX: "aave-v3",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
  MKR: "makerdao",
  CRV: "curve-dex",
  LDO: "lido",
  ARB: "gmx",
  OP: "synthetix",
  MATIC: "aave-v3",
  POL: "aave-v3",
  BNB: "pancakeswap",
  SUI: "cetus",
  APT: "thala",
  DOT: "acala",
  ATOM: "osmosis",
  NEAR: "ref-finance",
  INJ: "helix",
  TIA: "stride",
  SEI: "astroport",
  RUNE: "thorchain",
  GMX: "gmx",
  PENDLE: "pendle",
  JUP: "jupiter",
  RAY: "raydium",
};

/** Map symbol → CoinGecko id fallback. */
const GECKO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  UNI: "uniswap",
  ATOM: "cosmos",
  LTC: "litecoin",
  NEAR: "near",
  APT: "aptos",
  SUI: "sui",
  ARB: "arbitrum",
  OP: "optimism",
  INJ: "injective-protocol",
  TIA: "celestia",
  SEI: "sei-network",
  JUP: "jupiter-exchange-solana",
  RUNE: "thorchain",
  AAVE: "aave",
  MKR: "maker",
  CRV: "curve-dao-token",
  LDO: "lido-dao",
  GMX: "gmx",
  PENDLE: "pendle",
  RAY: "raydium",
};

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

interface LlamaProtocol {
  name?: string;
  symbol?: string;
  tvl?: number;
  change_1d?: number;
  change_7d?: number;
  chainTvls?: Record<string, number>;
  category?: string;
  url?: string;
  twitter?: string;
  mcap?: number;
}

async function fetchLlamaProtocol(slug: string): Promise<{
  name: string;
  tvl: number | null;
  change1d: number | null;
  change7d: number | null;
  category: string | null;
  mcap: number | null;
  topChains: Array<{ chain: string; tvl: number }>;
} | null> {
  return getBreaker(LLAMA).exec(async () => {
    const url = `https://api.llama.fi/protocol/${encodeURIComponent(slug)}`;
    const res = await fetchWithRetry(url, {
      provider: LLAMA,
      timeoutMs: 8_000,
      retries: 1,
    });
    const data = await readJsonSafe<LlamaProtocol>(res, LLAMA, url);
    const chainEntries = Object.entries(data.chainTvls ?? {})
      .filter(([k, v]) => Number.isFinite(v) && !k.includes("-"))
      .map(([chain, tvl]) => ({ chain, tvl: Number(tvl) }))
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 5);
    return {
      name: data.name ?? slug,
      tvl: typeof data.tvl === "number" ? data.tvl : null,
      change1d: typeof data.change_1d === "number" ? data.change_1d : null,
      change7d: typeof data.change_7d === "number" ? data.change_7d : null,
      category: data.category ?? null,
      mcap: typeof data.mcap === "number" ? data.mcap : null,
      topChains: chainEntries,
    };
  });
}

async function fetchLlamaChainTvl(chain: string): Promise<number | null> {
  try {
    return await getBreaker(LLAMA).exec(async () => {
      const url = `https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(chain)}`;
      const res = await fetchWithRetry(url, {
        provider: LLAMA,
        timeoutMs: 8_000,
        retries: 1,
      });
      const rows = await readJsonSafe<Array<{ date: number; tvl: number }>>(res, LLAMA, url);
      if (!rows?.length) return null;
      return rows[rows.length - 1]?.tvl ?? null;
    });
  } catch {
    return null;
  }
}

interface GeckoOnchain {
  id: string;
  symbol: string;
  name: string;
  market_data?: {
    circulating_supply?: number;
    total_supply?: number;
    max_supply?: number;
    market_cap?: { usd?: number };
    total_volume?: { usd?: number };
    fully_diluted_valuation?: { usd?: number };
  };
  community_data?: {
    twitter_followers?: number;
    reddit_subscribers?: number;
  };
  developer_data?: {
    forks?: number;
    stars?: number;
    subscribers?: number;
    commit_count_4_weeks?: number;
  };
  tickers?: Array<{ market?: { name?: string }; volume?: number }>;
}

async function fetchGeckoMetrics(id: string): Promise<{
  circulating: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  marketCap: number | null;
  fdv: number | null;
  volume24h: number | null;
  twitterFollowers: number | null;
  redditSubscribers: number | null;
  githubStars: number | null;
  commits4w: number | null;
  exchangeConcentration: number | null;
} | null> {
  return getBreaker(GECKO).exec(async () => {
    const url =
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}` +
      `?localization=false&tickers=true&market_data=true&community_data=true&developer_data=true&sparkline=false`;
    const res = await fetchWithRetry(url, {
      provider: GECKO,
      timeoutMs: 8_000,
      retries: 1,
    });
    const d = await readJsonSafe<GeckoOnchain>(res, GECKO, url);
    const md = d.market_data;
    // Crude exchange volume concentration: top3 ticker volume / total volume
    let exchangeConcentration: number | null = null;
    if (d.tickers?.length && md?.total_volume?.usd) {
      const vols = d.tickers
        .map((t) => Number(t.volume) || 0)
        .sort((a, b) => b - a);
      const top3 = vols.slice(0, 3).reduce((a, b) => a + b, 0);
      const total = md.total_volume.usd;
      if (total > 0) exchangeConcentration = Math.min(1, top3 / total);
    }
    return {
      circulating: md?.circulating_supply ?? null,
      totalSupply: md?.total_supply ?? null,
      maxSupply: md?.max_supply ?? null,
      marketCap: md?.market_cap?.usd ?? null,
      fdv: md?.fully_diluted_valuation?.usd ?? null,
      volume24h: md?.total_volume?.usd ?? null,
      twitterFollowers: d.community_data?.twitter_followers ?? null,
      redditSubscribers: d.community_data?.reddit_subscribers ?? null,
      githubStars: d.developer_data?.stars ?? null,
      commits4w: d.developer_data?.commit_count_4_weeks ?? null,
      exchangeConcentration,
    };
  });
}

async function fetchBtcMempool(): Promise<{
  feeFast: number | null;
  feeHalfHour: number | null;
  feeHour: number | null;
  hashrateEh: number | null;
  difficulty: number | null;
} | null> {
  try {
    return await getBreaker(MEMPOOL).exec(async () => {
      const [feesRes, hrRes] = await Promise.all([
        fetchWithRetry("https://mempool.space/api/v1/fees/recommended", {
          provider: MEMPOOL,
          timeoutMs: 6_000,
          retries: 1,
        }),
        fetchWithRetry("https://mempool.space/api/v1/mining/hashrate/3d", {
          provider: MEMPOOL,
          timeoutMs: 6_000,
          retries: 1,
        }),
      ]);
      const fees = await readJsonSafe<{
        fastestFee?: number;
        halfHourFee?: number;
        hourFee?: number;
      }>(feesRes, MEMPOOL, "fees");
      const hr = await readJsonSafe<{
        currentHashrate?: number;
        currentDifficulty?: number;
      }>(hrRes, MEMPOOL, "hashrate");
      const hashrateEh =
        typeof hr.currentHashrate === "number"
          ? hr.currentHashrate / 1e18
          : null;
      return {
        feeFast: fees.fastestFee ?? null,
        feeHalfHour: fees.halfHourFee ?? null,
        feeHour: fees.hourFee ?? null,
        hashrateEh,
        difficulty: hr.currentDifficulty ?? null,
      };
    });
  } catch {
    return null;
  }
}

function buildAssessment(input: {
  symbol: string;
  tvl: number | null;
  tvlChange1d: number | null;
  circRatio: number | null;
  exchangeConc: number | null;
  commits4w: number | null;
}): string {
  const parts: string[] = [];
  if (input.tvl != null && input.tvlChange1d != null) {
    if (input.tvlChange1d > 3)
      parts.push(`TVL protocol +${input.tvlChange1d.toFixed(1)}% (1d) — vốn DeFi đang chảy vào.`);
    else if (input.tvlChange1d < -3)
      parts.push(`TVL protocol ${input.tvlChange1d.toFixed(1)}% (1d) — rút vốn DeFi.`);
    else parts.push(`TVL protocol ổn định (~${fmtUsd(input.tvl)}).`);
  }
  if (input.circRatio != null) {
    if (input.circRatio < 0.4)
      parts.push(`Circulating/supply thấp (${(input.circRatio * 100).toFixed(0)}%) — rủi ro unlock/dilution.`);
    else if (input.circRatio > 0.85)
      parts.push(`Phần lớn supply đã lưu hành (${(input.circRatio * 100).toFixed(0)}%).`);
  }
  if (input.exchangeConc != null && input.exchangeConc > 0.55)
    parts.push("Volume tập trung top sàn — thanh khoản CEX chi phối.");
  if (input.commits4w != null && input.commits4w > 0)
    parts.push(`Dev activity: ${input.commits4w} commits/4 tuần.`);
  if (!parts.length)
    return "Dữ liệu on-chain hạn chế cho symbol này (nguồn free). Kết hợp với futures/order-flow để đọc dòng tiền.";
  return parts.join(" ");
}

export async function fetchOnChainIntelligence(
  baseSymbol: string,
  opts: { coingeckoId?: string | null } = {},
): Promise<OnChainIntelligence> {
  const symbol = baseSymbol.trim().toUpperCase().replace(/USDT$/i, "");
  const errors: string[] = [];

  const geckoId = opts.coingeckoId || GECKO_ID[symbol] || null;
  const protocolSlug = PROTOCOL_SLUG[symbol] || null;

  const [protoSettled, geckoSettled, mempoolSettled, ethChainSettled] =
    await Promise.allSettled([
      protocolSlug ? fetchLlamaProtocol(protocolSlug) : Promise.resolve(null),
      geckoId ? fetchGeckoMetrics(geckoId) : Promise.resolve(null),
      symbol === "BTC" ? fetchBtcMempool() : Promise.resolve(null),
      symbol === "ETH" ? fetchLlamaChainTvl("Ethereum") : Promise.resolve(null),
    ]);

  let protocol = null;
  if (protoSettled.status === "fulfilled") protocol = protoSettled.value;
  else errors.push(`llama: ${String(protoSettled.reason).slice(0, 100)}`);

  let gecko = null;
  if (geckoSettled.status === "fulfilled") gecko = geckoSettled.value;
  else errors.push(`gecko: ${String(geckoSettled.reason).slice(0, 100)}`);

  let mempool = null;
  if (mempoolSettled.status === "fulfilled") mempool = mempoolSettled.value;
  else if (symbol === "BTC")
    errors.push(`mempool: ${String(mempoolSettled.reason).slice(0, 80)}`);

  let ethChainTvl: number | null = null;
  if (ethChainSettled.status === "fulfilled") ethChainTvl = ethChainSettled.value;

  const circ = gecko?.circulating ?? null;
  const total = gecko?.totalSupply ?? null;
  const circRatio =
    circ != null && total != null && total > 0 ? circ / total : null;

  const tvl = protocol?.tvl ?? ethChainTvl;
  const tvlChange1d = protocol?.change1d ?? null;

  const assessment = buildAssessment({
    symbol,
    tvl,
    tvlChange1d,
    circRatio,
    exchangeConc: gecko?.exchangeConcentration ?? null,
    commits4w: gecko?.commits4w ?? null,
  });

  if (errors.length) log.warn("onchain_partial", { symbol, errors: errors.slice(0, 3) });

  const available =
    tvl != null ||
    gecko != null ||
    mempool != null ||
    (protocol?.topChains?.length ?? 0) > 0;

  return {
    symbol,
    defi: {
      protocolName: protocol?.name ?? null,
      protocolSlug,
      tvl,
      tvlChange1d,
      tvlChange7d: protocol?.change7d ?? null,
      category: protocol?.category ?? null,
      protocolMcap: protocol?.mcap ?? null,
      topChains: protocol?.topChains ?? [],
      chainTvl: ethChainTvl,
    },
    supply: {
      circulating: circ,
      totalSupply: total,
      maxSupply: gecko?.maxSupply ?? null,
      circulatingRatio: circRatio,
      marketCap: gecko?.marketCap ?? null,
      fdv: gecko?.fdv ?? null,
      volume24h: gecko?.volume24h ?? null,
    },
    activity: {
      twitterFollowers: gecko?.twitterFollowers ?? null,
      redditSubscribers: gecko?.redditSubscribers ?? null,
      githubStars: gecko?.githubStars ?? null,
      commits4w: gecko?.commits4w ?? null,
      exchangeVolumeConcentration: gecko?.exchangeConcentration ?? null,
    },
    bitcoin:
      symbol === "BTC"
        ? {
            feeFastSatVb: mempool?.feeFast ?? null,
            feeHalfHourSatVb: mempool?.feeHalfHour ?? null,
            feeHourSatVb: mempool?.feeHour ?? null,
            hashrateEh: mempool?.hashrateEh ?? null,
            difficulty: mempool?.difficulty ?? null,
          }
        : null,
    assessment,
    available,
    errors,
    sources: [
      protocol ? "defillama" : null,
      gecko ? "coingecko" : null,
      mempool ? "mempool.space" : null,
    ].filter(Boolean) as string[],
    fetchedAt: new Date().toISOString(),
  };
}

export function formatOnChainForAgent(o: OnChainIntelligence): string {
  if (!o.available) return `onchain=${o.symbol}:unavailable`;
  const bits = [
    `onchain=${o.symbol}`,
    o.defi.tvl != null ? `tvl=${fmtUsd(o.defi.tvl)}` : null,
    o.defi.tvlChange1d != null ? `tvl1d=${o.defi.tvlChange1d.toFixed(1)}%` : null,
    o.supply.circulatingRatio != null
      ? `circ=${(o.supply.circulatingRatio * 100).toFixed(0)}%`
      : null,
    o.assessment.slice(0, 160),
  ].filter(Boolean);
  return bits.join(" | ");
}
