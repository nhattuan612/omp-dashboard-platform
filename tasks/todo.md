# Todo triển khai OMP Dashboard

> Resume nhanh: đọc `tasks/session-report-2026-09-23.md` rồi làm theo `tasks/resume-plan.md`.

## Đang làm

- [x] Xác nhận OMP local `18.2.7`, ACP/RPC và runtime LaunchAgent.
- [x] Xác nhận `/chat`/`/quota` là production routes và quota là nguồn model/account live.
- [x] Xác nhận UI phải mirror OMP, không giữ demo data/fake success.
- [x] Viết lại kế hoạch theo capability catalog và Settings phân tách local/OMP.
- [x] Chốt capability contract từ OMP và backend adapter.
- [x] Sprint 2026-09-23: session/reconnect → workspace file reference → abort/steer/recovery → approval → share → Agent Hub; memory giữ unavailable.

## Backend

- [x] Capability/model/tool/browser/approval/Agent Hub/share catalog.
- [x] SSE lifecycle start/delta/lifecycle/done/error/abort; reconnect UI giữ ở partial.
- [x] Session actions + pagination + file reference + persistent folders/assignment.
- [x] Approval modes + Safety Guard + redacted observability.
- [x] Encrypted share + local loopback URL; collab modes trả `unavailable`.

## Frontend

- [ ] Đưa full OMP surface vào shell hiện tại theo lát dọc.
- [x] Settings local/OMP, browser modes, approval modes và share mode selector.
- [x] Session folder menu: create, assign, unassign and reload persistence.
- [x] Agent Hub, files thật, tool status và unavailable state.
- [x] Loại mock transcript/account/fake success; quick cards giữ lại nhưng đã nối vào composer thật.
- [x] Sửa các lỗi UI/a11y đã audit: running send gọi `stopStream()`, dialog đóng có `aria-hidden`/`inert`.

## Verification

- [x] Contract/SSE/abort/session/file/approval/share/recovery tests: 25 isolated fake-OMP scenarios, including first-user auto-title, and approval UI deny/approve smoke.
- [x] Mock baseline `257/257`.
- [x] Browser QA 360/390/768/1440; focused live runtime audit confirms dialog AX tree clean, share local/encrypted, and folder create/assign/reload/unassign.
- [x] Deploy/restart/checksum/rollback.
- [x] Focused production browser QA 2026-09-24: live Stop, approval deny/approve, steer/reconnect, local/encrypted share, and Agent Hub subagent all pass; no longer blocked by `ACCOUNT_UNAVAILABLE`.
- [x] Sau QA, `node --check server.mjs`, `./test-runtime-security.sh`, `node test-session-actions.mjs`, folder UI smoke, production abort recovery smoke và `/healthz` đều pass.
- [x] Prompt queue: web snapshot tức thời, FIFO sequential dispatch, first prompt không chờ `/messages`, greeting/auto-title smoke và deploy 2026-09-24.


## Chờ Síp

- [ ] Repo GitHub đích + public/private trước khi push.
- [ ] Một prompt thật `Trả lời đúng một từ: OK` cho nghiệm thu OMP/Google (tiêu thụ quota).

## Product-release parity — 2026-09-28

- [x] Mirror 3 asset lệch: server, Chat live client, Quota SKE.
- [x] Sửa contract test quota không còn phụ thuộc `dashboard-live.js` đã xoá.
- [x] Checkpoint: parity, syntax, security smoke, ACP/pin/session contract pass; không deploy/restart.

## Kế hoạch triển khai riêng `/quota`

- [x] Q0: tạo manifest và backup timestamp trước khi sửa.
- [x] Q1: sửa legacy account switch dùng chung availability policy.
- [x] Q1: sửa overview thiếu quota trả `unknown`/`--`, không trả 0 giả.
- [x] Q2: xác nhận UI `/quota` render null/unknown và switch lỗi an toàn.
- [x] Q3: cập nhật quota contract, mock và tài liệu.
- [x] Q4: test, checksum, browser QA và chỉ deploy sau khi duyệt.
- [x] Mỗi phase có checkpoint; fail thì restore backup gần nhất.

## Phối hợp bắt buộc với `/chat`

