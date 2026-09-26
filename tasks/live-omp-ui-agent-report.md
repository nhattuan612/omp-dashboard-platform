# Báo cáo QA live OMP Chat/Quota

**Thời điểm:** 2026-09-22 (Asia/Ho_Chi_Minh)  
**Runtime:** `127.0.0.1:4177` — một listener Node duy nhất (PID thay đổi theo restart).  
**An toàn:** Không gửi prompt thật, không tạo session mới, không switch account, không archive/delete. Không sửa source trong vòng QA.

## Smoke backend/routes

| Kiểm tra | Kết quả |
|---|---|
| `GET /chat` | `200` |
| `GET /quota` | `200` |
| `GET /api/v1/models` | `200`, 118 model live |
| `GET /api/v1/omp/capabilities` | `200`, có sessions/streaming/abort/file-references/agent-hub |
| `127.0.0.1:4177` listener | 1 Node listener |
| Console/network event buffer | `[]`, không thấy uncaught error/network error |

## Responsive evidence

Đã chụp tại `tasks/qa-screenshots/`:

- `live-chat-360.png`, `live-chat-390.png`, `live-chat-768.png`, `live-chat-1440.png`
- `live-quota-360.png`, `live-quota-390.png`, `live-quota-768.png`, `live-quota-1440.png`

Chat không có horizontal overflow ở 360/390/768/1440. Mobile sidebar đóng đúng ngoài viewport, nút menu hiện; desktop sidebar rộng 260px và tools drawer rộng 320px. Input co đúng theo viewport.

Quota không có horizontal overflow thực tế; `scrollWidth` nhỏ hơn viewport do scrollbar dọc (360→345, 390→375, 768→753, 1440→1425). Route hiển thị dữ liệu live 7 account.

## Flow đã kiểm tra

- Chat load: đạt; 50 session live, trạng thái `Đã kết nối`, không tự tạo session mẫu.
- Chọn session thứ hai: đạt; `.session-item.active` đổi ID và nội dung/header đổi theo session.
- Sidebar tools rail: đạt; `#closeToolsDrawerBtn` đóng drawer và hiện `#toolsDrawerRail`, click rail mở lại.
- Settings: đạt; có `Chung`, `Mô hình`, `Công cụ & trình duyệt`, `Agent Hub`; permission mặc định `require_approval`.
- OMP settings: đạt về hiển thị; `#ompBrowserModeSelect` có Ego Browser (Một phần), OMP Browser Relay, Chrome/Electron disabled; Agent Hub hiển thị trạng thái runtime.
- Tools: đạt về dữ liệu; `#drawerTabToolsBtn` hiện danh sách capability live, capability unavailable ghi rõ `Chưa khả dụng`.
- Quota: đạt; 7 account live, các scope `1g`, `24g`, `7n`, `30n`, `Tổng` lần lượt nhận class `period-btn active` khi click.
- Sync: đạt; `#syncBtn` disabled trong lúc chạy rồi bật lại, toast `Đã đồng bộ thành công dữ liệu 7 tài khoản OMP.`
- Link quota→chat: link `/chat` hiện và route trả `200`.

## Lỗi/blocker cần xử lý

### P1 — Ego Browser toggle lệch state

- Selector: `#egoBrowserToggle`.
- Thực tế: click lần 1 đổi UI sang `Đang TẮT`, toast chế độ tiêu chuẩn; `state.browserMode` vẫn là `ego-browser`. Click lần 2 đổi UI sang `Đang BẬT`, state vẫn `ego-browser`.
- Kỳ vọng: UI và payload adapter cùng chuyển giữa standard/ego; hoặc ẩn control nếu adapter chưa hỗ trợ chuyển mode.

### P1 — Approval selector đổi label nhưng không đổi adapter state

- Selector: `#fullAccessBadge`, option `#optApproveForMe`.
- Thực tế: label/settings select đổi sang `approve_for_me`, nhưng `window.HONPI_PRODUCTION_CHAT.state.approvalMode` vẫn `always-ask`. Đã khôi phục về `require_approval` sau kiểm tra.
- Kỳ vọng: chỉ báo, settings state và payload gửi backend phải cùng một giá trị.

### P1 — File attachment đang hiển thị nhưng upload bị chặn

