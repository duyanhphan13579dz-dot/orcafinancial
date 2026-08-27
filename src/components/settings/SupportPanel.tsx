"use client";

import { useState } from "react";
import Link from "next/link";
import { SettingsSection, Button } from "./primitives";
import { useToast } from "./Toast";

const FAQ = [
  {
    q: "Dữ liệu giá cổ phiếu lấy từ đâu?",
    a: "ORCA tổng hợp dữ liệu từ các nguồn thị trường đã kiểm chứng và có cơ chế dự phòng khi nguồn chính gián đoạn.",
  },
  {
    q: "Bản tin sáng và Tổng kết thị trường phát hành lúc nào?",
    a: "Bản tin sáng phát hành lúc 07:30 và Tổng kết thị trường lúc 15:15 vào ngày giao dịch.",
  },
  {
    q: "Bộ lọc CANSLIM / Minervini / Wyckoff / Elliott hoạt động thế nào?",
    a: "Mỗi bộ lọc chấm điểm 0–100 cho từng mã dựa trên tiêu chí gốc của phương pháp. Bạn có thể điều chỉnh ngưỡng điểm tối thiểu bằng thanh trượt trong trang Bộ lọc.",
  },
  {
    q: "Vì sao cần đăng nhập để xem nội dung chi tiết?",
    a: "Đăng nhập cho phép chúng tôi lưu watchlist, cài đặt giao diện, lịch gửi báo cáo và cảnh báo giá riêng cho từng tài khoản.",
  },
  {
    q: "Dữ liệu của tôi có được bảo vệ không?",
    a: "Tài khoản được bảo vệ bằng mật khẩu mã hóa, xác thực hai lớp và quản lý phiên đăng nhập từ xa.",
  },
];

export function SupportPanel() {
  const { push } = useToast();
  const [open, setOpen] = useState<number | null>(0);
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);

  const submit = () => {
    if (!feedback.trim()) {
      push("error", "Vui lòng nhập nội dung phản hồi");
      return;
    }
    setSending(true);
    const subject = encodeURIComponent("[ORCA] Phản hồi từ người dùng");
    const body = encodeURIComponent(feedback);
    window.location.href = `mailto:support@orca.finance?subject=${subject}&body=${body}`;
    setTimeout(() => {
      setSending(false);
      setFeedback("");
      push("success", "Đã mở ứng dụng email để gửi phản hồi");
    }, 600);
  };

  return (
    <div className="space-y-5">
      <SettingsSection title="Câu hỏi thường gặp" description="Những thắc mắc phổ biến về nền tảng ORCA.">
        <div className="space-y-2">
          {FAQ.map((item, i) => (
            <div key={i} className="rounded-lg border border-[#1a3558] bg-[#0a1d33]/50 overflow-hidden">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 min-h-[44px] active:scale-[0.99] transition-transform"
              >
                <span className="text-sm font-medium text-slate-200">{item.q}</span>
                <span className={`text-[#00d4ff] transition-transform ${open === i ? "rotate-180" : ""}`}>▾</span>
              </button>
              {open === i && (
                <div className="px-4 pb-3 text-xs text-slate-400 leading-relaxed border-t border-[#1a3558]/60 pt-3">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Gửi phản hồi / Báo lỗi" description="Mô tả vấn đề bạn gặp phải, chúng tôi sẽ phản hồi qua email.">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={5}
          placeholder="Mô tả lỗi hoặc góp ý của bạn…"
          className="w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none resize-y"
        />
        <Button onClick={submit} loading={sending} variant="outline">
          Gửi phản hồi
        </Button>
      </SettingsSection>

      <SettingsSection title="Tài liệu &amp; liên hệ">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/system"
            className="rounded-lg border border-[#1a3558] bg-[#0a1d33]/50 p-4 hover:border-[#00d4ff]/50 transition-colors min-h-[44px]"
          >
            <div className="text-2xl">🩺</div>
            <div className="text-sm font-semibold text-white mt-2">Trạng thái hệ thống</div>
          </Link>
          <a
            href="mailto:support@orca.finance"
            className="rounded-lg border border-[#1a3558] bg-[#0a1d33]/50 p-4 hover:border-[#00d4ff]/50 transition-colors min-h-[44px] block"
          >
            <div className="text-2xl">✉️</div>
            <div className="text-sm font-semibold text-white mt-2">Email hỗ trợ</div>
            <div className="text-[11px] text-slate-500 mt-1">support@orca.finance</div>
          </a>
        </div>
      </SettingsSection>
    </div>
  );
}