- [x] Gửi `tasks/chat-fix-coordination-report.md` cho bên Chat; shared status đã đối chiếu với source/runtime.
- [x] Hai bên dùng chung auth/Host/Origin, headers, console allowlist và SSE redaction contract.
- [x] Chạy regression `/quota` + `/chat` trước và sau restart runtime.
- [ ] Không xóa file legacy/adapter/backup khi chưa có xác nhận riêng.

## OMP-native Memory adapter — đặc tả đã được Síp duyệt

- [ ] **M1 — Native Memory API + fake-OMP contract**
  - Acceptance: session-scoped API reads the effective OMP backend in that session’s CWD; `off` remains off; only verified builtin Memory subcommands run; output is returned only after a local-only OMP response; clear/reset require server-side confirmation; operation locking prevents active-turn/cross-session output races.
  - Verify: `rtk node --check server.mjs`; `rtk node --check console-bridge.mjs`; `rtk node test-session-actions.mjs`; `rtk sh test-runtime-security.sh`.
  - Files: `server.mjs`, `console-bridge.mjs`, `test-session-actions.mjs`.
  - Dependencies: none.

- [ ] **M2 — OMP Settings Memory panel**
  - Acceptance: selected-session/CWD status; truthful off/unsupported/error states; only API-supported operations; warning before model/data processing; explicit clear/reset confirmation; Memory text rendered safely and not stored.
  - Verify: isolated fake-OMP UI smoke in Ego Browser at phone/tablet/desktop widths; check session switching, errors, and console.
  - Files: `honpi-chat-dashboard-live.js`.
  - Dependencies: M1.

- [ ] **M3 — Capability/ADR/docs and regression checkpoint**
  - Acceptance: capability contract, ADR-08, index, and feature matrix match verified behavior and state backend-specific deletion/processing limits.
  - Verify: all M1 commands pass; isolated UI smoke passes; `/healthz` and capability read-only checks; no production deploy, config change, model processing, or Memory deletion.
  - Files: `📚-OMP-DASHBOARD-TECHNICAL-REPORTS-IMPORTANT-🔒/02-API-AND-CAPABILITY-CONTRACT-IMPORTANT-🔒.md`, `06-ADR-CAPABILITY-DECISIONS-IMPORTANT-🔒.md`, `00-INDEX-IMPORTANT-🔒.md`, `tasks/feature-matrix.md`.
  - Dependencies: M1, M2.

### Checkpoint — before implementation

- [ ] Síp reviews and approves `tasks/plan.md`; no code changes before approval.

---

## Catalog OMP → `/chat` và sidebar Công cụ — 2026-09-29

- [x] Backup validated state vào commit `92512fc` trên `codex/omp-tools-sidebar-map`; không push.
- [x] Audit OMP 18.3.2: default RPC, explicit-tool roster, combo ACP 14 tool và `hub` blocked.
- [x] Đánh dấu `tasks/omp-capability-map.md` là historical; ghi kế hoạch chi tiết tại `tasks/omp-tools-sidebar-plan-2026-09-29.md`.
- [ ] **P0 — Map source + validator**
  - Acceptance: `config/omp-tool-map.json` là nguồn duy nhất; status state machine và migration v1→v2 fail-closed.
- [ ] **P1 — Audit + drift detector**
  - Acceptance: nhận ra version/roster/schema đổi, phân loại builtin/MCP và không gửi prompt/model.
- [ ] **P2 — API + session selection**
  - Acceptance: server chỉ nhận tool verified, combo advertised pass ACP, failure rollback selection.
- [ ] **P3 — Sidebar data-driven**
  - Acceptance: bỏ hardcode groups/icons/status; có detail, drift, disabled state đúng và Agent Hub dùng chung catalog.
- [ ] **P4 — QA + release**
  - Acceptance: contract/integration/ACP/Ego Browser 360-1440 pass; deploy/restart chỉ sau review.

---

## Mic voice-to-text + Terminal native — kế hoạch 2026-09-29

- [x] **V1 — Mic từ Web Speech API (source)**
  - Acceptance: UI mic hỗ trợ `SpeechRecognition`/`webkitSpeechRecognition`, chọn `vi-VN` hoặc `en-US` (mặc định `vi-VN`), chèn text vào draft/caret, không auto-submit, dừng đúng lúc; permission/error/unsupported rõ.
  - Verify: Chrome, Edge, Safari, Firefox; allow/deny, speech, stop/send/session-switch; xác nhận dashboard không nhận audio.
  - Files: `honpi-chat-dashboard-live.js`, `server.mjs`, `test-session-actions.mjs`.
