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

