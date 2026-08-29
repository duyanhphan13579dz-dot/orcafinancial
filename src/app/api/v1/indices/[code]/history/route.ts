import { NextRequest } from "next/server";
import { GET as stockHistoryGET } from "@/app/api/v1/stocks/[symbol]/history/route";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;
  return stockHistoryGET(req, {
    params: Promise.resolve({ symbol: code }),
  });
}
