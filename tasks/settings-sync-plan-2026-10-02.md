# Settings: chuẩn hóa demo và đồng bộ OMP — 2026-10-02

## Phạm vi được duyệt

Síp yêu cầu lập kế hoạch và thực hiện sau audit popup Settings. Giữ chức năng production thật và bảo vệ file Agent; giao diện lấy cấu trúc từ Neuratalk demo.

## Kế hoạch

- [x] Audit DOM live và demo; xác định duplicate ID, renderer lặp, handler giả và control bị ẩn.
- [x] Backup source/release trước sửa; kiểm tra SHA-256 manifest. UI/JS: `~/.omp/usage-dashboard/backups/settings-sync/20261002-085047`.
- [x] Chuẩn hóa 6 tab; General mỗi control một lần, thứ tự theo demo, ID duy nhất.
- [x] Models hiện đủ source/default/reasoning/gateway/Temperature/Max Output; tham số chưa có adapter disabled kèm lý do inline.
- [x] Browser/Share/Memory dùng duy nhất tab OMP và handler production; bỏ handler local/fake trùng.
- [x] Enter khi bận dùng queue/block thật; Cmd/Ctrl+Enter đảo hành vi, Shift+Enter xuống dòng.
- [x] Browser capability probe kết nối thực tế; đưa mode/config vào worker mà không đổi cấu hình OMP global.
- [x] Kiểm tra API, luồng settings, trạng thái lỗi/rỗng, desktop/tablet/mobile, glyph tiếng Việt và reduced-motion; 30 viewport-tab checks live pass.
- [x] Đồng bộ product-release, deploy sau backup runtime, kiểm tra checksum/health/live; lần deploy cuối 2026-10-02, backup `~/.omp/usage-dashboard/backups/deploy/20261002-092545-3852`.
- [x] Ghi bài học duplicate DOM/ownership vào checklist UI và mirror repo skill chính thức (commit `55aee41`, đã push `main`).
- [x] Phát hiện và sửa reduced-motion còn hiệu lực 0.2s trong modal; xác minh reduced-motion 0.00001s live.
- [x] Sửa vòng chờ Relay: cho phép chọn `Khởi chạy cùng chat` khi OMP cần bootstrap endpoint; contract prewarm giữ endpoint loopback và worker overlay.
- [ ] Relay vẫn chờ load extension thủ công tại `~/.omp/browser-relay/extension`; Síp đã chuyển ưu tiên sang Chrome/Electron CDP nên em giữ nguyên Relay.

## Layout contract

Modal giữ khung demo hiện có: header đầy chiều ngang, nav bên trái và nội dung có vùng cuộn. Mobile nav/row dùng bố cục hiện có theo breakpoint; text, endpoint và đường dẫn được wrap trong vùng nội dung. Mỗi setting có một label, một control, một state; không có duplicate ID hoặc renderer tạo bản sao. Control unsupported vẫn thấy và có lý do inline. Không thay đổi shell, dữ liệu hội thoại hoặc quyền xóa file Agent.

## Điều kiện kết nối browser

Relay cần relay server + extension đã nối; Chrome/Electron cần CDP loopback đang hoạt động. Code tự probe và từ chối mode không sẵn sàng; không báo supported từ version/help. Sau deploy, em đã tạo Chrome riêng cho OMP bằng profile `~/.omp/browser-profiles/omp-cdp`, CDP chỉ bind `127.0.0.1:9225`, và đặt `browser.cdpUrl` về endpoint này. `/api/v1/omp/capabilities` trả `chrome-electron: supported/ready`. Cấu hình OMP cũ được sao lưu tại `~/.omp/backups/omp-agent-config-before-cdp-20261002.yml` (mode `600`). Relay vẫn giữ nguyên: port `9224` trả `503` do extension chưa kết nối, `browser.relay=false`; không bật Relay global. Relay auto-start theo worker OMP khi được chọn trong chat mới; capability đánh dấu `connectOnStart` nếu server chưa được mở để tránh vòng chờ.