- [x] **T1 — Resolver Terminal CWD + API (source)**
  - Acceptance: project folder → folder CWD; chat chưa phân loại → `GENERAL_CHAT_CWD`; draft → workspace đã chọn hoặc General. Session ID authoritative; mọi CWD canonicalize và check allowlist.
  - Verify: project/general/custom draft/unknown ID/path traversal/symlink/outside root; API auth/Origin/CSRF.
  - Files: `server.mjs`, `test-session-actions.mjs`.
- [x] **T2 — Native terminal adapters (source)**
  - Acceptance: mở terminal mặc định trên Windows/macOS/Linux bằng argv an toàn; không shell command từ UI; lỗi launcher rõ.
  - Verify: smoke OS thật, path có Unicode/khoảng trắng, terminal thiếu; không rò env/credential.
  - Files: `server.mjs`, có thể thêm `host-terminal.mjs`.
  - Dependencies: T1.
- [x] **T3 — Composer/header UI + checkpoint (source)**
  - Acceptance: nút mic và nút Terminal thật, status/a11y/loading/error rõ; panel sandbox không bị nhận nhầm là host terminal; docs capability cập nhật.
  - Verify: browser QA session project/general/draft + toàn voice flow; syntax, security smoke và focused contract pass.
  - Files: `honpi-chat-dashboard-live.js`, `honpi-chat-dashboard-SKE.html`, docs feature matrix.
  - Dependencies: V1, T2.
- [x] **Deploy/restart:** Síp đã duyệt; backup `20260929-141256-5725`, health/pages/checksum pass.
- [x] **Live smoke:** Síp xác nhận mic hoạt động; nút toolbar mở Terminal thật ở General trên macOS.
- [ ] **QA còn lại:** xác minh runtime Windows/Linux khi có host tương ứng.

---

## Terminal nhúng PTY thật — kế hoạch 2026-09-29

- [x] **E1 — Dependencies/assets:** `node-pty`, `ws`, xterm.js + fit addon khóa phiên bản, assets local; deploy/product-release có install và backup/rollback dependency.
- [x] **E2 — PTY + WebSocket:** auth dashboard cookie và Origin/Host loopback; CWD server-derived; giới hạn payload/session/idle/output; cleanup; không lưu lệnh/output.
- [x] **E3 — UI khung dưới:** mở/đóng, resize, trạng thái host/workspace, xterm keyboard/output; bỏ sandbox transcript và nối session CWD project/General/draft.
- [x] **E4 — Source checkpoint:** syntax/whitespace và release sync pass.
- [x] **E4 — macOS live checkpoint:** npm audit 0 vulnerabilities; `/healthz`, `/chat`, `/quota`, xterm asset HTTP 200; LaunchAgent running; UI mở/xterm nhận lệnh/đóng PTY; `pwd` xác nhận General và project “Open design”; đóng panel kết thúc PTY. Backup: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260929-152014-18220` (checksum đã xác minh).
- [ ] **OS remainder:** Windows/Linux cần host tương ứng để kiểm chứng.
- [x] **Deploy gate:** Síp đã duyệt; deploy script đã backup package lock/dependencies và restart dashboard.


## PHASE 1 — Mic và Terminal nhúng — HOÀN TẤT (2026-09-29)

- [x] Mic voice-to-text (`vi-VN` / `en-US`) và Terminal nhúng PTY đã triển khai; CWD project/General đã xác minh trên macOS.
- [x] Backup runtime đã tạo và checksum đã xác minh: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260929-152014-18220`.
- [ ] Chờ host Windows/Linux để xác minh runtime trên các hệ điều hành đó.

---

## Nâng cấp UI Neuratalk từ state mẫu — 2026-09-29

Chi tiết và acceptance: [neuratalk-ui-upgrade-plan-2026-09-29.md](neuratalk-ui-upgrade-plan-2026-09-29.md).