- Selector: `#drawerTabFilesBtn` → `#drawerUploadFileBtn`.
- Thực tế: pane hiển thị `Tệp tin 0`, nút `Thêm tệp vào ngữ cảnh` visible/enabled; click và chọn fixture an toàn `/tmp/omp-ui-qa-attachment.txt` không mở file chooser, toast `Control này chưa có backend production.`, attachment count vẫn 0.
- Kỳ vọng: nối API file-reference thật hoặc ẩn/disable nút; không để capability endpoint quảng cáo `file-references` rồi chặn bằng unsupported handler.

### P2 — Model live chưa có default rõ ràng

- `/api/v1/models` trả danh sách live nhưng không có model default trong dữ liệu quan sát; UI chọn model đầu tiên (quan sát là `deep-research-max-preview-04-2026`).
- Nếu sản phẩm yêu cầu model mặc định `neural-flash-3.8`, backend cần đánh dấu default hoặc UI cần policy chọn rõ ràng.

## Chưa chạy vì policy QA

- `#newSessionBtn`: không click để tránh POST tạo dữ liệu live.
- Switch account, archive/delete, pin/unpin, rename, fork/share mutation: không click để tránh thay đổi dữ liệu thật; cần test trong fixture/mock hoặc staging có rollback.
- Gửi prompt/stream/stop/retry/reconnect và chọn file thật: không chạy vì yêu cầu không tiêu thụ quota và không upload dữ liệu.
- Quota detail modal và account switch transaction: route đã load/live nhưng chưa mở modal hoặc switch account trong vòng smoke này.

## Kết luận

Routes và dữ liệu live hoạt động, responsive không overflow, tools/settings/quota sync đạt. Chưa đạt điều kiện production “mọi control đều dùng được” do ba blocker P1: Ego toggle state, approval state và file upload handler. Cần sửa ba điểm này rồi chạy lại flow prompt/stream và mutation trên staging/mock.

## Hậu kiểm sau sửa

**Thời điểm:** 2026-09-22 — bản sửa mới nhất của agent chính.

- **Ego Browser toggle: PASS.** `#egoBrowserToggle` chuyển đồng bộ `browserMode: ego-browser → none → ego-browser`; class, title và aria-label đổi đúng theo state.
- **Approval selector: PASS.** `#optApproveForMe` đổi đồng bộ label, `#settingsPermissionSelect=approve_for_me` và adapter state `approvalMode=write`; chọn lại `#optRequireApproval` khôi phục `always-ask`.
- **Attachment: PASS.** `#productionFileInput` nhận fixture an toàn; state có 1 attachment và xuất hiện chip `productionAttachmentStrip` với tên file. Không còn toast unsupported.
- **Model mặc định: PASS.** `/api/v1/models` trả 118 model live; `#promptModelSelect` và `#settingsDefaultModelSelect` chọn `gemini-3.8-flash`.
- **Stream: PASS theo evidence runtime của agent chính.** Prompt kiểm thử an toàn đã trả `OK`; không lặp lại để tránh tiêu thụ quota.
- **Responsive/console/network:** giữ nguyên evidence vòng QA trước: 360/390/768/1440 không overflow; route/API đều 200; event buffer không có console/network error.

### Kết luận hậu kiểm

Ba blocker P1 đã đóng. Còn một điểm cần theo dõi: pane `#drawerFilesList` vẫn hiển thị placeholder trong khi chip attachment đã hiện ở `#productionAttachmentStrip`; không ảnh hưởng state/payload nhưng nên đồng bộ hai vị trí hiển thị trước nghiệm thu UI cuối.

### Hậu kiểm bổ sung

Sau hậu kiểm trên, `renderAttachmentStrip()` đã được cập nhật để đồng bộ cả `#productionAttachmentStrip` và `#drawerFilesList`. Fixture attachment hiện hiển thị ở cả hai vị trí, badge đếm đúng và payload giữ nguyên. Điểm theo dõi này đã đóng.

## Hậu kiểm mutation session tạm

**Phạm vi:** tạo 2 session tạm để kiểm tra; không gửi prompt, không đổi account/setting, không chạm session lịch sử. Session UI được tạo từ `#newSessionBtn` (sau thời gian khởi tạo OMP), sau đó xoá sạch. Session API thứ hai dùng để chạy đầy đủ action contract.

