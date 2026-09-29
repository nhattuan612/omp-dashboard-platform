# Kế hoạch OMP Dashboard: Chat + Quota

## Quyết định đã chốt

- OMP là nguồn sự thật về model, tool, session, Agent Hub, approval và share.
- Runtime giữ loopback `127.0.0.1:4177`; production chỉ gồm `/chat` và `/quota`.
- `/chat` dùng OMP runtime thật và quota/model live từ `/quota`; không provider giả, account rotation hoặc dữ liệu demo.
- Ba browser mode trong Settings: Ego Browser (mặc định), OMP Browser Relay, Chrome/Electron hiện có. Mode chưa hỗ trợ hiển thị `Chưa khả dụng`, không báo thành công giả.
- Approval mặc định `Luôn hỏi`; cho phép chọn `Chỉ hỏi thao tác nguy hiểm` hoặc `Toàn quyền`.
- File attachment là file thật; Agent Hub là UI mirror của OMP, không thay đổi hành vi OMP.
- Computer automation có UI nhưng disabled `Chưa khả dụng` tới khi có adapter an toàn.
- Share gồm OMP encrypted share, Collab read-only/read-write và local loopback URL.

## UI đích

Settings dùng các tab rõ nguồn dữ liệu:

1. **Hiển thị cục bộ:** theme, font, ngôn ngữ, density, reduced motion.
2. **OMP Runtime:** model, thinking, tools, approval, sandbox, Safety Guard.
3. **Browsers:** Ego Browser mặc định, OMP Relay, Chrome/Electron.
4. **Tools & Agent Hub:** capability live, supported/partial/unavailable, task/subagent/advisor.
5. **Quota & Share:** account đang dùng, quota link sang `/quota`, ba kiểu share.

Composer luôn hiển thị dưới ô nhập: Ego Browser pill mặc định, permission pill, model/thinking pill và file attach. Header hiển thị model live, thinking, quota, kết nối OMP và session actions. Không render số liệu, session, account hoặc quick card mẫu khi API không trả dữ liệu.

## Nguồn sự thật đã kiểm tra

- OMP local: `~/.bun/bin/omp`, version `18.2.7`; ACP qua `omp acp`, RPC qua `omp --mode rpc`.
- Capability OMP gồm model catalog, tool calling, LSP/debug, subagent/task hub, browser/web search, computer automation, memory, share/collab và ACP.
- Dashboard runtime: `~/.omp/usage-dashboard/server.mjs` + `console-bridge.mjs`; LaunchAgent `com.trannhattuan.omp-usage-dashboard`.
- Route hiện tại: `/chat` → `honpi-chat-dashboard-SKE.html`, `/quota` → `honpi-quota-dashboard-SKE.html`.

## Lát triển khai

### 0. Baseline và manifest

- [x] Ghi manifest source/runtime/route, loại secret, checksum và rollback.
- [x] Chụp baseline mock `257/257`, route smoke và một listener.

### 1. Capability contract

- [ ] Chuẩn hóa `/api/omp/v1/capabilities` thành catalog model/tool/browser/approval/agent/share.
- [ ] Map catalog trực tiếp từ OMP command/API; field chưa có trả `unavailable` có lý do.
- [ ] Bổ sung contract test cho capability, command allowlist, error/redaction.

### 2. Chat runtime

- [ ] SSE truyền đủ lifecycle/event OMP: start, text delta, tool call, approval, status, done, error, abort và reconnect.
- [ ] Truyền model, thinking, tools, approval, browser mode và requestId qua adapter có validation.
- [ ] Hoàn thiện session list/pagination, create, rename, pin/unpin, unread/read, archive/delete, fork, share.
- [ ] File upload/reference dùng file thật, giới hạn kích thước/path; không upload giả.
- [ ] Agent Hub đọc task/subagent/advisor từ OMP; action chưa có adapter phải disabled.

### 3. Quota/model integration

- [ ] `/api/v1/models` lấy catalog live từ OMP, không hardcode model demo.
- [ ] Chat hiển thị account/quota/Safety Guard live và chặn model không khả dụng.
- [ ] Switch account/sync chỉ cập nhật sau HTTP success; lỗi có trạng thái và retry.

### 4. UI và Settings

- [ ] Loại demo data/quick cards/fake success khỏi production.
- [ ] Dùng DOM an toàn cho message, session title, model, file name và tool output.
- [ ] Nối Settings theo hai nhóm local/OMP; local dùng localStorage, OMP-backed chỉ xác nhận sau API.
- [ ] Sửa folder `aria-expanded`, sidebar label, connection probe thật, whitespace validation, loading state và aria-label.
- [ ] Giữ full UI cần thiết của OMP; ẩn hoặc disable đúng capability chưa có backend.

