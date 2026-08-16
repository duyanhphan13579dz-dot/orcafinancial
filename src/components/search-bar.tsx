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
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5">
        <span className="text-slate-500 text-sm">⌕</span>
        <input
          value={q}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) {
              router.push(`/stocks/${hits[0].symbol}`);
              setOpen(false);
            }
          }}
          placeholder="Tìm mã CK, công ty… (VNM, HPG, FPT)"
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-600"
        />
        {latency !== null && open && <span className="text-[10px] text-slate-600 shrink-0">{latency}ms</span>}
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-xl">
          {hits.map((h) => (
            <Link
              key={h.symbol}
              href={`/stocks/${h.symbol}`}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-800"
            >
              <span>
                <span className="font-bold text-cyan-400">{h.symbol}</span>
                <span className="ml-2 text-slate-400 text-xs">{h.name.slice(0, 40)}</span>
              </span>
              <span className="text-[10px] text-slate-500">{h.exchange}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
