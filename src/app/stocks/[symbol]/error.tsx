"use client";

/**
 * Error boundary cho route /stocks/[symbol]. Trước đây một lỗi render client
 * (VD null.toFixed khi BCTC thiếu chỉ tiêu) làm React unmount cả cây và Next
 * hiện interstitial "This page couldn't load" — mất toàn bộ trang dù các khối
 * khác vẫn ổn. Giờ lỗi chỉ thay thế nội dung route bằng panel này, kèm nút
 * thử lại; layout (header/nav) giữ nguyên.
 */
export default function StockPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="panel p-8 max-w-md w-full text-center">
        <div className="h-16 w-16 rounded-full bg-rose-500/10 flex items-center justify-center text-3xl mx-auto mb-4">
          ⚠️
        </div>
        <h2 className="text-xl font-bold text-white">Không hiển thị được trang cổ phiếu</h2>
        <p className="text-slate-400 mt-3 text-sm leading-relaxed">
          Một khối dữ liệu trên trang gặp lỗi khi render. Các trang khác vẫn
          hoạt động bình thường — thử tải lại, nếu còn lỗi hãy báo kèm mã lỗi
          dưới đây.
        </p>
        <p className="mt-3 text-[11px] font-mono text-slate-500 break-all">
          {error.message || "unknown render error"}
        </p>
        <button type="button" onClick={reset} className="btn-orca min-h-11 py-3 mt-6 w-full">
          Thử lại
        </button>
      </div>
    </div>
  );
}
