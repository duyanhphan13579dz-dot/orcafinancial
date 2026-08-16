"use client";

interface Activity { name: string; nameVi: string; description: string; icon: string; }
export interface ValueChain {
  primary: Activity[];
  support: Activity[];
  modelVersion: string;
  sector: string;
  industry: string;
}

export function ValueChainVisual({ chain }: { chain: ValueChain }) {
  return (
    <div className="panel p-5 relative scanlines overflow-hidden">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-[#00d4ff] uppercase">Porter value chain</div>
          <div className="font-display text-xl md:text-2xl font-extrabold text-white tracking-tight mt-1">
            Chuỗi giá trị · <span className="italic text-[#7aa8d4] text-base">{chain.industry}</span>
          </div>
        </div>
        <div className="font-mono text-[10px] text-slate-500">
          model <span className="text-[#00d4ff]">{chain.modelVersion}</span> · {chain.primary.length + chain.support.length} activities
        </div>
      </div>

      {/* Primary pipeline */}
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-cyan-300">Primary</span>
        <div className="flex-1 h-px bg-gradient-to-r from-cyan-500/40 via-cyan-500/10 to-transparent" />
      </div>
      <div className="chain-track reveal-stagger">
        {chain.primary.map((a, i) => (
          <div key={i} className="chain-node">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-2xl leading-none">{a.icon}</span>
              <span className="font-mono text-[9px] tracking-[0.2em] text-cyan-300/70 uppercase">P{i + 1}</span>
            </div>
            <div className="font-display font-bold text-white text-[13px] leading-tight">{a.nameVi}</div>
            <div className="font-mono text-[10px] text-slate-500 italic mt-0.5">{a.name}</div>
            <p className="text-[11px] text-slate-300/90 mt-2 leading-snug">{a.description}</p>
          </div>
        ))}
      </div>
      <div className="chain-flow">
        {chain.primary.slice(0, -1).map((_, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.3}s` }} />
        ))}
      </div>

      {/* Support rail */}
      <div className="mt-6 mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-amber-300">Support</span>
        <div className="flex-1 h-px bg-gradient-to-r from-amber-500/40 via-amber-500/10 to-transparent" />
      </div>
      <div className="chain-rail reveal-stagger">
        {chain.support.map((a, i) => (
          <div key={i} className="chain-node">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-2xl leading-none">{a.icon}</span>
              <span className="font-mono text-[9px] tracking-[0.2em] text-amber-300/70 uppercase">S{i + 1}</span>
            </div>
            <div className="font-display font-bold text-white text-[13px] leading-tight">{a.nameVi}</div>
            <div className="font-mono text-[10px] text-slate-500 italic mt-0.5">{a.name}</div>
            <p className="text-[11px] text-slate-300/90 mt-2 leading-snug">{a.description}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-[#1a3558]/70 flex flex-wrap gap-3 text-[10px] font-mono text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#00d4ff] animate-pulse" /> Hoạt động chính — dòng giá trị trực tiếp tới khách hàng</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> Hoạt động hỗ trợ — nền tảng hạ tầng, nhân sự, công nghệ</span>
      </div>
    </div>
  );
}
