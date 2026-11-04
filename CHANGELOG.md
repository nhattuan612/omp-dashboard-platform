# Changelog

## 1.1.0 — 2026-11-04

### Added

- Route chat, OpenAI-compatible API và local API qua account Quota đang chọn; OMP Gateway có Bearer key riêng.
- Tạo các ACP session độc lập song song trên worker dùng chung.
- Safety Guard giãn lượt gửi prompt tối thiểu một giây và áp dụng cooldown khi provider trả 429.

### Fixed

- Session mới không còn quét lịch sử OMP để tìm một ID vừa được tạo, giảm độ trễ mở phiên.
- Khi cấu hình ghim account bị lỗi, request dừng thay vì chuyển account ngầm.
