# Kế hoạch resume OMP Dashboard

## Resume entrypoint

Đọc theo thứ tự:

1. `tasks/session-report-2026-09-23.md`
2. `tasks/feature-matrix.md`
3. `tasks/todo.md`
4. File/symbol theo phase bên dưới

Runtime đang phục vụ:

```text
http://127.0.0.1:4177/chat
http://127.0.0.1:4177/quota
```

Source/runtime:

```text
Source:  /Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI
Runtime: /Users/trannhattuan/.omp/usage-dashboard
```

## Phase tiếp theo: Focused production browser QA

### Mục tiêu

Focused QA trên runtime thật đã chạy ngày 2026-09-23. Mỗi flow dưới đây được phân loại theo bằng chứng runtime; không coi source inspection hoặc fake OMP là production pass.

### Kết quả QA production

1. **Stop một turn đang chạy — BLOCKED BY ACCOUNT STATE**
   - Browser tạo session thật và gửi prompt thật.
   - `/api/v1/chat/stream` trả `409 ACCOUNT_UNAVAILABLE` trước khi tạo active turn vì account đang chọn `aiaprompt00@gmail.com` có `generationStatus=error`, `canUse=false`.
   - Không có active turn để bấm Stop; chưa được phép claim abort production pass.
2. **Approval thật — BLOCKED BY ACCOUNT STATE**
   - Cùng preflight quota/account gate; chưa tạo được active OMP turn để phát `extension_ui_request`.
   - Approval deny/approve chỉ có bằng chứng raw OMP isolated và fake-OMP, vẫn giữ `partial`.
3. **Steer/reconnect trong active turn — BLOCKED BY ACCOUNT STATE**
   - Chưa có active turn production để kiểm tra steer hoặc active reconnect conflict.
   - Idle recovery/reconnect path vẫn trả state thành công trong session thật sau stream failure; active-turn guard chưa được nghiệm thu production.
4. **Share encrypted/local — PASS**
   - Session thật trên runtime 4177 trả `200` cho cả `shareMode=local` và `shareMode=encrypted`.
   - Local trả loopback URL `http://127.0.0.1:4177/chat?session=...`; encrypted trả HTTPS `https://my.omp.sh/...` và metadata được persist.
5. **Agent Hub — PARTIAL / BLOCKED FOR LIVE SUBAGENT**
   - `GET /api/v1/sessions/:id/agents` trên session thật trả `200` với `agents: []`.
   - Empty state đã có bằng chứng production; subagent thật chưa thể tạo vì account gate chặn active model turn.
6. **Dialog accessibility và send-control invariant — PASS**
   - Runtime browser có 8 dialog; dialog đóng đều có `aria-hidden="true"` và `inert`.
   - CDP accessibility tree trả 0 node role `dialog` khi tất cả dialog đóng.
   - Sau stream bị chặn, send control trở lại `Gửi tin nhắn`, `disabled=false`.
   - Đây là bằng chứng fix UI/a11y; không thay thế bằng chứng active-turn abort.

### Việc còn lại và thứ tự

1. Khôi phục hoặc chọn thủ công một account có `canUse=true` khi người dùng cho phép; không tự động đổi account/model để né quota.
2. Chạy lại riêng ba flow model-dependent: Stop, approval deny/approve, steer/reconnect active.
3. Khi có active turn thật, chạy Agent Hub với subagent thật; không quảng cáo `agents: []` là subagent pass.
4. Giữ encrypted/local share ở trạng thái đã nghiệm thu; collab vẫn `unavailable`.
5. Sau khi có active account, cập nhật lại session report với kết quả production cuối cùng; không mở P2 trước khi ba flow bị chặn có bằng chứng.

## Production-surface disposition

- Running send button đã nối vào `stopStream()`.
- Dialog đóng được đồng bộ `aria-hidden`/`inert`; accessibility tree không còn node dialog ẩn.
- `server.mjs` hiện đã có cookie auth, Host/Origin check, CSP, redaction và `server.on("error")`.
- Các capability chưa có adapter tiếp tục ở `partial`/`unavailable`, không tạo workaround giả.

## Checkpoint bắt buộc mỗi phase

```bash
node --check server.mjs
node --check console-bridge.mjs
node --check honpi-chat-dashboard-live.js
./test-runtime-security.sh
./deploy-local-dashboard.sh --restart
```

Sau deploy:

- Kiểm tra `/healthz`.
- Mở `/chat` và `/quota`.
- Chạy browser smoke tương ứng.
- Ghi backup path mới vào báo cáo.

## Acceptance criteria