| Control/API action | Kết quả | Evidence |
|---|---|---|
| Tạo session | PASS | `POST /api/v1/sessions` → `201`, trả `sessionId`; UI `#newSessionBtn` tạo session và header chuyển `Phiên làm việc mới` |
| Chọn session | PASS | Session mới được active và nội dung rỗng được nạp |
| Rename | PASS backend | `POST /sessions/:id/action {action:"rename",title}` → `200`; GET list trả title mới |
| Pin / unpin | PASS | Hai request lần lượt `200`; `isPinned: false → true → false` |
| Unread / read | PASS | Hai request `200`; `isUnread: false → true → false` |
| Fork | PARTIAL | Request `fork` → `200`, trả `forkSession.id`, `status:"queued"`; child không xuất hiện trong GET `/sessions?limit=100` |
| Share URL | PARTIAL | Request `share` → `200`, `status:"queued"`; API không trả `shareUrl`, UI tự dựng `/chat?session=<id>` và copy clipboard |
| Archive | PASS | Request `archive` → `200`; parent biến mất khỏi GET sessions |
| Delete | PASS | Session UI tạm khác được `delete` → `200`, `deleted:true`; kiểm tra xoá parent sau archive trả `404 NOT_FOUND` là đúng vì đã archived |
| Dọn dữ liệu | PASS | Không còn session QA mutation trong GET list; fork child queued cũng không xuất hiện |

### Ghi chú UI

`#newSessionBtn` đã tạo được session sau khoảng 10 giây khởi tạo OMP. Khi thử mở menu more trên row session bằng pointer, Ego báo `<div> intercepts pointer events`; vì vậy rename/pin/unread/fork/share được xác nhận qua cùng endpoint mà UI `runAction()` gọi, còn pointer menu cần kiểm tra lại ở vòng visual QA riêng. Không có dữ liệu lịch sử bị thay đổi.

## Hậu kiểm sau sửa fork/share/menu

- **Fork: PASS.** Backend chờ session OMP thật xuất hiện, trả `status:"ready"`, child dùng OMP session id và được ghi metadata/path; test trả child `01a0c77b-8670-776c-a95a-61fd79bd3591`, sau đó cleanup `delete` → `200`.
- **Share: PASS local.** API trả `status:"ready"`, `shareMode:"local"`, `shareUrl:"/chat?session=..."`; UI copy đúng URL trả về. Encrypted/collab vẫn hiển thị `partial` đúng capability OMP, không giả thành công.
- **Menu More: đã gia cố.** Production ẩn menu prototype cũ, menu live đặt `z-index:3000` và `pointer-events:auto`; action menu không còn dùng lớp prototype chồng lên.

### Visual pointer re-check

Qua tab live sau reload, click pointer vào `Tùy chọn cuộc trò chuyện` đã mở `liveSessionActionMenu` với 7 action. Click `Ghim` trả toast `Đã thực hiện: pin`; trạng thái đã được khôi phục về `unpin` ngay sau kiểm tra.

## Hậu kiểm khẩn cấp `/chat` — khả năng truy cập và sử dụng

**Thời điểm:** 2026-09-22, sau reload runtime hiện tại.

- Route `/chat`: `200`; `/api/v1/sessions?limit=1`: `200`; `/api/v1/models`: `200`; listener chỉ có một Node process tại `127.0.0.1:4177`.
- Accessibility snapshot có đầy đủ sidebar, 50 session live, header model `gemini-3.8-flash`, textbox composer và nút `Gửi tin nhắn (Nhấn Enter)`.
- Click một session hiện có thành công: `.session-item.active` đổi sang session đã chọn, header đổi `Phiên làm việc mới`, nội dung chat được nạp.
- Composer hoạt động: fill/clear thành công; nút gửi visible/enabled. Click khi prompt rỗng bị chặn đúng và tạo thông báo `Vui lòng nhập nội dung trước khi gửi.`; không gửi prompt mới.
- Browser event buffer có 69 event, `errorEvents: 0`; không thấy console exception, failed request hoặc network error.
- Screenshot recovery: `tasks/qa-screenshots/chat-live-recovery.png`.

### Nguyên nhân pointer có thể làm Síp tưởng chat bị khóa

Nút More của session có CSS `pointer-events: none` khi row chưa hover. Bấm trực tiếp khi chưa hover sẽ bị `<div> intercepts pointer events`; hover row trước làm `pointer-events: auto`, sau đó menu mở bình thường và các action pin/unpin trả API `200`. Đây là affordance/interaction issue, không phải runtime/API outage.

Một context menu còn mở sau một vòng browser bị ngắt cũng có thể che sidebar; reload hoặc click vùng chat để dismiss đã khôi phục UI. Sau reload, route, session selection, composer và validation đều PASS.

