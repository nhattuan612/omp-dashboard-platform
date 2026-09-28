# Kiểm tra Quota sau đăng nhập — 2026-09-27 18:29:04 +07

## Kết quả live

| Nguồn | Kết quả |
|---|---|
| OAuth credential local | 5 credential `google-antigravity`, đều enabled, không có block active |
| `omp usage --json` | 0 account |
| `omp usage --history --days 1 --json` | 0 account |
| Sau `omp usage invalidate --provider google-antigravity` | Live và history vẫn 0 account |
| `omp auth-broker status --json` | `not_configured` |
| Dashboard | `/healthz` OK |

## Kết luận

OAuth callback đã hoàn tất nhưng OMP không xuất quota report dù credential cục bộ tồn tại. Vì vậy dashboard chưa có dữ liệu để đánh giá `Google từ chối quyền`, entitlement Pro/Ultra, quota hoặc account affinity. Đây là lỗi đồng bộ OMP credential → usage report, không phải bằng chứng Google từ chối quyền.

## Safeguard đã áp dụng

Sau OAuth, dashboard chỉ báo thành công khi `omp usage` nhận đúng account. Nếu report rỗng, UI báo rõ lỗi đồng bộ và không ghi auth-event thành công, không tự đổi account hay gán lỗi cho Google.