- [x] U0: Baseline state/API thật và fixture UI redacted.
- [x] U1: Shell/tokens/assets với CSP hiện hữu.
- [x] U2: Session/conversation/attachment/image renderer an toàn.
- [x] U3: SSE, lifecycle, approval, queue, lỗi/reconnect.
- [x] U4: Workspace composer, tools, Agent Hub, file-change snapshot và Apply/Revert hash-guarded atomic rollback.
- [x] U5: Quota, settings, Memory, mic, terminal và share.
- [x] U6: A11y, responsive và regression matrix hiện tại.
- [ ] U7: Cutover, product-release parity, backup/deploy/rollback.

### U7 checkpoint — 2026-09-29

- [x] Đồng bộ source vào `product-release/`; 17/17 asset theo manifest khớp byte, installer gồm OMP tool catalog/map.
- [x] Syntax, `git diff --check`, runtime security smoke, routes `/healthz` `/chat` `/quota` và 112 session contract scenarios pass.
- [x] Sửa model popover: accessible name, state ARIA đồng bộ, Escape đóng và trả focus; browser source smoke 320–1440px pass.
- [ ] Cutover cần Síp duyệt. Sau bản vá, source/runtime chỉ lệch `honpi-chat-dashboard-SKE.html` và `honpi-chat-dashboard-legacy.js`; chưa deploy/restart.
- [ ] Full ledger 258 control/13 modal chưa chạy lại; kế hoạch cũng nhắc `/chat-preview` nhưng route này hiện chưa có.

---

## Phân loại nguồn cuộc trò chuyện — 2026-10-01

- Quy tắc UI: chat do `/chat` tạo không có icon; nguồn chưa xác định hiện `$`; app ngoài đã nhận diện thì gom vào folder dự án phù hợp hoặc tạo folder riêng.
- Phạm vi chỉ là metadata/sidebar và gom nhóm. Không dùng nguồn này để đổi Flow, nội dung chat, prompt, model hay token.
- Cần OMP lưu danh tính client/app vào metadata session khi tạo và trả lại qua API danh sách. Không dùng whitelist app cố định; nguồn app do client tự khai báo nên chỉ được xem là nhãn giao diện, không phải căn cứ bảo mật.
- Trạng thái: runtime OMP `18.4.6` đã cập nhật audit; backup mới nhất: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20261001-161054-origin-pagination-fix` (`SHA256SUMS` đạt). Patch nguồn: `patches/omp-origin-metadata-v18.4.6.patch`.
- Quy tắc sau audit: OMP trực tiếp hiện `π`; `/chat` không icon; nguồn chưa xác minh hiện `$`; app có danh tính được gom vào folder phù hợp. ACP nhận diện động từ `clientInfo`, không dùng whitelist. OMP `rpc`/`rpc-ui` không có danh tính mặc định thành `unknown`.
- Dashboard chỉ suy luận Open Design cho session cũ không có `originType`; giữ `unknown` đã khai báo và app thiếu tên ở trạng thái chưa xác minh. Việc này chỉ tác động metadata/sidebar/folder, không đổi Flow, nội dung chat, prompt, model hay token.
- Kiểm tra đạt: `check:types`; 2 test ACP tập trung (có và không có `clientInfo`); build, `omp/18.4.6`, codesign; `node --check`; `patch --dry-run`; runtime `/healthz`, `/chat`, JS asset đều HTTP 200 và asset có badge `π`.
- Giới hạn: client ACP khai báo `clientInfo` được nhận diện động. RPC client không gửi danh tính vẫn hiện `$`; không thể đặt tên app từ giao thức hiện tại. Chỉ session cũ thiếu hẳn `originType` mới có thể được suy luận Open Design bằng CWD; chưa gửi PR upstream.

- Audit tiếp 2026-10-01: phiên CLI không tương tác mặc định `unknown`; ACP `_omp/sessions/listAll` hỗ trợ offset và thứ tự tạo ổn định; bridge lấy đủ trang, phát hiện trang lặp/thiếu và vẫn trả danh sách theo hoạt động mới nhất.
- Kiểm chứng: ACP test tập trung, `bun run check`, build + codesign, patch dry-run đều đạt; bridge runtime trả đủ 1.735/1.735 session; mô phỏng 6.001 session qua 2 trang cũng đạt, không trùng ID. Health, `/chat`, JS asset: HTTP 200.
- Rà lịch sử chỉ đọc header JSONL trong 15:00–15:40 +07: có 2 header, cả hai thiếu origin trong header và metadata là app/inferred; không có header gắn `omp`, chưa thấy nhãn `π` sai. Không sửa metadata lịch sử.
- Lưu ý kiểm chứng: OMP `listAll` đọc prefix giới hạn và tail giới hạn để dựng catalog; nội dung không in ra hay lưu thêm. Quét lịch sử chỉ đọc header.

- Khắc phục audit 2026-10-01: server giữ snapshot catalog và một refresh đang chạy; khởi động/watcher làm mới snapshot, còn `GET /sessions` chỉ đọc snapshot đã ổn định. Mỗi cập nhật metadata session đánh dấu snapshot cũ; app mới được gom folder trong lượt refresh, không phải trong GET lặp lại.
- Tin cậy nguồn: chỉ metadata `chat` explicit do dashboard ghi mới là `/chat` không icon. `clientInfo` ACP mang tên `Hòn π /chat` vẫn là app, nên không thể giả nguồn dashboard.
- Hậu kiểm source: 115 session-action scenarios pass; contract chứng minh GET không ghi metadata, hai GET đồng thời dùng một ACP scan; focused ACP pagination pass; `node --check`, `git diff --check`, `patch --dry-run` pass. Patch OMP cập nhật thêm regression test, chưa đổi binary OMP ở lượt này.
- Đã deploy/restart dashboard: backup `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20261001-165235-42698`, manifest checksum pass; LaunchAgent running (PID 43064); `/healthz`, `GET /chat`, chat asset đều 200. Runtime `server.mjs` và bridge khớp source checksum. Live catalog có cookie trả 200 và metadata không đổi ở lượt GET cache.

---

## Đồng bộ hai chiều tab Agent OMP với AGENTS.md — 2026-10-01

Chi tiết và quyết định: [plan.md — Đồng bộ file context Agent OMP](plan.md#đồng-bộ-tab-agent-omp-với-file-context-thật--2026-10-01).

- [x] Điều tra: nguồn thật là `~/.omp/agent/AGENTS.md` (OMP tự nạp); bản deploy trước ghi vào cấu hình dashboard riêng nên chưa đấu nối Agent thật.
- [x] API đọc/ghi atomic file context, backup bản cũ, hash chống ghi đè và hỗ trợ file dài.
- [x] UI đọc/nạp lại thay đổi từ OMP, lưu thẳng file.
- [x] Đồng bộ `product-release/`; 116 contract scenarios pass; deploy/restart sau backup checksum.
- [x] Live health/chat/quota 200; Agent API chưa xác thực 401; Settings nạp đúng 10.928 ký tự/93 dòng. `AGENTS.md` giữ nguyên hash `70345e5a…92b46f6`; không gọi model thật.
- [x] Backup cuối: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20261001-191035-64822`; LaunchAgent PID 65150, trạng thái running.