## Chẩn đoán Safety Guard và hậu kiểm lỗi Client đã đóng kết nối

- Safety Guard là khoảng cách tối thiểu 20 giây trong console-bridge.mjs:12, không phải provider 429; /api/safety báo blocked=false, recent429Count=0, consecutive429=0, lastDecision=healthy, còn protect-status báo cooldownSec=0.
- Root cause lỗi lifecycle đã sửa trong /Users/trannhattuan/.omp/usage-dashboard/server.mjs:1304-1314: dùng req.on("aborted") và kiểm tra res.destroyed/res.writableEnded; không còn dùng req.on("close") để đánh dấu nhầm client đóng.
- Sau runtime restart và reload /chat: HTTP 200, LaunchAgent running PID 97668, chỉ một listener 127.0.0.1:4177; 50 session hiển thị, composer tồn tại, nút gửi enabled, trạng thái Đã kết nối.
- Ego Browser event buffer sau reload không có console error, Log error hoặc Network.loadingFailed; các API khởi tạo sessions/models/quota đều 200.
- Không gửi prompt mới trong vòng này để tránh tiêu quota; evidence stream thành công trước đó vẫn giữ ở phần hậu kiểm trước. Các log CLIENT_CLOSED quan sát được là log cũ trước bản sửa.

**Trạng thái:** PASS route/load/reload/session/composer/console/network sau sửa. Không thay đổi Safety Guard hoặc bật auto-retry.
## 2026-09-22 — Safety Guard stream fix

- User-visible failure: second prompt within the 20-second provider safety gap was rendered as `Stream lỗi` with `Google Safety Guard: còn Ns trước request tiếp theo`.
- Root cause: backend rejected the request immediately even though the wait was short and safe; the UI had no waiting state.
- Fix: stream endpoint now emits `waiting` events and waits for the guard slot before sending to OMP; UI shows a countdown and keeps the stream open. Real 429 cooldown remains a hard error.
- Verification: `node --check` passed; source/runtime chat checksum matches; `/chat` and `/healthz` return 200; one listener remains on `127.0.0.1:4177`.
- Follow-up root-cause fix: POST request `close` was being treated as client disconnect; Node emits it after the request body completes. The chat SSE now handles `aborted` and response `close` only while the response is still open, preventing false `Client đã đóng kết nối` errors.
- **Root cause bổ sung phát hiện sau phản hồi live:** `waitForRequestSlot()` còn kiểm tra `req.destroyed`; Node đánh dấu `IncomingMessage.destroyed=true` sau khi POST body đã đọc xong dù response SSE vẫn mở. Điều này vẫn ném `CLIENT_CLOSED` trước khi gửi prompt. Đã sửa vòng chờ chỉ dựa trên cờ `ended` do handler abort/response-close quản lý, restart LaunchAgent PID mới `2501`, và `node --check` pass.
- Design audit follow-up: live checks at 360/390/768/1440 found no horizontal overflow; sidebar group chevrons now render and support click plus Enter/Space with `aria-expanded`. Production greeting keeps only the real New Chat and Ego Browser actions; GitHub/Skill/Open Design/Plan cards are hidden because no matching production adapter exists.

## Xác minh trực tiếp bổ sung

- Composer nhận đúng nội dung nhiều dòng `Dòng 1\n\nDòng 2`, bộ đếm cập nhật `14 ký tự / ~4 tokens`, sau đó xoá sạch về `0 ký tự`; không gửi thêm prompt thật.
- Toggle thư mục sidebar đổi `aria-expanded=true → false`, class `collapsed=false → true`, rồi khôi phục lại đúng trạng thái ban đầu.
- Các quick card không có adapter production (`GitHub`, `Skill`, `Open Design`, `Plan`) đang `hidden=true`; chỉ còn `Mở cuộc trò chuyện mới` và `Ego Browser` hiển thị.
- Kiểm tra runtime cuối: `/chat`, `/quota`, `/healthz` đều `200`; một listener PID `99752`; checksum source/runtime khớp; `257/257` assertion pass; `node --check` pass.

## 2026-09-22 — Body/sidebar UI alignment