- API trả state thật sau action.
- UI không giữ session đã archive/delete làm active.
- Abort/steer/reconnect không tạo prompt thứ hai ngoài ý muốn.
- Retry không race với cleanup stream.
- File reference không vượt workspace/path policy.
- Approval chưa có schema thì không báo success.
- Capability unavailable luôn disabled và có lý do.
- Không có console error sau browser smoke.

## Known limitations

- Collab read-only/read-write chưa có host adapter.
- OMP encrypted share còn phụ thuộc `omp share` trả external HTTPS URL.
- OMP relay/Chrome/Electron chưa có adapter sẵn sàng.
- Diff apply/revert và terminal execution chưa có boundary an toàn.
- Repo GitHub đích chưa được cung cấp; không tự ý push.

## Resume command sequence

```bash
cd "/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI"
node --check server.mjs
./test-runtime-security.sh
./deploy-local-dashboard.sh --restart
```

Sau đó đọc `tasks/session-report-2026-09-23.md` và bắt đầu Phase tiếp theo, không quay lại sửa các capability đã đạt acceptance trừ khi regression xuất hiện.

## Recovery addendum — 2026-09-24

- Root cause vận hành: generation health cũ từ lỗi certificate/TLS làm account active bị `chat_error` và preflight trả `409`; đây không phải frontend treo 120 giây ở lượt repro hiện tại.
- Fix đã deploy: certificate/TLS được coi là `transient_error`; account vẫn retry được khi quota/OAuth còn hợp lệ. `auth_error`, `access_error`, `quota_blocked` và `chat_error` không được nới.
- EGO production smoke: stream `200`, headers 5ms, end 4.9s, `gemini-3.8-flash`; account active chuyển về `generationStatus=live`, `canUse=true`.
- Không tự động chuyển account/model. Các flow active-turn Stop/approval/steer và subagent thật vẫn cần QA riêng.

## Final focused production browser QA — 2026-09-24

The selected account was live for the rerun. All five requested P1 flows were exercised against `http://127.0.0.1:4177/chat` with real OMP and one existing Ego Browser TaskSpace:

| Flow | Result | Runtime proof |
|---|---|---|
| Stop active turn | **PASS** | Stream `200` became aborted; abort endpoint `202`; UI returned to the send state and the guard had no active request. |
| Approval approve/deny | **PASS** | OMP `select` frame reached the UI; both `/approval` decisions returned `200`; approve produced the real `approval-approve-qa` output and deny produced the real denial result. |
| Steer/reconnect | **PASS** | Active steer returned `200`/`steer_sent`; reconnect while active returned `409 CONFLICT`; persisted idle reconnect returned `200`/`ready`. |
| Local/encrypted share | **PASS** | Local produced the loopback session URL; encrypted produced a real `https://my.omp.sh/...` URL; both persisted metadata. |
| Agent Hub subagent | **PASS** | OMP `task` created `QaAgent`; Agent Hub observed it running; OMP `hub wait` completed it; the assistant transcript contained `subagent-agenthub-qa`. |

Production fixes deployed in the narrow responsible layer:

- User abort/cancel/interruption no longer poisons generation health as `chat_error`.
- Approval parser/response now handles OMP `extension_ui_request` `method=select` by forwarding its selected string value.

Focused verification passed:

```text
node --check server.mjs
runtime security smoke: pass
session action contract: 22 scenarios passed on isolated port 59262
/healthz: {"ok":true}
production abort recovery smoke: stream 200 → abort 202 → session listed/messages 200 → reconnect 200 ready
deploy backup: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-070457`

Current boundaries remain intentional: stream recovery is `partial`; Agent Hub is read-only; OMP relay/Chrome/Electron and Collab share are unavailable. Aborted ephemeral session persistence after bridge recycling is fixed in the dashboard adapter. Ego Lite reported an update during QA; no upgrade was run.

Resume next from this completed QA state. Do not repeat account/model switching or CA/TLS work unless a new regression appears.

## Legacy session recovery addendum — 2026-09-24

- Legacy sessions persisted a CWD outside `OMP_DASHBOARD_WORKSPACE`; new sessions did not share the failure.
- The dashboard now migrates only that persisted session metadata to the configured workspace, keeps the original transcript path for visible/history loading, and starts a fresh RPC context when legacy tool-call state is unsafe.
- Explicit CWD validation remains strict; the allowlist was not broadened.
- Production EGO checks passed for a new session, the existing session, and the oldest session. No account/model switch and no Ego Lite upgrade.
- Latest deploy backup: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-072122`.
