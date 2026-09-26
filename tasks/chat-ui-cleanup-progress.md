# Báo cáo tiến độ: Chat UI và bước tiếp theo

## Trạng thái

- Phần chỉnh sửa đã smoke-test trong môi trường OMP giả lập cô lập và hiện đã được triển khai vào local runtime `127.0.0.1:4177`.
- LaunchAgent đã restart theo xác nhận của người dùng; chưa tạo commit.
- Ưu tiên đã thống nhất: tập trung tính năng; polish giao diện để sau.
- Phạm vi báo cáo: công việc chat/OMP của lượt này, không gồm các thay đổi khác trong workspace.

## Đã thực hiện

### `honpi-chat-dashboard-live.js`

- Nút gửi chuyển sang hành vi dừng khi đang stream; dừng gọi `stopStream()` và abort request OMP đang chạy.
- Đồng bộ `aria-hidden` và `inert` cho dialog đóng/mở, tránh dialog ẩn xuất hiện trong accessibility tree.
- Xóa quick-action cards prototype, plugin giả và popover tham số chưa có backend cùng các handler liên quan.
- Thay nội dung tab Plugins bằng lựa chọn Browser/Share lấy từ OMP capabilities thật.
- Quota không còn giữ số liệu demo khi thiếu dữ liệu hoặc request lỗi: giá trị thiếu thành `--`, thanh quota về 0%, account list hiển thị empty/error state. Khi API hồi phục, dữ liệu thật được render lại.

### `server.mjs` và `test-session-actions.mjs`

- Thêm metadata folder bền vững, API `GET/POST /api/v1/folders`, và action `assign_folder`/`unassign_folder`.
- Session list trả `folderId`/`folderName`; create, assign, unassign, reassign và reload đều giữ đúng metadata.
- Contract test mở rộng lên 24 scenario; folder persistence pass trên port cô lập.

### Folder UI production

- Live session menu có `Phân loại folder`, tạo folder mới, gán folder có sẵn và bỏ phân loại.
- Sửa modal helper và dialog accessibility để form tạo folder nhận input thật, không bị `inert` trong lúc transition.

### `honpi-chat-dashboard-legacy.js`

- Chỉ cho legacy mock-account globals và chu kỳ refresh 30 giây chạy ngoài route `/chat`.
- Trên `/chat`, route guard `/^\/chat\/?$/` chặn updater giả chạy trước khi live controller được tải. Sau reload, hai global mock không còn được export.
- Các route legacy khác vẫn giữ nhánh updater cũ.

## Kiểm chứng

- `node --check honpi-chat-dashboard-live.js` và `node --check honpi-chat-dashboard-legacy.js`: pass sau chỉnh sửa cuối.
- `node test-session-actions.mjs`: 24 scenario fake-OMP pass.
- Fake OMP UI: đã kiểm tra stop/abort, approval deny và approve.
- Reload `/chat` trong server cô lập: quota, capabilities, models và sessions trả HTTP 200; không có runtime/console errors trong lượt kiểm tra cuối.
- Quota lỗi được mô phỏng bằng cách từ chối fetch: state/account được xóa, header/modal hiển thị `--`, bốn thanh quota về 0%, error row xuất hiện; tải lại API thật phục hồi account và quota.
- OMP settings có Browser/Share controls thật; fake toggle count bằng 0; quick-action grid và parameter popover không còn.
- Viewport 390 CSS px: document/body/scroll width đều 390; input 356 px và nút gửi 32 px nằm trong viewport; không tràn ngang.
- Đã xác nhận accessibility snapshot có dialog Cài đặt khi mở. Chụp screenshot tự động thất bại lặp lại với `CdpRequestTimeoutError: Page.captureScreenshot`; thay bằng AX snapshot và phép đo DOM. Vì ưu tiên UI đã được hạ, visual polish để sau.
- Sau deploy: script xác nhận source/runtime đồng bộ và `/healthz` sẵn sàng; `/healthz`, `/chat`, `/quota` đều trả HTTP 200. `./test-runtime-security.sh` pass.
- Browser `/chat` sau deploy tải live controller và OMP Browser/Share controls; legacy mock globals, fake plugin toggles và parameter UI không có. Lượt đầu ghi nhận capabilities/models/protect-status HTTP 200. Kiểm tra lại bằng `loadQuota()` chỉ đọc: overview/accounts/protect-status đều HTTP 200, state có 8 account và có active account; không có runtime/console errors.

