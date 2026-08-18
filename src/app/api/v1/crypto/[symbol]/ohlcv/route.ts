import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getCryptoOhlcv } from "@/lib/crypto/service";
export const dynamic="force-dynamic";
const VALID=new Set(["1m","5m","15m","1h","4h","1d"]);
export async function GET(req:NextRequest,ctx:{params:Promise<{symbol:string}>}){const limited=checkRateLimit(req,120);if(limited)return limited;const{symbol}=await ctx.params;const timeframe=req.nextUrl.searchParams.get("timeframe")??"1h";if(!VALID.has(timeframe))return fail("Invalid timeframe",400);const limit=Math.min(1000,Math.max(20,Number(req.nextUrl.searchParams.get("limit")??300)));try{const data=await getCryptoOhlcv(symbol.toUpperCase(),timeframe,limit);return ok({symbol:data.coin.symbol,timeframe,bars:data.bars},{source:data.source,timezone:"Asia/Ho_Chi_Minh"});}catch(err){return handleError(err,`crypto_ohlcv:${symbol}`);}}
