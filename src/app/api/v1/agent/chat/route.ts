import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { analyze, type AnalysisResult } from "@/lib/analysis";
import { type Quote } from "@/lib/connectors/core";
import {
  generateFundamentalReport,
  type FundamentalReport,
} from "@/lib/fundamental";
import {
  listConfiguredProviders,
  llmEnvDiagnostics,
  smoothAgentAnswer,
  agentNarrativeDetailed,
  buildAdvisorFallback,
} from "@/lib/llm";
import {
  getHistory,
  getMarketOverview,
  getNews,
  getQuote,
  searchSymbols,
} from "@/lib/market";
import { analyzeSentiment, sentimentLabel } from "@/lib/sentiment";
import { buildPersonalFinanceContext } from "@/lib/personal-finance/context";
import { buildCorporateFinanceContext } from "@/lib/corporate-finance/context";
import { retrievePlaybookContext } from "@/lib/rag";
import { appendChatTurn } from "@/lib/agent/history";
import { loadPreferredQuarterlyFinancials } from "@/lib/financial-ingestion";
import {
  getCachedAgentAnswer,
  setCachedAgentAnswer,
  shouldCacheAgentAnswer,
  withAgentSingleFlight,
} from "@/lib/agent/response-cache";
import { enrichAgentWithCrypto } from "@/lib/agent/crypto-enrich";
import { getDbHealth } from "@/db";
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

type SourceStatus = "ok" | "timeout" | "error" | "skipped" | "empty";

interface SourceReport {
  name: string;
  status: SourceStatus;
  ms?: number;
  detail?: string;
}

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
  reportedFinancials: Awaited<ReturnType<typeof loadPreferredQuarterlyFinancials>>["quarters"][number] | null;
  sentimentScore: number;
  sentimentLabel: string;
  headlines: string[];
  sources: SourceReport[];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function timedSettle<T>(
  label: string,
  ms: number,
  factory: () => Promise<T>,
): Promise<{ value: T | null; report: SourceReport }> {
  const t0 = Date.now();
  try {
    const value = await withTimeout(factory(), ms, label);
    return {
      value,
      report: { name: label, status: "ok", ms: Date.now() - t0 },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status: SourceStatus = /timeout/i.test(msg) ? "timeout" : "error";
    return {
      value: null,
      report: { name: label, status, ms: Date.now() - t0, detail: msg.slice(0, 120) },
    };
  }
}

/**
 * Quote from connectors uses OHLC fields (`close`), not `price`.
 */
function minimalAnalysis(symbol: string, quote: Quote): AnalysisResult {
  return {
    symbol,
    lastClose: quote.close,
    changePct1d: quote.changePct ?? null,
    changePct1m: null,
    volumeVsAvg20: null,
    rsi14: null,
    macd: null,
    sma20: null,
    sma50: null,
    bollinger: null,
    supportResistance: null,
    volatilityPct: null,
    maxDrawdownPct: null,
    recommendation: "Hold",
    score: 0,
    confidence: 0.4,
    reasons: ["Thiếu lịch sử đủ dài — chỉ có giá gần nhất."],
    multiTimeframe: { short: "NEUTRAL", medium: "NEUTRAL", long: "NEUTRAL" },
    accumulationDistribution: { score: 0, label: "NEUTRAL", volumeTrend: null },
  };
}

async function buildSymbolContext(symbol: string): Promise<SymbolContext | null> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400 * 90;

  const [quoteRes, histRes, newsRes] = await Promise.all([
    timedSettle(`${symbol}.quote`, 5_000, () => getQuote(symbol)),
    timedSettle(`${symbol}.history`, 6_000, () => getHistory(symbol, from, to, "D")),
    timedSettle(`${symbol}.news`, 3_500, () => getNews({ symbol, limit: 2 })),
  ]);

  const sources: SourceReport[] = [quoteRes.report, histRes.report, newsRes.report];

  if (!quoteRes.value) {
    logger.warn("agent_symbol_no_quote", { symbol, sources });
    return null;
  }

  const quote = quoteRes.value;
  const bars = histRes.value?.bars ?? [];
  const analysis = bars.length >= 20 ? analyze(symbol, bars) : minimalAnalysis(symbol, quote);
  const fundamental = bars.length >= 60 ? generateFundamentalReport(symbol, bars) : null;
  const reportedFinancials = (await loadPreferredQuarterlyFinancials(symbol, 1).catch(() => ({ quarters: [] })) ).quarters[0] ?? null;
  const items = newsRes.value?.items ?? [];
  const headlineText = items.map((n) => n.title).join(" ");
  const sScore = analyzeSentiment(headlineText);

  if (items.length === 0 && newsRes.report.status === "ok") {
    sources.push({ name: `${symbol}.news`, status: "empty", ms: newsRes.report.ms });
  }

  return {
    symbol,
    quote,
    analysis,
    fundamental,
    reportedFinancials,
    sentimentScore: sScore,
    sentimentLabel: sentimentLabel(sScore),
    headlines: items.map((n) => `${n.title} (${n.sourceName})`),
    sources,
  };
}

