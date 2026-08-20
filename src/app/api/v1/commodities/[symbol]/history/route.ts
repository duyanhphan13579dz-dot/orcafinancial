import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getCommodityHistory } from "@/lib/commodities/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/commodities/:symbol/history?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns price history for a commodity in date range.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;

  const { symbol } = await ctx.params;
  const url = new URL(req.url);

  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  if (!fromStr || !toStr) {
    return fail("Missing 'from' or 'to' parameter", 400);
  }

  const from = new Date(fromStr);
  const to = new Date(toStr);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return fail("Invalid date format. Use YYYY-MM-DD", 400);
  }

  try {
    const sourceParam = url.searchParams.get("source") ?? undefined;

    if (
      sourceParam &&
      !["simplize", "vietnambiz"].includes(sourceParam)
    ) {
      return fail(
        "source phải là 'simplize' hoặc 'vietnambiz'",
        400,
      );
    }

    const history = await getCommodityHistory(
      symbol.toUpperCase(),
      from,
      to,
      sourceParam,
    );

    return ok(
      {
        symbol: symbol.toUpperCase(),
        from: fromStr,
        to: toStr,
        source: sourceParam ?? "all",
        history,
        count: history.length,
      },
      {
        cacheSeconds: 300,
      },
    );
  } catch (err) {
    return handleError(err, `commodity_history:${symbol}`);
  }
}
