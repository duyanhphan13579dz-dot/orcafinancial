"use client";

import { useEffect, useState } from "react";
import { SettingsSection, Row, Toggle, TextInput } from "./primitives";
import { useToast } from "./Toast";

interface Prefs {
  emailMorning: boolean;
  morningTime: string;
  emailSummary: boolean;
  summaryTime: string;
  emailAlerts: boolean;
  emailNews: boolean;
  pushEnabled: boolean;
  inAppNotifications: boolean;
}

export function NotificationsPanel() {
  const { push } = useToast();
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    fetch("/api/v1/users/preferences")
      .then((r) => r.json())
      .then((j) => j.data?.preferences && setPrefs(j.data.preferences))
      .catch(() => {});
  }, []);

  const update = async (patch: Partial<Prefs>) => {
    if (!prefs) return;
    setPrefs({ ...prefs, ...patch });
    try {
      const res = await fetch("/api/v1/users/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Lưu thất bại");
      push("success", "Đã lưu cài đặt thông báo");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Lưu thất bại");
    }
  };

  const requestPush = async () => {
    if (typeof Notification === "undefined") {
      push("error", "Trình duyệt không hỗ trợ thông báo đẩy");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      await update({ pushEnabled: true });
      new Notification("ORCA FINANCIAL", { body: "Thông báo đẩy đã được bật." });
    } else {
      push("error", "Bạn đã từ chối quyền thông báo");
    }
  };

  if (!prefs) {
    return (
      <div className="panel p-8 text-center text-slate-500 text-sm">
        <div className="inline-block h-5 w-5 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
        <div className="mt-2">Đang tải cài đặt thông báo…</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SettingsSection
        title="Báo cáo qua email"
        description="Chọn bản tin bạn muốn nhận và giờ gửi (giờ Việt Nam)."
      >
        <Row label="Morning Brief" hint="Bản tin đầu ngày với điểm tin và chiến lược thận trọng.">
          <div className="flex items-center gap-3">
            <Toggle checked={prefs.emailMorning} onChange={(v) => update({ emailMorning: v })} label="Morning Brief" />
            <TextInput
              type="time"
              value={prefs.morningTime}
              disabled={!prefs.emailMorning}
              onChange={(e) => update({ morningTime: e.target.value })}
              className="w-32"
            />
          </div>
        </Row>
        <Row label="Market Summary" hint="Nhận định cuối phiên và kế hoạch hành động phiên tới.">
          <div className="flex items-center gap-3">
            <Toggle checked={prefs.emailSummary} onChange={(v) => update({ emailSummary: v })} label="Market Summary" />
            <TextInput
              type="time"
              value={prefs.summaryTime}
              disabled={!prefs.emailSummary}
              onChange={(e) => update({ summaryTime: e.target.value })}
              className="w-32"
            />
          </div>
        </Row>
      </SettingsSection>

      <SettingsSection title="Cảnh báo &amp; tin tức">
        <Row label="Cảnh báo giá cổ phiếu" hint="Nhận email khi mã trong watchlist biến động mạnh.">
          <Toggle checked={prefs.emailAlerts} onChange={(v) => update({ emailAlerts: v })} label="Cảnh báo giá" />
        </Row>
        <Row label="Tin tức quan trọng" hint="Tin vĩ mô hoặc doanh nghiệp có tác động lớn.">
          <Toggle checked={prefs.emailNews} onChange={(v) => update({ emailNews: v })} label="Tin tức" />
        </Row>
      </SettingsSection>

      <SettingsSection title="Thông báo trình duyệt &amp; ứng dụng">
        <Row label="Thông báo đẩy (Push)" hint="Hiển thị thông báo ngay cả khi không mở tab ORCA.">
          <div className="flex items-center gap-3">
            <Toggle
              checked={prefs.pushEnabled}
              onChange={(v) => (v ? requestPush() : update({ pushEnabled: false }))}
              label="Push"
            />
            <span className="text-[11px] text-slate-500">
              {prefs.pushEnabled ? "Đang bật" : "Cần cấp quyền trình duyệt"}
            </span>
          </div>
        </Row>
        <Row label="Thông báo trong ứng dụng" hint="Hiện toast khi có tin mới hoặc AI Agent hoàn thành.">
          <Toggle
            checked={prefs.inAppNotifications}
            onChange={(v) => update({ inAppNotifications: v })}
            label="In-app"
          />
        </Row>
      </SettingsSection>
    </div>
  );
}
