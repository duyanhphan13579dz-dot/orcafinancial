import { forProvider } from "@/lib/logger";
import { cryptoSentimentScore } from "./analysis";
import { fetchCryptoNews, type CryptoNewsItem } from "./connectors";
import { fetchFuturesIntelligence } from "./futures";
import { scoreCryptoSentimentHybrid } from "./sentiment-hybrid";
import type {
  CryptoSentimentIntelligence,
  SentimentDistribution,
  SentimentDivergence,
  SentimentLabel,
} from "./types";

const log = forProvider("crypto-sentiment-engine");

const POSITIVE = [
  "surge", "rally", "bullish", "approval", "adoption", "record high", "inflow",
  "upgrade", "partnership", "launch", "gain", "breakout", "ath", "etf",
  "accumulate", "institutional", "positive", "soar", "pump",
];
const NEGATIVE = [
  "hack", "exploit", "bearish", "ban", "lawsuit", "crash", "liquidation",
  "outflow", "fraud", "scam", "decline", "sell-off", "dump", "sec", "probe",
  "bankrupt", "collapse", "risk", "warning", "delist",
];

function scoreArticle(text: string): number {
  const t = text.toLowerCase();
  let s = 0;
  let hits = 0;
  for (const w of POSITIVE) {
    if (t.includes(w)) {
      s += 1;
      hits++;
    }
  }
  for (const w of NEGATIVE) {
    if (t.includes(w)) {
      s -= 1;
      hits++;
    }
  }
  if (!hits) return 0;
  return Math.max(-1, Math.min(1, s / Math.max(2, Math.sqrt(hits) * 2)));
}

function labelFromScore(score: number): SentimentLabel {
  if (score > 0.25) return "BULLISH";
  if (score < -0.25) return "BEARISH";
  return "NEUTRAL";
}

function buildDistribution(
  articleScores: number[],
): SentimentDistribution {
  if (!articleScores.length) {
    return { bullishPct: 33, neutralPct: 34, bearishPct: 33, sampleSize: 0 };
  }
  let bull = 0;
  let neut = 0;
  let bear = 0;
  for (const s of articleScores) {
    if (s > 0.15) bull++;
    else if (s < -0.15) bear++;
    else neut++;
  }
  const n = articleScores.length;
  return {
    bullishPct: Math.round((bull / n) * 100),
    neutralPct: Math.round((neut / n) * 100),
    bearishPct: Math.round((bear / n) * 100),
    sampleSize: n,
  };
}