### 5. Share, approval và security

- [ ] Approval mặc định luôn hỏi; dangerous-only/full-access map vào OMP policy và hiển thị trạng thái.
- [ ] Tạo URL thật cho encrypted share, collab read-only/read-write và local session URL.
- [ ] Giữ loopback, giới hạn body/path, CORS kín, redaction log; không ghi prompt/token/cookie/credential.

### 6. QA, release và GitHub

- [ ] Chạy `node --check`, mock `257/257`, contract/SSE/abort/session/file/approval/share tests.
- [ ] Ego Browser kiểm tra 360/390/768/1440: load, session, stream, stop/reconnect, settings, quota, Agent Hub, share.
- [ ] Agent phụ bấm/test toàn bộ control sau khi code ổn định; báo cáo supported/partial/unavailable và console/network/a11y/overflow.
- [ ] Deploy, restart LaunchAgent, checksum source/runtime và rollback test.
- [ ] Tạo package GitHub sạch: source, runtime adapter, docs, license, `.gitignore`; loại state, log, credentials, account data.

## Điều kiện hoàn tất

Không còn nút production không có tác dụng hoặc fake success; dữ liệu không có trả empty/`--`; API lỗi hiện rõ; OMP là nguồn sự thật; `/chat` dùng quota/model live; rollback chạy được; QA agent xác nhận toàn bộ flow.

## Câu hỏi duy nhất trước khi xuất bản

Síp cần cung cấp repo GitHub đích (URL hoặc `owner/repo`) và xác nhận public/private. Origin hiện tại của thư mục cha là repo khác, không được tự ý push dự án này vào đó.

---

## Sprint hoàn thiện capability — 2026-09-23

Mục tiêu: chỉ chuyển `partial` sang `supported` khi có adapter OMP và nghiệm thu live; `memory` giữ `unavailable`.

1. **Session action + reconnect** — xác nhận rename/pin/archive/delete/fork bằng state thật; thêm reconnect an toàn, không reconnect khi đang có turn.  
   *Kiểm tra:* action trả state thật, session khôi phục transcript sau reconnect.
2. **Workspace file reference** — API chỉ đọc file text dưới `cwd` session, chặn traversal/symlink/`.git`, giới hạn 512 KB; UI chọn và xem tên/path thật trước khi gửi prompt.  
   *Kiểm tra:* file hợp lệ được đính kèm; path ngoài workspace/binary/quá giới hạn bị từ chối.
3. **Abort + steer + stream recovery** — giữ abort route hiện có, thêm steer vào active context, reconnect/retry sau SSE lỗi; không gửi prompt thứ hai khi chưa có context an toàn.  
   *Kiểm tra:* abort/steer/reconnect trả trạng thái có cấu trúc và `/chat` vẫn gửi stream được.
4. **Approval roundtrip** — chỉ triển khai sau khi probe được frame yêu cầu quyền và command phản hồi OMP; nếu thiếu schema thì UI disabled, có lý do.  
   *Kiểm tra:* một request/response frame thật hoặc capability giữ `partial`.
5. **Share + Agent Hub** — Share chỉ enabled nếu `omp share` trả URL thật; Agent Hub chỉ render `get_subagents`/messages, action chưa có adapter disabled.  
   *Kiểm tra:* không có URL thật không thông báo success; danh sách Agent Hub phản ánh runtime.

Checkpoint mỗi lát: backup runtime, syntax check, security smoke, `/healthz` + `/chat` + `/quota`, rồi browser/API test tương ứng.

---

# Kế hoạch riêng `/quota` và phối hợp `/chat`

## Phạm vi chỉ triển khai cho `/quota`

Route production: `http://127.0.0.1:4177/quota`.

### Thành phần được phép sửa trong nhánh Quota

- `honpi-quota-dashboard-SKE.html`: render trạng thái quota, `--` khi thiếu dữ liệu, switch account và hiển thị lỗi.
- `~/.omp/usage-dashboard/server.mjs`: chỉ các hàm/route quota:
  - `quotaAccountStatus()` và `quotaAccountAvailability()`.
  - `quotaAccountsPayload()` và `quotaWindowPayload()`.
  - `quotaOverviewPayload()`.
  - `/api/v1/quota/*` và legacy `/api/select-account`.
- Test/contract liên quan quota trong `test-mock-api.js`, `mock-server.js`, `api-schema.json` và tài liệu quota.

### Không sửa trong nhánh Quota

