import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { syncForexOhlcv } from "@/lib/forex/service";
import { fetchForexBars } from "@/lib/forex/connectors";

const V = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const dynamic = "force-dynamic";
export const maxDuration = 8;

/** Hard wall clock for chart — target 1–3s; fail over at 2.8s. */
const HARD_MS = 2_800;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms),
    ),
  ]);
}

export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const l = checkRateLimit(req, 180);
  if (l) return l;

  const { symbol } = await c.params;
  const sym = symbol.toUpperCase();
  const tf = req.nextUrl.searchParams.get("timeframe") ?? "1h";
  if (!V.has(tf)) return fail("Invalid timeframe", 400);

  const limit = Math.min(
    200,
    Math.max(40, Number(req.nextUrl.searchParams.get("limit") ?? 120)),
  );

  try {
    let bars;
    let source = "yahoo-forex";

    try {
      const d = await withTimeout(syncForexOhlcv(sym, tf, limit), HARD_MS, "forex_ohlcv_svc");
      bars = d.bars;
      source = d.source;
    } catch (inner) {
      // Service slow/failed → direct Yahoo race (already parallel hosts)
      const live = await withTimeout(fetchForexBars(sym, tf, limit), HARD_MS, "yahoo_bars");
      bars = live.bars;
      source = `${live.source}-direct`;
      console.warn(
        "[forex_ohlcv] service/timeout → Yahoo direct",
        sym,
        tf,
        inner instanceof Error ? inner.message : inner,
      );
    }

    if (!bars?.length) {
      return fail(`Không có dữ liệu chart cho ${sym} (${tf})`, 502);
    }

    const response = ok(
      { symbol: sym, timeframe: tf, bars },
      { source, timezone: "Asia/Ho_Chi_Minh" },
    );
    // Edge cache: repeat TF switches hit CDN in <100ms
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=15, stale-while-revalidate=60",
    );
    response.headers.set(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=15, stale-while-revalidate=60",
    );
    return response;
  } catch (e) {
    return handleError(e, `forex_ohlcv:${sym}:${tf}`);
  }
}
