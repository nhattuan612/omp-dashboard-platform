# Kế hoạch nâng cấp UI Neuratalk bằng dữ liệu OMP thật

## Mục tiêu

Đưa ngôn ngữ thiết kế, bố cục và các trạng thái minh hoạ từ `Nâng cấp giao diện/neuratalk-backend-handoff-v1.0.0/` vào `/chat`, trong khi giữ nguyên nguồn dữ liệu, quyền và hành vi đã được OMP runtime xác minh.

Gói Neuratalk là thư viện tham chiếu giao diện: ảnh đính kèm phải có thumbnail/metadata/viewer như mẫu; hàng chờ phải có tray, trạng thái và nút đúng với khả năng queue thật; hoạt động OMP, thay đổi tệp, quota, terminal và lỗi phải hiển thị theo state thật, không dùng số liệu hoặc success giả.

## Giả định đã chốt

- `server.mjs`, `console-bridge.mjs` và API runtime hiện hữu là nguồn sự thật về session, streaming, approval, file, quota, tool, terminal và share.
- UI mới thay presentation và event binding; không thay policy cookie, Origin/Host, CSP loopback, allowlist workspace hoặc quy tắc PTY.
- `/chat` cũ phải còn nguyên cho đến khi preview đạt full functional parity. Không deploy/restart trong các phase source.
- Đây là phạm vi **feature parity đầy đủ**: mọi chức năng người dùng có trong HTML mẫu phải có hành vi production thật. Nếu runtime chưa có contract, phase triển khai phải bổ sung contract an toàn, không ẩn, vô hiệu hoá hoặc giữ lại nút demo để qua release.
- Dữ liệu, tài khoản, transcript và bridge mock trong HTML chỉ là fixture minh hoạ; chúng không được mang sang production. Chức năng tương ứng phải render từ dữ liệu OMP thật.

## Định nghĩa hoàn tất bắt buộc

Mỗi control mang tính thao tác trong mẫu phải có đủ năm điểm: **nguồn state thật → event binding ngoài HTML → API/preference thật → trạng thái loading/success/error → kiểm thử sau reload**. Không có ngoại lệ cho menu, modal, theme/font, hai sidebar, hàng chờ hay layout responsive.

`100%` ở đây được đo bằng control ledger: từng nút/menu/field/modal mẫu được ghi thành một ý định sản phẩm duy nhất, có owner, contract và bằng chứng browser. Các đoạn transcript minh hoạ lặp lại không được copy thành dữ liệu giả; renderer production vẫn phải hiển thị được đúng loại state mà chúng minh hoạ.

## Ledger parity bắt buộc của HTML mẫu

