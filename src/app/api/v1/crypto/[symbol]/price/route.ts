import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import {
  ensureCryptoFresh,
  getCryptoCoin,
} from "@/lib/crypto/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: {
    params: Promise<{ symbol: string }>;
  }
) {
  const limited = checkRateLimit(req, 180);

  if (limited) {
    return limited;
  }

  const { symbol } = await ctx.params;

  try {
    /*
     * Không cần refresh toàn bộ crypto market mỗi 5 giây.
     *
     * Price frontend hiện polling 10 giây.
     * Backend cho phép dữ liệu cũ tối đa khoảng 15 giây
     * trước khi cần refresh market.
     */
    const freshness = await ensureCryptoFresh(15_000);

    const data = await getCryptoCoin(symbol);

    if (!data?.price) {
      return fail("Price unavailable", 404);
    }

    return ok(
      {
        symbol: data.coin.symbol,
        price: data.price,
        freshness,
      },
      {
        timezone: "Asia/Ho_Chi_Minh",
      },
      { cacheSeconds: 5 },
    );
  } catch (err) {
    return handleError(
      err,
      `crypto_price:${symbol}`
    );
  }
}