- `honpi-chat-dashboard-SKE.html`.
- `console-bridge.mjs` và logic command/SSE của Chat.
- Xóa adapter, backup, HTML legacy hoặc `.DS_Store`.
- Thay đổi security middleware dùng chung trước khi bên `/chat` thống nhất.

## Các task triển khai Quota

### Q0 — Baseline và backup bắt buộc

- [x] Ghi manifest file, route, checksum, quyền file và LaunchAgent hiện tại.
- [x] Tạo backup timestamp trong `~/.omp/usage-dashboard/backups/quota/<timestamp>/` với quyền thư mục `700`, file nhạy cảm `600`.
- [x] Backup source quota, `server.mjs`, runtime asset đang phục vụ, cấu hình chọn account và manifest; không đưa token/log/session vào Git.
- [x] Ghi lệnh restore và checksum vào `MANIFEST.sha256`.

**Checkpoint Q0:** chưa sửa code; `/quota` vẫn load; health check pass; backup đọc được.

### Q1 — Sửa logic quota ở backend

- [x] Legacy `/api/select-account` dùng cùng `quotaAccountAvailability()` như `/api/v1/quota/switch`.
- [x] Account thiếu quota 5 giờ không được chọn; account ≥90% bị tạm ngưng; 80–90% chỉ cảnh báo.
- [x] Overview không có dữ liệu trả `usedPct: null`, `remainingPct: null`, `status: "unknown"`, không trả 0 giả.
- [x] Giữ nguyên response shape hiện tại hoặc tăng version; không đổi ngầm contract của Chat.

**Verification:** unit/assert cho account thiếu quota, 80%, 90%, 100%, account đang chọn và toàn bộ quota trống.

### Q2 — Sửa UI `/quota`

- [x] `null`/`unknown` luôn render `--` và label rõ lý do.
- [x] Switch account chỉ báo thành công sau HTTP success; lỗi giữ account cũ và hiển thị lý do.
- [x] Giữ responsive 360/390/768/1440, không overflow, không đổi hành vi các nút đang đúng.

**Verification:** browser smoke toàn bộ flow load → xem chi tiết → chọn account hợp lệ → từ chối account không khả dụng → refresh.

### Q3 — Contract, mock và tài liệu Quota

- [x] Tách rõ fixture mock 5 account khỏi dữ liệu live 7 account.
- [x] Cập nhật schema/docs về trạng thái `quota_unknown`, `quota_suspended`, response `null` và route production.
- [x] Không dùng mock pass để thay thế live API verification.

### Q4 — Release và rollback

- [x] Chạy `node --check`, mock tests, health check, checksum source/runtime.
- [x] Kiểm tra `/quota` ở 4 viewport và kiểm tra không có console/network error nghiêm trọng.
- [x] Chỉ sau khi Síp duyệt mới deploy/restart LaunchAgent.
- [x] Nếu fail: dừng, khôi phục backup gần nhất, kiểm tra checksum và xác nhận `/quota` về baseline.

## Phần bắt buộc thống nhất với bên `/chat`

Các mục sau không được tự sửa riêng ở Quota vì `server.mjs`/SSE là tài nguyên dùng chung:

- Auth/Origin/CSRF boundary cho toàn bộ loopback API.
- Security headers chung.
- Allowlist cho `/api/console/command` và policy `approvalMode`.
- Redaction lỗi/SSE: client nhận lỗi an toàn, stderr chi tiết chỉ ở log local đã khóa quyền.
- Status code, error shape, request id và cơ chế tương thích ngược.

Nội dung gửi bên `/chat` nằm tại `tasks/chat-fix-coordination-report.md`.

## Quy tắc backup và khôi phục

- Mỗi phase tạo một checkpoint backup mới; không ghi đè backup cũ.
- Không xóa trực tiếp: file rác/legacy chỉ chuyển vào thư mục quarantine có timestamp sau khi được duyệt.
- Không backup credential/token/session log vào repo hoặc GitHub.
- Sau mỗi thay đổi phải có checksum trước/sau, test, và lệnh rollback tương ứng.
- Nếu thay đổi shared backend làm một dashboard fail, rollback toàn bộ patch shared, không vá riêng từng dashboard.

## Implementation Plan: OMP-native Memory adapter

Approved specification: [SPEC-memory-native-adapter.md](SPEC-memory-native-adapter.md).

### Architecture decisions