| Bề mặt mẫu | Thành phần phải có ở UI mới | Điều kiện được tính là hoạt động |
|---|---|---|
| Cài đặt: giao diện | Light, Dark, System; 5 canvas tone `deep-tech/obsidian/charcoal/midnight/ocean`; 7 accent sidebar `neutral/cobalt/emerald/violet/amber/cyan/rose`; badge động | Áp dụng đồng thời cho main, sidebar trái/phải, composer, message, menu, modal, tooltip, queue, diff và terminal chrome; lưu preference, khôi phục sau reload, thay đổi System khi OS đổi. |
| Cài đặt: font và đọc | Inter, ChatgptStyle/Open Sans, Be Vietnam Pro, Geist Sans, JetBrains Mono, System Native; tăng/giảm cỡ chat; language, mật độ hội thoại, Enter behaviour | Mỗi font có file local đã kiểm license hoặc system fallback được kiểm chứng; không card nào chọn được nhưng không tải font. Chữ Việt, code, emoji và icon giữ glyph/line-height đúng ở cả Light/Dark. |
| Cài đặt: Models/OMP | model source, model mặc định, reasoning, max tokens, browser mode, share mode, Memory refresh | Option lấy từ capabilities/API; save chỉ báo thành công sau phản hồi server; khi value không được hỗ trợ phải có contract bổ sung hoặc không đạt release. |
| Cài đặt: Agent/Welcome | chỉ dẫn Agent: copy/clear/reset/save; cấu hình Plan-YOLO/Advisor; tiêu đề/mô tả/card welcome: add/edit/reset/save | Nội dung được persist theo scope phù hợp, render lại khi mở trang và có validation/rollback. Không chỉ lưu biến JavaScript hoặc local fixture. |
| Sidebar trái: khung | resize, thu gọn/mở rộng, mobile drawer; nút New session, trạng thái kết nối, Settings | Kích thước/mode lưu và clamp theo viewport; keyboard/Escape/focus hoạt động; connection lấy health/capabilities thật. |
| Sidebar trái: danh sách | tìm kiếm; sort newest/oldest/A-Z; filter running/unread/pinned; compact/timestamp/reset; pinned/projects/unassigned collapse | Thao tác trên dữ liệu session/folder thật, không clone DOM; trạng thái filter và group đúng sau đổi session, reload và viewport nhỏ. |
| Sidebar trái: folder/session | tạo/sửa/xoá folder, gán session; rename/pin/unpin/unread/archive/delete/duplicate/export/fork/open-window/share từ context menu và header | Mỗi action gọi session/folder contract thật, có confirm cho thao tác phá huỷ, optimistic update rollback khi lỗi và dữ liệu tồn tại sau reload. |
| Header | tên session sửa trực tiếp; model/reasoning; quota/account refresh; menu Rename/Pin/Duplicate/Export/Fork/Model/Quota/Delete; share; Light/Dark; mở terminal và right drawer | Toàn bộ menu dùng state session thật. Account/model không đổi UI trước khi API success. URL share và export dùng dữ liệu session thật. |
| Hội thoại | empty/welcome 6 quick cards; text/Markdown/code/table; copy/edit/fork/reaction/retry; OMP accordion; execution rows; command/output; turn navigator click/drag; scroll-to-bottom; body-width resize | Renderer an toàn, không `innerHTML` từ payload. Quick card phát prompt/action thật; mọi action có target message/session đúng cả khi user đổi session lúc stream. |
| File/ảnh/diff | chip file, thumbnail ảnh input/output, viewer, metadata; card tệp đổi; floating change pill; modal diff tabs/expand/apply/revert | Viewer chỉ đọc file được server cho phép. Diff lấy từ workspace/session thật. Apply/Revert dùng contract transactional, confirmation và kết quả/rollback thật; không tạo code diff demo. |
| Composer | textarea auto-resize/counter, Enter setting, active tags, plus-menu (file/folder/Open Design/project/goal/Plan/record skill/sketch/tools/plugins/Safety/saved chats/search), attachments, model/reasoning, approval, Ego Browser, voice, RPC/context/compact, send/stop | Prompt payload qua validation hiện hữu; attachment chứa content/reference hợp lệ, không gửi tag mock. Mỗi entry plus-menu có implementation/capability thật; menu phụ có keyboard/focus và trạng thái lỗi. |
| Hàng chờ | tray, order count/status, attachment preview, edit/refine, send-now/steer, delete, pause/resume | Local và server queue có contract rõ. Nếu mẫu cho đổi thứ tự, runtime phải có API reorder có kiểm soát; nếu chưa có, bổ sung trước release. Không mô phỏng thứ tự bằng DOM. |
| Sidebar phải | toggle/resize; tabs Tools/Modes/Files; search/filter/group 14 tool; chọn/sync tool; Plan-YOLO/Advisor/tuning; files search/preview/upload/open | Tools dùng canonical id + capability. Modes ghi runtime thật. File list/upload/open dùng workspace validation, chống traversal/symlink và phản hồi lỗi hiển thị được. |
| Bottom panel | open/close/resize; tabs Terminal/Logs/Output; clear/copy; terminal input/history | Terminal giữ xterm + authenticated WebSocket, host/CWD thật, cleanup khi đóng; Logs/Output lấy lifecycle/body thật, không transcript mẫu. |
| Modal/popover | custom input, delete, share, open window, create/edit/delete folder, quota, settings, code diff, upgrade, approval/model/context/RPC | Mỗi modal trap focus, Escape/backdrop hợp lệ, restore focus và state loading/error. Share phải thực sự tạo local/encrypted link theo policy; nếu cần public/team như mẫu thì bổ sung server policy/auth/audit trước release. |
| Shortcut/responsive | Alt+T, Cmd/Ctrl+B, Cmd/Ctrl+K, Cmd/Ctrl+,, Esc, Alt+Q và shortcut session; tablet/mobile của hai sidebar/drawer | Shortcut không cướp focus input/terminal, có aria-keyshortcuts/help, hoạt động qua reload và không tạo thao tác phá huỷ ngoài confirm. |