## Môi trường và giới hạn

- Smoke-test chạy trên server OMP giả lập ở cổng 43821. Server đã dừng và thư mục fixture tạm đã xóa.
- Theo xác nhận của người dùng, chạy `./deploy-local-dashboard.sh --restart`. Checkpoint đầy đủ được tạo tại `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260923-152749`; LaunchAgent đã restart. Lần deploy folder gần nhất tạo backup `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-080317`; script sao lưu state/config rồi đồng bộ source, không ghi vào file state/config gốc.
- Hash trước deploy cho thấy source/runtime khác ở `honpi-chat-dashboard-live.js`, `honpi-chat-dashboard-legacy.js` và `console-bridge.mjs`; deploy script đồng bộ bộ file theo runbook. `console-bridge.mjs` được deploy nhưng không phải file chỉnh trong task này.
- Đã thử `1devtool-agent-v10` với OMP/Gemini `gemini-3.7-high`; terminal không có instance đang chạy, registry không có model này, và fallback headless hết thời gian. Không claim native Gemini 3.7 High đã chạy.
- Không stage hoặc commit. `git status` theo các path liên quan cho thấy hai source file và thư mục `tasks/` ở trạng thái untracked trong Git context bên ngoài; các thay đổi khác trong workspace được giữ nguyên, không đụng tới.

## Hạng mục đã hoàn tất — 2026-09-24

### Lưu bền thư mục dự án cho phiên chat

- `server.mjs` thêm metadata folder, `GET/POST /api/v1/folders`, và action `assign_folder`/`unassign_folder`.
- Session list trả `folderId`/`folderName`; tạo, gán, bỏ gán, gán lại và reload giữ đúng metadata.
- `honpi-chat-dashboard-live.js` nối menu session vào API, có tạo folder mới, chọn folder có sẵn và bỏ phân loại.
- Bổ sung modal helper và sửa dialog accessibility để form tạo folder nhận input thật trong lúc CSS transition.
- Contract test: `24 scenarios passed`; browser smoke trên server fake OMP cô lập: tạo → gán → reload → bỏ gán đều pass.
- Deploy lại local runtime với backup `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-080317`; `/healthz` trả `{"ok":true}`.

Polish giao diện vẫn ngoài phạm vi cho tới khi Síp yêu cầu riêng.

## Hàng chờ prompt và greeting — 2026-09-24

- Prompt được snapshot ngay trên web: text, attachments và settings không còn chờ `createSession()`.
- Dispatcher giữ FIFO theo session, chỉ cho phép một `activeRequest`; prompt mới không bypass order cũ.
- Khi chưa có session, queue nhận prompt với `sessionId: null`, tạo session dùng chung, tự chọn session mới và dispatch mà không chờ `GET /messages`.
- Greeting/logo hiện ở trạng thái neutral hoặc session rỗng; ẩn ngay khi submit; preview prompt hiển thị trong lúc chờ.
- Session mới lấy tên từ prompt đầu tiên ở frontend và backend; sidebar/header cập nhật tức thời.
- Baseline first prompt có thêm `GET /messages` trước stream; sau patch isolated browser không còn request này.
- Contract test: `25 scenarios passed`; browser smoke queue 3 prompt xác nhận thứ tự `one → two → three`, `maxRunning=1`, queue cạn và greeting ẩn.
- Deploy backup mới: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-084301`; `/healthz`, `/chat`, `/quota` trả `200`; source/runtime checksum khớp.
