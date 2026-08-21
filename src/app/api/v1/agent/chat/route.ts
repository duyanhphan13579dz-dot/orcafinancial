import { NextRequest } from "next/server";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { analyze, type AnalysisResult } from "@/lib/analysis";
import type { Quote } from "@/lib/connectors/core";
import {
  generateFundamentalReport,
  type FundamentalReport,
} from "@/lib/fundamental";
import {
  agentNarrative,
  listConfiguredProviders,
  smoothAgentAnswer,
} from "@/lib/llm";
import {
  getHistory,
  getMarketOverview,
  getNews,
  getNewsSentiment,
  getQuote,
  searchSymbols,
} from "@/lib/market";
import { sentimentLabel } from "@/lib/sentiment";
import {
  detectCandlestickPatterns,
  detectChartPatterns,
  type CandlePattern,
  type ChartPattern,
} from "@/lib/technical-patterns";
import { buildPersonalFinanceContext } from "@/lib/personal-finance/context";
import { buildCorporateFinanceContext } from "@/lib/corporate-finance/context";
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

/**
 * Detect the user's intent from natural Vietnamese language.
 *
 * Important:
 * - Do not rely on exact phrases only.
 * - Personal finance questions are often written in very casual language:
 *   "còn 150k sống đến tuần sau", "thiếu tiền", "tiêu thế nào", etc.
 * - General questions must NOT automatically trigger market/news context.
 */