- Production source: `honpi-chat-dashboard-SKE.html`; runtime checksum matches source: `e89ef99a5fded9d9a6a9ae33ee5e9ed2d2998803830fca5c9eed88cf742d5bcf`.
- Assistant content now uses a safe DOM Markdown renderer: headings, ordered/unordered lists, bold/italic, inline code, fenced code, blockquote and safe HTTP(S) links. No raw Markdown markers remained in the live DOM (`rawMarkers: 0`); live session rendered 4 message blocks, 3 headings, 4 lists, and 10 strong nodes.
- Fixed duplicate transcript turns in runtime `chatMessages()`: persisted OMP records are canonical; runtime cache duplicates are dropped when role/content/timestamp match. The checked session returned 5 messages, no duplicate role/content pair, and unique IDs.
- Sidebar now follows Design System baseline: default/minimum width 260px, readable 28–30.75px session rows, 10px content rhythm, muted metadata at 0.72 opacity, hidden hover action buttons to prevent title shift, and keyboard/click folder toggle preserved.
- Live CUA checks: `/chat` visual reload passed; folder toggle changed `aria-expanded=false → true`; desktop/mobile metrics at 360/390/768/1440 had zero horizontal overflow; console error/warning count was 0.
- Runtime checks: `/chat`, `/quota`, `/healthz` HTTP 200; `/healthz` returned `{"ok":true}`; one listener on `127.0.0.1:4177`; `node --check` passed; mock baseline remained `257/257`.

## 2026-09-22 — Sidebar folder label rule

- Production sidebar now renders `session.folderName` as a badge only when `session.isPinned` is true.
- Sessions inside project folders keep the folder grouping header, but their individual rows no longer repeat the folder name; pinned rows retain the folder badge for context.
- Live verification after LaunchAgent restart: 50 sessions loaded, folder rows `folderBadges=0`, pinned rows `pinnedBadges=1`, connection status `Đã kết nối`.
- Responsive check at 360/390/768/1440: zero horizontal overflow.

## 2026-09-22 — Agent feature audit and production fixes

Agent live audit found:

- Rename/delete were blocked by native `prompt()`/`confirm()` in the in-app browser; production now uses the existing accessible input/delete modals and calls `/api/v1/sessions/:id/action`.
- Sort parser did not understand compound ages such as `15g 23p`; production sort now uses `updatedAt`/`createdAt` with a compound-age fallback and persists sort/filter through reload.
- Search refresh used the wrong input id; production now reads both search controls.
- Folder creation/assignment, duplicate and sample export were DOM-only; those controls are hidden in production until OMP routes exist.
- Reasoning now updates the real stream payload (`state.thinking`) and persists locally. Enter-while-busy now supports queue, send-now and block. Conversation display now changes production message density.
- Browser mode label follows the selected OMP capability. English, Temperature and Max Output are visibly marked unavailable because this OMP runtime has no corresponding contract. Agent Hub remains informational until OMP exposes operations.
- Gateway card no longer claims a hard-coded `127.0.0.1:61277`; it reports the live dashboard connection state.
- Mobile composer/approval popover no longer causes horizontal overflow at 360/390px.

Live checks after the fixes: rename and delete on a temporary session, reasoning sync, Browser Relay label, conversation density, sort persistence, modal cancellation, console errors, and 360/390/768/1440 layout.

Final verification 14:19 ICT: `node test-mock-api.js` 257/257; `node --check` server and production adapter pass; `/chat`, `/quota`, `/healthz` return 200; one listener at `127.0.0.1:4177`; source/runtime checksum `0909f4b5192c1f9bb62de5b7655fc1c91ba09ad74bfc3df6803e2a4db4ab40b7`; live console had zero new errors; mobile overflow false at 360/390/768/1440.

## 2026-09-22 — OMP thật và tool allowlist

### Semantics của allowlist tool trong OMP

- `--tools=<csv>` là allowlist khởi tạo context; OMP kiểm tra tên tool trước khi chạy và không chấp nhận tên ngoài registry của context.
- Runtime OMP có `setActiveToolsByName` theo phạm vi session. Một prompt tiếp theo trong cùng session giữ nguyên tool đang bật; OMP không tự tắt sau mỗi order.
- RPC mode hiện không có command web riêng để đổi active tool. Adapter vì vậy dừng context, khởi tạo lại cùng session path với allowlist mới rồi lưu `metadata.tools`.
- Tạo chat mới từ web truyền lựa chọn tool hiện tại vào context mới; chuyển lại session cũ khôi phục allowlist đã lưu của session đó. Đây là quy tắc của adapter web, còn OMP core sẽ reset các quyết định runtime ở ranh giới `newSession()`.
- Drawer production hiển thị mô tả tiếng Việt, switch theo Design System và trạng thái `Đang bật/Đang tắt · Khả dụng`; trong lúc adapter đang restart, switch bị khóa để tránh hai mutation chạy đồng thời.

