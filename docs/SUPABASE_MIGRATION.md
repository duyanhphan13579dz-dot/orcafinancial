# Hướng dẫn di chuyển Database sang Supabase

> **Lưu ý stack thực tế:** Prompt gốc giả định stack NestJS + Prisma. Dự án
> ORCA FINANCIAL thực tế dùng **Next.js (App Router) + Drizzle ORM +
> `pg.Pool`** (xem `src/db/index.ts`, `src/db/schema.ts`, `drizzle.config.json`).
> Toàn bộ hướng dẫn dưới đây đã được điều chỉnh cho đúng stack này —
> `npx drizzle-kit push` thay cho `prisma migrate deploy`, không có bước
> `prisma db seed` vì dự án không có seed script.

> **Về TimescaleDB:** Tính đến 2026, Supabase đã **loại bỏ hoàn toàn**
> extension `timescaledb` khỏi bundle Postgres 17, và Postgres 15 (bundle
> cũ còn extension này) sẽ end-of-life vào khoảng tháng 5/2026
> ([nguồn: Supabase GitHub Discussions #35851](https://github.com/orgs/supabase/discussions/35851),
> [Supabase Changelog](https://supabase.com/changelog)). **Không thể tạo
> hypertable mới trên Supabase managed cloud.** Tin tốt: schema hiện tại
> của dự án (`src/db/schema.ts`) **chưa từng dùng TimescaleDB hypertable**
> — `stock_prices`, `index_prices` chỉ là bảng PostgreSQL thường với
> composite index `(symbol, time DESC)`. Vì vậy việc chuyển sang Supabase
> **không làm mất bất kỳ tính năng nào** đang có. Phần "Thay thế
> TimescaleDB" ở cuối tài liệu này giải thích cách tối ưu time-series
> queries bằng native PostgreSQL partitioning nếu dữ liệu tăng lớn.

---

## Tổng quan quy trình

```
1. Tạo project Supabase          →  lấy 2 connection string (direct + pooled)
2. Cập nhật .env                 →  DATABASE_URL trỏ sang Supabase
3. Áp schema hiện tại lên Supabase →  npx drizzle-kit push
4. Di chuyển dữ liệu cũ (nếu có) →  scripts/migrate-to-supabase.sh
5. (Tùy chọn) Tích hợp Supabase Auth/Realtime/Storage
6. Cập nhật Docker Compose        →  docker-compose.supabase.yml
```

Toàn bộ logic nghiệp vụ, API routes, connector resilience (circuit
breaker, retry, health check) trong `src/lib/connectors/core.ts` và
`src/db/index.ts` **không cần sửa** — file `src/db/index.ts` đã được
nâng cấp để **tự động nhận diện** kết nối Supabase (bật SSL, giảm pool
size khi qua PgBouncer) chỉ dựa vào `DATABASE_URL`, xem phần
["Điều gì đã thay đổi trong code"](#điều-gì-đã-thay-đổi-trong-code) bên dưới.

---

## Bước 1 — Tạo project trên Supabase

1. Đăng ký / đăng nhập tại [supabase.com](https://supabase.com).
2. **New Project** → chọn Organization → đặt tên project (vd: `orca-financial`).
3. Chọn **Region: Southeast Asia (Singapore)** — gần Việt Nam nhất, giảm latency.
4. Đặt **Database Password** mạnh — lưu lại ngay, Supabase chỉ hiện 1 lần.
5. Chờ project khởi tạo (~2 phút).
6. Vào **Project Settings → Database** để lấy 2 connection string:

   | Loại | Dùng để | Host |
   |---|---|---|
   | **Direct connection** | Migration (`drizzle-kit push`), `pg_dump`/`pg_restore` | `db.<project-ref>.supabase.co:5432` |
   | **Connection pooling (PgBouncer, Transaction mode)** | App chạy production | `<project-ref>.pooler.supabase.com:6543` |

   > Vì sao cần 2 loại: PgBouncer ở chế độ Transaction pooling **không hỗ
   > trợ prepared statements phía server**, trong khi một số thao tác DDL
   > của Drizzle Kit cần connection trực tiếp. Dùng sai loại cho migration
   > sẽ báo lỗi `prepared statement already exists` hoặc DDL bị treo.

---

## Bước 2 — Cập nhật biến môi trường

Sửa `.env` (không commit file này — đã có trong `.gitignore`):

```env
# Dùng cho app chạy production (qua PgBouncer, bắt buộc pgbouncer=true)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@[PROJECT-REF].pooler.supabase.com:6543/postgres?pgbouncer=true
```

Khi cần chạy migration (`drizzle-kit push`) hoặc `pg_dump`, **tạm thời**
dùng connection trực tiếp thay vì pooled (có thể set qua biến môi trường
riêng, xem Bước 3):

```env
# Chỉ dùng cho migration — KHÔNG dùng cho app runtime
SUPABASE_DIRECT_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

Toàn bộ template biến môi trường (bao gồm cả các biến optional cho
Supabase Auth/Realtime) đã có sẵn trong `.env.example` — copy các dòng cần
thiết sang `.env` thật của bạn.

### Điều gì đã thay đổi trong code

`src/db/index.ts` đã được nâng cấp (không cần bạn sửa thêm gì) để:

- **Tự bật SSL** (`ssl: { rejectUnauthorized: false }`) khi phát hiện host
  chứa `supabase.co` / `supabase.com` — đúng theo khuyến nghị chính thức
  của Supabase cho node-postgres/Drizzle/Prisma.
- **Tự giảm pool size mặc định xuống 5** (thay vì 20) khi phát hiện
  `pgbouncer=true` hoặc cổng `:6543` trong `DATABASE_URL`, tránh làm cạn
  `default_pool_size` của PgBouncer phía Supabase. Có thể override bằng
  `DATABASE_POOL_MAX` trong `.env`.
- Giữ nguyên 100% cơ chế retry/circuit-breaker/health-check hiện có
  (`pingDb`, `waitForDatabaseReady`, `startDbSelfPing`, `pool.on("error")`)
  — không phân biệt Postgres local hay Supabase.

Không có thay đổi nào khác trong logic nghiệp vụ.

---

## Bước 3 — Áp schema hiện tại lên Supabase

Dự án dùng **Drizzle Kit**, không phải Prisma. Tương đương với
`prisma migrate deploy` là:

```bash
# Trỏ tạm drizzle.config.json sang connection trực tiếp của Supabase
# (sửa dbCredentials.url trong drizzle.config.json, hoặc set qua env
# nếu bạn dùng drizzle.config.ts với process.env)

npx drizzle-kit push
```

Lệnh này đọc `src/db/schema.ts` và tạo toàn bộ bảng + index + enum tương
ứng trên Supabase — **schema giữ nguyên 100%**, không cần viết lại bất kỳ
bảng nào.

> **Không có bước "seed"**: dự án này không sử dụng file seed (`npx prisma
> db seed` không áp dụng). Toàn bộ dữ liệu là dữ liệu thị trường thật được
> các connector (`src/lib/connectors/providers.ts`) và scheduler
> (`src/lib/reports/scheduler.ts`) tự động đồng bộ liên tục sau khi app
> khởi động — không cần seed thủ công.

Sau khi push xong, đổi `DATABASE_URL` trong `.env` trở lại connection
**pooled** (Bước 2) cho môi trường chạy thật.

---

## Bước 4 — Di chuyển dữ liệu cũ (nếu bạn đã có dữ liệu trong Postgres hiện tại)

Dùng script có sẵn tại `scripts/migrate-to-supabase.sh` (dùng
`pg_dump`/`pg_restore`, an toàn, có xác nhận trước khi ghi, và tự đối
chiếu row-count giữa nguồn và đích sau khi xong):

```bash
export SOURCE_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/app_db"
export SUPABASE_DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

./scripts/migrate-to-supabase.sh
```

Script sẽ:
1. `pg_dump` toàn bộ schema + data từ nguồn (custom format, nén).
2. `pg_restore` vào Supabase (dùng connection **trực tiếp**, không phải pooled).
3. Đối chiếu số dòng (`SELECT count(*)`) của từng bảng giữa nguồn và đích,
   in bảng so sánh để bạn xác nhận migrate đầy đủ.

Yêu cầu: máy chạy script cần có `pg_dump`/`pg_restore`/`psql` (gói
`postgresql-client`).

---

## Bước 5 — (Tùy chọn) Tích hợp Supabase Auth / Realtime / Storage

Đã cài sẵn `@supabase/supabase-js` và tạo 2 client wrapper, **hoàn toàn
tùy chọn** — nếu không cấu hình biến môi trường, code tự động no-op và
không ảnh hưởng gì đến app hiện tại:

| File | Dùng ở đâu | Mục đích |
|---|---|---|
| `src/lib/supabase/client.ts` | Client component (`"use client"`) | Supabase Auth (đăng nhập), Realtime subscriptions |
| `src/lib/supabase/server.ts` | API routes / Server Component | Thao tác admin (service role), bypass RLS |

### 5.1. Bật Supabase Auth thay cho JWT thủ công

Dự án hiện tại **chưa có hệ thống JWT thủ công nào** cần thay thế — các
API route hiện là public hoặc dùng session cookie đơn giản (xem
`src/app/api/v1/watchlist/route.ts`). Nếu bạn muốn thêm đăng nhập người
dùng:

```env
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

```tsx
// Client component ví dụ
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

async function signInWithEmail(email: string, password: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase chưa được cấu hình");
  return supabase.auth.signInWithPassword({ email, password });
}
```

### 5.2. Bật Supabase Realtime cho giá cổ phiếu

Hiện tại `/` (Dashboard) và `/stocks/[symbol]` lấy giá real-time bằng
polling `/api/v1/market/overview` mỗi vài giây (xem `usePoll` hook trong
`src/lib/client.ts`) — **cách này tiếp tục hoạt động bình thường**, không
bắt buộc phải đổi. Nếu muốn nâng cấp sang push-based:

```tsx
import { subscribeToTable } from "@/lib/supabase/client";

useEffect(() => {
  return subscribeToTable("price_snapshots", (payload) => {
    // cập nhật UI khi có INSERT/UPDATE mới trên bảng price_snapshots
  });
}, []);
```

> Yêu cầu bật **Realtime** cho bảng tương ứng trong Supabase Dashboard →
> Database → Replication trước khi dùng.

### 5.3. Service role key (server-only)

```env
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # KHÔNG BAO GIỜ đưa vào NEXT_PUBLIC_*
```

Dùng trong API routes qua `getSupabaseServerClient()` — key này bypass Row
Level Security nên phải xử lý như mọi secret khác (không hardcode, không
log ra console).

`/api/health/upstream` đã được cập nhật để tự động báo cáo trạng thái kết
nối Supabase Auth nếu 2 biến `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` được cấu hình — không cấu hình thì mục này
không xuất hiện trong response, không ảnh hưởng health check tổng thể.

### 5.4. Row Level Security (RLS)

Nếu dùng Supabase Auth cho người dùng cuối, nên bật RLS cho các bảng
nhạy cảm (`watchlist_items`, `agent_logs`) trong SQL Editor:

```sql
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only see their own watchlist"
  ON watchlist_items FOR SELECT
  USING (auth.uid()::text = session_id);
```

Vì app hiện dùng `session_id` dạng string tự sinh (không phải
`auth.uid()` của Supabase), cần điều chỉnh policy cho khớp nếu bạn tích
hợp Supabase Auth thật sự — đây là bước tùy chọn, không bắt buộc để
migrate database.

---

## Bước 6 — Docker Compose

Hai file compose riêng biệt tùy kịch bản triển khai:

| File | Dùng khi nào |
|---|---|
| `docker-compose.yml` | Tự host PostgreSQL (có service `postgres` + `pgbouncer` local) |
| `docker-compose.supabase.yml` | Dùng Supabase cloud — **không có service `postgres`/`pgbouncer`**, chỉ còn `web` |

Chuyển sang Supabase cloud:

```bash
cp .env.example .env
# điền DATABASE_URL = connection string pooled của Supabase
# điền NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY nếu dùng Auth/Realtime

docker compose -f docker-compose.supabase.yml up -d --build
```

Dự án **không dùng Redis** ở bất kỳ đâu (cache là in-memory trong
`src/lib/connectors/core.ts`), nên không có service Redis nào cần giữ
lại hay loại bỏ.

---

## Kiểm tra sau khi migrate

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/health/upstream
```

`db.status` phải trả về `"up"`. Nếu Supabase host được nhận diện đúng,
log khởi động sẽ có dòng:

```json
{"level":"info","provider":"database","msg":"supabase_connection_detected","mode":"pgbouncer-pooled","poolMax":5,"ssl":true}
```

---

## Thay thế TimescaleDB — tối ưu time-series không cần hypertable

Vì Supabase không còn hỗ trợ TimescaleDB, và schema hiện tại vốn đã không
dùng hypertable, dữ liệu giá (`price_snapshots`) đã được tối ưu bằng:

- Composite index `(symbol)` unique trên snapshot mới nhất — tra cứu O(log n).
- Nếu sau này bạn lưu **lịch sử** giá theo thời gian (không chỉ snapshot
  mới nhất) và bảng phình to (>10 triệu dòng), khuyến nghị dùng **native
  PostgreSQL declarative partitioning theo tháng** thay cho TimescaleDB
  hypertable — Supabase hỗ trợ đầy đủ tính năng này vì nó thuộc PostgreSQL
  lõi, không phải extension:

  ```sql
  CREATE TABLE stock_prices_history (
    symbol varchar(20) NOT NULL,
    time timestamptz NOT NULL,
    close double precision NOT NULL,
    volume double precision NOT NULL DEFAULT 0
  ) PARTITION BY RANGE (time);

  CREATE TABLE stock_prices_history_2026_01
    PARTITION OF stock_prices_history
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
  ```

  Đây chính là hướng mà Supabase khuyến nghị chính thức để thay thế
  TimescaleDB (họ dự định tích hợp sẵn `pg_partman` để tự động hoá việc
  tạo partition theo lịch, xem
  [Supabase Discussion #35851](https://github.com/orgs/supabase/discussions/35851)).
