import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { analyze, type AnalysisResult } from "@/lib/analysis";
import type { Quote } from "@/lib/connectors/core";
import {
  generateFundamentalReport,
  type FundamentalReport,
} from "@/lib/fundamental";
import {
  buildAdvisorFallback,
  listConfiguredProviders,
  llmEnvDiagnostics,
  smoothAgentAnswer,
} from "@/lib/llm";
import { agentNarrativeDetailed } from "@/lib/llm/sentiment-llm";
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
import { retrievePlaybookContext } from "@/lib/rag";
import { appendChatTurn } from "@/lib/agent/history";
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
  const m = message
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();

  if (hasTickers) {
    return "market_ticker";
  }

  const corporateFinancePattern =
    /doanh\s*nghiệp|công\s*ty|báo\s*cáo\s*tài\s*chính|bctc|vốn\s*lưu\s*động|vốn\s*working|cấu\s*trúc\s*vốn|dòng\s*tiền\s*(dn|doanh\s*nghiệp|công\s*ty)|dòng\s*tiền\s*doanh\s*nghiệp|ebitda|ebit|đòn\s*bẩy|nợ\s*doanh\s*nghiệp|khả\s*năng\s*trả\s*lãi|biên\s*lợi\s*nhuận|roa|roe|capex|opex|working\s*capital|corporate\s*finance|financial\s*statement|cash\s*flow|capital\s*structure|hộ\s*kinh\s*doanh|sme|cửa\s*hàng|xoay\s*vốn|báo\s*giá|định\s*giá\s*dịch\s*vụ/.test(
      m,
    );

  if (corporateFinancePattern) {
    return "corporate_finance";
  }

  const wealthPattern =
    /wealth|quản\s*lý\s*gia\s*sản|quản\s*lý\s*tài\s*sản|tài\s*sản\s*ròng|net\s*worth|phân\s*bổ\s*tài\s*sản|phân\s*bổ\s*danh\s*mục|asset\s*allocation|danh\s*mục\s*dài\s*hạn|danh\s*mục\s*đầu\s*tư|hưu\s*trí|nghỉ\s*hưu|khẩu\s*vị\s*rủi\s*ro|mức\s*chịu\s*rủi\s*ro|đa\s*dạng\s*hóa|đa\s*dạng\s*danh\s*mục|tái\s*cân\s*bằng|rebalancing|retirement|portfolio\s*management|wealth\s*management|nên\s*đầu\s*tư|đầu\s*tư\s*gì|etf|quỹ\s*mở|trái\s*phiếu|mua\s*nhà\s*hay\s*thuê|buy\s*or\s*rent/.test(
      m,
    );

  if (wealthPattern) {
    return "wealth";
  }

  const personalFinancePattern =
    /ngân\s*sách|budget|lập\s*budget|tiết\s*kiệm|saving|quỹ\s*khẩn|emergency\s*fund|chi\s*tiêu|tiêu\s*thế\s*nào|tiêu\s*bao\s*nhiêu|tiêu\s*đến|sống\s*đến|sống\s*qua|còn\s*(bao\s*nhiêu|ít|tiền)|thiếu\s*tiền|hết\s*tiền|tiền\s*ăn|tiền\s*nhà|tiền\s*thuê|tiền\s*điện|tiền\s*xăng|tiền\s*đi\s*lại|sinh\s*hoạt|lương|thu\s*nhập|income|nợ\s*cá\s*nhân|đang\s*nợ|mắc\s*nợ|trả\s*nợ|nợ\s*thẻ|vay\s*cá\s*nhân|khoản\s*vay|bảo\s*hiểm|mục\s*tiêu\s*tài\s*chính|mua\s*nhà|mua\s*xe|đám\s*cưới|du\s*lịch|học\s*phí|tài\s*chính\s*cá\s*nhân|personal\s*finance|personal\s*budget|cash\s*flow\s*cá\s*nhân|thuế|tncn|lạm\s*phát|lãi\s*suất|tỷ\s*giá|chuyển\s*tiền|kiều\s*hối|đàm\s*phán\s*lương|tăng\s*lương|thu\s*nhập\s*phụ|freelance|lừa\s*đảo|đa\s*cấp|vay\s*nóng|tín\s*dụng\s*đen|cắt\s*giảm|xoay\s*tiền|nhàn\s*rỗi|tiền\s*mặt/.test(
      m,
    );

  const hasMoneyAmount =
    /(?:\d+(?:[.,]\d+)?)\s*(?:k|nghìn|ngàn|triệu|tr|tỷ|tỉ|đ|vnđ|vnd|đồng|usd|\$)\b/.test(
      m,
    );

  const hasTimeHorizon =
    /(?:\d+\s*(?:ngày|ngay|tuần|tuan|tháng|thang|năm|nam))|(?:đến|tới|qua)\s*(?:cuối\s*tuần|tuần\s*sau|cuối\s*tháng|tháng\s*sau|cuối\s*năm|năm\s*sau)|(?:hết|qua)\s*(?:tuần|tháng|năm)/.test(
      m,
    );

  const naturalBudgetingPattern =
    /còn\s*\d|có\s*\d|đang\s*có\s*\d|trong\s*tài\s*khoản|tài\s*khoản\s*còn|tiền\s*còn|phải\s*dùng|phải\s*tiêu|làm\s*sao\s*đủ|làm\s*sao\s*để\s*đủ|chia\s*tiền|phân\s*bổ\s*tiền|quản\s*lý\s*tiền|quản\s*lý\s*tài\s*chính|nên\s*làm\s*gì\s*với\s*tiền/.test(
      m,
    );

  if (
    personalFinancePattern ||
    (hasMoneyAmount && hasTimeHorizon) ||
    (hasMoneyAmount && naturalBudgetingPattern) ||
    hasMoneyAmount
  ) {
    return "personal_finance";
  }

  const marketPattern =
    /thị\s*trường|vn-?index|vn30|hnx|upcom|tổng\s*quan\s*thị\s*trường|diễn\s*biến\s*thị\s*trường|hôm\s*nay\s*thị\s*trường|phiên\s*hôm\s*nay|phiên\s*giao\s*dịch|chỉ\s*số|chứng\s*khoán|cổ\s*phiếu|crypto|tiền\s*điện\s*tử|bitcoin|btc|ethereum|eth|forex|ngoại\s*hối|vàng|dầu|hàng\s*hóa|commodity|market|market\s*overview/.test(
      m,
    );

  if (marketPattern) {
    return "market_overview";
  }

  if (
    /tiền|tài\s*chính|đầu\s*tư|vay|nợ|lương|thu\s*nhập|chi\s*tiêu|tiết\s*kiệm|bảo\s*hiểm|thuế|lãi|vốn/.test(
      m,
    )
  ) {
    return "personal_finance";
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
  playbookContext: string | null,
): string {
  const parts: string[] = [];

  parts.push(`Chủ đề gợi ý (nội bộ): ${intent}`);
  parts.push(`Nội dung khách hỏi: ${message}`);

  if (playbookContext) {
    parts.push(playbookContext);
  }

  if (intent === "personal_finance") {
    if (personalContext) {
      parts.push(personalContext);
    } else {
      parts.push(
        "Chưa có hồ sơ thu nhập/chi tiêu đầy đủ. Vẫn tư vấn ngay từ số liệu trong câu hỏi; nếu thiếu thì hỏi thêm tối đa 1–3 ý (thu nhập, chi cố định, nợ). Có thể gợi ý nhẹ việc lưu hồ sơ sau, nhưng đừng mở đầu bằng \"bạn chưa khai báo\".",
      );
    }
  } else if (intent === "corporate_finance") {
    if (corporateContext) {
      parts.push(corporateContext);
    } else {
      parts.push(
        "Chưa có BCTC đầy đủ. Đưa khung phân tích (dòng tiền, vốn lưu động, đòn bẩy, ROE/ROA) và hỏi số liệu then chốt — không đổ lỗi thiếu form/API.",
      );
    }
  } else if (intent === "wealth") {
    parts.push(
      "Wealth: bám khẩu vị rủi ro, chân trời, đa dạng hóa, tái cân bằng. Không gợi ý basket mã cố định.",
    );

    if (personalContext) {
      parts.push(personalContext);
    }
  } else if (intent === "general") {
    parts.push(
      "Trả lời mọi góc độ tiền bạc/tài chính liên quan câu hỏi. Dùng playbook nếu có; tính số khi khách đưa số. Không từ chối chỉ vì ngoài thị trường cổ phiếu.",
    );
  }

  if (market) {
    const idxLine = market.indices
      .map(
        (idx) =>
          `${idx.name} ở mức ${fmt(idx.close)} (${(idx.changePct ?? 0) >= 0 ? "+" : ""}${fmt(idx.changePct)}%)`,
      )
      .join("; ");

    parts.push(`Chỉ số hiện tại: ${idxLine}.`);

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

    if (a.reasons.length > 0) {
      parts.push(`Các lý do chính: ${a.reasons.join("; ")}.`);
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
      parts.push(`Tin liên quan mã: ${c.headlines.join("; ")}.`);
    }
  }

  if (
    contexts.length === 0 &&
    !market &&
    !personalContext &&
    !corporateContext
  ) {
    parts.push(
      "Câu hỏi này không bắt buộc số liệu thị trường. Trả lời theo nguyên tắc tài chính và số liệu khách đã nêu — đừng từ chối.",
    );
  }

  parts.push("Cuối cùng nhắc nhẹ: nội dung mang tính tham khảo.");

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
      conversationId?: string | null;
    };

    const message = body.message?.trim() ?? "";

    if (!message) {
      return fail("Missing message", 400);
    }

    if (message.length > 2000) {
      return fail("Message too long", 400);
    }

    const authedUser = await getAuthedUser(req).catch(() => null);
    const requestedConversationId =
      typeof body.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim()
        : null;

    const candidates = [
      ...new Set(
        [...message.toUpperCase().matchAll(TICKER_RE)].map((m) => m[1]),
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
        // skip
      }
    }

    const intent = detectIntent(message, validated.length > 0);

    const needMarket =
      intent === "market_ticker" || intent === "market_overview";

    const playbookContext = retrievePlaybookContext(message, intent) || null;

    const [contexts, market, newsRes, personalContext, corporateContext] =
      await Promise.all([
        Promise.all(validated.map(buildSymbolContext)).then((list) =>
          list.filter((c): c is SymbolContext => c !== null),
        ),

        needMarket || intent === "wealth"
          ? getMarketOverview().catch(() => null)
          : Promise.resolve(null),

        intent === "market_overview" || intent === "market_ticker"
          ? getNews({ limit: 6 }).catch(() => null)
          : Promise.resolve(null),

        intent === "personal_finance" || intent === "wealth"
          ? buildPersonalFinanceContext(authedUser?.id ?? null).catch(
              () => null,
            )
          : Promise.resolve(null),

        intent === "corporate_finance"
          ? buildCorporateFinanceContext(
              authedUser?.id ?? null,
              body.companyName,
            ).catch(() => null)
          : Promise.resolve(null),
      ]);

    const headlines =
      newsRes?.items?.map((n) => `${n.title} (${n.sourceName})`) ?? [];

    if (intent === "market_ticker" && contexts.length === 0) {
      return fail(
        "Không lấy được dữ liệu mã. Thử lại hoặc kiểm tra mã.",
        503,
      );
    }

    const deterministic = composeDeterministicAnswer(
      message,
      intent,
      contexts,
      market,
      headlines,
      personalContext,
      corporateContext,
      playbookContext,
    );

    const narrative = await agentNarrativeDetailed(message, deterministic);
    const llmResult = narrative.result;

    const answer = smoothAgentAnswer(
      llmResult?.text ?? buildAdvisorFallback(message, deterministic),
    );

    const model = llmResult
      ? `${llmResult.provider}/${llmResult.model}`
      : "rule-engine";

    const latencyMs = Date.now() - started;
    const envDiag = llmEnvDiagnostics();

    if (!llmResult) {
      logger.warn("agent_llm_fallback_rule_engine", {
        errors: narrative.errors,
        attempted: narrative.attempted,
        keysPresent: envDiag.keysPresent,
      });
    }

    const sessionId =
      req.cookies.get("vnstock_session")?.value ??
      req.cookies.get("refreshToken")?.value?.slice(0, 64) ??
      "";

    let conversationId: string | null = null;
    try {
      const saved = await appendChatTurn({
        userId: authedUser?.id ?? null,
        conversationId: requestedConversationId,
        sessionId,
        prompt: message,
        response: answer,
        model,
        latencyMs,
      });
      conversationId = saved.conversationId;
    } catch (err) {
      logger.error("agent_log_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return ok(
      {
        answer,
        model,
        intent,
        symbols: validated,
        conversationId,
        personalized: Boolean(personalContext || corporateContext),
        rag: Boolean(playbookContext),
        providersConfigured: listConfiguredProviders().map((p) => p.id),
        llmAttempted: narrative.attempted,
        llmErrors: llmResult ? undefined : narrative.errors.slice(0, 6),
        llmKeysPresent: envDiag.keysPresent,
      },
      {
        latencyMs,
        source: playbookContext
          ? "rag-playbook+data-engine+llm"
          : "data-engine+intent+llm",
        confidence: contexts[0]?.analysis.confidence ?? 0.85,
        llmProvider: llmResult?.provider ?? null,
      },
    );
  } catch (err) {
    return handleError(err, "agent_chat");
  }
}