### Kiểm tra sau khi triển khai 16:xx ICT

- Drawer live có 19 hàng, 19 mô tả tiếng Việt, switch kích thước 38×22px; accessibility tree nhận đúng role `switch`.
- Toggle `Đọc tệp` trên session `em, ơi`: lúc adapter restart mọi switch bị khóa; API hoàn tất trả toast `Đã cập nhật công cụ OMP cho phiên; áp dụng từ lượt kế tiếp.`; bật lại thành công và metadata session khôi phục `read`.
- Gửi thêm order chưa được gọi trong vòng này để tránh tiêu quota; quy tắc giữ tool đã được kiểm tra bằng context/session adapter, không cần model prompt.
- `GET /api/v1/omp/capabilities`: 19 tool, 19 mô tả, capability response không chứa secret; `/chat` và `/quota` 200; một listener 4177; checksum source/runtime khớp; console browser không có error/warn.

## 2026-09-22 — Tool drawer alignment theo demo chuẩn

- Production drawer dùng lại composition của demo: `tool-group-label` → hàng `icon / tên + nhãn trạng thái / mô tả` → switch ở mép phải.
- Live metrics ở 320/375/768/1024/1440px: overflow ngang `0`; switch `38×22px`; hàng đầu tiên nằm trọn trong drawer; title một dòng; mô tả tối đa 2 dòng; line-height mobile `15.18px`, từ tablet `16.1px`.
- Accessibility tree nhận đúng `role=switch`, `aria-checked` và nhãn tiếng Việt; toggle mobile 320px đã kiểm tra bật/tắt và khôi phục.
- Screenshot live khớp demo về thứ tự đọc, icon, status tag, mô tả và vị trí switch; browser console không có error/warn.

- `omp/18.2.7` tại `/Users/trannhattuan/.bun/bin/omp`; một lượt thật đã trả đúng `OK` từ `google-antigravity/gemini-3.8-flash`, dùng `--no-session --approval-mode always-ask --thinking medium`.
- Probe `--tools` trực tiếp cho thấy 19 tool ID hợp lệ trong RPC: `read`, `write`, `edit`, `ast_edit`, `grep`, `glob`, `bash`, `eval`, `lsp`, `debug`, `task`, `hub`, `web_search`, `todo`, `goal`, `init_experiment`, `run_experiment`, `log_experiment`, `update_notes`.
- Đã loại khỏi catalog production các tên không hợp lệ trong context này: `browser`, `ask`, `fetch`, `computer`, `github`, `memory`, `security_scan`, `tts`, `generate_image`, `ast_grep`. Ego Browser/OMP Browser Relay vẫn là Browser mode riêng.
- `console-bridge.mjs` giờ truyền `--tools=<csv>` khi tạo RPC context. Drawer Công cụ dùng checkbox thật; action `tools` restart context, giữ session path, lưu metadata; session cũ chưa có context được dựng lại trước khi toggle.
- Verification: `/api/v1/omp/capabilities` trả 19 tool với `canToggle:true`; session `OpenDesign Charter` đã test tắt `todo`, API trả `200` và UI reload hiển thị Todo unchecked; console không có lỗi mới. Không gửi thêm prompt model khi test toggle.

## 2026-09-22 — Folder/session sidebar behavior

- Mỗi folder production hiển thị tối đa 5 session đầu theo thứ tự hiện tại; folder nhiều hơn 5 có nút `Tải thêm`, tải tiếp các trang API cần thiết rồi mở toàn bộ folder.
- Session row hỗ trợ double-click rename và context-menu rename. Rename chỉ cập nhật title, giữ nguyên `updatedAt` hoạt động nên không làm session nhảy lên đầu; backend và UI đều đã kiểm tra.
- Header folder có context menu thật với `Luôn mở rộng`, `Luôn thu gọn` và chế độ thủ công; preference áp dụng khi render lại và không giả mạo API OMP.
- Live Ego Browser: folder 5-row cap, tải toàn bộ `Open design` thành 74 row, menu folder đủ 3 lựa chọn, double-click mở modal rename; console không có lỗi.
- Verification: source/runtime checksum khớp `e278e818e20329d85e89dc7c8c51b1e6419c148123c546173fba144b7a1e3fbc`; `257/257` mock assertions pass; `/chat` và `/quota` 200; một listener loopback `127.0.0.1:4177`.

