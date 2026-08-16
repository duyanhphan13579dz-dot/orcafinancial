"use client";

import { useEffect, useState } from "react";
import { api, fmtNum } from "@/lib/client";
import { ValueChainVisual, type ValueChain } from "@/components/value-chain";

interface Profile {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  description: string;
  employees: number;
  website: string;
  listingDate: string;
  marketCapBillionVnd: number;
  sharesOutstandingMillions: number;
  beta: number;
}

interface Swot {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

const SWOT_CATS: Array<{ key: keyof Swot; label: string; color: string; bg: string }> = [
  { key: "strengths", label: "Điểm mạnh (S)", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-700" },
  { key: "weaknesses", label: "Điểm yếu (W)", color: "text-rose-400", bg: "bg-rose-500/10 border-rose-700" },
  { key: "opportunities", label: "Cơ hội (O)", color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-700" },
  { key: "threats", label: "Thách thức (T)", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-700" },
];

export function CompanyProfile({ symbol }: { symbol: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [swot, setSwot] = useState<Swot | null>(null);
  const [valueChain, setValueChain] = useState<ValueChain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileRes, chainRes] = await Promise.allSettled([
        api<{ profile: Profile; swot: Swot }>(`/stocks/${symbol}/profile`),
        api<ValueChain & { symbol: string }>(`/stocks/${symbol}/value-chain`),
      ]);
      if (profileRes.status === "fulfilled") {
        setProfile(profileRes.value.data.profile);
        setSwot(profileRes.value.data.swot);
      } else {
        throw profileRes.reason;
      }
      if (chainRes.status === "fulfilled") setValueChain(chainRes.value.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      await api(`/stocks/${symbol}/swot/generate`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenerating(false);
    }
  };

  useEffect(() => {
    if (!loaded && !loading) {
      setLoaded(true);
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (error) return <div className="panel p-4 text-sm text-rose-400">{error}</div>;
  if (loading && !profile) return <div className="panel p-8 text-center text-sm text-slate-500">Đang tải hồ sơ doanh nghiệp…</div>;
  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-bold">{profile.name}</h2>
            <div className="text-xs text-slate-500 mt-0.5">
              {profile.sector} · {profile.industry} · Niêm yết {profile.exchange}
            </div>
          </div>
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:border-cyan-600 hover:text-cyan-300 disabled:opacity-50"
          >
            {regenerating ? "Đang phân tích lại…" : "Phân tích lại SWOT"}
          </button>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed mb-4">{profile.description}</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="bg-slate-800/40 rounded p-2">
            <div className="text-[10px] text-slate-500">Vốn hóa</div>
            <div className="font-bold text-sm">{profile.marketCapBillionVnd.toLocaleString("vi-VN")} tỷ VND</div>
          </div>
          <div className="bg-slate-800/40 rounded p-2">
            <div className="text-[10px] text-slate-500">Số CP lưu hành</div>
            <div className="font-bold text-sm">{(profile.sharesOutstandingMillions).toLocaleString("vi-VN")} triệu</div>
          </div>
          <div className="bg-slate-800/40 rounded p-2">
            <div className="text-[10px] text-slate-500">Nhân sự</div>
            <div className="font-bold text-sm">{profile.employees.toLocaleString("vi-VN")} người</div>
          </div>
          <div className="bg-slate-800/40 rounded p-2">
            <div className="text-[10px] text-slate-500">Beta</div>
            <div className="font-bold text-sm">{fmtNum(profile.beta)}</div>
          </div>
          <div className="bg-slate-800/40 rounded p-2 col-span-2">
            <div className="text-[10px] text-slate-500">Ngày niêm yết</div>
            <div className="font-bold text-sm">{profile.listingDate}</div>
          </div>
          <div className="bg-slate-800/40 rounded p-2 col-span-2">
            <div className="text-[10px] text-slate-500">Website</div>
            <div className="font-bold text-sm text-cyan-400">{profile.website}</div>
          </div>
        </div>
      </div>

      {swot && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SWOT_CATS.map((cat) => (
            <div key={cat.key} className={`panel p-4 border ${cat.bg}`}>
              <h3 className={`text-sm font-bold mb-3 ${cat.color}`}>{cat.label}</h3>
              <ul className="space-y-2 text-xs text-slate-300">
                {swot[cat.key].map((item, i) => (
                  <li key={i} className="flex gap-2 leading-snug">
                    <span className={cat.color}>●</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-slate-600">
        SWOT được tạo tự động dựa trên dữ liệu tài chính mô hình hóa, diễn biến giá thật và sentiment tin tức.
      </div>

      {valueChain && <ValueChainVisual chain={valueChain} />}
    </div>
  );
}
