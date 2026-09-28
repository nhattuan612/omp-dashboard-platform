# Hiệu chỉnh phân loại entitlement · 2026-09-27

- Phát hiện: hai credential OAuth bị khóa dù trạng thái đăng nhập hợp lệ.
- Bằng chứng read-only từ auth broker: mỗi credential trả ba bucket `daily` (Google, Anthropic, OpenAI); đây là capability đầy đủ nhưng khác hình dạng 5 giờ/tuần.
- Nguyên nhân: dashboard chỉ nhận bucket 5 giờ/tuần và bỏ qua quota `daily` hợp lệ mà OMP dùng cho Antigravity.
- Sửa: nhận Google + Anthropic + OpenAI `daily` (hoặc Claude/GPT shared) làm capability đầy đủ, hiển thị cửa sổ `Ngày` đúng dữ liệu và cho phép chọn thủ công.
- An toàn: pin theo session giữ nguyên; không fallback, không round-robin, không tự đổi account.
- Recheck live sau deploy: Google vẫn trả `403 Account verification required` cho cả hai credential khi gọi model. Đây là xác minh Google còn thiếu, không phải OAuth cache; dashboard giữ chặn đến khi xác minh hoàn tất.
- Recheck strict sau lần đăng nhập lại (19:53 ICT): ghim pool tạm chỉ đúng hai credential, tắt toàn bộ account khác rồi ping model tối thiểu. Cả hai có usage probe `ok`, nhưng completion đều fail `ACCOUNT_VERIFICATION_REQUIRED` trên `gpt-oss-120b` (~1.2 giây). Kết luận không đổi: OAuth còn hiệu lực nhưng Google chưa cho phép generation; không phải lỗi chọn nhầm account hay round-robin.
- Timestamp OAuth: dashboard chỉ dùng `authorizedAt` của OMP (mốc interactive OAuth), không dùng `updated_at` vì trường đó đổi theo refresh token. Kiểm chứng live: cả năm account trùng trực tiếp với OMP.
- Regression: `test-session-actions.mjs` 100/100, gồm fixture `daily` đầy đủ.
- Không ghi token, cookie, credential thô hoặc email vào tài liệu này.
