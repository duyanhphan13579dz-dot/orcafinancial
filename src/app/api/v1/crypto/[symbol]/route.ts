import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  fail,
  handleError,
  ok,
} from "@/lib/api";
import {
  ensureCryptoFresh,
  enrichCryptoProfile,
} from "@/lib/crypto/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: {
    params: Promise<{
      symbol: string;
    }>;
  },
) {
  const limited = checkRateLimit(
    req,
    120,
  );

  if (limited) {
    return limited;
  }

  const { symbol } =
    await ctx.params;

  const normalized =
    symbol.toUpperCase();

  if (
    !/^[A-Z0-9]{2,15}$/.test(
      normalized,
    )
  ) {
    return fail(
      "Invalid symbol",
      400,
    );
  }

  try {
    /*
     * Chỉ refresh market khi dữ liệu
     * thực sự cũ.
     */
    await ensureCryptoFresh(
      30_000,
    );

    const data =
      await enrichCryptoProfile(
        normalized,
      );

    if (!data) {
      return fail(
        "Coin not found",
        404,
      );
    }

    const response =
      ok(data, {
        source:
          "crypto-cache",
        timezone:
          "Asia/Ho_Chi_Minh",
      });

    /*
     * Browser:
     * cache 30 giây.
     *
     * Vercel/CDN:
     * cache 60 giây.
     *
     * stale-while-revalidate:
     * trong lúc refresh cache,
     * người dùng vẫn nhận dữ liệu cũ.
     */
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );

    response.headers.set(
      "CDN-Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );

    response.headers.set(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );

    return response;
  } catch (err) {
    return handleError(
      err,
      `crypto:${normalized}`,
    );
  }
}
