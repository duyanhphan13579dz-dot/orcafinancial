import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureCryptoFresh, listCryptoCoins } from "@/lib/crypto/service";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const limited=checkRateLimit(req,120); if(limited)return limited;
  try { const q=req.nextUrl.searchParams; const freshness=await ensureCryptoFresh(); const data=await listCryptoCoins({search:q.get("q")??undefined,page:Number(q.get("page")??1),limit:Number(q.get("limit")??30)}); return ok({...data,freshness},{source:"binance→coingecko→coinpaprika",timezone:"Asia/Ho_Chi_Minh"}); }
  catch(err){return handleError(err,"crypto_coins");}
}
