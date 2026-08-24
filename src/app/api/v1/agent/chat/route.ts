import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { analyze, type AnalysisResult } from "@/lib/analysis";
import { mapPool, CONNECTOR_CONFIG, type Quote } from "@/lib/connectors/core";
import {
  generateFundamentalReport,
  type FundamentalReport,
} from "@/lib/fundamental";
import {
  listConfiguredProviders,
  llmEnvDiagnostics,
  smoothAgentAnswer,
  agentNarrativeDetailed,
} from "@/lib/llm";
import {
  getHistory,
  getMarketOverview,
  getNews,
  getQuote,
  searchSymbols,
} from "@/lib/market";
import { analyzeSentiment, sentimentLabel } from "@/lib/sentiment";
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
import {
  getCachedAgentAnswer,
  setCachedAgentAnswer,
  shouldCacheAgentAnswer,
  withAgentSingleFlight,
} from "@/lib/agent/response-cache";
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

  if (hasTickers) return "market_ticker";

  if (
    /doanh\s*nghiệp|công\s*ty|báo\s*cáo\s*tài\s*chính|bctc|vốn\s*lưu\s*động|cấu\s*trúc\s*vốn|ebitda|đòn\s*bẩy|working\s*capital|corporate\s*finance|sme|hộ\s*kinh\s*doanh/.test(
      m,
    )
  ) {
    return "corporate_finance";
  }

  if (
    /wealth|quản\s*lý\s*gia\s*sản|tài\s*sản\s*ròng|net\s*worth|phân\s*bổ\s*tài\s*sản|asset\s*allocation|hưu\s*trí|khẩu\s*vị\s*rủi\s*ro|đa\s*dạng\s*hóa|rebalancing|portfolio|etf/.test(
      m,
    )
  ) {
    return "wealth";
  }

  if (
    /ngân\s*sách|budget|tiết\s*kiệm|quỹ\s*khẩn|chi\s*tiêu|lương|thu\s*nhập|nợ\s*cá\s*nhân|trả\s*nợ|tài\s*chính\s*cá\s*nhân|personal\s*finance|thiếu\s*tiền|hết\s*tiền/.test(
      m,
    ) ||
    /(?:\d+(?:[.,]\d+)?)\s*(?:k|nghìn|triệu|tr|tỷ|tỉ|đ|vnđ|vnd|\$)/.test(m)
  ) {
    return "personal_finance";
  }

  if (
    /thị\s*trường|vn-?index|vn30|chứng\s*khoán|cổ\s*phiếu|crypto|bitcoin|forex|vàng|dầu|commodity|market|phân\s*tích|kết\s*quả\s*kinh\s*doanh|quý\s*\d/.test(
      m,
    )
  ) {
    return "market_overview";
  }

  if (/tiền|tài\s*chính|đầu\s*tư|vay|nợ|lương|chi\s*tiêu|tiết\s*kiệm/.test(m)) {
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

async function buildSymbolContext(symbol: string): Promise<SymbolContext | null> {
  try {
    const to = Math.floor(Date.now() / 1000);
    const [quote, hist, newsRes] = await Promise.all([
      getQuote(symbol),
      getHistory(symbol, to - 86400 * 180, to, "D"),
      getNews({ symbol, limit: 3 }).catch(() => null),
    ]);
    const bars = hist.bars;
    const fundamental = bars.length >= 60 ? generateFundamentalReport(symbol, bars) : null;
    const recentCandle = detectCandlestickPatterns(bars).filter(
      (p) => p.barIndex >= bars.length - 10,
    );
    const chartPats = detectChartPatterns(bars);
    const headlineText = (newsRes?.items ?? []).map((n) => n.title).join(" ");
    const sScore = analyzeSentiment(headlineText);
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

/** Raw numbers for LLM only — never shown directly to user. */
function composeDataContext(
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
  parts.push(`intent: ${intent}`);
  parts.push(`question: ${message}`);
  if (playbookContext) parts.push(playbookContext);
  if (personalContext) parts.push(personalContext);
  if (corporateContext) parts.push(corporateContext);
  if (market) {
    const idxLine = market.indices
      .map(
        (idx) =>
          `${idx.name}=${fmt(idx.close)} (${(idx.changePct ?? 0) >= 0 ? "+" : ""}${fmt(idx.changePct)}%)`,
      )
      .join("; ");
    parts.push(`indices: ${idxLine}`);
    parts.push(
      `breadth: sample=${market.breadth.sample} up=${market.breadth.advancers} down=${market.breadth.decliners}`,
    );
  }
  if (headlines.length > 0) parts.push(`news: ${headlines.slice(0, 5).join(" | ")}`);
  for (const c of contexts) {
    const a = c.analysis;
    parts.push(
      `symbol=${c.symbol} rec=${a.recommendation} conf=${(a.confidence * 100).toFixed(0)}% price=${fmt(a.lastClose)} d1=${fmt(a.changePct1d)}% m1=${fmt(a.changePct1m)}% src=${c.quote.source}`,
    );
    parts.push(
      `tech rsi14=${fmt(a.rsi14, 1)} macd_hist=${fmt(a.macd?.histogram, 3)} sma20=${fmt(a.sma20)} sma50=${fmt(a.sma50)}`,
    );
    if (a.supportResistance) {
      parts.push(
        `sr support=${fmt(a.supportResistance.support)} resist=${fmt(a.supportResistance.resistance)}`,
      );
    }
    if (a.reasons.length) parts.push(`reasons: ${a.reasons.join("; ")}`);
    if (c.fundamental) {
      const f = c.fundamental;
      parts.push(
        `fund health=${f.financialHealth.rating} score=${f.financialHealth.overallScore} eps=${fmt(f.eps)} roe=${fmt(f.roe)} pe=${fmt(f.valuation.pe, 1)} verdict=${f.valuation.verdictVi}`,
      );
    }
    parts.push(`sentiment=${c.sentimentLabel} score=${c.sentimentScore.toFixed(2)}`);
  }
  return parts.join("\n");
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 90);
  if (limited) return limited;

  const started = Date.now();

  try {
    const body = (await req.json()) as {
      message?: string;
      companyName?: string;
      conversationId?: string | null;
    };

    const message = body.message?.trim() ?? "";
    if (!message) return fail("Missing message", 400);
    if (message.length > 2000) return fail("Message too long", 400);

    const authedUser = await getAuthedUser(req);
    if (!authedUser) {
      return fail("Vui lòng đăng nhập để dùng AI Agent và lưu lịch sử chat.", 401, {
        code: "AUTH_REQUIRED",
      });
    }

    const envDiag = llmEnvDiagnostics();
    const providers = listConfiguredProviders();

    if (providers.length === 0) {
      return fail(
        "Chưa cấu hình LLM. Thêm ZAI_API_KEY (hoặc GLM_API_KEY) và/hoặc OPENROUTER_API_KEY trên Vercel Production rồi redeploy.",
        503,
        { code: "LLM_NOT_CONFIGURED", keysPresent: envDiag.keysPresent },
      );
    }

    const requestedConversationId =
      typeof body.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim()
        : null;
    const isFollowUp = Boolean(requestedConversationId);

    const candidates = [
      ...new Set([...message.toUpperCase().matchAll(TICKER_RE)].map((m) => m[1])),
    ].slice(0, 2);

    const earlyCache = await getCachedAgentAnswer(message, candidates);
    if (earlyCache && !earlyCache.model.includes("soft") && !earlyCache.model.includes("rule")) {
      const latencyMs = Date.now() - started;
      const sessionId =
        req.cookies.get("vnstock_session")?.value ??
        req.cookies.get("refreshToken")?.value?.slice(0, 64) ??
        authedUser.id.slice(0, 64);
      const saved = await appendChatTurn({
        userId: authedUser.id,
        conversationId: requestedConversationId,
        sessionId,
        prompt: message,
        response: earlyCache.answer,
        model: `${earlyCache.model}+cache`,
        latencyMs,
      });
      return ok(
        {
          answer: earlyCache.answer,
          model: `${earlyCache.model}+cache`,
          intent: earlyCache.intent,
          symbols: earlyCache.symbols,
          conversationId: saved.conversationId,
          historySaved: saved.saved,
          historyError: saved.error ?? null,
          cacheHit: true,
          providersConfigured: providers.map((p) => p.id),
        },
        {
          latencyMs,
          source: "redis-agent-cache",
          confidence: 0.9,
          llmProvider: null,
        },
      );
    }

    const validateSettled = await mapPool(
      candidates,
      CONNECTOR_CONFIG.searchConcurrency,
      async (c) => {
        const found = await searchSymbols(c);
        return found.some((f) => f.symbol === c) ? c : null;
      },
    );
    const validated: string[] = [];
    for (const r of validateSettled) {
      if (r.status === "fulfilled" && r.value) validated.push(r.value);
    }

    const intent = detectIntent(message, validated.length > 0);
    const needMarket = intent === "market_ticker" || intent === "market_overview";
    const playbookContext = retrievePlaybookContext(message, intent) || null;

    const [contexts, market, newsRes, personalContext, corporateContext] = await Promise.all([
      Promise.all(validated.map(buildSymbolContext)).then((list) =>
        list.filter((c): c is SymbolContext => c !== null),
      ),
      needMarket || intent === "wealth"
        ? getMarketOverview().catch(() => null)
        : Promise.resolve(null),
      intent === "market_overview" || intent === "market_ticker"
        ? getNews({ limit: 4 }).catch(() => null)
        : Promise.resolve(null),
      intent === "personal_finance" || intent === "wealth"
        ? buildPersonalFinanceContext(authedUser.id).catch(() => null)
        : Promise.resolve(null),
      intent === "corporate_finance"
        ? buildCorporateFinanceContext(authedUser.id, body.companyName).catch(() => null)
        : Promise.resolve(null),
    ]);

    const headlines = newsRes?.items?.map((n) => `${n.title} (${n.sourceName})`) ?? [];
    const personalized = Boolean(personalContext || corporateContext);

    if (intent === "market_ticker" && contexts.length === 0 && validated.length > 0) {
      return fail("Không lấy được dữ liệu mã. Thử lại sau vài giây.", 503);
    }

    // Data Engine → raw context only (never user-facing)
    const dataContext = composeDataContext(
      message,
      intent,
      contexts,
      market,
      headlines,
      personalContext,
      corporateContext,
      playbookContext,
    );

    const produced = await withAgentSingleFlight(message, validated, async () => {
      const narrative = await agentNarrativeDetailed(message, dataContext, {
        followUp: isFollowUp,
      });
      const llmResult = narrative.result;

      // LLM-first: if no LLM text, do NOT dump data-engine template to user
      if (!llmResult?.text?.trim()) {
        logger.error("agent_llm_unavailable", {
          errors: narrative.errors.slice(0, 4),
          attempted: narrative.attempted,
          transient: narrative.transient,
        });
        throw Object.assign(new Error("LLM_FAILED"), {
          llmErrors: narrative.errors,
          llmAttempted: narrative.attempted,
          keysPresent: envDiag.keysPresent,
          transient: narrative.transient,
        });
      }

      const answer = smoothAgentAnswer(llmResult.text);
      const model = `${llmResult.provider}/${llmResult.model}`;

      return {
        answer,
        model,
        intent,
        symbols: validated,
        cachedAt: Date.now(),
        _llmAttempted: narrative.attempted,
        _llmProvider: llmResult.provider,
      } as const;
    });

    const answer = produced.answer;
    const model = produced.model;
    const latencyMs = Date.now() - started;

    if (shouldCacheAgentAnswer(intent, personalized, message) && answer.length > 40) {
      void setCachedAgentAnswer(message, validated, {
        answer,
        model,
        intent,
        symbols: validated,
      });
    }

    const sessionId =
      req.cookies.get("vnstock_session")?.value ??
      req.cookies.get("refreshToken")?.value?.slice(0, 64) ??
      authedUser.id.slice(0, 64);

    const saved = await appendChatTurn({
      userId: authedUser.id,
      conversationId: requestedConversationId,
      sessionId,
      prompt: message,
      response: answer,
      model,
      latencyMs,
    });

    if (!saved.saved) {
      logger.error("agent_history_save_failed", {
        error: saved.error,
        userId: authedUser.id,
      });
    }

    return ok(
      {
        answer,
        model,
        intent,
        symbols: validated,
        conversationId: saved.conversationId,
        historySaved: saved.saved,
        historyError: saved.error ?? null,
        cacheHit: false,
        personalized,
        rag: Boolean(playbookContext),
        providersConfigured: providers.map((p) => p.id),
        llmAttempted: (produced as { _llmAttempted?: string[] })._llmAttempted,
        llmKeysPresent: envDiag.keysPresent,
      },
      {
        latencyMs,
        source: "llm+data-context",
        confidence: contexts[0]?.analysis.confidence ?? 0.85,
        llmProvider: (produced as { _llmProvider?: string | null })._llmProvider ?? null,
      },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "LLM_FAILED") {
      const e = err as Error & {
        llmErrors?: string[];
        llmAttempted?: string[];
        keysPresent?: Record<string, boolean>;
        transient?: boolean;
      };
      // Human message — never mechanical data-engine dump
      const retryHint = e.transient
        ? "Mô hình đang bận hoặc quá tải. Bạn thử gửi lại câu hỏi sau 5–10 giây nhé."
        : "Không kết nối được mô hình AI lúc này. Kiểm tra API key GLM/OpenRouter trên Vercel hoặc thử lại sau.";
      return fail(retryHint, 503, {
        code: "LLM_FAILED",
        llmErrors: e.llmErrors?.slice(0, 6),
        llmAttempted: e.llmAttempted,
        keysPresent: e.keysPresent,
      });
    }
    return handleError(err, "agent_chat");
  }
}