function analyzeDivergence(input: {
  priceChange24h: number | null;
  fundingBias: string | null;
  oiSetup: string | null;
  oiChangePct: number | null;
  sentimentLabel: SentimentLabel;
  sentimentScore: number;
}): SentimentDivergence {
  const {
    priceChange24h,
    fundingBias,
    oiSetup,
    oiChangePct,
    sentimentLabel,
    sentimentScore,
  } = input;

  const priceUp = (priceChange24h ?? 0) > 1.5;
  const priceDown = (priceChange24h ?? 0) < -1.5;
  const sentBull = sentimentLabel === "BULLISH" || sentimentScore > 0.25;
  const sentBear = sentimentLabel === "BEARISH" || sentimentScore < -0.25;
  const fundingLong = fundingBias === "LONG_CROWDED";
  const fundingShort = fundingBias === "SHORT_CROWDED";
  const oiUp = (oiChangePct ?? 0) > 0.5 || oiSetup === "LONG_BUILDUP" || oiSetup === "SHORT_BUILDUP";

  // Crowded long / overheating
  if (priceUp && sentBull && (fundingLong || oiSetup === "LONG_BUILDUP")) {
    return {
      code: "CROWDED_LONG",
      severity: "HIGH",
      title: "Crowded Long / Overheating Risk",
      insight:
        `Giá đang tăng (${(priceChange24h ?? 0).toFixed(1)}%) trong khi sentiment BULLISH` +
        `${fundingLong ? ", funding Long crowded" : ""}` +
        `${oiSetup === "LONG_BUILDUP" ? ", OI long buildup" : ""}. Rủi ro overheating / long squeeze nếu đảo chiều.`,
    };
  }

  // Short buildup
  if (priceDown && (fundingShort || oiSetup === "SHORT_BUILDUP") && (sentBear || oiUp)) {
    return {
      code: "SHORT_BUILDUP",
      severity: "HIGH",
      title: "Short buildup",
      insight:
        `Giá giảm (${(priceChange24h ?? 0).toFixed(1)}%) kèm OI/funding nghiêng Short` +
        `${sentBear ? " và sentiment BEARISH" : ""}. Dòng tiền phái sinh đang nghiêng về Short.`,
    };
  }

  // Bullish divergence: price down but sentiment improving / not bearish
  if (priceDown && sentBull) {
    return {
      code: "BULLISH_DIVERGENCE",
      severity: "MEDIUM",
      title: "Sentiment–Price divergence (bullish)",
      insight:
        `Giá giảm nhưng tin tức/sentiment vẫn BULLISH — có thể là cơ hội hấp thụ bán, cần xác nhận volume/OI.`,
    };
  }

  // Bearish divergence: price up but sentiment weak
  if (priceUp && sentBear) {
    return {
      code: "BEARISH_DIVERGENCE",
      severity: "MEDIUM",
      title: "Sentiment–Price divergence (bearish)",
      insight:
        `Giá tăng nhưng sentiment BEARISH — đà tăng có thể thiếu sự ủng hộ của dòng tin, thận trọng chase.`,
    };
  }

  // Short squeeze setup hint
  if (priceUp && (fundingShort || oiSetup === "SHORT_COVERING")) {
    return {
      code: "SHORT_SQUEEZE_RISK",
      severity: "MEDIUM",
      title: "Short squeeze pressure",
      insight:
        `Giá tăng trong khi funding/OI gợi ý short covering hoặc short crowded — áp lực short squeeze có thể còn.`,
    };
  }

  // Aligned bullish
  if (priceUp && sentBull && !fundingLong) {
    return {
      code: "ALIGNED_BULLISH",
      severity: "LOW",
      title: "Aligned bullish",
      insight: `Giá và sentiment cùng hướng tăng, funding chưa crowded — momentum tương đối lành mạnh hơn crowded long.`,
    };
  }

  // Aligned bearish
  if (priceDown && sentBear && !fundingShort) {
    return {
      code: "ALIGNED_BEARISH",
      severity: "LOW",
      title: "Aligned bearish",
      insight: `Giá và sentiment cùng hướng giảm — xu hướng bearish được tin tức ủng hộ.`,
    };
  }

  return {
    code: "NEUTRAL",
    severity: "LOW",
    title: "No strong divergence",
    insight:
      "Chưa phát hiện divergence rõ giữa giá, funding, OI và sentiment. Theo dõi thêm khi funding/OI lệch mạnh.",
  };
}

function filterRelevant(
  news: CryptoNewsItem[],
  symbol: string,
  name?: string | null,
): CryptoNewsItem[] {
  const needles = [
    symbol.toLowerCase(),
    name?.toLowerCase(),
    symbol === "BTC" ? "bitcoin" : null,
    symbol === "ETH" ? "ethereum" : null,
    symbol === "SOL" ? "solana" : null,
    symbol === "BNB" ? "bnb" : null,
  ].filter(Boolean) as string[];

  const relevant = news.filter((item) => {
    const text = `${item.title} ${item.summary}`.toLowerCase();
    return needles.some((n) => text.includes(n));
  });

  // Fallback: broader market news if too few hits
  if (relevant.length >= 5) return relevant.slice(0, 40);
  return [...relevant, ...news.filter((n) => !relevant.includes(n))].slice(0, 25);
}

