import { NextRequest } from "next/server";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { analyze, type AnalysisResult } from "@/lib/analysis";
import type { Quote } from "@/lib/connectors/core";
import { generateFundamentalReport, type FundamentalReport } from "@/lib/fundamental";
import { getHistory, getMarketOverview, getNews, getNewsSentiment, getQuote, searchSymbols } from "@/lib/market";
import { sentimentLabel } from "@/lib/sentiment";
import { detectCandlestickPatterns, detectChartPatterns, type CandlePattern, type ChartPattern } from "@/lib/technical-patterns";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICKER_RE = /\b([A-Z]{3})\b/g;

interface SymbolContext {
  symbol: string;
  quote: Quote;
  analysis: AnalysisResult;
  fundamental: FundamentalReport | null;
  candlePatterns: CandlePattern[];
  chartPatterns: ChartPattern[];
  sentimentScore: number;
  sentimentLabel: string;
  headlines: string[];
}

async function buildSymbolContext(symbol: string): Promise<SymbolContext | null> {
  try {
    const to = Math.floor(Date.now() / 1000);
    const [quote, hist, newsRes, sentimentRes] = await Promise.all([
      getQuote(symbol),
      getHistory(symbol, to - 86400 * 1100, to, "D"),
      getNews({ symbol, limit: 3 }).catch(() => null),
      getNewsSentiment(symbol).catch(() => null),
    ]);
    const bars = hist.bars;
    const fundamental = bars.length >= 60 ? generateFundamentalReport(symbol, bars) : null;
    const recentCandle = detectCandlestickPatterns(bars).filter((p) => p.barIndex >= bars.length - 10);
    const chartPats = detectChartPatterns(bars);
    const sScore = sentimentRes?.sentimentScore ?? 0;

    return {
      symbol,
      quote,
      analysis: analyze(symbol, bars),
      fundamental,
      candlePatterns: recentCandle.slice(0, 5),
      chartPatterns: chartPats.slice(0, 3),
      sentimentScore: sScore,
      sentimentLabel: sentimentLabel(sScore),
      headlines: newsRes?.items.map((n) => `${n.title} (${n.sourceName})`) ?? [],
    };
  } catch {
    return null;
  }
}

function fmt(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "n/a" : n.toFixed(digits);
}

function composeDeterministicAnswer(
  message: string,
  contexts: SymbolContext[],
  market: Awaited<ReturnType<typeof getMarketOverview>> | null,
): string {
  const parts: string[] = [];
  if (contexts.length === 0 && market) {
    parts.push("## Tổng quan thị trường (dữ liệu thật, real-time qua Data Engine)");
    for (const idx of market.indices) {
      parts.push(`- **${idx.name}**: ${fmt(idx.close)} (${(idx.changePct ?? 0) >= 0 ? "+" : ""}${fmt(idx.changePct)}%)`);
    }
    parts.push(
      `- Độ rộng (mẫu ${market.breadth.sample} mã): ${market.breadth.advancers} tăng / ${market.breadth.decliners} giảm / ${market.breadth.unchanged} đứng`,
    );
    if (market.topGainers.length > 0) {
      parts.push(`- Dẫn dắt: ${market.topGainers.slice(0, 3).map((q) => `${q.symbol} (+${fmt(q.changePct)}%)`).join(", ")}`);
    }
    if (market.crypto.length > 0) {
      parts.push(`- Crypto: ${market.crypto.map((c) => `${c.symbol} $${c.priceUsd.toLocaleString()} (${c.change24hPct >= 0 ? "+" : ""}${c.change24hPct.toFixed(2)}%)`).join(", ")}`);
    }
    parts.push("\nHãy hỏi về một mã cụ thể (ví dụ: \"Phân tích VNM\") để nhận phân tích đầy đủ.");
  }

  for (const c of contexts) {
    const a = c.analysis;
    parts.push(`## ${c.symbol} — Khuyến nghị: **${a.recommendation}** (tin cậy ${(a.confidence * 100).toFixed(0)}%)`);
    parts.push(
      `Giá: **${fmt(a.lastClose)}** | 1d: ${fmt(a.changePct1d)}% | 1m: ${fmt(a.changePct1m)}% | Nguồn: ${c.quote.source}`,
    );

    // Technical indicators
    parts.push("### Chỉ báo kỹ thuật");
    parts.push(
      `RSI(14)=${fmt(a.rsi14, 1)}, MACD hist=${fmt(a.macd?.histogram, 3)}, SMA20=${fmt(a.sma20)}, SMA50=${fmt(a.sma50)}, Biến động=${fmt(a.volatilityPct, 1)}%, Drawdown=${fmt(a.maxDrawdownPct, 1)}%`,
    );
    if (a.supportResistance) {
      parts.push(`Hỗ trợ ~ ${fmt(a.supportResistance.support)} | Kháng cự ~ ${fmt(a.supportResistance.resistance)}`);
    }

    // Reasons
    parts.push("**Lý do:**");
    for (const r of a.reasons) parts.push(`- ${r}`);

    // Fundamental
    if (c.fundamental) {
      const f = c.fundamental;
      const h = f.financialHealth;
      parts.push(`### Phân tích cơ bản`);
      parts.push(`Sức khỏe tài chính: **${h.rating}** (${h.overallScore}/100) | EPS ≈ ${fmt(f.eps)} | ROE ≈ ${fmt(f.roe)}% | ROA ≈ ${fmt(f.roa)}%${f.cagr3y !== null ? ` | CAGR 3y ≈ ${fmt(f.cagr3y)}%` : ""}`);
      if (f.dupont) {
        parts.push(`DuPont: ${f.dupont.description}`);
      }
      const v = f.valuation;
      parts.push(`### Định giá`);
      parts.push(`P/E=${fmt(v.pe, 1)} | P/B=${fmt(v.pb, 1)} | EV/EBITDA=${fmt(v.evEbitda, 1)} | Graham=${fmt(v.grahamNumber)} | DDM=${fmt(v.ddm)}`);
      if (v.dcf) {
        parts.push(`DCF: Bi quan ${fmt(v.dcf.pessimistic)} → Cơ sở ${fmt(v.dcf.base)} → Lạc quan ${fmt(v.dcf.optimistic)}`);
      }
      if (v.reverseDcfGrowth !== null) {
        parts.push(`Reverse DCF: thị trường đang price-in tăng trưởng ${fmt(v.reverseDcfGrowth)}%/năm`);
      }
      parts.push(`**${v.verdictVi}**`);
    }

    // Technical patterns
    if (c.candlePatterns.length > 0 || c.chartPatterns.length > 0) {
      parts.push("### Mẫu hình");
      for (const p of c.chartPatterns) {
        parts.push(`- **${p.nameVi}** (${p.type === "bullish" ? "▲ tăng" : p.type === "bearish" ? "▼ giảm" : "─"}, tin cậy ${(p.reliability * 100).toFixed(0)}%): ${p.description}`);
      }
      for (const p of c.candlePatterns) {
        parts.push(`- Nến **${p.nameVi}** (${p.type === "bullish" ? "▲" : p.type === "bearish" ? "▼" : "─"}, ${(p.reliability * 100).toFixed(0)}%): ${p.description}`);
      }
    }

    // Sentiment
    parts.push(`### Tâm lý thị trường: ${c.sentimentLabel} (${c.sentimentScore >= 0 ? "+" : ""}${c.sentimentScore.toFixed(2)})`);

    // News
    if (c.headlines.length > 0) {
      parts.push("### Tin liên quan");
      for (const h of c.headlines) parts.push(`- ${h}`);
    }
  }
  parts.push("\n_Phân tích từ dữ liệu giá thật (VNDirect/Yahoo), tin RSS thật, NLP sentiment, và mô hình tài chính. Không phải lời khuyên đầu tư._");
  return parts.join("\n");
}

