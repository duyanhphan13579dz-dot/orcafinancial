/**
 * Route CHẨN ĐOÁN cho nguồn giá CafeF realtime.
 *
 * Vì sandbox/dev không luôn có mạng tới msh-datacenter.cafef.vn, route này cho
 * phép mở thẳng trên môi trường chạy thật để thấy: HTTP status thật, các khóa
 * JSON thật, bao nhiêu bản ghi parse được, và một mẫu response gốc. Dán kết quả
 * về cho người phát triển để khớp parser chính xác — không đoán mò.
 */
import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { fetchCafefRealtimeQuotes } from "@/lib/connectors/cafef-realtime";
import { getQuotes } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 20);
  if (limited) return limited;

  const requested = req.nextUrl.searchParams.get("symbols");
  const symbols = (
    requested ? requested.split(/[,;\s]+/).filter(Boolean) : ["VNM", "FPT", "VCB"]
  )
    .map((s) => s.toUpperCase())
    .slice(0, 10);

  try {
    const [result, baseline] = await Promise.all([
      fetchCafefRealtimeQuotes(symbols, fetch, true),
      getQuotes(symbols, { persist: false, allowStale: true, fast: true }).catch(() => []),
    ]);
    return ok(
      {
        requestedSymbols: symbols,
        sourceUrl: result.sourceUrl,
        httpStatus: result.debug.httpStatus,
        parsedQuotes: result.debug.parsed,
        matchedQuotes: result.debug.matched,
        topLevelKeys: result.debug.topLevelKeys,
        firstRecordKeys: result.debug.firstRecordKeys,
        warnings: result.warnings,
        quotes: result.quotes.slice(0, 10),
        // Giá EOD từ vndirect dchart — để đối chiếu nguồn nào lệch so với
        // terminal thật của người dùng.
        baselineEod: baseline.map((q) => ({
          symbol: q.symbol,
          close: q.close,
          changePct: q.changePct,
          source: q.source,
        })),
        sample: result.sample ?? null,
      },
      undefined,
      { cacheSeconds: 0 },
    );
  } catch (err) {
    return handleError(err, "realtime-debug");
  }
}