### Rà lại quyền chỉnh nội dung — 2026-10-02

- [x] Giữ API GET/PUT; từ chối DELETE, thêm/bớt/làm rỗng nội dung vẫn giữ file AGENTS.md.
- [x] Bỏ nút “Xóa toàn bộ”; tắt handler localStorage legacy trên `/chat`.
- [x] Khi xung đột, giữ bản nháp và khóa Lưu đến khi nạp lại; tải lại khi mở tab/quay về cửa sổ nếu chưa sửa.
- [x] 116 contract scenarios pass; thêm/bớt/làm rỗng nội dung giữ file, DELETE 405, stale version 409.
- [x] UI regression dùng API giả xác nhận giữ bản nháp/khóa lưu khi conflict, nạp lại version mới, lưu thêm/bớt, tự đọc khi mở tab/quay lại cửa sổ và không chạy handler localStorage cũ.
- [x] Deploy/restart sau backup `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20261002-072748-75215`; manifest checksum pass; LaunchAgent PID 75557 running, health/chat/quota 200.
- [x] API có auth đọc đúng toàn bộ 10.928 ký tự từ file OMP; hash file Agent thật giữ nguyên. Source/runtime/product-release parity và syntax/diff check pass; TaskSpace 163 đã finish, không gọi model thật.

Phạm vi chặn xóa là màn Cài đặt Agent OMP và API cấu hình tương ứng; không áp dụng bộ lọc lệnh bash/terminal tùy ý trong OMP.

---

## Đồng bộ thanh Công cụ OMP — 2026-10-02

