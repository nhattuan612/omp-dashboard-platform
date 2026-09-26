# Báo cáo phối hợp fix chung `/chat` và `/quota`

## Phạm vi

Dashboard đang dùng chung loopback runtime `127.0.0.1:4177` và backend:

- `/chat` → `honpi-chat-dashboard-SKE.html`.
- `/quota` → `honpi-quota-dashboard-SKE.html`.
- Backend chung → `~/.omp/usage-dashboard/server.mjs`.
- Console/SSE bridge của Chat → `~/.omp/usage-dashboard/console-bridge.mjs`.

## Shared backend status (2026-09-23)

Các mục dưới đây là yêu cầu lịch sử cần hai dashboard thống nhất; source/runtime hiện đã có boundary chung:

1. **Auth/Host/Origin:** `server.mjs` yêu cầu cookie dashboard hợp lệ, Host loopback hợp lệ và Origin nằm trong allowlist trước mọi `/api/*`.
2. **Console command:** `console-bridge.mjs` chỉ nhận command trong allowlist/policy; không nhận lệnh tùy ý từ browser.
3. **SSE/error redaction:** raw frame được redact trước lưu/phát; client nhận error code/message giới hạn, không nhận credential hoặc raw secret.
4. **Security headers:** response chung áp dụng CSP, `x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy` và `cache-control`.
5. **Contract:** JSON/SSE giữ error shape, status code, request id và versioning; shared backend patch phải kiểm tra cả `/chat` và `/quota`.

Các mục trên không còn là blocker cần patch ngay. Không mở rộng security boundary riêng cho `/chat` hoặc `/quota`; chỉ sửa nếu regression runtime chứng minh contract hiện tại không đủ.

## Nguyên tắc triển khai

- Một người/nhánh chịu trách nhiệm patch shared backend; bên còn lại review trước khi deploy.
- Tách rõ quota-only, chat-only và shared patch.
- Shared patch phải test cả `/chat` và `/quota` trước restart.
- Không đổi UI hoặc dữ liệu quota trong patch security nếu không cần thiết.
- Không xóa code cũ trong đợt security; chỉ quarantine sau khi hai bên xác nhận không còn caller.

## Kiểm thử bắt buộc trước khi merge/deploy

- `node --check` cho `server.mjs` và `console-bridge.mjs`.
- Mock/contract tests và route smoke cho `/chat`, `/quota`, `/healthz`.
- Browser QA 360/390/768/1440 cho cả hai dashboard.
- Kiểm tra command bị từ chối khi không nằm trong allowlist.
- Kiểm tra SSE không lộ raw stderr/credential.
- Kiểm tra switch account và quota `--` vẫn đúng sau shared patch.
- Đối chiếu checksum source/runtime và thử restore backup nếu patch fail.

## Backup và rollback chung

Trước mỗi patch shared, tạo backup timestamp chứa source/runtime asset, manifest checksum và cấu hình cần khôi phục; thư mục `700`, file nhạy cảm `600`, không commit token/session/log. Nếu một dashboard fail sau patch, rollback toàn bộ shared patch về checkpoint trước đó, không vá nóng riêng một dashboard.

## Đề nghị bên `/chat` xác nhận

- Đồng ý dùng một security boundary và một error/SSE contract cho cả hai dashboard.
- Cử một đầu mối review patch `server.mjs`/`console-bridge.mjs`.
- Xác nhận test matrix trên trước khi restart runtime.
- Xác nhận chưa xóa adapter/legacy/backup trong đợt fix này.
