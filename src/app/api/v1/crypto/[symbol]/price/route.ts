import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureCryptoFresh, getCryptoCoin } from "@/lib/crypto/service";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest,ctx:{params:Promise<{symbol:string}>}){const limited=checkRateLimit(req,180);if(limited)return limited;const{symbol}=await ctx.params;try{const freshness=await ensureCryptoFresh(5000);const data=await getCryptoCoin(symbol);if(!data?.price)return fail("Price unavailable",404);return ok({symbol:data.coin.symbol,price:data.price,freshness},{timezone:"Asia/Ho_Chi_Minh"});}catch(err){return handleError(err,`crypto_price:${symbol}`);}}