Không có mục `visual-only` trong ledger production. Mọi CTA trong mẫu hoặc gọi chức năng thật, hoặc là dữ liệu hiển thị không thao tác; CTA demo không được xuất hiện ở `/chat`.

## Lỗi prototype phải loại trước khi port

- Filter/count `Unread` đang hỏi `.has-unread` trong khi item dùng `.unread`; production lấy một enum trạng thái duy nhất, có test count/filter/session update.
- Theme `System` hiện lưu lựa chọn rồi ép Dark khi reload. Production theo `matchMedia('(prefers-color-scheme: dark)')`, lắng nghe thay đổi OS và test reload.
- Một số `onclick` message gọi hàm không tồn tại global. Production dùng event delegation/module handler, không dùng inline handler.
- Bridge prototype chỉ emit event và `simulateAiResponse()`; không có `fetch`, SSE hay WebSocket. Production tái dùng transport xác thực đang chạy.
- Các payload tag/tool/account/share/diff của mock không có schema production. Control ledger chỉ đóng khi route/preference thật đã qua validation.

## Bản đồ capability và thứ tự

| Module | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `ui-shell` | Token, responsive shell, sidebar/header/drawers/modal và assets local | — |
| `conversation` | Session, message, Markdown an toàn, attachment/image viewer | `ui-shell` |
| `turn-runtime` | SSE, lifecycle, approval, queue, tool/body, file change, lỗi/reconnect | `conversation` |
| `runtime-surfaces` | Composer, workspace, tool catalog, quota, settings, terminal, mic, share | `turn-runtime` |
| `ui-release` | Contract, browser QA, parity, backup/deploy | tất cả |

Thứ tự: `ui-shell → conversation → turn-runtime → runtime-surfaces → ui-release`.

## Map mẫu UI → dữ liệu và hành vi thật

| State trong mẫu | Dữ liệu/render production | Hành vi được phép |
|---|---|---|
| Tin nhắn text/code/table | `messages[].content`, render qua `renderSafeMarkdown()` và DOM nodes | Copy; fork chỉ qua session action thật. Không gán `innerHTML` từ message. |
| Tệp đính kèm | `attachments[]` đã validate; chip tên, loại, dung lượng; text file preview hoặc image viewer | Mở viewer; không lộ path ngoài workspace. |
| Ảnh input/output | `attachments[].type`, `data`, width/height nếu có | Thumbnail trong bubble và viewer; output media từ SSE `media`. |
| Đang suy nghĩ/viết/tool | SSE `start`, `lifecycle`, `body`, `delta`, `command_output` | Status line, spinner và accordion OMP mở/đóng theo event thực. |
| Approval | SSE `approval` + POST `/sessions/:id/approval` | Approve/Deny/Input/Select đúng frame OMP; không dùng control mock. |
| Hàng chờ | `pendingPrompts` web và SSE `waiting`/server queue theo session | Tray, số order, meta, `Bỏ`, `Sửa`, `Gửi ngay` cho web queue; server queue chỉ `Bỏ`/`Tiếp tục` khi API hỗ trợ. Không drag-reorder hay “ưu tiên” server giả. |
| Thay đổi tệp | body blocks tool có file operation | Card số tệp, trạng thái và `Xem hoạt động`; không hiện Apply/Revert khi chưa có diff adapter. |
| Lỗi/dừng/reconnect | SSE `error`/`end.aborted`, abort route, reconnect action | Card lỗi, retry safe, trạng thái queue paused; không tự retry hoặc báo hoàn tất sai. |
| Sidebar/folder/session | `/sessions`, `/folders`, session action | Pin, archive, rename, fork, folder assignment theo API; skeleton chỉ khi đang tải. |
| Quota/account/model | quota/models/accounts/overview/protect APIs | Badge/header/modal dùng live data; switch chỉ cập nhật sau HTTP success. |
| Tool/mode/agent/memory | capability catalog, advisor config, agent/memory endpoints | Catalog data-driven; unknown/MCP/blocked read-only; backend off/unavailable ghi đúng lý do. |
| Terminal/mic/share | PTY WebSocket, Web Speech, session share action | Terminal xterm thật có host/CWD; mic chỉ draft; local/encrypted URL thật, collab disabled. |

## Quyết định kỹ thuật

