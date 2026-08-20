import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { runCryptoAnalysis } from "@/lib/crypto/service";
export const dynamic="force-dynamic";
const VALID=new Set(["1m","5m","15m","1h","4h","1d"]);
export async function GET(req:NextRequest,ctx:{params:Promise<{symbol:string}>}){const limited=checkRateLimit(req,60);if(limited)return limited;const{symbol}=await ctx.params;const timeframe=req.nextUrl.searchParams.get("timeframe")??"1h";if(!VALID.has(timeframe))return fail("Invalid timeframe",400);try{return ok(await runCryptoAnalysis(symbol.toUpperCase(),timeframe),{timezone:"Asia/Ho_Chi_Minh"},{cacheSeconds:20});}catch(err){return handleError(err,`crypto_analysis:${symbol}`);}}
