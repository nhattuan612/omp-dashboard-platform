# Baseline đăng nhập lại Quota — 2026-09-27 17:12:44 +07

Mục đích: mốc đối chiếu trước khi đăng nhập lại các account. Không lưu token, cookie, email hay credential.

| Hạng mục | Kết quả baseline |
|---|---|
| Dashboard local | `GET /healthz` → `{"ok":true}` |
| OMP usage | `omp usage --json` → `accountCount: 0` |
| Provider đã nhận | Không có |
| Cache account dashboard | Không có account (state chỉ có trường alert) |
| API account qua request trần | `401` vì không có cookie dashboard; không dùng để suy luận OAuth account |

## Cách so sau khi đăng nhập

1. Mở `http://127.0.0.1:4177/quota`, đăng nhập từng account.
2. Refresh dashboard, đối chiếu số account, `planEligible`, `status` và bốn cửa sổ quota Gemini/Claude-GPT với baseline này.
3. Nếu account vẫn hiện `Google từ chối quyền` hoặc account đã chọn bị đổi, giữ nguyên session và báo lại để đối chiếu log provider/pin; không gửi prompt thử hoặc bật auto-switch.