function fmt(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "n/a" : n.toFixed(digits);
}

function isFinancialClaimQuestion(message: string): boolean {
  return /\b(doanh thu|doanh số|lợi nhuận|lãi ròng|gross profit|ebitda|ebit|eps|tài sản|tổng tài sản|nợ|vốn chủ|vốn lưu động|biên lợi nhuận|roe|roa|cfo|cfi|cff|fcf|cash ?flow|dòng tiền|lưu chuyển tiền|bctc|báo cáo tài chính|kết quả kinh doanh|sức khỏe tài chính|định giá|giá trị nội tại|pe|p\/e|p\/b|ev\/ebitda)\b/i.test(message);
}

function composeHumanDataSummary(contexts: SymbolContext[]): string {
  const lines: string[] = [];
  for (const c of contexts) {
    const a = c.analysis;
    lines.push(
      `Với ${c.symbol}, khuyến nghị kỹ thuật ${a.recommendation} (độ tin cậy ${(a.confidence * 100).toFixed(0)}%). ` +
        `Giá ${fmt(a.lastClose)}, 1D ${fmt(a.changePct1d)}%, 1M ${fmt(a.changePct1m)}%.` +
        (a.rsi14 != null ? ` RSI(14) ${fmt(a.rsi14, 1)}.` : ""),
    );
    if (c.fundamental) {
      lines.push(
        `Sức khỏe tài chính ${c.fundamental.financialHealth.rating} (điểm ${c.fundamental.financialHealth.overallScore}).`,
      );
    }
  }
  return lines.join(" ");
}

