"use client";

import { useState } from "react";
import { SettingsSection, Row, Button, TextInput } from "./primitives";
import { useToast } from "./Toast";
import { useAuth } from "@/lib/auth/context";

export function DataPanel() {
  const { push } = useToast();
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [showDanger, setShowDanger] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/v1/users/export-data", { method: "POST" });
      if (!res.ok) throw new Error("Xuất dữ liệu thất bại");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orca-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      push("success", "Đã tải xuống dữ liệu cá nhân");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Xuất dữ liệu thất bại");
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/v1/users/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Xoá tài khoản thất bại");
      push("success", "Tài khoản đã được xoá");
      setTimeout(() => (window.location.href = "/"), 1200);
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Xoá tài khoản thất bại");
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <SettingsSection
        title="Xuất dữ liệu cá nhân"
        description="Tải về toàn bộ dữ liệu chúng tôi lưu về bạn dưới dạng JSON: hồ sơ, cài đặt, phiên đăng nhập, nhật ký hoạt động và watchlist."
      >
        <Button onClick={exportData} loading={exporting} variant="outline">
          Tải xuống dữ liệu (.json)
        </Button>
      </SettingsSection>

      <SettingsSection
        title="Vùng nguy hiểm"
        description="Xoá tài khoản là hành động vĩnh viễn và không thể hoàn tác. Dữ liệu thị trường chung không bị ảnh hưởng."
      >
        {!showDanger ? (
          <Button variant="danger" onClick={() => setShowDanger(true)}>
            Tôi muốn xoá tài khoản
          </Button>
        ) : (
          <div className="rounded-lg border border-rose-800 bg-rose-950/25 p-4 space-y-3">
            <div className="text-sm text-rose-200">
              Hành động này sẽ xoá vĩnh viễn hồ sơ, cài đặt, phiên đăng nhập và nhật ký của bạn.
            </div>
            <Row label="Nhập email để xác nhận" hint={`Gõ chính xác: ${user?.email ?? ""}`}>
              <TextInput
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={user?.email ?? "email của bạn"}
              />
            </Row>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                onClick={deleteAccount}
                loading={deleting}
                disabled={!confirmText || confirmText !== user?.email}
              >
                Xoá vĩnh viễn tài khoản
              </Button>
              <Button variant="ghost" onClick={() => { setShowDanger(false); setConfirmText(""); }}>
                Huỷ
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