## 2026-09-24 — Chat UI responsive audit follow-up

**Phạm vi:** live `/chat` tại `http://127.0.0.1:4177/chat`; viewport 320×800, 375×812, 768×1024, 1024×768 và 1440×900.  
**Kết quả:** 3 lỗi UI xác minh được — 2 P1, 1 P2. Đây là lượt rà soát bổ sung; không sửa source.

### P1 — Ngăn Công cụ & Tệp tin không mở được trên mobile

- Ở 320px, `#toggleToolsBtn` chỉ đổi class `collapsed`; drawer vẫn ở ngoài màn hình (`x=320`), không có class `mobile-open`.
- Bấm `#toolsDrawerRail` cũng chỉ bỏ `collapsed`; drawer vẫn ở `x=320`, `mobile-open=false`. Người dùng không vào được danh sách công cụ và tab tệp tin trên mobile.
- Sidebar mobile vẫn mở được; drawer bên phải và tab Công cụ/Tệp tin hoạt động ở desktop.

### P1 — Composer chồng điều khiển ở tablet ngang 1024px

- `.app-main` rộng 444px (`x=260…704`); drawer bên phải bắt đầu tại `x=704`.
- `#fullAccessBadge` nằm tại `x=536…684`, chồng lên `#voiceRecordBtn` (`x=580…612`) và `#sendBtn` (`x=619…651`). Hit-test trong vùng chồng trả về badge thay vì nút mic/gửi.
- `#promptModelIconBtn` tràn tới `x=718`, vượt mép `.app-main` 14px và bị drawer che.

### P2 — Header cắt tên phiên và model ở bề rộng hẹp

- `.header-session-title` rộng 0px tại 320px và 375px; chỉ 17px tại 1024px dù nội dung cuộn rộng 164px.
- `#headerModelPill` chỉ rộng 25px tại 320px và khoảng 92–95px tại 1024px; tên model không hiển thị đầy đủ.

### Kiểm tra đạt và giới hạn

- Không có tràn ngang ở cấp document tại các viewport đã thử; tràn ở 1024px bị giới hạn bên trong composer/main pane như ghi ở P1.
- Inter và glyph tiếng Việt hiển thị; ba ảnh trong trang tải thành công; không có lỗi console/runtime trong lần nạp live được ghi nhận.
- Kiểm tra tương tác mobile sidebar, drawer desktop và chuyển tab Công cụ/Tệp tin đạt. Ô nhập có tên truy cập từ placeholder; nút có focus indicator khi đi bằng bàn phím.
- Đây là rà soát trực quan/DOM và tương tác chính; chưa chạy kiểm tra WCAG/contrast tự động đầy đủ.

### Follow-up — Chat body resize rail hit area

- Hover/drag activation now matches the visible rail width (3.5px), replacing the broad horizontal buffer; full-height vertical tracking and existing header/bottom-panel limits remain.
- Live `/chat` at 1440×900: x286 (12px beside the x274 rail) stays hidden; x275 shows the rail and pointer y400→450 moves its top from 358→408px; x273 and x278 stay hidden.
- Dragging from the rail changed the chat frame 784→760px. Restored the original 784px width and empty saved preference.
- 320/768/1024/1440px viewport checks kept document width equal to viewport. Source and runtime scripts match; `node --check` passed for both.

### Follow-up — Responsive chat body resize rail

- Rail visibility now follows actual resize capacity rather than the 920px viewport cutoff: visible at 641/684/768/920/1440px; hidden at 320/375/640px where the 600px minimum leaves no range, and at 921/1024px where the sidebars leave insufficient body width.
- Live drag at 684×752 changed the chat frame 652→624px; at 1440×900 it changed 784→760px. Restored the original widths and empty saved preference after each drag.
- At 684px, x20 (12px beside the x8 rail) stays inactive; x9 activates the 3.5px handle. The compact tooltip flips to the right and remains inside the viewport.
- 320/375/640/641/684/768/920/921/1024/1440px checks kept document width equal to the viewport. Tablet screenshot shows the rail; the stabilized 320px screenshot shows it hidden.

## 2026-09-24 — Settings UI audit and fixes

**Phạm vi:** live `/chat` settings, new-chat state; viewport 320×760, 375×812, 768×1024 và 1500×819. Không gửi prompt, không tạo/chọn session.