- Tạo preview route và bundle UI riêng. Không nhập `HonPiBridge`, mock server, demo session cache, account cache hoặc inline event handler từ mẫu vào production.
- Giữ transport hiện tại của `honpi-chat-dashboard-live.js`: POST SSE, `AbortController`, queue recovery, capability loading và authenticated WebSocket. Renderer mới nhận state đã chuẩn hoá từ transport đó.
- Tách markup, CSS và JS production ra file external có nonce/CSP hiện hữu; asset logo/font phải local hoặc system stack. Không thêm `unsafe-inline`, CDN font hoặc CORS mở.
- Giữ progressive enhancement: skeleton lúc load, empty state khi không có session và trạng thái lỗi/retry thật.
- Bổ sung endpoint/contract khi tính năng mẫu chưa có dữ liệu hoặc action runtime, nhưng chỉ sau khi định nghĩa validation, auth, error/rollback và acceptance. Không tạo endpoint chỉ trả mock để làm UI có vẻ hoạt động.

## Task list

### U0 — Baseline và contract hiển thị

- [ ] Chụp state/API của `/chat` đang chạy: empty, session có text, attachment ảnh, active stream/tool, approval, queue, error, quota, terminal.
- [ ] Viết fixture UI chỉ từ payload thật đã redaction; không dùng email, prompt, output hay path nhạy cảm.
- [ ] Tạo control ledger từ 258 nút, menu, field và 13 modal của HTML mẫu; gộp các control lặp vào một ý định sản phẩm, gắn route/preference/fixture và test browser.
- [ ] Chốt backlog server contract cho diff apply/revert, queue reorder, file upload, share scope hoặc bất cứ action mẫu nào runtime chưa có; không chuyển phase khi còn CTA không có contract.
- [ ] Liệt kê đủ quick-card, plus-menu, context menu, shortcut, popover và entry của hai sidebar trong ledger; xác định action thật hoặc endpoint cần bổ sung cho từng entry.
- [ ] Đưa các lỗi prototype (`Unread`, System theme reload, inline handler thiếu hàm, mock bridge) thành regression case.
- Acceptance: mỗi state mẫu có payload nguồn và screenshot baseline; ledger không có trạng thái `mock`, `skip`, `hide` hoặc `chưa rõ`.
- Verify: `node test-session-actions.mjs`, `sh test-runtime-security.sh`, request read-only `/healthz` và capabilities.
- Files: `tasks/neuratalk-ui-upgrade-plan-2026-09-29.md`, test fixture/screenshot mới nếu cần.

### U1 — Preview shell và design tokens

- [ ] Dựng `/chat-preview` bằng layout/tokens/assets Neuratalk: sidebar trái/phải, header, chat viewport, composer, right drawer, bottom panel và modal host.
- [ ] Đưa đủ 3 theme, 5 canvas tone, 7 sidebar accent, badge động, 6 font và chat font-size vào preference store; mọi token có bảng giá trị Light/Dark.
- [ ] Đóng gói font cục bộ có license hoặc chỉ enable font hệ thống có mặt; kiểm thử glyph tiếng Việt trước khi hiện trong Settings.
- [ ] Gỡ mock state, inline handler, Google Fonts CDN và hardcode production-looking data; toàn bộ tương tác bind từ script external.
- Acceptance: preview cấp cookie/CSP như `/chat`; Light/Dark/System và mọi font/tone/accent tác động đủ cả hai sidebar; màn hình 360/390/768/1440 không overflow, không có remote asset/network.
- Verify: browser load, console/CSP/network sạch; smoke GET route và asset HTTP 200.
- Files: `server.mjs`, template preview, stylesheet/bundle preview, local assets tối đa 1 bundle.
- Depends on: U0.

### U2 — Session và conversation renderer

- [ ] Port toàn bộ sidebar trái: resize/collapse/mobile, search, sort/filter, compact/timestamp, pinned/project/unassigned tree, folder/session context actions và connection status theo mẫu bằng API `/sessions` và `/folders`.
- [ ] Port header: inline rename, model/reasoning, quota, complete session menu, share, drawer/bottom controls và theme switcher.
- [ ] Port user/assistant message card, safe Markdown, code copy, file chips, image thumbnail/viewer và action copy/fork.
- Acceptance: mọi action sidebar/header tồn tại sau reload và rollback đúng khi API lỗi; session switch không race; ảnh input/output và tệp text render đúng metadata thực; HTML từ OMP không chạy script.
- Verify: fake-OMP/session tests plus browser fixture text, image, file, empty, session-switch.
- Files: preview client, preview stylesheet, focused UI test/fixture.
- Depends on: U1.

