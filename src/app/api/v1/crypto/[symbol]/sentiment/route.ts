import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getLatestCryptoSentiment } from "@/lib/crypto/service";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest,ctx:{params:Promise<{symbol:string}>}){const limited=checkRateLimit(req,60);if(limited)return limited;const{symbol}=await ctx.params;try{return ok({symbol:symbol.toUpperCase(),...(await getLatestCryptoSentiment(symbol.toUpperCase()))},{source:"coindesk+cointelegraph-rss"});}catch(err){return handleError(err,`crypto_sentiment:${symbol}`);}}
