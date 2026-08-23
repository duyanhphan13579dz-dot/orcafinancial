"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

interface StockHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export function SearchBar() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<StockHit[]>([]);
  const [open, setOpen] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const search = (value: string) => {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    if (!value.trim()) {
      setHits([]);
      setOpen(false);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const started = performance.now();
        const env = await api<{ stocks: StockHit[] }>(`/search?q=${encodeURIComponent(value)}&type=stock`);
        setLatency(Math.round(performance.now() - started));
        setHits(env.data.stocks.slice(0, 8));
        setOpen(true);
      } catch {
        setHits([]);
      }
    }, 200);
  };

  return (
    <div ref={boxRef} className="relative w-full z-50">
      <div className="flex items-center gap-2 rounded-lg border border-[#1a3558] bg-[#0e2e4f] px-3 py-2 min-h-[40px] focus-within:border-[#00d4ff]/60 focus-within:ring-1 focus-within:ring-[#00d4ff]/30 transition-colors">
        <span className="text-slate-500 text-sm shrink-0 select-none" aria-hidden>
          ⌕
        </span>
        <input
          value={q}
          onChange={(e) => search(e.target.value)}
          onFocus={() => {
            if (hits.length > 0) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) {
              router.push(`/stocks/${hits[0].symbol}`);
              setOpen(false);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Tìm mã CK, công ty… (VNM, HPG, FPT)"
          className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          autoComplete="off"
          spellCheck={false}
        />
        {latency !== null && open && (
          <span className="text-[10px] text-slate-600 shrink-0 tabular-nums">{latency}ms</span>
        )}
      </div>
      {open && hits.length > 0 && (
        <div className="absolute left-0 right-0 z-[60] mt-1.5 overflow-hidden rounded-lg border border-[#1a3558] bg-[#0A2540] shadow-2xl ring-1 ring-black/40">
          {hits.map((h) => (
            <Link
              key={h.symbol}
              href={`/stocks/${h.symbol}`}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-[#0e2e4f] transition-colors min-h-[44px]"
            >
              <span className="min-w-0 truncate">
                <span className="font-bold text-cyan-400">{h.symbol}</span>
                <span className="ml-2 text-slate-400 text-xs">{h.name.slice(0, 40)}</span>
              </span>
              <span className="text-[10px] text-slate-500 shrink-0">{h.exchange}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
