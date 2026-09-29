# Ma trận phạm vi UI Hòn π

## Đã bật trên production local

| Khu vực | Route/API | Trạng thái |
|---|---|---|
| Quota accounts, overview, safety | `/quota`, `/api/v1/quota/accounts`, `/overview`, `/protect-status` | supported |
| Quota history, sync, switch | `/api/v1/quota/history`, `/sync`, `/switch` | supported |
| Chat sessions/messages/models | `/api/v1/sessions`, `/api/v1/models` | supported |
| Chat send và SSE stream | `/api/v1/chat/send`, `/api/v1/chat/stream` | supported; production EGO smoke pass sau khi khôi phục retry cho generation lỗi tạm thời: SSE `200`, headers sau 5ms, hoàn tất 4.9s với `gemini-3.8-flash` |
| Session actions, pagination và folder persistence | `/api/v1/sessions/:id/action`, `/api/v1/folders`, `?limit=&cursor=` | supported; create/assign/unassign/reassign/reload giữ metadata thật |
| File listing/reference | `/api/v1/sessions/:id/files`, `/files/reference` | supported; workspace-constrained; isolated API acceptance covers valid text plus traversal, symlink, `.git`, binary, and size boundaries; production file smoke chưa chạy |
| Approval, Agent Hub, capability catalog | `/approval`, `/agents`, `/api/v1/omp/capabilities` | approval roundtrip supported for real `confirm`/`select` frames; Agent Hub partial/read-only, real subagent observed and completed; capability GET `200` |
| OMP tool catalog & drift | `omp-tool-map.json`, `/api/v1/omp/capabilities`, `POST /api/v1/omp/capabilities/audit` | supported; source map versioned, runtime audit không gửi prompt/model, unknown/MCP chỉ read-only, `hub` blocked theo evidence |
| Browser modes | capability catalog + Settings | partial; Ego Browser mặc định, relay/chrome unavailable |
| Share modes | `/api/v1/sessions/:id/action` action `share` | partial; live session đã pass local loopback và encrypted HTTPS; collab unavailable |
| OMP-native Memory adapter | `/api/v1/sessions/:id/memory`, `/api/v1/sessions/:id/memory/action` | deployed; capability supported; live backend `off`, không có production Memory operation trong rollout |
| Source/runtime deployment | `deploy-local-dashboard.sh` | supported; có backup/rollback |

## Còn giới hạn có chủ đích

| Tính năng | Trạng thái | Lý do |
|---|---|---|
| Abort/retry/steer UI | partial | Live Stop returned stream abort plus API `202`; live steer returned `200`/`steer_sent`; active reconnect guard returned `409`, persisted idle reconnect returned `200`; stream recovery remains partial |
| Diff apply/revert, terminal execution | unavailable | Chưa có boundary quyền thực thi an toàn |
| Collab read-only/read-write share | unavailable | Chưa có host collab adapter |
| Session rename/pin/archive/delete | partial | 24 fake-OMP API cases và isolated active archive/delete UI smoke pass; live acceptance ngoài share chưa có active model turn |
| OMP-native Memory backend | Adapter/API deployed; runtime `off` | API live trả backend `off`, không có operation khả dụng; chưa bật backend hoặc xử lý/xóa Memory thật. |

Các mục `partial`/`unavailable` không được quảng cáo là capability đã hỗ trợ đầy đủ. UI lấy trạng thái từ capability catalog và disable mode `unavailable`.

## Focused production evidence — 2026-09-24

- Stop, approval deny/approve, steer/reconnect, local/encrypted share, and Agent Hub subagent all passed on the real runtime with the selected account live.
- Approval needed a narrow adapter fix because current OMP emitted `extension_ui_request.method=select`; the dashboard now forwards the selected `Approve`/`Deny` value.
- User aborts are excluded from generation-health failure classification; genuine auth/access/quota/upstream errors remain guarded.
- Persistence/recovery sau abort đã pass: session ephemeral vẫn nằm trong `/api/v1/sessions`, `/messages` trả prompt cache, reconnect sau recycle trả `200 ready`.

## Focused P2 recovery verification — 2026-09-24

- `rememberGatewaySession()` lấy `sessionFile`/`sessionId` thật từ OMP `get_state` trước khi recycle bridge và lưu mapping dashboard → OMP trong metadata.
- Stream cache user prompt trước khi dispatch; session list/messages có fallback metadata/cache trong cùng runtime.
- Production smoke sau deploy: stream thật `200`, abort `202`, session vẫn listed, messages `200` có prompt, reconnect `200 ready`; smoke session đã xoá sau kiểm thử.

## Legacy session recovery — 2026-09-24

- Sessions with a persisted CWD outside the configured workspace migrate their session metadata to `OMP_DASHBOARD_WORKSPACE`; the dashboard keeps the original transcript path for visible/history loading and does not widen the allowlist.
- New, existing, and oldest production browser chat flows all returned SSE `200` with visible responses after deployment.
- Isolated contract coverage includes the legacy CWD migration and persisted-header rewrite (`24 scenarios passed`).

## Persistent session folders — 2026-09-24

- Isolated browser smoke qua UI: tạo folder mới → gán session → reload vẫn nằm đúng group → bỏ phân loại chuyển session về `CHƯA PHÂN LOẠI`.
- API và DOM cùng xác nhận `folderId`/`folderName`; contract suite giữ coverage create, assignment, unassignment, reassign và reload.

## Prompt queue và empty state — 2026-09-24

- Supported: web-side FIFO queue theo session, snapshot prompt/attachments/settings, sequential OMP dispatch và failure pause/retry.
- Supported: first prompt không chờ `GET /messages`; session creation dùng chung cho nhiều prompt gửi liên tiếp.
- Supported: greeting/logo cho neutral/session rỗng, ẩn tức thời khi submit, preview prompt và auto-title sidebar/header.
- Evidence: isolated browser smoke 3 prompt tuần tự (`maxRunning=1`), first prompt không gọi `/messages`, contract suite `25 scenarios passed`.

## OMP-native Memory source verification — 2026-09-24

- Source có API trạng thái/thao tác Memory, capability projection và panel Settings theo session. Fake OMP bao phủ backend off/unknown/supported, cách ly theo CWD, confirmation/backend mismatch, boundary clear Hindsight/Sharpshooter, active-turn, lỗi/timeout và không lưu output; contract suite đạt `59 scenarios`.
- Browser smoke cô lập hiển thị backend local cùng `fake-memory-stats`; nhấn Clear chỉ mở cảnh báo/xác nhận, không gửi lệnh clear.
- Ở checkpoint source verification trước rollout chưa có production Memory action, đổi config/backend, deploy hoặc restart. Rollout live được xác nhận sau đó; xem mục dưới và [12 — OMP-native Memory deployment & rollback](../📚-OMP-DASHBOARD-TECHNICAL-REPORTS-IMPORTANT-🔒/12-OMP-NATIVE-MEMORY-DEPLOYMENT-REPORT-IMPORTANT-🔒.md).

## OMP-native Memory deployment — 2026-09-24

- Live `/healthz` và capability trả `200`; capability `memory=supported`. Session status API trả `backend=off`, `status=off`, `scope=null`, không operation.
- Rollback snapshot `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-171216` có manifest hợp lệ; LaunchAgent running sau restart.
- Không đổi cấu hình hoặc gọi Memory operation thật. Live panel DOM có mặt; tab OMP không active trong browser session và overlay chặn mở tab, nên status live được kiểm tra qua API; panel flow đã được smoke bằng fake OMP.
