"use client";

import { useEffect, useState } from "react";
import { SettingsSection, Row, Select, Button, Badge } from "./primitives";
import { useToast } from "./Toast";

interface Prefs {
  theme: string;
  accentColor: string;
  language: string;
  fontScale: string;
}
interface AccentColor {
  id: string;
  label: string;
  value: string;
}

const THEMES = [
  { value: "dark", label: "Tối", icon: "🌙" },
  { value: "light", label: "Sáng", icon: "☀️" },
  { value: "system", label: "Theo hệ thống", icon: "💻" },
];

export function applyAppearance(p: Partial<Prefs>) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (p.theme) {
    const resolved =
      p.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : p.theme;
    root.classList.toggle("theme-light", resolved === "light");
    root.dataset.theme = resolved;
  }
  if (p.accentColor) {
    root.style.setProperty("--orca-cyan", p.accentColor);
  }
  if (p.fontScale) {
    const map: Record<string, string> = { sm: "15px", md: "16px", lg: "17.5px" };
    root.style.fontSize = map[p.fontScale] ?? "16px";
  }
  if (p.language) {
    root.lang = p.language;
  }
}

export function AppearancePanel() {
  const { push } = useToast();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [colors, setColors] = useState<AccentColor[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/users/preferences")
      .then((r) => r.json())
      .then((j) => {
        if (j.data?.preferences) {
          setPrefs(j.data.preferences);
          setColors(j.data.accentColors ?? []);
          applyAppearance(j.data.preferences);
        }
      })
      .catch(() => {});
  }, []);

  const update = async (patch: Partial<Prefs>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    applyAppearance(patch);
    setSaving(true);
    try {
      const res = await fetch("/api/v1/users/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Lưu thất bại");
      push("success", "Đã lưu giao diện");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) {
    return (
      <div className="panel p-8 text-center text-slate-500 text-sm">
        <div className="inline-block h-5 w-5 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
        <div className="mt-2">Đang tải cài đặt giao diện…</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SettingsSection
        title="Chủ đề"
        description="Thay đổi áp dụng ngay lập tức để bạn xem trước, đồng thời được lưu vào tài khoản."
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => update({ theme: t.value })}
              className={`rounded-lg border p-4 text-left transition-all active:scale-[0.98] min-h-[44px] ${
                prefs.theme === t.value
                  ? "border-[#00d4ff] bg-[#00d4ff]/10"
                  : "border-[#1a3558] bg-[#0e2e4f]/50 hover:border-[#2a4a75]"
              }`}
            >
              <div className="text-2xl">{t.icon}</div>
              <div className="mt-2 text-sm font-medium text-white">{t.label}</div>
              {prefs.theme === t.value && (
                <div className="mt-1">
                  <Badge tone="good">Đang dùng</Badge>
                </div>
              )}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Màu chủ đạo" description="Màu nhấn dùng cho nút, liên kết và biểu đồ.">
        <div className="flex flex-wrap gap-3">
          {colors.map((c) => (
            <button
              key={c.id}
              onClick={() => update({ accentColor: c.value })}
              title={c.label}
              className={`h-12 w-12 rounded-full border-2 transition-all active:scale-95 ${
                prefs.accentColor === c.value ? "border-white scale-110" : "border-transparent hover:scale-105"
              }`}
              style={{ background: c.value }}
            >
              {prefs.accentColor === c.value && <span className="text-[#0A2540] font-bold">✓</span>}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 mt-2">
          Đang chọn: <span className="font-mono text-slate-300">{prefs.accentColor}</span>
        </div>
      </SettingsSection>

      <SettingsSection title="Ngôn ngữ &amp; cỡ chữ">
        <Row label="Ngôn ngữ" hint="Áp dụng cho nhãn giao diện.">
          <Select value={prefs.language} onChange={(e) => update({ language: e.target.value })}>
            <option value="vi">Tiếng Việt</option>
          </Select>
        </Row>
        <Row label="Cỡ chữ" hint="Điều chỉnh kích thước chữ toàn hệ thống.">
          <Select value={prefs.fontScale} onChange={(e) => update({ fontScale: e.target.value })}>
            <option value="sm">Nhỏ</option>
            <option value="md">Vừa (mặc định)</option>
            <option value="lg">Lớn</option>
          </Select>
        </Row>
      </SettingsSection>

      {saving && <div className="text-xs text-slate-500 text-center">Đang lưu…</div>}
    </div>
  );
}
