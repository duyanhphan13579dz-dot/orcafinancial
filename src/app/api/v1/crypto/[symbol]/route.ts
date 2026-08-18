import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureCryptoFresh, enrichCryptoProfile } from "@/lib/crypto/service";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest,ctx:{params:Promise<{symbol:string}>}){const limited=checkRateLimit(req,120);if(limited)return limited;const{symbol}=await ctx.params;if(!/^[A-Z0-9]{2,15}$/i.test(symbol))return fail("Invalid symbol",400);try{await ensureCryptoFresh();const data=await enrichCryptoProfile(symbol.toUpperCase());if(!data)return fail("Coin not found",404);return ok(data,{timezone:"Asia/Ho_Chi_Minh"});}catch(err){return handleError(err,`crypto:${symbol}`);}}