- Use the installed OMP RPC builtin `memory` slash command. The no-session RPC probe on OMP 18.3.0 verified `get_available_commands` lists it and `/memory stats` completes with `agentInvoked: false` plus `command_output`.
- Before dispatch, verify the exact builtin command and requested subcommand against the selected session’s `get_available_commands`. The server constructs `/memory <allowlisted-subcommand>`; the browser never sends arbitrary slash-command text. Do not use `omp -p` as a fallback.
- Read only the effective `memory.backend` value for the selected session CWD, validate it against documented backend IDs, and never return full config, credentials, or endpoint values. Unknown values remain unsupported.
- Bind to the selected OMP session/context. The user-approved boundary keeps all backend configuration in OMP; preserve `off`, do not create dashboard persistence, and do not enable a backend.
- `command_output` has no request ID. Serialize Memory operations per context, reject a conflicting active turn, and coordinate the lock with chat dispatch so another request cannot steal the output.
- Wait for both the matching local-only prompt response and its single command output. A dispatch/HTTP acceptance is not success. If OMP invokes an agent, returns an error, times out, or emits ambiguous output, return a safe failure and never retry automatically.
- Require explicit confirmation for `clear`/`reset`; re-check the active backend before dispatch. Show processing/cost warnings for `sync`/`enqueue`. Hindsight clear is local-state/cache only, not remote-bank deletion.
- Keep API-auth/origin/CSP boundaries unchanged. Render Memory output as text; never log or persist it.

### Ordered implementation tasks

#### M1 — Native Memory API and fake-OMP contract

Files: `server.mjs`, `console-bridge.mjs`, `test-session-actions.mjs`.

- Add authenticated session-scoped status and action routes.
- Validate configured backend, native builtin/subcommand support, session state, allowed action, expected backend, and required confirmation on the server.
- Capture the RPC local-only terminal response and `command_output` under a per-context lock; return sanitized output only after confirmed completion.
- Add isolated fake-OMP coverage for `off`, available backend, exact allowlist, success, unsupported command/backend, wrong or missing output, failure, timeout, active turn, confirmation, and cross-session/concurrent command isolation.
- Keep capability unavailable/partial unless the installed OMP contract and lifecycle checks pass; an `off` backend is reported as off, not as an active memory store.

Checkpoint after M1: `rtk node --check server.mjs`, `rtk node --check console-bridge.mjs`, `rtk node test-session-actions.mjs`, and `rtk sh test-runtime-security.sh` pass. No live Memory mutation/model processing.

#### M2 — OMP Settings Memory panel

Files: `honpi-chat-dashboard-live.js`.

- Add a panel to the existing OMP Settings surface, bound to the selected session/CWD.
- Show backend/scope/operation state from the API; no session, backend off, unsupported operations, active turn, and API failures render truthful disabled/error states.
- Expose only API-reported native operations. `sync`/`enqueue` show processing warnings; `clear`/`reset` require explicit confirmation and use backend-specific deletion wording.
- Use the existing authenticated JSON helper and DOM `textContent`; never use Memory output as HTML or store it in browser storage.
- Verify the actual panel with an isolated fake-OMP server in Ego Browser at phone, tablet, and desktop widths. Do not use production Memory content.

Checkpoint after M2: exercise off → disabled, configured fake backend → stats/view, processing warning, clear cancellation/confirmation, session switch, API error, and responsive overflow; no console errors.

#### M3 — Contract, ADR, and completion verification

Files: `📚-OMP-DASHBOARD-TECHNICAL-REPORTS-IMPORTANT-🔒/02-API-AND-CAPABILITY-CONTRACT-IMPORTANT-🔒.md`, `06-ADR-CAPABILITY-DECISIONS-IMPORTANT-🔒.md`, `00-INDEX-IMPORTANT-🔒.md`, `tasks/feature-matrix.md`.

- Replace ADR-08’s “no verified OMP adapter” premise with the verified native adapter boundary, data lifecycle, and remaining limitations.
- Document routes, operation allowlist, backend-off behavior, error states, and Hindsight deletion semantics.
- Align capability status, index, and feature matrix with exactly what tests verify.
- Run syntax, fake-OMP contract, and runtime-security checks; inspect health/capabilities read-only. Do not deploy/restart the LaunchAgent or change Memory configuration without separate operator approval.

### Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Slash command falls through to model if not registered | Unintended provider call/quota | Verify builtin/subcommand first; never send free-form input; require `agentInvoked: false`; no automatic retry. |
| `command_output` lacks correlation ID | Cross-session output disclosure | Per-context exclusive lock, no active chat turn, exact context binding, and concurrency/error tests. |
| Memory backend processes personal history or remote data | Privacy/cost exposure | Preserve config; no implicit activation; explicit processing warning; never log content or secrets. |
| Backend clear semantics differ | False deletion claim/data loss | Confirm backend at action time; explicit confirmation; surface exact OMP boundary; do not claim Hindsight server-bank deletion. |
| Project config differs by session CWD | Wrong backend/status/actions | Resolve effective setting from the selected, server-validated session CWD; unknown result disables operations. |
| Local print-mode invocation hits incompatible extension/assistant path | Unintended model work | Use only the verified RPC command transport; no `omp -p` fallback. |

### Completion gate

- All spec success criteria pass through isolated fake OMP and the actual UI.
- No live OMP config changes, Memory processing, clearing, or deployment occurs in this implementation pass.
- Human approval of this plan is required before code changes.

## Task List: OMP-native Memory adapter

- M1: Native Memory API + fake-OMP contract tests (3 files; medium).
- M2: OMP Settings Memory panel + isolated Ego Browser verification (1 source file; small).
- M3: Capability contract, ADR, index, and feature matrix (4 documentation files; medium).

---

## Implementation Plan: Product-release parity — 2026-09-28

### Overview

Đồng bộ ba asset đã được runtime xác nhận vào `product-release/`, rồi sửa contract test để kiểm tra quota bundle hiện hành thay vì asset `dashboard-live.js` đã không còn trong package.

### Architecture decisions

- Source là nguồn chuẩn; sau bản vá, source/product-release là release candidate còn runtime giữ nguyên chờ deploy/restart riêng.
- Chỉ mirror ba asset đã lệch; không chạm state, credential, session, LaunchAgent hoặc các file product-release đã trùng.
- Test xác minh `/quota` có inline production client và endpoint quota switch; không khôi phục asset legacy không tồn tại.

### Task list

1. [x] Mirror `server.mjs`, `honpi-chat-dashboard-live.js`, `honpi-quota-dashboard-SKE.html` vào `product-release/`.
   - Acceptance: cả ba cặp source/product trùng byte.
   - Verify: `cmp` và checksum.
   - Dependency: backup full `20260928-074730` (done).
2. [x] Cập nhật quota contract assertion trong `test-session-actions.mjs`.
   - Acceptance: không còn tham chiếu `dashboard-live.js`; kiểm tra quota SKE có endpoint `/api/v1/quota/switch`.
   - Verify: `node test-session-actions.mjs` pass.
3. [x] Chạy checkpoint package/runtime.
   - Acceptance: syntax, security smoke, focused ACP/pin tests và source/product parity pass; không deploy/restart.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Package cũ mất quota/auth fixes | Mirror exact source assets, then byte-compare. |
| Test pass bằng asset sai | Assert route HTML contract trực tiếp, không fetch asset đã xoá. |

---

## Kế hoạch: Catalog OMP → `/chat` và sidebar Công cụ — 2026-09-29

Kế hoạch chi tiết và evidence audit: [omp-tools-sidebar-plan-2026-09-29.md](omp-tools-sidebar-plan-2026-09-29.md).

### Quyết định đã chốt

- `config/omp-tool-map.json` sẽ là source-controlled map duy nhất giữa ID OMP và presentation/selection `/chat`.
- Snapshot audit redacted nằm ngoài Git tại `~/.omp/usage-dashboard/tool-audits/`; map không chứa secret hay suy đoán status live.
- Server và sidebar chỉ tin catalog đã compile từ map + audit. Tool `unmapped`, `stale`, MCP dynamic hoặc `blocked` không có switch và không được gửi vào `--tools`.
- Danh sách hiện đã ACP-verified là 14: `read, write, edit, ast_edit, grep, glob, bash, eval, lsp, debug, task, todo, wait, web_search`. `hub` bị block do `UPSTREAM_ERROR`.

### Lát triển khai

1. **P0 Map + validator:** source map, historical marker cho map 18.2.7, schema/status state machine và migration selection v1→v2.
2. **P1 Audit/drift:** RPC no-session, digest/version, source builtin/MCP, ACP probe chỉ khi isolate session storage được xác minh.
3. **P2 Backend:** thay hardcode catalog, server validation/combo verification/effective roster và API contract.
4. **P3 Sidebar:** render groups/row/detail/drift từ API; thống nhất Agent Hub với cùng catalog.
5. **P4 QA/release:** contract + ACP combo + Ego Browser bốn viewport; deploy chỉ sau checkpoint và review drift.

### Completion gate

Không tool nào được UI quảng cáo toggleable nếu chưa pass toàn bộ combo ACP hiện hành. OMP update phải tạo drift visible và fail-closed, không tự bật tool mới.
