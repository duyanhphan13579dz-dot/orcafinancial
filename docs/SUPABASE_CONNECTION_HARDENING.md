# Supabase/PostgreSQL Connection Hardening

## Phạm vi

Bản hardening này xử lý rủi ro connection instability và `pooled_timeout` cho runtime Next.js/Drizzle của Orca Financial. Không có dữ liệu nghiệp vụ nào bị xóa, reset hoặc sửa; các quy tắc kiểm tra kỳ báo cáo vẫn được giữ nguyên.

## Kết quả audit

Connector Supabase đang có hai project tên `orcafinancial`. Project `jpimorytlufqsrrcotxs` là database ứng dụng có dữ liệu đầy đủ hơn, gồm schema stock/persistence và nhiều bản ghi hơn; trạng thái là `ACTIVE_HEALTHY`, region `ap-southeast-1`. Project này có unique index trên `financial_statements(symbol, type, period, fiscal_year)`, index theo symbol và index `created_at` cho `job_logs`.

Không phát hiện bản ghi `pooled_timeout`, pool exhaustion, connection hoặc database failure trong nhóm `job_logs` được kiểm tra. Supavisor logs trong cửa sổ 24 giờ được truy vấn thành công nhưng không có bản ghi. Vì vậy các thay đổi dưới đây là hardening phòng ngừa, không phải tuyên bố rằng đã quan sát thấy một outage đang diễn ra.

Performance advisors trả về các cảnh báo informational về unused index. Không tự động xóa các index này vì cửa sổ quan sát ngắn chưa đủ để kết luận an toàn, và việc xóa index không trực tiếp giải quyết pooled timeout.

## Thay đổi runtime

`pg` pool hiện dùng kích thước nhỏ an toàn cho serverless/Supabase, recycle client theo số lần dùng và lifetime, bật TCP keep-alive, giới hạn thời gian mở connection, đồng thời áp dụng `statement_timeout` và `idle_in_transaction_session_timeout` ở cấp session.

Retry wrapper dùng chung nhận diện PostgreSQL `53300`, pooled timeout/pool exhaustion của Supabase, connection reset/termination và các lỗi transient liên quan. Retry dùng exponential backoff có giới hạn và jitter để tránh nhiều instance retry đồng thời. Financial statement reads và synthetic upserts cũng đã đi qua wrapper này.

Health endpoint trả các pool counter an toàn: total, idle, waiting và max connections, cùng latency/status; không trả secret. `waitingCount` tăng kéo dài là tín hiệu capacity, không nên chỉ tăng pool size trên mọi serverless instance vì có thể làm nặng hơn.

## Cấu hình production khuyến nghị

```env
DATABASE_URL=postgresql://...@...pooler.supabase.com:6543/postgres?pgbouncer=true
DATABASE_POOL_MAX=2
DATABASE_POOL_TIMEOUT_MS=8000
DATABASE_POOL_IDLE_TIMEOUT_MS=15000
DATABASE_POOL_MAX_USES=500
DATABASE_POOL_MAX_LIFETIME_SECONDS=300
DATABASE_CONNECT_TIMEOUT_SECONDS=8
DATABASE_STATEMENT_TIMEOUT_MS=15000
DATABASE_IDLE_TRANSACTION_TIMEOUT_MS=30000
```

Connection string đầy đủ và password phải được cấu hình trực tiếp trong Vercel/Supabase secrets, không commit hoặc gửi qua chat. Hãy lấy đúng transaction pooler string từ Supabase dashboard của project đang dùng.

## Kiểm chứng

Sau thay đổi, TypeScript, ESLint, Vitest và `git diff --check` phải được chạy lại. Database verification chỉ đọc: kiểm tra project status, table inventory, indexes, advisors và logs; không áp dụng migration phá hủy.
