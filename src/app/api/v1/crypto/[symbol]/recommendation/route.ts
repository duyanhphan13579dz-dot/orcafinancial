import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { runCryptoAnalysis } from "@/lib/crypto/service";
export const dynamic="force-dynamic";
const VALID=new Set(["1m","5m","15m","1h","4h","1d"]);
export async function GET(req:NextRequest,ctx:{params:Promise<{symbol:string}>}){const limited=checkRateLimit(req,60);if(limited)return limited;const{symbol}=await ctx.params;const timeframe=req.nextUrl.searchParams.get("timeframe")??"1h";if(!VALID.has(timeframe))return fail("Invalid timeframe",400);try{const a=await runCryptoAnalysis(symbol.toUpperCase(),timeframe);return ok({symbol:a.symbol,timeframe,recommendation:a.recommendation,entryPrice:a.entryPrice,stopLoss:a.stopLoss,takeProfit:a.takeProfit,confidence:a.confidence,reasons:a.reasons,sentiment:a.sentiment,disclaimer:a.disclaimer},{source:"binance+crypto-rss"});}catch(err){return handleError(err,`crypto_recommendation:${symbol}`);}}