- **Badge preview bị ẩn:** `sanitizeProductionSurface()` đặt `.settings-badge-preview-row` `hidden` dù toggle vẫn cập nhật `data-colorful-badges` và localStorage. Đã giữ preview cho setting production. Live off/on đổi đủ 4 nhóm preview từ cùng màu đơn sắc sang màu ngữ nghĩa; CSS cũng áp trực tiếp cho `.ai-message-card code.badge-*`. Không có message card trong session mới nên không gửi prompt để dựng dữ liệu mẫu.
- **Tab tác tử trống/lệch nhãn:** `loadAgentHub()` chỉ chạy khi có `activeId`, khiến pane trống ở trạng thái chưa chọn session; nav “Cấu hình tác tử” lại chứa Agent Hub status. Giờ luôn render empty state “Chọn session để xem task/subagent thật.” và nhãn tab “Tác tử OMP”.
- **General vỡ ở mobile:** tại 320px `settingsPermissionSelect` giữ intrinsic width 309px, vượt mép modal (`x=41…350`, modal phải `x=312`) và phần copy co về 0px; 375px copy cũng 0px. Đã stack hàng General dưới 480px và đặt `min-width:0`; sau sửa select/copy cùng nằm trong row tại 320/375px.
- **Mô tả Enter sai trạng thái:** control bị runtime disable ở `Gửi ngay` nhưng helper text còn hứa queue/chặn; nay inline nêu rõ OMP gửi ngay và queue/chặn chưa khả dụng.
- **Responsive:** document width bằng viewport ở 320/375/768/1500; settings modal, General rows, preview và Agent Hub nằm trong vùng; tab ngang mobile cuộn được.
- **State sau kiểm thử:** sidebar accent `neutral`, colorful badges `true`, theme `dark`, ngôn ngữ `vi`, cỡ chữ `14px`; các state đã về giá trị ban đầu. Console/runtime kiểm tra ở hậu kiểm dưới đây.
- **Verification:** hard reload live `/chat`; badge preview visible and flips from one monochrome computed color to four semantic colors; `document.fonts.check("14px Inter")` returned `true`. Agent empty state rendered with no active session. No session/message created, so message-card colors were not visually exercised; the live CSS selectors target `.ai-message-card code.badge-*`.
- **Static/runtime:** `node --check` passed on source and runtime `honpi-chat-dashboard-live.js`; SHA-256 matches on both (`a3532630cd953edbf02e79c8bca26f17253edf22ace60a4f73ea26ea3f2f5c16`). Ego page event buffer returned 0 events after interactions.
- **Checklist:** local `tuan-thiet-ke-ui` and official `MY-SKILL---tuanvungtau` updated with UI-28–UI-31; pushed to `main` as `6e62343`.

## 2026-09-24 — Actual conversation badge-color follow-up

- **Tái hiện:** Dù setting và `localStorage` đều là `true`, 123 inline-code nodes trong một conversation đã đọc vẫn giữ màu trung tính; trước sửa các node chỉ là `<code>` không có class/type, lệch khỏi selector `.badge-*`.
- **Root cause:** `appendInlineMarkdown()` không gắn hook màu cho inline code; lần kiểm tra trước chỉ chứng minh preview nên bỏ sót renderer của message thật.
- **Sửa:** Inline code nay nhận `.inline-code-badge`; token nhận diện được gắn `data-type`/`.badge-file`, `.badge-service`, `.badge-port` hoặc `.badge-env`; token khác dùng accent khi bật màu. Code block fenced giữ nguyên.
- **Live proof:** Cùng conversation, 123 badge thật (7 file, 116 generic); sau khi transition ổn định, OFF cho 1 màu/1 nền, ON cho 2 màu/2 nền khác nhau. Toggle và storage được trả về `true`.
- **An toàn:** Chỉ chọn conversation đã đọc để kiểm tra; không gửi prompt, tạo session hay in nội dung message. Accent/theme và preference ban đầu không đổi.
- **Kiểm tra code:** `node --check` source/runtime đạt; SHA-256 cả hai `e4bcb6b64d6e3a9705b4306f1b909150bfd5993bc5e8cd05acad9806aeeebb0d`; live browser không có page error.
- **Checklist:** UI-32 được thêm vào bản cài đặt, mirror khớp nội dung, push repo skill chính thức `main` commit `5dfde8b`.