### U3 — Streaming, lifecycle, approval và hàng chờ

- [ ] Áp dụng visual state mẫu cho `start`, `waiting`, `lifecycle`, `body`, `command_output`, `delta`, `media`, `approval`, `end`, `error`.
- [ ] Tray queue hiển thị order/status/attachment preview/edit/refine/send-now/steer/delete/pause/resume/reorder đúng như mẫu, qua contract local/server đã chốt.
- Acceptance: stop không để stream tiếp tục render; đổi session khi stream không chèn nhầm; approval không mất; từng CTA queue thay đổi đúng state server và sống sau refresh.
- Verify: focused stream/abort/reconnect/approval/queue tests và browser smoke mỗi state.
- Files: preview client, stylesheet, `test-session-actions.mjs` hoặc UI smoke.
- Depends on: U2.

### U4 — File change, tools và workspace composer

- [ ] Dùng catalog runtime để render sidebar phải có resize/tabs Tools/Modes/Files, search/filter/group, selection, drift, read-only/blocked state và Agent Hub.
- [ ] Port composer plus menu, workspace picker, attachment strip, browser/voice/model/approval controls và changed-file card theo mẫu nhưng chỉ từ data server-validated.
- [ ] Cài diff adapter thật để modal file change, tabs, expand, Apply/Revert làm thay đổi workspace có transaction/confirm/rollback; cài file search/upload/open theo policy workspace.
- Acceptance: tool toggle truyền canonical ID; selection rollback khi combo fail; diff/file action có server result thật; không tin path/tags mock từ browser.
- Verify: capability/tool-contract tests, file traversal/symlink boundaries, mobile drawer smoke.
- Files: preview client, preview template/styles, `test-session-actions.mjs`.
- Depends on: U3.

### U5 — Quota, settings, Memory, mic, terminal và share

- [ ] Port visual modal quota/header telemetry với account/model live; switch/sync only after success.
- [ ] Port đủ 6 tab Settings và mọi option mẫu. Preference giao diện/Welcome persist; Models/OMP/Agent/Memory save qua API runtime, reload khôi phục đúng và rollback khi server từ chối.
- [ ] Port host-terminal frame, SpeechRecognition state and share UI into visual shell without changing their security boundaries.
- Acceptance: terminal shows real host/CWD, mic inserts draft only, Memory off stays off, share scope nào xuất hiện đều tạo URL/quyền thật; không có public/team giả.
- Verify: quota action smoke, fake Memory UI states, terminal authenticated WS smoke, mic feature detection and share failure/success smoke.
- Files: preview client, template/styles, relevant existing focused tests.
- Depends on: U4.

### U6 — Accessibility, responsive và regression gate

- [ ] Keyboard/focus/inert/dialog flow, screen-reader labels, reduced motion and Vietnamese glyph/line-height review across the upgraded page.
- [ ] Validate 360/390/768/1440: sidebar trái/phải, drawer/modal/queue/attachment/image/terminal overflow; no hidden clickable overlay.
- [ ] Chạy control ledger trên cả Light/Dark/System, 5 tone, 7 accent và 6 font: mở settings → chọn → áp dụng → reload → keyboard navigation → mobile/desktop.
- Acceptance: all controls have a truthful, persistent state; no console/network/CSP error; user cannot reach a fake operation; ledger đạt 100% pass.
- Verify: Ego Browser scenario matrix; syntax/security/session/ACP tests; screenshots and console/network evidence per ledger.
- Files: preview template/styles/client, test/screenshot artefacts.
- Depends on: U5.

### U7 — Cutover, parity và release

- [ ] Compare `/chat-preview` against old `/chat` using the state matrix; switch route only after every supported production flow passes. `/chat-preview` is not present in the current server.
- [x] Mirror current source assets to `product-release/`; manifest parity and installer file coverage pass. Backup/deploy/restart remain pending Síp review.
- Acceptance: `/chat`, `/quota`, `/healthz`, LaunchAgent and PTY cleanup pass after restart; old UI remains rollback target until live acceptance succeeds.
- Verify: `node --check server.mjs`, `node --check <client>`, `sh test-runtime-security.sh`, `node test-session-actions.mjs`, browser live smoke.
- Files: production template/client/style, `server.mjs`, `product-release/` mirrors, docs/runbook.
- Depends on: U6 and Síp review.

