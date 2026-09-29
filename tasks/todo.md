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
- [x] Loại sạch demo data, quick cards và fake success.
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
