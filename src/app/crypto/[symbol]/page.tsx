"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CandleChart, type Bar } from "@/components/candle-chart";
import { changeColor, fmtNum, fmtPct, fmtVol, usePoll } from "@/lib/client";

interface Detail { coin:{symbol:string;name:string;logoUrl:string|null;website:string|null;description:string|null;marketCapRank:number|null;circulatingSupply:number|null;totalSupply:number|null;maxSupply:number|null};price:{price:number;priceVnd:number|null;volume24h:number|null;marketCap:number|null;change24h:number|null;source:string;timestamp:string}|null }
interface Analysis { recommendation:"LONG"|"SHORT"|"NEUTRAL";entryPrice:number;stopLoss:number|null;takeProfit:number|null;confidence:number;reasons:string[];sentiment:number;indicators:Record<string,any>;candlestickPatterns:Array<{nameVi:string;type:string;reliability:number}>;chartPatterns:Array<{nameVi:string;type:string;reliability:number}>;disclaimer:string }
const TFS=["1m","5m","15m","1h","4h","1d"];
export default function CryptoDetail(){
 const symbol=String(useParams().symbol).toUpperCase(); const [tf,setTf]=useState("1h");
 const detail=usePoll<Detail>(`/crypto/${symbol}`,60000); const realtime=usePoll<{price:Detail["price"]}>(`/crypto/${symbol}/price`,5000);
 const ohlcv=usePoll<{bars:Bar[]}>(`/crypto/${symbol}/ohlcv?timeframe=${tf}&limit=300`,15000);
 const analysis=usePoll<Analysis>(`/crypto/${symbol}/analysis?timeframe=${tf}`,60000);
 const sentiment=usePoll<{score:number;label:string;articles?:Array<{title:string;link:string;source:string;publishedAt:string}>}>(`/crypto/${symbol}/sentiment`,15*60_000);
 const coin=detail.data?.coin, price=realtime.data?.price??detail.data?.price, a=analysis.data;
 const recoStyle=a?.recommendation==="LONG"?"border-emerald-600 bg-emerald-500/10 text-emerald-300":a?.recommendation==="SHORT"?"border-rose-600 bg-rose-500/10 text-rose-300":"border-amber-600 bg-amber-500/10 text-amber-300";
 return <div className="space-y-5">
  <div><Link href="/crypto" className="text-xs text-[#00d4ff]">← Thị trường Crypto</Link></div>
  <div className="panel p-4 flex flex-wrap items-center gap-4">{coin?.logoUrl?<img src={coin.logoUrl} alt="" className="h-12 w-12 rounded-full"/>:<div className="h-12 w-12 rounded-full bg-[#00d4ff]/15 flex items-center justify-center font-bold">{symbol.slice(0,2)}</div>}<div><div className="flex items-center gap-2"><h1 className="text-2xl font-black text-white">{coin?.name??symbol}</h1><span className="text-slate-500">{symbol}</span><span className="h-2 w-2 rounded-full bg-emerald-400 live-dot"/></div><div className="text-[10px] text-slate-500">Nguồn giá: {price?.source??"—"} · GMT+7</div></div><div className="sm:ml-auto"><div className="text-3xl font-black text-white">${fmtNum(price?.price,price?.price&&price.price<1?6:2)}</div><div className={`text-right font-bold ${changeColor(price?.change24h)}`}>{fmtPct(price?.change24h)}</div></div></div>

  <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
   <div className="panel p-3 xl:col-span-2"><div className="flex flex-wrap justify-between gap-2 mb-2"><h2 className="font-semibold text-white">Biểu đồ {symbol}/USDT</h2><div className="flex gap-1 overflow-x-auto">{TFS.map(x=><button key={x} onClick={()=>setTf(x)} className={`min-h-9 px-3 rounded text-xs ${tf===x?"bg-[#00d4ff] text-[#0A2540]":"bg-slate-800 text-slate-400"}`}>{x}</button>)}</div></div>{ohlcv.data?<CandleChart bars={ohlcv.data.bars} height={400}/>:<div className="h-96 flex items-center justify-center text-slate-500">Đang tải Binance klines...</div>}</div>
   <div className={`panel border p-4 ${recoStyle}`}><div className="text-[10px] tracking-[.25em] uppercase opacity-70">Tín hiệu định lượng</div><div className="text-4xl font-black mt-2">{a?.recommendation??"—"}</div><div className="text-sm mt-1">Confidence {a?`${Math.round(a.confidence*100)}%`:"—"}</div><div className="mt-4 grid grid-cols-2 gap-y-2 text-xs"><span className="opacity-60">Entry</span><span className="text-right font-mono">${fmtNum(a?.entryPrice,4)}</span><span className="opacity-60">Stop Loss</span><span className="text-right font-mono">${fmtNum(a?.stopLoss,4)}</span><span className="opacity-60">Take Profit</span><span className="text-right font-mono">${fmtNum(a?.takeProfit,4)}</span></div><ul className="mt-4 text-xs space-y-1 opacity-90">{a?.reasons.slice(0,6).map((r,i)=><li key={i}>• {r}</li>)}</ul><div className="mt-4 text-[9px] opacity-60">Không phải lời khuyên đầu tư.</div></div>
  </div>

  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
   <div className="panel p-4"><h2 className="font-semibold text-white mb-3">Chỉ báo kỹ thuật</h2><div className="grid grid-cols-2 gap-2 text-xs">{a&&Object.entries(a.indicators).filter(([,v])=>typeof v==="number"||v===null).map(([k,v])=><div key={k} className="rounded bg-slate-900/40 p-2"><div className="text-slate-500">{k}</div><div className="font-mono text-white mt-1">{typeof v==="number"?fmtNum(v,4):"—"}</div></div>)}</div></div>
   <div className="panel p-4"><h2 className="font-semibold text-white mb-3">Sentiment</h2><div className="text-3xl font-black text-white">{sentiment.data?.score!=null?(sentiment.data.score>0?"+":"")+sentiment.data.score.toFixed(2):"—"}</div><div className="text-sm text-slate-400">{sentiment.data?.label??"Đang phân tích RSS..."}</div><div className="mt-3 space-y-2">{sentiment.data?.articles?.slice(0,4).map((n,i)=><a key={i} href={n.link} target="_blank" rel="noreferrer" className="block text-xs text-slate-400 hover:text-[#00d4ff] line-clamp-2">{n.title} · {n.source}</a>)}</div></div>
   <div className="panel p-4"><h2 className="font-semibold text-white mb-3">Thông tin thị trường</h2><dl className="grid grid-cols-2 gap-y-2 text-xs"><dt className="text-slate-500">Market cap</dt><dd className="text-right">${fmtVol(price?.marketCap)}</dd><dt className="text-slate-500">Volume 24h</dt><dd className="text-right">${fmtVol(price?.volume24h)}</dd><dt className="text-slate-500">Rank</dt><dd className="text-right">#{coin?.marketCapRank??"—"}</dd><dt className="text-slate-500">Circulating</dt><dd className="text-right">{fmtVol(coin?.circulatingSupply)}</dd><dt className="text-slate-500">Max supply</dt><dd className="text-right">{fmtVol(coin?.maxSupply)}</dd></dl>{coin?.website&&<a href={coin.website} target="_blank" rel="noreferrer" className="mt-3 block text-xs text-[#00d4ff]">Website chính thức ↗</a>}</div>
  </div>
  {coin?.description&&<div className="panel p-4"><h2 className="font-semibold text-white mb-2">Giới thiệu</h2><p className="text-sm text-slate-400 leading-relaxed line-clamp-6">{coin.description}</p></div>}
 </div>;
}
