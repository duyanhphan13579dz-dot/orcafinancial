# Orca Stock Intelligence — Technical Specification v1.0

## Audit kết luận

Repository hiện có Stock dashboard Next.js với các route quote, history, technical, fundamental, financial statements, financial health, sentiment và reports. Market layer đã có cache theo TTL, fallback provider, snapshot DB và giới hạn request. Tuy nhiên, financial statements hiện được tổng hợp từ OHLCV bằng benchmark ngành; chưa có một canonical contract mang period type, source, timestamp, freshness và confidence xuyên suốt các module. Financial Health nhận trực tiếp các quarter tổng hợp và chưa công khai hard rule `current state = latest reported actual` trong contract API. Decision logic hiện nằm rải rác giữa analysis, fundamental và sentiment.

## Phạm vi v1 triển khai

| Dependency | Deliverable | Mục tiêu |
|---|---|---|
| Phase 1 | Canonical stock data model, period engine, provenance, validation | Tách Actual/Estimate/Target và làm rõ kỳ dữ liệu |
| Phase 2 | Single-flight cache, provider metadata, stale protection | Tránh request trùng và minh bạch freshness |
| Phase 3 | Financial health current-state contract | Chỉ dùng latest reported period cho current health |
| Phase 4 | ORCA decision engine | Score có breakdown, confidence, verdict, multi-horizon và giải thích |
| UX | Executive Summary | Quyết định ở Level 1, lý do ở Level 2, metadata dữ liệu ở đầu trang |

Các phase còn lại của roadmap (forecast/scenario, backtest, AI và PDF đầy đủ) sẽ tiêu thụ canonical contract này thay vì tự tính lại. Không đưa thêm dữ liệu giả hoặc tuyên bố accuracy khi chưa có historical signal database và censoring hợp lệ.

## Quy tắc bất biến

1. `actual`, `estimate` và `target` là ba `PeriodKind` khác nhau và không được trộn trong cùng một series.
2. Financial Health được gắn với `latestReportedPeriod` và chỉ đọc dữ liệu Actual.
3. Mọi payload dữ liệu phải mang `source`, `retrievedAt`, `period`, `status` và `confidence`.
4. `dataConfidence` (độ tin cậy dữ liệu) khác `predictionConfidence` (độ tin cậy dự báo).
5. Khi không đủ dữ liệu, module trả về `insufficient_data` thay vì suy diễn.
6. Score chỉ là phân tích định lượng; không phải lời khuyên tài chính cá nhân.

## Acceptance criteria

Stock API có executive summary thống nhất; response có metadata freshness; period engine xác định latest quarter, previous quarter, same quarter prior year, YTD, TTM và latest FY; validation phát hiện missing/duplicate/wrong period/impossible value; cache chống request trùng; Financial Health ghi rõ current period; UI hiển thị verdict, score, confidence, risk, trend, valuation và lý do.