function detectIntent(message: string, hasTickers: boolean): AgentIntent {
  const m = message
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();

  /**
   * A validated ticker is the strongest signal.
   *
   * We only pass hasTickers=true after validating the candidate through
   * searchSymbols(), so normal uppercase words should not accidentally
   * become market_ticker.
   */
  if (hasTickers) {
    return "market_ticker";
  }

  /**
   * CORPORATE FINANCE
   *
   * Check this before personal finance because a company/business question
   * can contain words such as "lương", "nợ", "dòng tiền", etc.
   */
  const corporateFinancePattern =
    /doanh\s*nghiệp|công\s*ty|báo\s*cáo\s*tài\s*chính|bctc|vốn\s*lưu\s*động|vốn\s*working|cấu\s*trúc\s*vốn|dòng\s*tiền\s*(dn|doanh\s*nghiệp|công\s*ty)|dòng\s*tiền\s*doanh\s*nghiệp|ebitda|ebit|đòn\s*bẩy|nợ\s*doanh\s*nghiệp|khả\s*năng\s*trả\s*lãi|biên\s*lợi\s*nhuận|roa|roe|capex|opex|working\s*capital|corporate\s*finance|financial\s*statement|cash\s*flow|capital\s*structure/.test(
      m,
    );

  if (corporateFinancePattern) {
    return "corporate_finance";
  }

  /**
   * WEALTH MANAGEMENT
   *
   * Focus on asset allocation, portfolio construction, retirement,
   * diversification and long-term wealth planning.
   */
  const wealthPattern =
    /wealth|quản\s*lý\s*gia\s*sản|quản\s*lý\s*tài\s*sản|tài\s*sản\s*ròng|net\s*worth|phân\s*bổ\s*tài\s*sản|phân\s*bổ\s*danh\s*mục|asset\s*allocation|danh\s*mục\s*dài\s*hạn|danh\s*mục\s*đầu\s*tư|hưu\s*trí|nghỉ\s*hưu|khẩu\s*vị\s*rủi\s*ro|mức\s*chịu\s*rủi\s*ro|đa\s*dạng\s*hóa|đa\s*dạng\s*danh\s*mục|tái\s*cân\s*bằng|rebalancing|retirement|portfolio\s*management|wealth\s*management/.test(
      m,
    );

  if (wealthPattern) {
    return "wealth";
  }

  /**
   * PERSONAL FINANCE
   *
   * This is deliberately broader than the old keyword list.
   *
   * Examples now recognised:
   * - "còn 150k sống đến tuần sau"
   * - "còn 500 nghìn làm sao tiêu đến cuối tháng"
   * - "tháng này thiếu tiền"
   * - "tiền ăn còn ít"
   * - "lương 15 triệu chia thế nào"
   * - "đang nợ 20 triệu"
   * - "bao giờ đủ tiền mua nhà"
   * - "có 100 triệu nên làm gì"
   */
  const personalFinancePattern =
    /ngân\s*sách|budget|lập\s*budget|tiết\s*kiệm|saving|quỹ\s*khẩn|emergency\s*fund|chi\s*tiêu|tiêu\s*thế\s*nào|tiêu\s*bao\s*nhiêu|tiêu\s*đến|sống\s*đến|sống\s*qua|còn\s*(bao\s*nhiêu|ít|tiền)|thiếu\s*tiền|hết\s*tiền|tiền\s*ăn|tiền\s*nhà|tiền\s*thuê|tiền\s*điện|tiền\s*xăng|tiền\s*đi\s*lại|sinh\s*hoạt|lương|thu\s*nhập|income|nợ\s*cá\s*nhân|đang\s*nợ|mắc\s*nợ|trả\s*nợ|nợ\s*thẻ|vay\s*cá\s*nhân|khoản\s*vay|bảo\s*hiểm\s*nhân\s*thọ|bảo\s*hiểm\s*cá\s*nhân|mục\s*tiêu\s*tài\s*chính|mua\s*nhà|mua\s*xe|đám\s*cưới|du\s*lịch|học\s*phí|tài\s*chính\s*cá\s*nhân|personal\s*finance|personal\s*budget|cash\s*flow\s*cá\s*nhân/.test(
      m,
    );

  /**
   * Money + time is an especially strong personal-finance signal.
   *
   * This catches natural sentences even when they do not contain
   * conventional finance vocabulary.
   *
   * Examples:
   * "150k đến tuần sau"
   * "500 nghìn đến cuối tháng"
   * "2 triệu dùng 10 ngày"
   * "còn 3tr sống 2 tuần"
   */
  const hasMoneyAmount =
    /(?:\d+(?:[.,]\d+)?)\s*(?:k|nghìn|ngàn|triệu|tr|tỷ|tỉ|đ|vnđ|vnd|đồng)\b/.test(
      m,
    );

  const hasTimeHorizon =
    /(?:\d+\s*(?:ngày|ngay|tuần|tuan|tháng|thang|năm|nam))|(?:đến|tới|qua)\s*(?:cuối\s*tuần|tuần\s*sau|cuối\s*tháng|tháng\s*sau|cuối\s*năm|năm\s*sau)|(?:hết|qua)\s*(?:tuần|tháng|năm)/.test(
      m,
    );

  const naturalBudgetingPattern =
    /còn\s*\d|có\s*\d|đang\s*có\s*\d|trong\s*tài\s*khoản|tài\s*khoản\s*còn|tiền\s*còn|phải\s*dùng|phải\s*tiêu|làm\s*sao\s*đủ|làm\s*sao\s*để\s*đủ|chia\s*tiền|phân\s*bổ\s*tiền|quản\s*lý\s*tiền|quản\s*lý\s*tài\s*chính/.test(
      m,
    );

  if (
    personalFinancePattern ||
    (hasMoneyAmount && hasTimeHorizon) ||
    (hasMoneyAmount && naturalBudgetingPattern)
  ) {
    return "personal_finance";
  }

  /**
   * MARKET OVERVIEW
   *
   * Only explicit market-related language should trigger market context.
   */
  const marketPattern =
    /thị\s*trường|vn-?index|vn30|hnx|upcom|tổng\s*quan\s*thị\s*trường|diễn\s*biến\s*thị\s*trường|hôm\s*nay\s*thị\s*trường|phiên\s*hôm\s*nay|phiên\s*giao\s*dịch|chỉ\s*số|chứng\s*khoán|cổ\s*phiếu|crypto|tiền\s*điện\s*tử|bitcoin|btc|ethereum|eth|forex|ngoại\s*hối|vàng|dầu|hàng\s*hóa|commodity|market|market\s*overview/.test(
      m,
    );

  if (marketPattern) {
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

async function buildSymbolContext(
  symbol: string,
): Promise<SymbolContext | null> {
  try {
    const to = Math.floor(Date.now() / 1000);

    const [quote, hist, newsRes, sentimentRes] = await Promise.all([
      getQuote(symbol),
      getHistory(symbol, to - 86400 * 1100, to, "D"),
      getNews({ symbol, limit: 3 }).catch(() => null),
      getNewsSentiment(symbol).catch(() => null),
    ]);

    const bars = hist.bars;

    const fundamental =
      bars.length >= 60
        ? generateFundamentalReport(symbol, bars)
        : null;

    const recentCandle = detectCandlestickPatterns(bars).filter(
      (p) => p.barIndex >= bars.length - 10,
    );

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
      headlines:
        newsRes?.items.map(
          (n) => `${n.title} (${n.sourceName})`,
        ) ?? [],
    };
  } catch {
    return null;
  }
}

function fmt(
  n: number | null | undefined,
  digits = 2,
): string {
  return n === null ||
    n === undefined ||
    !Number.isFinite(n)
    ? "n/a"
    : n.toFixed(digits);
}

function composeDeterministicAnswer(
  message: string,
  intent: AgentIntent,
  contexts: SymbolContext[],
  market: Awaited<ReturnType<typeof getMarketOverview>> | null,
  headlines: string[],
  personalContext: string | null,
  corporateContext: string | null,
): string {
  const parts: string[] = [];

  parts.push(`Câu hỏi người dùng: ${message}`);
  parts.push(`Phân loại intent: ${intent}`);

  if (intent === "personal_finance") {
    if (personalContext) {
      parts.push(personalContext);
    } else {
      parts.push(
        "Người dùng CHƯA khai báo hồ sơ tài chính cá nhân (thu nhập/chi tiêu/nợ/mục tiêu) tại /api/v1/personal-finance/profile. Gợi ý khung trả lời tổng quát: làm rõ mục tiêu và chân trời thời gian; quỹ khẩn cấp 3–6 tháng chi tiêu; tỷ lệ chi tiêu/tiết kiệm tham khảo (vd 50/30/20); ưu tiên trả nợ lãi cao; bảo hiểm rủi ro cơ bản trước khi đầu tư. Chủ động gợi ý người dùng khai báo hồ sơ để nhận tư vấn cá nhân hóa với số liệu thật.",
      );
    }
  } else if (intent === "corporate_finance") {
    if (corporateContext) {
      parts.push(corporateContext);
    } else {
      parts.push(
        "Người dùng CHƯA nhập số liệu tài chính doanh nghiệp tại /api/v1/corporate-finance/statements. Gợi ý khung trả lời tổng quát: dòng tiền hoạt động vs đầu tư vs tài chính; vốn lưu động; đòn bẩy và khả năng trả lãi; đọc nhanh ROE/ROA/biên lợi nhuận; rủi ro thanh khoản. Chủ động gợi ý người dùng nhập số liệu BCTC để nhận phân tích chính xác với số liệu thật thay vì lý thuyết chung.",
      );
    }
  } else if (intent === "wealth") {
    parts.push(
      "Gợi ý khung trả lời (wealth): khẩu vị rủi ro, chân trời, đa dạng hóa theo nhóm tài sản, tái cân bằng định kỳ, tránh tập trung quá mức một mã/ngành. Không liệt kê basket mã cố định.",
    );

    if (personalContext) {
      parts.push(personalContext);
    }
  }

  if (market) {
    const idxLine = market.indices
      .map(
        (idx) =>
          `${idx.name} ở mức ${fmt(idx.close)} (${(idx.changePct ?? 0) >= 0 ? "+" : ""}${fmt(idx.changePct)}%)`,
      )
      .join("; ");

    parts.push(
      `Tổng quan thị trường (Data Engine): ${idxLine}.`,
    );

    parts.push(
      `Độ rộng mẫu ${market.breadth.sample} mã: ${market.breadth.advancers} tăng, ${market.breadth.decliners} giảm, ${market.breadth.unchanged} đứng giá.`,
    );
  }

  if (headlines.length > 0) {
    parts.push(
      `Tin gần đây: ${headlines.slice(0, 5).join("; ")}.`,
    );
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

    if (a.reasons.length > 0) {
      parts.push(
        `Các lý do chính: ${a.reasons.join("; ")}.`,
      );
    }

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

    if (c.headlines.length > 0) {
      parts.push(
        `Tin liên quan mã: ${c.headlines.join("; ")}.`,
      );
    }
  }

  if (
    contexts.length === 0 &&
    !market &&
    !personalContext &&
    !corporateContext &&
    (
      intent === "personal_finance" ||
      intent === "corporate_finance" ||
      intent === "wealth" ||
      intent === "general"
    )
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

  if (limited) {
    return limited;
  }

  const started = Date.now();

  try {
    const body = (await req.json()) as {
      message?: string;
      companyName?: string;
    };

    const message = body.message?.trim() ?? "";

    if (!message) {
      return fail("Missing message", 400);
    }

    if (message.length > 2000) {
      return fail("Message too long", 400);
    }

    const authedUser = await getAuthedUser(req).catch(
      () => null,
    );

    /**
     * Detect possible ticker candidates.
     *
     * We still validate every candidate with searchSymbols()
     * before treating it as a market ticker.
     */
    const candidates = [
      ...new Set(
        [...message.toUpperCase().matchAll(TICKER_RE)].map(
          (m) => m[1],
        ),
      ),
    ].slice(0, 3);

    const validated: string[] = [];

    for (const c of candidates) {
      try {
        const found = await searchSymbols(c);

        if (found.some((f) => f.symbol === c)) {
          validated.push(c);
        }
      } catch {
        // Skip invalid/unavailable candidates.
      }
    }

    const intent = detectIntent(
      message,
      validated.length > 0,
    );

    /**
     * IMPORTANT:
     *
     * "general" no longer triggers Market Data.
     *
     * Previously:
     *   general -> market + news
     *
     * That caused questions such as:
     *   "còn 150k làm sao sống đến tuần sau?"
     *
     * to receive VN-Index/HNX/UPCOM/news context.
     */
    const needMarket =
      intent === "market_ticker" ||
      intent === "market_overview";

    const [contexts, market, newsRes, personalContext, corporateContext] =
      await Promise.all([
        Promise.all(
          validated.map(buildSymbolContext),
        ).then((list) =>
          list.filter(
            (c): c is SymbolContext => c !== null,
          ),
        ),

        /**
         * Wealth can use market context when relevant because
         * wealth-management decisions may involve the current
         * market environment.
         *
         * Personal Finance does NOT automatically get market data.
         */
        needMarket || intent === "wealth"
          ? getMarketOverview().catch(() => null)
          : Promise.resolve(null),

        /**
         * News is only loaded when the user explicitly asks
         * about market-related information.
         *
         * General chat must stay general.
         */
        intent === "market_overview" ||
        intent === "market_ticker"
          ? getNews({ limit: 6 }).catch(() => null)
          : Promise.resolve(null),

        /**
         * Personal Finance context.
         */
        intent === "personal_finance" ||
        intent === "wealth"
          ? buildPersonalFinanceContext(
              authedUser?.id ?? null,
            ).catch(() => null)
          : Promise.resolve(null),

        /**
         * Corporate Finance context.
         */
        intent === "corporate_finance"
          ? buildCorporateFinanceContext(
              authedUser?.id ?? null,
              body.companyName,
            ).catch(() => null)
          : Promise.resolve(null),
      ]);

    const headlines =
      newsRes?.items?.map(
        (n) => `${n.title} (${n.sourceName})`,
      ) ?? [];

    /**
     * Only hard-fail when the user clearly asked for
     * market/ticker data and the requested symbol cannot
     * be resolved.
     */
    if (
      intent === "market_ticker" &&
      contexts.length === 0
    ) {
      return fail(
        "Không lấy được dữ liệu mã. Thử lại hoặc kiểm tra mã.",
        503,
      );
    }

    /**
     * Build structured context for the LLM.
     */
    const deterministic = composeDeterministicAnswer(
      message,
      intent,
      contexts,
      market,
      headlines,
      personalContext,
      corporateContext,
    );

    /**
     * Let the configured LLM turn the structured context
     * into a natural answer.
     *
     * If no LLM provider is available, the existing
     * deterministic fallback is retained for now.
     *
     * We will improve this fallback in Part 3.
     */
    const llmResult = await agentNarrative(
      message,
      deterministic,
    );

    const answer = smoothAgentAnswer(
      llmResult?.text ?? deterministic,
    );

    const model = llmResult
      ? `${llmResult.provider}/${llmResult.model}`
      : "rule-engine";

    const latencyMs = Date.now() - started;

    const sessionId =
      req.cookies.get("vnstock_session")?.value ?? "";

    void db
      .insert(agentLogs)
      .values({
        sessionId,
        prompt: message,
        response: answer.slice(0, 8000),
        model,
        latencyMs,
      })
      .catch((err) =>
        logger.error("agent_log_failed", {
          error: String(err),
        }),
      );

    return ok(
      {
        answer,
        model,
        intent,
        symbols: validated,
        personalized: Boolean(
          personalContext || corporateContext,
        ),
        providersConfigured:
          listConfiguredProviders().map(
            (p) => p.id,
          ),
      },
      {
        latencyMs,
        source: "data-engine+intent+llm",
        confidence:
          contexts[0]?.analysis.confidence ?? 0.85,
        llmProvider: llmResult?.provider ?? null,
      },
    );
  } catch (err) {
    return handleError(err, "agent_chat");
  }
}