- [x] Backup source/release/runtime trước sửa: `~/.omp/usage-dashboard/backups/tool-sync/20261002-074416`, 17 file checksum đạt.
- [x] Xác minh OMP 18.4.6: 14 builtin RPC/ACP; audit overlay xdev tạm thấy thêm 38 MCP, không gọi model hoặc sửa config thật.
- [x] Cập nhật map 18.4.6, kiểm tra descriptor trước khi cho phép chọn; hiển thị mọi trạng thái và lý do bị khóa.
- [x] API/audit lỗi giữ danh sách cuối gồm MCP; đồng bộ không báo thành công giả.
- [x] 120 contract scenarios pass; live hiển thị đủ 58 hàng/14 switch khả dụng; desktop/tablet/mobile 1440/768/390/320px không tràn ngang.
- [x] UI fixture stale/probe/HTTP error giữ đủ 58 hàng, khóa thao tác, báo rõ lý do và phục hồi sau đồng bộ.
- [x] Deploy/restart sau backup `~/.omp/usage-dashboard/backups/deploy/20261002-075428-81445`; manifest checksum đạt; health/chat/quota 200, LaunchAgent running.
- [x] Kiểm tra cuối 120 contract scenarios pass, bao gồm GET sau audit lỗi không khôi phục cache thành công cũ. Final backup `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20261002-080214-83426` checksum đạt; LaunchAgent PID 83751 running; source/runtime/release parity, health/chat/quota 200, Agent file giữ nguyên hash.
- [x] TaskSpace 164 đã finish keep=[]; không gọi model thật.

## Settings và OMP modes — 2026-10-02

- [x] Hoàn tất [kế hoạch chuẩn hóa Settings và đấu nối OMP](settings-sync-plan-2026-10-02.md): 6 tab theo demo, không duplicate ID/control, Models hiển thị giới hạn inline, Browser/Share/Memory gọi trạng thái thật, Enter queue/block thực; giữ nguyên file Agent.
- [x] Live UI 30 tổ hợp (6 tab × 1440/1024/768/375/320), reduced-motion, font/glyph tiếng Việt và shell responsive: không tràn, ID duy nhất, không lỗi console.
- [x] Backend contract 123/123; OMP approval wrapper 6/6; preview interaction 16/16 và capability retry sau API lỗi. Memory API báo backend `off`; không chạy thao tác Memory.
- [x] Backup trước sửa/deploy checksum đạt; source/runtime/release đồng bộ; health/chat/quota 200; Agent file SHA-256 không đổi. Backup deploy cuối: `~/.omp/usage-dashboard/backups/deploy/20261002-092545-3852`.
- [x] Chrome/Electron CDP loopback đã cấu hình riêng cho OMP và API trả `supported/ready`; Relay vẫn báo `extension_disconnected` đến khi extension được load.

## OMP Browser Relay — bootstrap follow-up — 2026-10-02

- [x] Chọn Relay; cài bộ extension bằng `omp browser-relay install` tại `~/.omp/browser-relay/extension`.
- [x] Sửa deadlock capability: Relay cho phép chọn `Khởi chạy cùng chat` khi endpoint chưa chạy; OMP worker nhận config overlay per-chat và có thể tự bootstrap relay. `test-session-actions.mjs`: 124 scenarios pass; gồm prewarm với endpoint `endpoint_unavailable` và extension `503`.
- [ ] Load extension Relay unpacked trong Chrome nếu Síp muốn tiếp tục nhánh Relay; hiện ưu tiên Chrome/Electron CDP riêng.

## Chrome/Electron CDP — 2026-10-02

- [x] Backup cấu hình OMP trước khi nối CDP: `~/.omp/backups/omp-agent-config-before-cdp-20261002.yml` (mode `600`).
- [x] Mở Chrome profile riêng `~/.omp/browser-profiles/omp-cdp`, CDP loopback `127.0.0.1:9225`; không dùng Chrome cá nhân hoặc cổng headless `9223`.
- [x] Đặt `browser.cdpUrl=http://127.0.0.1:9225`; API capabilities live trả `chrome-electron: supported/ready`; `/healthz`, `/chat`, `/quota` đều `200`.
- [ ] Relay vẫn chờ extension tại `~/.omp/browser-relay/extension`; service `9224` còn giữ nguyên, chưa bật `browser.relay` global.
