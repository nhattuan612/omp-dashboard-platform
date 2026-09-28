# Khôi phục nguồn Quota qua Auth Broker — 2026-09-27

## Sửa nguồn dữ liệu

- Chạy `auth-broker` local tại `127.0.0.1:8765`; chỉ bind loopback. Token do OMP tự quản lý, permission `0600`, không lưu vào source/log.
- Cấu hình `auth.broker.url` trỏ đến broker local. Health-check OMP trả `ok`, version `18.3.2`.
- Migration không ghi thêm credential: 5 Google Antigravity OAuth credential đã có sẵn trên broker.
- Dashboard ưu tiên `omp usage --json`; khi command này không có report, fallback sang `omp auth-gateway check --json`, cache report 60 giây để tránh probe dồn dập.

## Trạng thái sau khôi phục

| Hạng mục | Kết quả |
|---|---|
| Account Google Antigravity | 5 |
| Đủ entitlement Pro/Ultra (4 bucket) | 3 |
| Daily-only, không đủ entitlement | 2, bị khóa đúng |
| Account có thể dùng | 3 |
| Account active | 1 |
| Status | 2 normal, 1 warning 429 lịch sử, 2 plan unsupported |

429 lịch sử không còn khóa account khi quota live dưới 90% và Safety Guard không cooldown. Hết quota, quota ≥90%, OAuth lỗi hoặc cooldown thật vẫn fail-closed; không có auto-switch account.

## Xác minh

- Dashboard `/healthz` OK; broker health OK.
- `test-session-actions.mjs`: 100/100 pass, gồm fallback broker và 429 lịch sử với quota live còn lại.
