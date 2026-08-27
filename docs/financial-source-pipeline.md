# Pipeline dữ liệu tài chính Vietstock/CafeF

## Mục tiêu

Pipeline chạy theo thứ tự: **Vietstock/CafeF → raw documents → data-engine quality gate → normalized facts → LLM structured output → tab Cơ bản/Tài chính**. LLM không được quyền sửa dữ liệu gốc; mọi số liệu trong output phải được sao chép từ normalized facts.

## Nguồn dữ liệu

Production phải dùng endpoint JSON/API hoặc DataFeed được cấp quyền. Repo không bypass đăng nhập, CAPTCHA, rate limit hay điều khoản sử dụng của Vietstock/CafeF. Cấu hình `VIETSTOCK_DATAFEED_URL` và `CAFEF_DATA_URL` là endpoint đã được phê duyệt; token tương ứng đặt ở `VIETSTOCK_DATAFEED_TOKEN` và `CAFEF_DATA_TOKEN`.

Vietstock mô tả DataFeed là dịch vụ cung cấp dữ liệu tài chính đã chuẩn hóa qua API hoặc Sync Data. CafeF có khu vực công bố thông tin với báo cáo quý/năm, hợp nhất/công ty mẹ, kiểm toán/soát xét và tải Excel. Adapter trong repo nhận JSON theo contract nội bộ để không phụ thuộc HTML không ổn định.

## JSON contract đầu vào

Endpoint phải nhận query `symbol` và `limit`, sau đó trả mảng hoặc object có `documents`/`data`. Mỗi document tối thiểu có `symbol`, `documentUrl`, `documentType` (`financial_statement` hoặc `analysis_report`) và có thể có `reportType`, `period`, `fiscalYear`, `filingDate`, `contentType`, `facts`.

Mỗi fact có `statementType` (`income`, `balance`, `cashflow`), `period` (`Q1/2026` đến `Q4/2026` hoặc `FY/2026`), `fiscalYear`, `reportScope` (`consolidated` hoặc `parent`), `currency`, `unit`, `periodEnd`, `filingDate` và `data`. `data` phải dùng key canonical của hệ thống, ví dụ `revenue`, `ebitda`, `netIncome`, `totalAssets`, `equity`, `operatingCashFlow`.

## Quality gate

Data-engine từ chối kỳ tương lai, kỳ sai định dạng, tài liệu thiếu URL, fact không có số liệu, phạm vi báo cáo không xác định và dữ liệu không có đủ provenance. Bản raw vẫn được lưu để audit; chỉ fact có `qualityStatus=accepted` mới được đưa cho LLM và các tab stock.

Không trộn `consolidated` với `parent`. Không dùng `updated_at` làm ngày công bố. Provenance tối thiểu phải giữ source, source URL, filing date, period end, report type, document hash, retrieved time và parser version.

## Các endpoint nội bộ

- `GET /api/internal/financial-ingest` kéo và lưu raw/normalized facts.
- `GET /api/internal/financial-llm` tạo output `basic` và `financials` từ facts đã accepted.
- `GET /api/v1/stocks/:symbol/financial-analysis?type=basic` đọc output LLM đã lưu.
- `GET /api/v1/stocks/:symbol/financial-analysis?type=financials` đọc ba bảng LLM đã cấu trúc.

Endpoint nội bộ yêu cầu `Authorization: Bearer $FINANCIAL_AUDIT_SECRET` hoặc `$CRON_SECRET`. Frontend không gọi provider LLM trực tiếp.

## Lịch chạy

Vercel Cron chạy ingestion lúc 01:30, LLM lúc 01:50, period audit lúc 02:10 và cleanup lúc 02:30 trong ngày 1–20 của tháng 1, 4, 7, 10 và 12. Nếu nguồn chưa được cấu hình, ingestion trả warning và không tạo synthetic facts mới.

## LLM output

Mục `basic` trả overview, positives, risks và chuỗi chart theo từng kỳ cho doanh thu, EBITDA, lợi nhuận ròng. Mục `financials` trả ba bảng kết quả kinh doanh, cân đối kế toán và lưu chuyển tiền tệ. Output được lưu theo SHA-256 fingerprint của facts; khi facts không đổi, hệ thống dùng cache và không gọi LLM lại.

LLM hiện dùng router provider có sẵn của repo. Production cần cấu hình ít nhất một provider (`GROQ_API_KEY` hoặc `OPENROUTER_API_KEY`). Nếu không có provider, route trả lỗi cấu hình và không tạo output giả.

## Nguồn tham khảo

- VietstockFinance, tài liệu báo cáo tài chính: https://finance.vietstock.vn/tai-lieu/bao-cao-tai-chinh.htm
- Vietstock DataFeed: https://dichvu.vietstock.vn/du-lieu-tai-chinh/datafeed---du-lieu-tai-chinh-tich-hop-chuyen-nghiep
- CafeF, công bố thông tin: https://cafef.vn/du-lieu/cong-bo-thong-tin.chn
