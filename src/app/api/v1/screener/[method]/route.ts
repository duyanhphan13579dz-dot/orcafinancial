import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import { FEATURED_SYMBOLS, getHistory } from "@/lib/market";
import { ensureQuarterlyFinancials } from "@/lib/company-service";
import { calculateRSRating } from "@/lib/screener/utils";
import { screenCANSLIM } from "@/lib/screener/canslim";
import { screenMinervini } from "@/lib/screener/minervini";
import { screenWyckoff } from "@/lib/screener/wyckoff";
import { screenElliott } from "@/lib/screener/elliott";

export const dynamic = "force-dynamic";

const METHOD_IDS = ["canslim", "minervini", "wyckoff", "elliott"] as const;
type Method = (typeof METHOD_IDS)[number];

async function getUniverseData() {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400 * 365;
  const results = await Promise.all(
    FEATURED_SYMBOLS.map(async (symbol) => {
      try {
        const { bars } = await getHistory(symbol, from, to, "D");
        return { symbol, bars };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is { symbol: string; bars: any[] } => r !== null);
}

function parseMinScore(raw: string | null): { value: number; error: string | null } {
  if (raw === null || raw === "") return { value: 70, error: null };
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    return { value: 0, error: "minScore must be integer between 1 and 100" };
  }
  return { value: n, error: null };
}

export async function GET(req: NextRequest) {
  const method = (req.nextUrl.pathname.split("/").pop() ?? "") as Method;
  if (!METHOD_IDS.includes(method)) return fail(`Unknown screener method "${method}". Use one of: ${METHOD_IDS.join(", ")}`, 400);

  const { value: minScore, error: msErr } = parseMinScore(req.nextUrl.searchParams.get("minScore"));
  if (msErr) return fail(msErr, 400);

  try {
    const universe = await getUniverseData();
    const rsRatings = calculateRSRating(universe);

    // CANSLIM needs quarterly financials per symbol. This used to be a
    // `for (...) await ensureQuarterlyFinancials(...)` loop — one DB/upstream
    // round-trip at a time, so total latency scaled linearly with universe
    // size (~27 symbols sequentially). Fetch them all concurrently instead;
    // order is preserved via the returned array index, and a failed lookup
    // degrades to an empty financials array exactly as before.
    const financialsBySymbol =
      method === "canslim"
        ? new Map(
            (
              await Promise.all(
                universe.map((item) =>
                  ensureQuarterlyFinancials(item.symbol, 5)
                    .catch(() => [])
                    .then((financials) => [item.symbol, financials] as const),
                ),
              )
            ),
          )
        : null;

    const results: Array<ReturnType<typeof screenCANSLIM> | ReturnType<typeof screenMinervini> | ReturnType<typeof screenWyckoff> | ReturnType<typeof screenElliott>> = [];

    for (const item of universe) {
      const rs = rsRatings.get(item.symbol) || 0;
      if (method === "canslim") {
        const financials = financialsBySymbol!.get(item.symbol) ?? [];
        results.push(screenCANSLIM(item.symbol, item.bars, financials, rs));
      } else if (method === "minervini") {
        results.push(screenMinervini(item.symbol, item.bars, rs));
      } else if (method === "wyckoff") {
        results.push(screenWyckoff(item.symbol, item.bars));
      } else if (method === "elliott") {
        results.push(screenElliott(item.symbol, item.bars));
      }
    }

    const total = results.length;
    const passed = results.filter((r) => r.score >= minScore).sort((a, b) => b.score - a.score);

    return ok(
      {
        method,
        minScore,
        universeSize: universe.length,
        totalEvaluated: total,
        passedCount: passed.length,
        results: passed,
      },
      { source: `screener/${method}`, minScore, passed: passed.length, total },
    );
  } catch (err) {
    return handleError(err, `screener:${method}`);
  }
}
