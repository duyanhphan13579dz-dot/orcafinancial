# UI period audit — 27/08/2026

Đã thử mở `http://localhost:3011/stocks/VNM`. Ứng dụng chuyển hướng tới `/auth/login?next=/stocks/VNM`, vì vậy phiên browser local chưa có tài khoản đăng nhập và không thể kiểm tra các panel dữ liệu thật bằng browser.

Các điểm đã kiểm tra qua mã nguồn: stock detail gọi `ensureQuarterlyFinancials`; generator hiện anchor vào quý đã hoàn tất; company service lọc persisted future rows; financial source lọc future-dated actual records. Vì vậy UI nhận chuỗi newest-first không bao gồm Q3/2026 actual trước ngày hợp lệ. Cần một phiên đăng nhập hoặc môi trường staging có auth để hoàn tất visual smoke test bằng browser.
