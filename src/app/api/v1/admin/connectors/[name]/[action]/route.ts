import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { logger } from "@/lib/logger";
import { getBreaker, resetBreaker } from "@/lib/connectors/core";
import {
  binancePrices,
  coingeckoPrices,
  fetchAllRssNews,
  vndirectHistory,
  vndirectSearch,
  yahooHistory,
} from "@/lib/connectors/providers";
import { ssiProbe } from "@/lib/connectors/ssi/client";
import { isSsiConfigured, isSsiWsEnabled } from "@/lib/connectors/ssi/config";
import { ssiAuthStatus } from "@/lib/connectors/ssi/auth";

export const dynamic = "force-dynamic";

type Action = "reset" | "test";

async function runTest(name: string): Promise<{ ok: boolean; durationMs: number; detail: string }> {
  const started = Date.now();
  const to = Math.floor(Date.now() / 1000);
  try {
    switch (name) {
      case "vndirect-dchart": {
        const bars = await vndirectHistory("VNM", to - 86400 * 30, to, "D");
        return { ok: true, durationMs: Date.now() - started, detail: `OK: ${bars.length} bars VNM (last ${bars[bars.length - 1].close})` };
      }
      case "yahoo-finance": {
        const bars = await yahooHistory("VNM", to - 86400 * 30, to, "D");
        return { ok: true, durationMs: Date.now() - started, detail: `OK: ${bars.length} bars VNM.VN (last ${bars[bars.length - 1].close})` };
      }
      case "coingecko": {
        const q = await coingeckoPrices();
        return { ok: true, durationMs: Date.now() - started, detail: `OK: ${q.length} coins (BTC=${q.find((c) => c.symbol === "BTC")?.priceUsd})` };
      }
      case "binance-vision": {
        const q = await binancePrices();
        return { ok: true, durationMs: Date.now() - started, detail: `OK: ${q.length} pairs (BTC=${q.find((c) => c.symbol === "BTC")?.priceUsd})` };
      }
      case "vnexpress-rss":
      case "cafef-rss":
      case "vietstock-rss": {
        const { items, errors } = await fetchAllRssNews();
        const fromSrc = items.filter((i) => i.source.toLowerCase().startsWith(name.split("-")[0])).length;
        return {
          ok: fromSrc > 0,
          durationMs: Date.now() - started,
          detail: fromSrc > 0 ? `OK: ${fromSrc} items từ ${name}` : `NO ITEMS. Errors: ${errors.join("; ")}`,
        };
      }
      case "search": {
        const r = await vndirectSearch("VN");
        return { ok: r.length > 0, durationMs: Date.now() - started, detail: `OK: ${r.length} results` };
      }
      case "ssi-fastconnect": {
        if (!isSsiConfigured()) {
          return {
            ok: false,
            durationMs: Date.now() - started,
            detail: "NOT CONFIGURED: set SSI_API_KEY + SSI_API_SECRET (+ SSI_CLIENT_ID).",
          };
        }
        const probe = await ssiProbe();
        const auth = await ssiAuthStatus();
        return {
          ok: probe.ok,
          durationMs: probe.latencyMs,
          detail: probe.ok
            ? `OK: ${probe.indices} indices · token cached=${auth.tokenCached} · ws enabled=${isSsiWsEnabled()}`
            : `FAIL: ${probe.error ?? "unknown"}`,
        };
      }
      default:
        return { ok: false, durationMs: Date.now() - started, detail: `No test probe for ${name} (internal module)` };
    }
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      detail: `FAIL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ name: string; action: string }> }) {
  const { name, action } = await ctx.params;
  if (action === "reset") {
    try {
      resetBreaker(name);
      getBreaker(name);
      logger.info("circuit_breaker_reset", { provider: name });
      return ok({ name, action: "reset", ok: true });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), 500);
    }
  }
  if (action === "test") {
    const result = await runTest(name);
    logger.info("connector_manual_test", { provider: name, ...result });
    return ok({ name, action: "test", ...result }, { durationMs: result.durationMs });
  }
  return fail(`Unknown action "${action}". Use reset|test.`, 400);
}