function composeDataContext(
  message: string,
  intent: AgentIntent,
  contexts: SymbolContext[],
  market: Awaited<ReturnType<typeof getMarketOverview>> | null,
  headlines: string[],
  personalContext: string | null,
  corporateContext: string | null,
  playbookContext: string | null,
  sourceReports: SourceReport[],
  cryptoBlock?: string,
): string {
  const parts: string[] = [];
  const financialClaim = isFinancialClaimQuestion(message);
  parts.push(`intent: ${intent}`);
  parts.push(`data_policy=verify_source_then_rank_relevance; financial_claim=${financialClaim ? "true" : "false"}`);
  parts.push(`question: ${message}`);

  const failed = sourceReports.filter((s) => s.status === "timeout" || s.status === "error");
  if (failed.length > 0) {
    parts.push(
      `data_gaps: ${failed.map((f) => `${f.name}=${f.status}`).join(", ")} (trả lời dựa trên dữ liệu còn lại)`,
    );
  }

  if (playbookContext) parts.push(playbookContext.slice(0, 800));
  if (personalContext) parts.push(personalContext.slice(0, 600));
  if (corporateContext) parts.push(corporateContext.slice(0, 600));
  if (market) {
    const idxLine = market.indices
      .map(
        (idx) =>
          `${idx.name}=${fmt(idx.close)} (${(idx.changePct ?? 0) >= 0 ? "+" : ""}${fmt(idx.changePct)}%)`,
      )
      .join("; ");
    parts.push(`indices: ${idxLine}`);
  }
  if (headlines.length > 0) parts.push(`news: ${headlines.slice(0, 4).join(" | ")}`);
  for (const c of contexts) {
    const a = c.analysis;
    const quoteAgeSeconds = Math.max(0, Math.floor(Date.now() / 1000) - c.quote.time);
    parts.push(
      `symbol=${c.symbol} rec=${a.recommendation} conf=${(a.confidence * 100).toFixed(0)}% price=${fmt(a.lastClose)} d1=${fmt(a.changePct1d)}% m1=${fmt(a.changePct1m)}% src=${c.quote.source} quote_as_of=${new Date(c.quote.time * 1000).toISOString()} quote_age_seconds=${quoteAgeSeconds}`,
    );
    parts.push(
      `tech rsi14=${fmt(a.rsi14, 1)} macd_hist=${fmt(a.macd?.histogram, 3)} sma20=${fmt(a.sma20)} sma50=${fmt(a.sma50)}`,
    );
    if (a.supportResistance) {
      parts.push(
        `sr support=${fmt(a.supportResistance.support)} resist=${fmt(a.supportResistance.resistance)}`,
      );
    }
    if (a.reasons?.length) parts.push(`reasons: ${a.reasons.slice(0, 3).join("; ")}`);
    if (c.fundamental && (!financialClaim || c.reportedFinancials)) {
      const f = c.fundamental;
      parts.push(
        `market_proxy_fundamental health=${f.financialHealth.rating} score=${f.financialHealth.overallScore} pe=${fmt(f.valuation.pe, 1)} source=ohlcv-derived; not_reported_financials=true`,
      );
    } else if (c.fundamental) {
      parts.push(
        "market_proxy_fundamental=excluded_for_financial_claim; không dùng proxy OHLCV để khẳng định doanh thu, lợi nhuận, tài sản, nợ, dòng tiền hoặc định giá doanh nghiệp",
      );
    }
    if (c.reportedFinancials) {
      const q = c.reportedFinancials;
      parts.push(
        `reported_period=${q.period} reported_source=financial-ingestion reported_cashflow CFO=${fmt(q.cashflow.operatingCashFlow)} CFI=${fmt(q.cashflow.investingCashFlow)} CFF=${fmt(q.cashflow.financingCashFlow)} FCF=${fmt(q.cashflow.freeCashFlow)}`,
      );
    } else {
      parts.push("reported_cashflow=unavailable; không có CFO/CFI/CFF được xác minh cho mã này");
    }
    parts.push(`sentiment=${c.sentimentLabel} score=${c.sentimentScore.toFixed(2)}`);
  }
  if (cryptoBlock?.trim()) {
    parts.push(cryptoBlock.trim().slice(0, 4500));
  }
  return parts.join("\n");
}

function newRequestId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  } catch {
    return `r${Date.now().toString(36)}`;
  }
}

