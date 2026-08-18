"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { changeColor, fmtNum, fmtPct, fmtVol, usePoll } from "@/lib/client";

interface Row { symbol:string; name:string; logoUrl:string|null; marketCapRank:number|null; price:number; priceVnd:number|null; volume24h:number|null; marketCap:number|null; change24h:number|null; source:string; timestamp:string }
export default function CryptoPage(){
 const feed=usePoll<{prices:Row[];freshness:Record<string,unknown>}>("/crypto/prices?limit=100",5000);
 const [query,setQuery]=useState(""); const [sort,setSort]=useState<"volume"|"gainers"|"losers">("volume");
 const rows=useMemo(()=>{const a=(feed.data?.prices??[]).filter(x=>!query||x.symbol.includes(query.toUpperCase())||x.name.toLowerCase().includes(query.toLowerCase()));return [...a].sort((x,y)=>sort==="gainers"?(y.change24h??0)-(x.change24h??0):sort==="losers"?(x.change24h??0)-(y.change24h??0):(y.volume24h??0)-(x.volume24h??0));},[feed.data,query,sort]);
 return <div className="space-y-5">
  <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="font-mono text-[10px] tracking-[.3em] text-[#00d4ff] uppercase">Binance Market Intelligence</div><h1 className="text-3xl font-black text-white mt-1">Thị trường Crypto</h1><p className="text-sm text-slate-400 mt-1">Giá USDT real-time 5 giây · Binance → CoinGecko → CoinPaprika</p></div><span className="inline-flex items-center gap-2 text-xs text-emerald-300"><i className="h-2 w-2 rounded-full bg-emerald-400 live-dot"/>LIVE</span></div>
  <div className="panel p-3 flex flex-col sm:flex-row gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm BTC, ETH, SOL..." className="Input flex-1"/><div className="flex gap-1">{[["volume","Thanh khoản"],["gainers","Tăng mạnh"],["losers","Giảm mạnh"]].map(([v,l])=><button key={v} onClick={()=>setSort(v as typeof sort)} className={`min-h-11 rounded-lg px-3 text-xs ${sort===v?"bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/40":"border border-slate-700 text-slate-400"}`}>{l}</button>)}</div></div>
  {feed.error&&<div className="panel border-rose-800 p-4 text-sm text-rose-300">{feed.error}</div>}
  {feed.loading&&!feed.data&&<div className="panel p-12 text-center text-slate-500">Đang đồng bộ Binance...</div>}
  <div className="panel overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b border-slate-700 text-xs text-slate-500"><th className="text-left p-3">Coin</th><th className="text-right">Giá USD</th><th className="text-right">Giá VND</th><th className="text-right">24h</th><th className="text-right">Volume 24h</th><th className="text-right pr-3">Nguồn</th></tr></thead><tbody>{rows.map(r=><tr key={r.symbol} className="border-b border-slate-800/70 hover:bg-slate-800/30"><td className="p-3"><Link href={`/crypto/${r.symbol}`} className="flex items-center gap-2">{r.logoUrl?<img src={r.logoUrl} alt="" className="h-8 w-8 rounded-full"/>:<span className="h-8 w-8 rounded-full bg-[#00d4ff]/15 flex items-center justify-center text-xs font-bold text-[#00d4ff]">{r.symbol.slice(0,2)}</span>}<div><div className="font-bold text-white">{r.symbol}</div><div className="text-[10px] text-slate-500">{r.name}</div></div></Link></td><td className="text-right font-mono">${fmtNum(r.price,r.price<1?6:2)}</td><td className="text-right font-mono text-slate-400">{r.priceVnd?fmtNum(r.priceVnd,0):"—"}</td><td className={`text-right font-mono font-bold ${changeColor(r.change24h)}`}>{fmtPct(r.change24h)}</td><td className="text-right text-slate-400">${fmtVol(r.volume24h)}</td><td className="text-right pr-3 text-[10px] text-slate-600">{r.source}</td></tr>)}</tbody></table></div>
  <div className="text-[10px] text-slate-600">Dữ liệu chỉ nhằm mục đích tham khảo. Giao dịch tài sản số có rủi ro cao.</div>
 </div>;
}