export async function fetchSentimentIntelligence(
  baseSymbol: string,
  opts: {
    name?: string | null;
    change24h?: number | null;
  } = {},
): Promise<CryptoSentimentIntelligence> {
  const symbol = baseSymbol.trim().toUpperCase().replace(/USDT$/i, "");
  const errors: string[] = [];

  let news: CryptoNewsItem[] = [];
  try {
    news = await fetchCryptoNews();
  } catch (e) {
    errors.push(`news: ${String(e).slice(0, 120)}`);
  }

  const relevant = filterRelevant(news, symbol, opts.name);
  const articleScores = relevant.map((item) =>
    scoreArticle(`${item.title} ${item.summary}`),
  );
  const distribution = buildDistribution(articleScores);

  const texts = relevant.map((item) => `${item.title} ${item.summary}`);
  let hybridScore = 0;
  let hybridLabel = "Trung lập";
  let confidence = 0.4;
  let rationale = "";
  let scoringSource = "rule-engine";
  let model: string | undefined;

  try {
    const hybrid = await scoreCryptoSentimentHybrid(symbol, texts);
    hybridScore = hybrid.score;
    hybridLabel = hybrid.label;
    confidence = hybrid.confidence;
    rationale = hybrid.rationale;
    scoringSource = hybrid.source;
    model = hybrid.model;
  } catch (e) {
    hybridScore = cryptoSentimentScore(texts);
    hybridLabel =
      hybridScore > 0.3 ? "Tích cực" : hybridScore < -0.3 ? "Tiêu cực" : "Trung lập";
    errors.push(`hybrid: ${String(e).slice(0, 80)}`);
  }

  // Prefer distribution majority if sample is decent
  let label: SentimentLabel = labelFromScore(hybridScore);
  if (distribution.sampleSize >= 8) {
    if (distribution.bullishPct >= 55) label = "BULLISH";
    else if (distribution.bearishPct >= 55) label = "BEARISH";
    else if (
      distribution.bullishPct > distribution.bearishPct + 15
    )
      label = "BULLISH";
    else if (
      distribution.bearishPct > distribution.bullishPct + 15
    )
      label = "BEARISH";
  }

  let fundingBias: string | null = null;
  let oiSetup: string | null = null;
  let oiChangePct: number | null = null;
  try {
    const fut = await fetchFuturesIntelligence(symbol, opts.change24h);
    if (fut.available) {
      fundingBias = fut.funding.bias;
      oiSetup = fut.openInterest.setup;
      oiChangePct = fut.openInterest.changePct;
    }
  } catch (e) {
    errors.push(`futures: ${String(e).slice(0, 80)}`);
  }

  const divergence = analyzeDivergence({
    priceChange24h: opts.change24h ?? null,
    fundingBias,
    oiSetup,
    oiChangePct,
    sentimentLabel: label,
    sentimentScore: hybridScore,
  });

  const headlines = relevant.slice(0, 8).map((item, i) => ({
    title: item.title,
    link: item.link,
    source: item.source,
    publishedAt: item.publishedAt.toISOString(),
    lean: labelFromScore(articleScores[i] ?? 0),
  }));

  if (errors.length) {
    log.warn("sentiment_partial", { symbol, errors: errors.slice(0, 3) });
  }

  return {
    symbol,
    label,
    score: Number(hybridScore.toFixed(3)),
    confidence: Number(confidence.toFixed(2)),
    distribution,
    divergence,
    headlines,
    rationale,
    scoringSource,
    model: model ?? null,
    displayLabel: hybridLabel,
    available: relevant.length > 0 || distribution.sampleSize > 0,
    errors,
    fetchedAt: new Date().toISOString(),
  };
}

export function formatSentimentForAgent(s: CryptoSentimentIntelligence): string {
  if (!s.available) return `sentiment=${s.symbol}:unavailable`;
  return [
    `sentiment=${s.symbol} ${s.label} score=${s.score}`,
    `dist=B${s.distribution.bullishPct}/N${s.distribution.neutralPct}/S${s.distribution.bearishPct}`,
    `div=${s.divergence.code}:${s.divergence.title}`,
    s.divergence.insight.slice(0, 180),
  ].join(" | ");
}