function publicLlmHint(errors: string[] | undefined, transient: boolean): string {
  if (transient) {
    return (
      "Hệ thống AI đang quá tải tạm thời (giới hạn tốc độ của nhà cung cấp). " +
      "Bạn thử lại sau khoảng 10–20 giây, hoặc hỏi lại câu ngắn hơn."
    );
  }
  const raw = errors?.[0] ?? "";
  if (/api.?key|not configured|missing/i.test(raw)) {
    return "Chưa cấu hình hoặc khóa API Groq không hợp lệ. Kiểm tra GROQ_API_KEY trên Vercel.";
  }
  return "Không kết nối được mô hình AI lúc này. Vui lòng thử lại sau ít phút.";
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 90);
  if (limited) return limited;

  const requestId = newRequestId();
  const started = Date.now();
  const allSources: SourceReport[] = [];

  try {
    const body = (await req.json()) as {
      message?: string;
      companyName?: string;
      conversationId?: string | null;
    };

    const message = body.message?.trim() ?? "";
    if (!message) return fail("Missing message", 400, { requestId });
    if (message.length > 2000) return fail("Message too long", 400, { requestId });

    const authedUser = await getAuthedUser(req);
    if (!authedUser) {
      return fail("Vui lòng đăng nhập để dùng AI Agent và lưu lịch sử chat.", 401, {
        code: "AUTH_REQUIRED",
        requestId,
      });
    }

    const envDiag = llmEnvDiagnostics();
    const providers = listConfiguredProviders();

    if (providers.length === 0) {
      return fail(
        "Chưa cấu hình LLM. Thêm GROQ_API_KEY trên Vercel Production rồi redeploy.",
        503,
        { code: "LLM_NOT_CONFIGURED", keysPresent: envDiag.keysPresent, requestId },
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
      }).catch(() => ({
        conversationId: requestedConversationId,
        saved: false as const,
        error: "history_skipped",
      }));

      logger.info("agent_request_complete", {
        requestId,
        cacheHit: true,
        latencyMs,
        intent: earlyCache.intent,
        symbols: earlyCache.symbols,
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
          requestId,
          providersConfigured: providers.map((p) => p.id),
        },
        {
          latencyMs,
          source: "redis-agent-cache",
          confidence: 0.9,
          llmProvider: null,
          requestId,
        },
      );
    }

    const validated: string[] = [];
    if (candidates.length > 0) {
      const checks = await Promise.all(
        candidates.map(async (c) => {
          const r = await timedSettle(`search.${c}`, 3_000, () => searchSymbols(c));
          allSources.push(r.report);
          return c;
        }),
      );
      validated.push(...checks);
    }

    const intent = detectIntent(message, validated.length > 0);
    const needMarket = intent === "market_ticker" || intent === "market_overview";
    const playbookContext = retrievePlaybookContext(message, intent) || null;

    const DATA_BUDGET_MS = 12_000;

    const dataStarted = Date.now();
    const [
      contextsSettled,
      marketSettled,
      newsSettled,
      pfSettled,
      dnSettled,
      cryptoEnrich,
    ] = await Promise.all([
      withTimeout(
        Promise.all(validated.map(buildSymbolContext)).then((list) =>
          list.filter((c): c is SymbolContext => c !== null),
        ),
        DATA_BUDGET_MS,
        "symbols",
      ).catch(() => [] as SymbolContext[]),
      needMarket || intent === "wealth"
        ? timedSettle("market.overview", 5_000, () => getMarketOverview())
        : Promise.resolve({
            value: null as Awaited<ReturnType<typeof getMarketOverview>> | null,
            report: { name: "market.overview", status: "skipped" as SourceStatus },
          }),
      intent === "market_overview" || intent === "market_ticker"
        ? timedSettle("news.list", 3_500, () => getNews({ limit: 3 }))
        : Promise.resolve({
            value: null as Awaited<ReturnType<typeof getNews>> | null,
            report: { name: "news.list", status: "skipped" as SourceStatus },
          }),
      intent === "personal_finance" || intent === "wealth"
        ? timedSettle("personal_finance", 2_500, () =>
            buildPersonalFinanceContext(authedUser.id),
          )
        : Promise.resolve({
            value: null as string | null,
            report: { name: "personal_finance", status: "skipped" as SourceStatus },
          }),
      intent === "corporate_finance"
        ? timedSettle("corporate_finance", 2_500, () =>
            buildCorporateFinanceContext(authedUser.id, body.companyName),
          )
        : Promise.resolve({
            value: null as string | null,
            report: { name: "corporate_finance", status: "skipped" as SourceStatus },
          }),
      enrichAgentWithCrypto(message, [...candidates, ...validated]),
    ]);

    const contexts = Array.isArray(contextsSettled) ? contextsSettled : [];
    for (const c of contexts) allSources.push(...c.sources);
    allSources.push(marketSettled.report, newsSettled.report, pfSettled.report, dnSettled.report);

    if (cryptoEnrich.block) {
      allSources.push({
        name: "crypto.intel",
        status: "ok",
        detail: cryptoEnrich.layersOk.join(",") || "partial",
      });
    } else if (cryptoEnrich.cryptoSymbols.length) {
      allSources.push({ name: "crypto.intel", status: "empty" });
    }

    const market = marketSettled.value;
    const newsRes = newsSettled.value;
    const personalContext = pfSettled.value;
    const corporateContext = dnSettled.value;

    const headlines = newsRes?.items?.map((n) => `${n.title} (${n.sourceName})`) ?? [];
    const personalized = Boolean(personalContext || corporateContext);

    const dataContext = composeDataContext(
      message,
      intent,
      contexts,
      market,
      headlines,
      personalContext,
      corporateContext,
      playbookContext,
      allSources,
      cryptoEnrich.block,
    );

    const dbHealth = getDbHealth();
    const dataMs = Date.now() - dataStarted;

    const responseSymbols = [
      ...new Set([...validated, ...cryptoEnrich.cryptoSymbols]),
    ];

    logger.info("agent_data_ready", {
      requestId,
      intent,
      symbols: responseSymbols,
      cryptoLayers: cryptoEnrich.layersOk,
      contextChars: dataContext.length,
      dataMs,
      sources: allSources.map((s) => `${s.name}:${s.status}${s.ms != null ? `(${s.ms}ms)` : ""}`),
      dbStatus: dbHealth.status,
      failedSources: allSources.filter((s) => s.status === "timeout" || s.status === "error").length,
    });

    const llmStarted = Date.now();
    const asksForCashflow = /\b(cfo|cfi|cff|cash ?flow|dòng tiền|lưu chuyển tiền|hoạt động kinh doanh|chi đầu tư|dòng tiền tài chính)\b/i.test(message);
    const asksForReportedFinancials = isFinancialClaimQuestion(message) && responseSymbols.length > 0;
    const hasReportedFinancials = contexts.length > 0 && contexts.every((c) => Boolean(c.reportedFinancials));
    const produced = await withAgentSingleFlight(message, responseSymbols, async () => {
      if (asksForReportedFinancials && !hasReportedFinancials) {
        return {
          answer: asksForCashflow
            ? "Mình chưa có báo cáo lưu chuyển tiền tệ thật đã xác minh cho mã này, nên không thể cung cấp hoặc ước lượng CFO, CFI hay CFF. Bạn hãy import BCTC quý tương ứng rồi mình sẽ tính và phân tích từ số liệu nguồn."
            : "Mình chưa có BCTC thật đã xác minh cho mã này, nên không thể kết luận chính xác về doanh thu, lợi nhuận, tài sản, nợ, sức khỏe tài chính hoặc định giá. Bạn hãy import báo cáo đúng kỳ; hiện mình chỉ có thể cung cấp góc nhìn thị trường/proxy và không dùng proxy đó để thay thế BCTC.",
          model: "rule-engine/no-reported-financials",
          intent,
          symbols: responseSymbols,
          cachedAt: Date.now(),
          _llmAttempted: [],
          _llmProvider: "rule-engine",
          _llmMs: Date.now() - llmStarted,
          _soft: true,
        } as const;
      }

      const narrative = await agentNarrativeDetailed(message, dataContext, {
        followUp: isFollowUp,
      });
      const llmResult = narrative.result;

      if (llmResult?.text?.trim()) {
        const answer = smoothAgentAnswer(llmResult.text);
        const model = `${llmResult.provider}/${llmResult.model}`;
        return {
          answer,
          model,
          intent,
          symbols: responseSymbols,
          cachedAt: Date.now(),
          _llmAttempted: narrative.attempted,
          _llmProvider: llmResult.provider,
          _llmMs: Date.now() - llmStarted,
          _soft: false,
        } as const;
      }

      const humanSummary = composeHumanDataSummary(contexts);
      const softCtx =
        [humanSummary, cryptoEnrich.block].filter(Boolean).join("\n") || dataContext;
      if (softCtx.length > 40) {
        const softAnswer = buildAdvisorFallback(message, softCtx);
        logger.warn("agent_llm_soft_fallback", {
          requestId,
          transient: narrative.transient,
          errors: narrative.errors.slice(0, 3),
          attempted: narrative.attempted,
        });
        return {
          answer: softAnswer,
          model: "rule-engine/soft",
          intent,
          symbols: responseSymbols,
          cachedAt: Date.now(),
          _llmAttempted: narrative.attempted,
          _llmProvider: null as string | null,
          _llmMs: Date.now() - llmStarted,
          _soft: true,
          _llmErrors: narrative.errors,
        } as const;
      }

      logger.error("agent_llm_unavailable", {
        requestId,
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
    });

    const answer = produced.answer;
    const model = produced.model;
    const latencyMs = Date.now() - started;
    const llmMs = (produced as { _llmMs?: number })._llmMs ?? null;
    const soft = Boolean((produced as { _soft?: boolean })._soft);

    if (
      !soft &&
      shouldCacheAgentAnswer(intent, personalized, message) &&
      answer.length > 40
    ) {
      void setCachedAgentAnswer(message, responseSymbols, {
        answer,
        model,
        intent,
        symbols: responseSymbols,
      });
    }

    const sessionId =
      req.cookies.get("vnstock_session")?.value ??
      req.cookies.get("refreshToken")?.value?.slice(0, 64) ??
      authedUser.id.slice(0, 64);

    let saved: { conversationId: string | null; saved: boolean; error?: string } = {
      conversationId: requestedConversationId,
      saved: false,
    };
    try {
      saved = await withTimeout(
        appendChatTurn({
          userId: authedUser.id,
          conversationId: requestedConversationId,
          sessionId,
          prompt: message,
          response: answer,
          model,
          latencyMs,
        }),
        3_000,
        "history",
      );
    } catch (err) {
      logger.warn("agent_history_save_failed", {
        requestId,
        error: err instanceof Error ? err.message : String(err),
        userId: authedUser.id,
      });
      saved = {
        conversationId: requestedConversationId,
        saved: false,
        error: err instanceof Error ? err.message : "history_timeout",
      };
    }

    const failedSources = allSources.filter(
      (s) => s.status === "timeout" || s.status === "error",
    );

    logger.info("agent_request_complete", {
      requestId,
      final: soft ? "SOFT_SUCCESS" : "SUCCESS",
      latencyMs,
      dataMs,
      llmMs,
      intent,
      symbols: responseSymbols,
      model,
      llmProvider: (produced as { _llmProvider?: string | null })._llmProvider ?? null,
      dbStatus: dbHealth.status,
      sourcesOk: allSources.filter((s) => s.status === "ok").length,
      sourcesFailed: failedSources.length,
      failed: failedSources.map((f) => `${f.name}:${f.status}`),
      historySaved: saved.saved,
    });

    return ok(
      {
        answer,
        model,
        intent,
        symbols: responseSymbols,
        cryptoSymbols: cryptoEnrich.cryptoSymbols,
        cryptoLayers: cryptoEnrich.layersOk,
        conversationId: saved.conversationId,
        historySaved: saved.saved,
        historyError: saved.error ?? null,
        cacheHit: false,
        personalized,
        rag: Boolean(playbookContext),
        soft,
        requestId,
        providersConfigured: providers.map((p) => p.id),
        llmAttempted: (produced as { _llmAttempted?: string[] })._llmAttempted,
        llmKeysPresent: envDiag.keysPresent,
        diagnostics: {
          dataMs,
          llmMs,
          dbStatus: dbHealth.status,
          sources: allSources,
          partial: failedSources.length > 0,
          soft,
        },
      },
      {
        latencyMs,
        source: soft ? "data-engine→rule-soft" : "data-engine→llm",
        confidence: soft
          ? 0.55
          : contexts[0]?.analysis.confidence ?? (cryptoEnrich.block ? 0.75 : 0.85),
        llmProvider: (produced as { _llmProvider?: string | null })._llmProvider ?? null,
        requestId,
      },
    );
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof Error && err.message === "LLM_FAILED") {
      const e = err as Error & {
        llmErrors?: string[];
        llmAttempted?: string[];
        keysPresent?: Record<string, boolean>;
        transient?: boolean;
      };

      const retryHint = publicLlmHint(e.llmErrors, Boolean(e.transient));

      logger.error("agent_request_failed", {
        requestId,
        final: "LLM_FAILED",
        latencyMs,
        llmErrors: e.llmErrors?.slice(0, 4),
        sources: allSources,
      });

      return fail(retryHint, 503, {
        code: "LLM_FAILED",
        requestId,
        llmErrors: e.llmErrors?.slice(0, 6),
        llmAttempted: e.llmAttempted,
        keysPresent: e.keysPresent,
      });
    }

    logger.error("agent_request_failed", {
      requestId,
      final: "ERROR",
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
      sources: allSources,
    });

    return handleError(err, `agent_chat:${requestId}`);
  }
}
