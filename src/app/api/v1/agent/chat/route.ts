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
import {
  detectCandlestickPatterns,
  detectChartPatterns,
  type CandlePattern,
  type ChartPattern,
} from "@/lib/technical-patterns";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICKER_RE = /\b([A-Z]{3})\b/g;

type AgentIntent =
  | "market_ticker"
  | "market_overview"
  | "personal_finance"
  | "corporate_finance"
  | "wealth"
  | "general";

function detectIntent(message: string, hasTickers: boolean): AgentIntent {
  const m = message.toLowerCase();
  if (hasTickers) return "market_ticker";

  if (
    /ngân\s*sách|tiết\s*kiệm|quỹ\s*khẩn|chi\s*tiêu|lương|nợ\s*thẻ|vay\s*cá\s*nhân|bảo\s*hiểm\s*nhân\s*thọ|mục\s*tiêu\s*tài\s*chính|personal\s*finance|budget|emergency\s*fund/.test(
      m,
    )
  ) {
    return "personal_finance";
  }
  if (
    /doanh\s*nghiệp|báo\s*cáo\s*tài\s*chính|vốn\s*lưu\s*động|cấu\s*trúc\s*vốn|dòng\s*tiền\s*dn|ebitda|đòn\s*bẩy|corporate|working\s*capital|capex/.test(
      m,
    )
  ) {
    return "corporate_finance";
  }
  if (
    /gia\s*sản|wealth|phân\s*bổ\s*tài\s*sản|asset\s*allocation|danh\s*mục\s*dài\s*hạn|hưu\s*trí|khẩu\s*vị\s*rủi\s*ro|đa\s*dạng\s*hóa/.test(
      m,
    )
  ) {
    return "wealth";
  }
  if (/thị\s*trường|vn-?index|tổng\s*quan|hôm\s*nay|phiên|chỉ\s*số|crypto|forex|chứng\s*khoán/.test(m)) {
    return "market_overview";
  }
  return "general";
}

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
  intent: AgentIntent,
  contexts: SymbolContext[],
  market: Awaited<ReturnType<typeof getMarketOverview>> | null,
  headlines: string[],
): string {
  const parts: string[] = [];
  parts.push(`Câu hỏi người dùng: ${message}`);
  parts.push(`Phân loại intent: ${intent}`);

  if (intent === "personal_finance") {
    parts.push(
      "Gợi ý khung trả lời (tài chính cá nhân): làm rõ mục tiêu và chân trời thời gian; quỹ khẩn cấp 3–6 tháng chi tiêu; tỷ lệ chi tiêu/tiết kiệm tham khảo (vd 50/30/20); ưu tiên trả nợ lãi cao; bảo hiểm rủi ro cơ bản trước khi đầu tư. Không ép sản phẩm cụ thể.",
    );
  } else if (intent === "corporate_finance") {
    parts.push(
      "Gợi ý khung trả lời (tài chính DN): dòng tiền hoạt động vs đầu tư vs tài chính; vốn lưu động; đòn bẩy và khả năng trả lãi; đọc nhanh ROE/ROA/biên lợi nhuận; rủi ro thanh khoản. Thiếu số liệu BCTC thì nói chưa có dữ liệu.",
    );
  } else if (intent === "wealth") {
    parts.push(
      "Gợi ý khung trả lời (wealth): khẩu vị rủi ro, chân trời, đa dạng hóa theo nhóm tài sản, tái cân bằng định kỳ, tránh tập trung quá mức một mã/ngành. Không liệt kê basket mã cố định.",
    );
  }

  if (market) {
    const idxLine = market.indices
      .map(
        (idx) =>
          `${idx.name} ở mức ${fmt(idx.close)} (${(idx.changePct ?? 0) >= 0 ? "+" : ""}${fmt(idx.changePct)}%)`,
      )
      .join("; ");
    parts.push(`Tổng quan thị trường (Data Engine): ${idxLine}.`);
    parts.push(
      `Độ rộng mẫu ${market.breadth.sample} mã: ${market.breadth.advancers} tăng, ${market.breadth.decliners} giảm, ${market.breadth.unchanged} đứng giá.`,
    );
  }

  if (headlines.length > 0) {
    parts.push(`Tin gần đây: ${headlines.slice(0, 5).join("; ")}.`);
  }

  for (const c of contexts) {
    const a = c.analysis;
    const conf = (a.confidence * 100).toFixed(0);
    parts.push(
      `Với ${c.symbol}, khuyến nghị kỹ thuật hiện tại là ${a.recommendation} (độ tin cậy khoảng ${conf}%). Giá gần nhất ${fmt(a.lastClose)}, biến động 1 ngày ${fmt(a.changePct1d)}% và 1 tháng ${fmt(a.changePct1m)}% (nguồn ${c.quote.source}).`,
    );

    let tech = `Về kỹ thuật, RSI(14) khoảng ${fmt(a.rsi14, 1)}, MACD histogram ${fmt(a.macd?.histogram, 3)}, SMA20 ${fmt(a.sma20)} và SMA50 ${fmt(a.sma50)}.`;
    if (a.supportResistance) {
      tech += ` Hỗ trợ quanh ${fmt(a.supportResistance.support)}, kháng cự quanh ${fmt(a.supportResistance.resistance)}.`;
    }
    parts.push(tech);

    if (a.reasons.length > 0) parts.push(`Các lý do chính: ${a.reasons.join("; ")}.`);

    if (c.fundamental) {
      const f = c.fundamental;
      const h = f.financialHealth;
      const v = f.valuation;
      parts.push(
        `Cơ bản: sức khỏe ${h.rating} (${h.overallScore}/100). EPS ${fmt(f.eps)}, ROE ${fmt(f.roe)}%, ROA ${fmt(f.roa)}%. P/E ${fmt(v.pe, 1)}, P/B ${fmt(v.pb, 1)}. ${v.verdictVi}.`,
      );
    }

    parts.push(
      `Tâm lý tin tức: ${c.sentimentLabel.toLowerCase()} (điểm ${c.sentimentScore >= 0 ? "+" : ""}${c.sentimentScore.toFixed(2)}).`,
    );
    if (c.headlines.length > 0) parts.push(`Tin liên quan mã: ${c.headlines.join("; ")}.`);
  }

  if (
    contexts.length === 0 &&
    !market &&
    (intent === "personal_finance" || intent === "corporate_finance" || intent === "wealth" || intent === "general")
  ) {
    parts.push(
      "Không có snapshot thị trường bắt buộc cho câu hỏi này. Hãy trả lời dựa trên nguyên tắc tài chính chuẩn và hỏi thêm thông tin nếu thiếu.",
    );
  }

  parts.push(
    "Nhắc cuối: phân tích mang tính tham khảo, không phải lời khuyên đầu tư cá nhân hóa.",
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

    const intent = detectIntent(message, validated.length > 0);

    const needMarket =
      intent === "market_ticker" || intent === "market_overview" || intent === "general";

    const [contexts, market, newsRes] = await Promise.all([
      Promise.all(validated.map(buildSymbolContext)).then((list) =>
        list.filter((c): c is SymbolContext => c !== null),
      ),
      needMarket || intent === "wealth"
        ? getMarketOverview().catch(() => null)
        : Promise.resolve(null),
      intent === "market_overview" || intent === "general" || intent === "market_ticker"
        ? getNews({ limit: 6 }).catch(() => null)
        : Promise.resolve(null),
    ]);

    const headlines = newsRes?.items?.map((n) => `${n.title} (${n.sourceName})`) ?? [];

    // Only hard-fail when user clearly asked for market data and we have nothing
    if (intent === "market_ticker" && contexts.length === 0) {
      return fail("Không lấy được dữ liệu mã. Thử lại hoặc kiểm tra mã.", 503);
    }

    const deterministic = composeDeterministicAnswer(message, intent, contexts, market, headlines);
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
        intent,
        symbols: validated,
        providersConfigured: listConfiguredProviders().map((p) => p.id),
      },
      {
        latencyMs,
        source: "data-engine+intent+llm",
        confidence: contexts[0]?.analysis.confidence ?? 0.85,
        llmProvider: llmResult?.provider ?? null,
      },
    );
  } catch (err) {
    return handleError(err, "agent_chat");
  }
}
