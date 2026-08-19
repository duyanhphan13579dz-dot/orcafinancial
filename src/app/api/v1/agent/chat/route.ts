import { NextRequest } from "next/server";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { analyze, type AnalysisResult } from "@/lib/analysis";
import type { Quote } from "@/lib/connectors/core";
import { generateFundamentalReport, type FundamentalReport } from "@/lib/fundamental";
import { agentNarrative, listConfiguredProviders, smoothAgentAnswer } from "@/lib/llm";
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

/** Prose fallback when LLM is unavailable — no markdown headers/bullets. */
function composeDeterministicAnswer(
  _message: string,
  contexts: SymbolContext[],
  market: Awaited<ReturnType<typeof getMarketOverview>> | null,
): string {
  const parts: string[] = [];

  if (contexts.length === 0 && market) {
    const idxLine = market.indices
      .map((idx) => `${idx.name} ở mức ${fmt(idx.close)} (${(idx.changePct ?? 0) >= 0 ? "+" : ""}${fmt(idx.changePct)}%)`)
      .join("; ");
    parts.push(`Tổng quan thị trường hiện tại: ${idxLine}.`);
    parts.push(
      `Độ rộng trên mẫu ${market.breadth.sample} mã: ${market.breadth.advancers} mã tăng, ${market.breadth.decliners} mã giảm, ${market.breadth.unchanged} đứng giá.`,
    );
    if (market.topGainers.length > 0) {
      parts.push(
        `Nhóm dẫn dắt gồm ${market.topGainers
          .slice(0, 3)
          .map((q) => `${q.symbol} (+${fmt(q.changePct)}%)`)
          .join(", ")}.`,
      );
    }
    if (market.crypto.length > 0) {
      parts.push(
        `Crypto tham chiếu: ${market.crypto
          .map(
            (c) =>
              `${c.symbol} $${c.priceUsd.toLocaleString()} (${c.change24hPct >= 0 ? "+" : ""}${c.change24hPct.toFixed(2)}%)`,
          )
          .join(", ")}.`,
      );
    }
    parts.push(`Bạn có thể hỏi cụ thể một mã, ví dụ "Phân tích VNM", để nhận nhận định đầy đủ hơn.`);
  }

  for (const c of contexts) {
    const a = c.analysis;
    const conf = (a.confidence * 100).toFixed(0);
    parts.push(
      `Với ${c.symbol}, khuyến nghị kỹ thuật hiện tại là ${a.recommendation} (độ tin cậy khoảng ${conf}%). Giá gần nhất ${fmt(a.lastClose)}, biến động 1 ngày ${fmt(a.changePct1d)}% và 1 tháng ${fmt(a.changePct1m)}% (nguồn ${c.quote.source}).`,
    );

    let tech = `Về kỹ thuật, RSI(14) khoảng ${fmt(a.rsi14, 1)}, MACD histogram ${fmt(a.macd?.histogram, 3)}, SMA20 ${fmt(a.sma20)} và SMA50 ${fmt(a.sma50)}. Biến động ${fmt(a.volatilityPct, 1)}%, drawdown tối đa gần đây ${fmt(a.maxDrawdownPct, 1)}%.`;
    if (a.supportResistance) {
      tech += ` Vùng hỗ trợ quanh ${fmt(a.supportResistance.support)}, kháng cự quanh ${fmt(a.supportResistance.resistance)}.`;
    }
    parts.push(tech);

    if (a.reasons.length > 0) {
      parts.push(`Các lý do chính: ${a.reasons.join("; ")}.`);
    }

    if (c.fundamental) {
      const f = c.fundamental;
      const h = f.financialHealth;
      const v = f.valuation;
      let fund = `Phía cơ bản, sức khỏe tài chính xếp hạng ${h.rating} (${h.overallScore}/100). EPS khoảng ${fmt(f.eps)}, ROE ${fmt(f.roe)}%, ROA ${fmt(f.roa)}%`;
      if (f.cagr3y !== null) fund += `, CAGR 3 năm khoảng ${fmt(f.cagr3y)}%`;
      fund += ".";
      parts.push(fund);
      if (f.dupont) parts.push(f.dupont.description);
      let val = `Định giá tham chiếu: P/E ${fmt(v.pe, 1)}, P/B ${fmt(v.pb, 1)}, EV/EBITDA ${fmt(v.evEbitda, 1)}, Graham ${fmt(v.grahamNumber)}, DDM ${fmt(v.ddm)}.`;
      if (v.dcf) {
        val += ` DCF bi quan / cơ sở / lạc quan lần lượt khoảng ${fmt(v.dcf.pessimistic)}, ${fmt(v.dcf.base)} và ${fmt(v.dcf.optimistic)}.`;
      }
      if (v.reverseDcfGrowth !== null) {
        val += ` Reverse DCF cho thấy thị trường đang price-in tăng trưởng khoảng ${fmt(v.reverseDcfGrowth)}%/năm.`;
      }
      val += ` ${v.verdictVi}.`;
      parts.push(val);
    }

    const patternBits: string[] = [];
    for (const p of c.chartPatterns) {
      patternBits.push(
        `${p.nameVi} (${p.type === "bullish" ? "tăng" : p.type === "bearish" ? "giảm" : "trung tính"}, tin cậy ${(p.reliability * 100).toFixed(0)}%)`,
      );
    }
    for (const p of c.candlePatterns) {
      patternBits.push(
        `nến ${p.nameVi} (${p.type === "bullish" ? "tăng" : p.type === "bearish" ? "giảm" : "trung tính"})`,
      );
    }
    if (patternBits.length > 0) {
      parts.push(`Mẫu hình đáng chú ý gần đây: ${patternBits.join("; ")}.`);
    }

    parts.push(
      `Tâm lý tin tức quanh mã đang ${c.sentimentLabel.toLowerCase()} (điểm ${c.sentimentScore >= 0 ? "+" : ""}${c.sentimentScore.toFixed(2)}).`,
    );
    if (c.headlines.length > 0) {
      parts.push(`Tin liên quan gần đây gồm: ${c.headlines.join("; ")}.`);
    }
  }

  parts.push(
    `Phân tích dựa trên dữ liệu giá thật (VNDirect/Yahoo), tin RSS và mô hình nội bộ. Đây không phải lời khuyên đầu tư, chỉ mang tính tham khảo.`,
  );

  return parts.join("\n\n");
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
    const llmResult = await agentNarrative(message, deterministic);
    const answer = smoothAgentAnswer(llmResult?.text ?? deterministic);
    const model = llmResult ? `${llmResult.provider}/${llmResult.model}` : "rule-engine";
    const latencyMs = Date.now() - started;

    const sessionId = req.cookies.get("vnstock_session")?.value ?? "";
    void db
      .insert(agentLogs)
      .values({ sessionId, prompt: message, response: answer.slice(0, 8000), model, latencyMs })
      .catch((err) => logger.error("agent_log_failed", { error: String(err) }));

    return ok(
      {
        answer,
        model,
        symbols: validated,
        providersConfigured: listConfiguredProviders().map((p) => p.id),
      },
      {
        latencyMs,
        source: "data-engine+fundamental+technical+sentiment+llm",
        confidence: contexts[0]?.analysis.confidence ?? 0.9,
        llmProvider: llmResult?.provider ?? null,
      },
    );
  } catch (err) {
    return handleError(err, "agent_chat");
  }
}