async function callAnthropic(message: string, contextBlock: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        system:
          "Bạn là chuyên viên phân tích đầu tư chứng khoán Việt Nam. CHỈ sử dụng dữ liệu real-time được cung cấp trong context — bao gồm giá, chỉ báo kỹ thuật, phân tích cơ bản (EPS, ROE, DCF, Graham, DuPont), mẫu hình nến/giá, và sentiment. Tuyệt đối không bịa số liệu. Trả lời bằng tiếng Việt, có cấu trúc, kèm khuyến nghị rõ ràng. Luôn kết thúc bằng lưu ý đây không phải lời khuyên đầu tư.",
        messages: [
          { role: "user", content: `DỮ LIỆU REAL-TIME TỪ DATA ENGINE:\n${contextBlock}\n\nCÂU HỎI: ${message}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    return data.content.find((b) => b.type === "text")?.text ?? null;
  } catch (err) {
    logger.warn("anthropic_failed_fallback_rule_engine", { error: String(err) });
    return null;
  }
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  const started = Date.now();
  try {
    const body = (await req.json()) as { message?: string };
    const message = body.message?.trim() ?? "";
    if (!message) return fail("Missing message", 400);
    if (message.length > 2000) return fail("Message too long", 400);

    const candidates = [...new Set([...message.toUpperCase().matchAll(TICKER_RE)].map((m) => m[1]))].slice(0, 3);
    const validated: string[] = [];
    for (const c of candidates) {
      try {
        const found = await searchSymbols(c);
        if (found.some((f) => f.symbol === c)) validated.push(c);
      } catch {
        // skip
      }
    }

    const contexts = (await Promise.all(validated.map(buildSymbolContext))).filter(
      (c): c is SymbolContext => c !== null,
    );
    const market = contexts.length === 0 ? await getMarketOverview().catch(() => null) : null;

    if (contexts.length === 0 && market === null) {
      return fail("No real market data available right now. Please retry.", 503);
    }

    const deterministic = composeDeterministicAnswer(message, contexts, market);
    const llmAnswer = await callAnthropic(message, deterministic);
    const answer = llmAnswer ?? deterministic;
    const model = llmAnswer ? "claude-haiku-4-5" : "rule-engine";
    const latencyMs = Date.now() - started;

    const sessionId = req.cookies.get("vnstock_session")?.value ?? "";
    void db
      .insert(agentLogs)
      .values({ sessionId, prompt: message, response: answer.slice(0, 8000), model, latencyMs })
      .catch((err) => logger.error("agent_log_failed", { error: String(err) }));

    return ok(
      { answer, model, symbols: validated },
      { latencyMs, source: "data-engine+fundamental+technical+sentiment", confidence: contexts[0]?.analysis.confidence ?? 0.9 },
    );
  } catch (err) {
    return handleError(err, "agent_chat");
  }
}