## Cổng nghiệm thu UI state

| Nhóm | Case bắt buộc |
|---|---|
| Conversation | Empty, text/Markdown/code, tool body, command output, file change, image input, image output, file attachment. |
| Turn | Start, writing, waiting, long running, approval, abort, error, retry/reconnect, session switch while active. |
| Queue | Local queued edit/send/discard, server FIFO wait/discard/pause/resume; không UI action vượt API. |
| Runtime surfaces | Session/folder action, quota switch fail/success, tool blocked/drift, Memory off/error, terminal open/close/CWD, mic unsupported/record/stop, share unavailable/local/encrypted. |
| Quality | 360/390/768/1440, keyboard/Escape/focus, Vietnamese, reduced motion, CSP/console/network, no horizontal overflow. |

## Rủi ro cần chặn

| Rủi ro | Cách chặn |
|---|---|
| UI mẫu khiến state demo lấn state thật | Không import mock logic; renderer nhận một state store từ transport production. |
| Lệch SSE làm mất approval/tool/media | Dùng event contract runtime đầy đủ, test từng event; không dùng schema mock làm chuẩn. |
| Nút đẹp nhưng không có API | Capability gate ở renderer; disabled reason hoặc hide. |
| XSS từ transcript/tool output | `textContent` và renderer Markdown hiện hữu; cấm `innerHTML` từ payload. |
| UI terminal bị hiểu là sandbox | Giữ cảnh báo host/OS/CWD thật và xterm/WS hiện hữu. |
| Queue giao diện sửa thứ tự server sai | Phân biệt local queue và server FIFO; chỉ phát action runtime hỗ trợ. |
| UI mới phá auth/CSP | Preview đi qua server hiện hữu, external script nonce, asset local, không nới policy. |

## Điều kiện bắt đầu code

- Síp duyệt capability map, state map và U0–U7.
- Không có deploy hoặc thay route production trước U7.

## Checkpoint thực thi hiện tại — 2026-09-29

| Lát | Trạng thái | Bằng chứng / giới hạn |
|---|---|---|
| U0 | Đạt phần audit | Đã đối chiếu handoff, HTML mẫu và runtime; không import mock bridge/data. |
| U1 | Đạt | `/chat` dùng shell hiện hữu, CSP/nonce, 3 theme, 5 tone, 7 accent, 6 font và responsive tokens. |
| U2 | Đạt | Session/folder/header, Markdown an toàn, attachment/media, copy/fork/duplicate/export đã nối runtime thật. |
| U3 | Đạt phần runtime | SSE/lifecycle/approval/reconnect và queue local/server; queue web có sửa, bỏ, gửi ngay, pause/resume và reorder. |
| U4 | Đạt | Tools/Modes/Files/Agent Hub và file-change activity lấy từ payload OMP; snapshot trước/sau, hash guard, Apply xác nhận và Revert atomic rollback đã nối runtime. |
| U5 | Đạt | Quota, Settings, Memory state, mic, terminal và local/encrypted share đã giữ contract runtime hiện hữu. |
| U6 | Đạt checkpoint hiện tại | Syntax/security/contract `112 scenarios`; browser QA 320/375/768/1024/1440 không overflow, menu/settings/queue/export không lỗi console. |
| U7 | Chờ Síp duyệt | Bundle parity 17/17; source/runtime matched before the final popover accessibility fix. Current diff is limited to the chat HTML and legacy client. No deploy/restart; full 258-control/13-modal ledger and the planned `/chat-preview` comparison remain open. |

### Contract file-change đã triển khai

- `GET /api/v1/sessions/:id/file-changes` trả snapshot trước/sau, hash SHA-256 và trạng thái review.
- `POST /api/v1/sessions/:id/file-changes/action` hỗ trợ `apply`/`revert`, yêu cầu xác nhận, kiểm tra hash hiện tại, ghi atomic và rollback khi lỗi.
- Snapshot giới hạn tệp/kích thước, chặn symlink/traversal/sensitive path; snapshot không đủ điều kiện chỉ cho xem.
- Không dùng `git checkout`, nội dung mẫu hoặc success giả để thay contract trên.
