# Financial data cleanup

Bộ cleaner quét bảng `financial_statements` để phát hiện kỳ báo cáo tương lai, kỳ sai định dạng, bản ghi thiếu provenance filing/professional và synthetic đời cũ.

## Quy tắc an toàn

Chế độ mặc định là **dry-run**. Bản ghi thiếu source filing chỉ được báo cáo là degraded và **không bị xóa**. Chỉ các bản ghi synthetic được phép xóa, gồm synthetic đời cũ `sector-synthetic-v1`, hoặc bản ghi synthetic nằm ở kỳ vượt quá kỳ báo cáo đã hoàn tất. Trước khi xóa, toàn bộ dòng bị xóa được lưu vào `job_logs` với job `financial-data-cleanup-backup`.

Các bản ghi có source `filing`, `fmp`, `professional`, `daloopa` hoặc `fiscal-ai` không bị xóa bởi cleaner này, kể cả khi cần điều tra thêm.

## Chạy thủ công

```bash
pnpm exec tsx scripts/financial-data-cleanup.ts
pnpm exec tsx scripts/financial-data-cleanup.ts --symbols=VND,FPT
pnpm exec tsx scripts/financial-data-cleanup.ts --apply
```

Không truyền `--apply` sẽ chỉ quét và in JSON kết quả. Chỉ dùng `--apply` sau khi kiểm tra `issues` và `removableCount`.

## Endpoint nội bộ

```text
GET /api/internal/financial-data-cleanup
GET /api/internal/financial-data-cleanup?symbols=VND,FPT
GET /api/internal/financial-data-cleanup?apply=true
```

Endpoint yêu cầu `Authorization: Bearer $FINANCIAL_AUDIT_SECRET` hoặc `$CRON_SECRET`. `apply=true` chỉ xóa các dòng removable theo quy tắc trên; không xóa dữ liệu filing/professional.

## Cron

Vercel Cron chạy audit lúc `02:00` và cleanup lúc `02:30`, trong ngày 1–20 của các tháng 1, 4, 7, 10 và 12. Cleanup chạy apply có backup trước khi xóa. Kết quả và backup được lưu trong `job_logs`.

## Provenance

Fallback synthetic hiện dùng thống nhất source `sector-synthetic-v2`. `updated_at` chỉ là thời điểm hệ thống ghi dữ liệu, không được xem là ngày công bố báo cáo. Để được coi là actual, dữ liệu vẫn phải có provider filing/professional và provenance tương ứng.
