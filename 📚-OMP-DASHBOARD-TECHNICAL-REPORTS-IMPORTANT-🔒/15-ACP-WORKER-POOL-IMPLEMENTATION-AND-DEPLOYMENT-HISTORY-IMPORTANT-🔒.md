# 15 — ACP worker pool: triển khai, kiểm chứng và lịch sử 🔒

**Ngày:** 2026-09-26 (Asia/Ho_Chi_Minh)  
**Phạm vi:** thay đổi Chat ACP trong source workspace, backup, regression, deploy/restart LaunchAgent và audit queue/workspace trong phiên này.  
**Trạng thái:** Đã deploy local; LaunchAgent healthy. Chưa gửi model prompt thật; không commit.

> Tài liệu chỉ ghi đường dẫn, mã kiểm tra và kết quả kỹ thuật; không lưu prompt hội thoại, cookie, token, log phiên hoặc credential.

## 1. Tóm tắt kết quả

- Chat dùng ACP worker process chia sẻ theo workspace (`cwd`), approval mode và bộ tools chuẩn hóa; mỗi chat vẫn giữ Dashboard context và OMP ACP `sessionId` riêng.
- `/api/console/*` giữ RPC lifecycle riêng. ACP prewarm chỉ khởi động worker, không tạo OMP session; local draft tạo Chat/OMP session ở prompt đầu. API tạo chat session tường minh có thể cấp OMP session trước prompt.
- Bundle runtime đã deploy bằng `deploy-local-dashboard.sh --restart`; backup code-only và checksum được xác minh trước khi copy. LaunchAgent đang `running`, `/healthz` trả `{"ok":true}`.
- Không gửi prompt model thật. Smoke OMP mở các ACP session test; `distinctSessions=true`, `siblingSurvivedStop=true`, `promptSent=false`.

## 2. Lịch sử thực hiện — 2026-09-26

### 2.1. Backup source trước sửa

- Archive: `/Users/trannhattuan/Documents/CODE/omp-dashboard-acp-prechange-20260926.tar.gz`
- Kết quả xác minh: 86 mục, 28,542,049 bytes.
- SHA-256: `6afcb93cb6287b6faa9a4063e3146616190b51c8e83d1874d3fdc348ac706a8d`.

### 2.2. Thay đổi implementation

- `acp-worker.mjs`: quản lý tiến trình OMP ACP/JSONL, initialize/authenticate, request routing và dừng process.
- `acp-session-context.mjs`: tạo/load/fork OMP session riêng cho từng chat, route event/approval/cancel; gửi prompt bằng `session/prompt`.
- `console-bridge.mjs`: chia sẻ worker theo `{ cwd, approvalMode, tools }`; route thông báo theo OMP session ID. `/api/console/*` vẫn dùng RPC riêng.
- `server.mjs`: Chat stream dùng ACP, prewarm, lưu CWD/session, serialize lượt theo chat context, giữ account pinning và capability truthful.
- `honpi-chat-dashboard-live.js`: prewarm khi tạo draft/đổi workspace hoặc policy; bỏ hành vi steer không có adapter.
- `api-schema.json`, `deploy-local-dashboard.sh`, `product-release/install-local-dashboard.sh`, `product-release/PRODUCT-MANIFEST.json`: cập nhật contract và danh sách bundle. Năm runtime file thay đổi được mirror vào `product-release/`.
- Regression: `test-acp-worker.mjs`, `test-session-actions.mjs`; các technical docs 00–07 và `SYSTEM-FLOW-IMPORTANT-DO-NOT-DELETE.md` được đồng bộ theo thay đổi.

### 2.3. Review và remediation

Review độc lập phát hiện và đã sửa 4 lỗi:

1. ACP startup initialize/authenticate lỗi không còn để worker/process treo.
2. SSE history replay chỉ gửi đến subscriber mới, không append lại frame vào history.
3. Capability catalog bỏ `set_session_name` chưa được hỗ trợ.
4. Approval request key được namespace theo `(chat sessionId, upstream request ID)` để tránh collision giữa chat.

Reviewer xác nhận bốn remediation này đã đóng, không còn finding trong các đường đó.

### 2.4. Kiểm thử trước deploy

| Lệnh / smoke | Kết quả | Phạm vi và giới hạn |
|---|---|---|
| `rtk node test-acp-worker.mjs` | Pass | Fake ACP process: prewarm reuse, cùng workspace/policy chia sẻ worker, chat có context/session riêng, output isolation, fork, sibling lifetime, workspace/policy partition, replay isolation, startup cleanup. |
| `rtk node test-session-actions.mjs` | 86 scenarios passed | Server integration dùng `NODE_ENV=test` và `OMP_DASHBOARD_TEST_CHAT_PROTOCOL=rpc`; không phải ACP `/api/v1/chat/stream` FIFO E2E. |
| `rtk node test-gemini-account-pin.mjs` | Pass | Account pin regression. |
| `rtk node test-omp-account-preference.mjs` | Pass | Preference regression. |
| `rtk node test-mock-api.js` | 267 checks / 12 scenarios passed | Mock API contract. |
| `rtk sh test-runtime-security.sh` | Pass | Runtime/security smoke. |
| Node syntax, JSON parse, shell syntax và source/release parity | Pass | Kiểm tra các runtime/test file, `api-schema.json`, manifest, scripts và năm bản mirror. |
| OMP ACP lifecycle smoke với HOME tạm | Pass; không gửi prompt | Tạo hai session riêng, dừng một context, sibling còn `ready`. |

### 2.5. Deploy và restart LaunchAgent

- Được người vận hành xác nhận trước khi deploy.
- Lệnh: `rtk ./deploy-local-dashboard.sh --restart`
- LaunchAgent: `com.trannhattuan.omp-usage-dashboard`; target runtime `/Users/trannhattuan/.omp/usage-dashboard`.
- Backup code-only do deploy script tạo: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260926-205243-88137`.
- `MANIFEST.sha256`: mọi mục `OK`. Backup ghi nhận runtime cũ chưa có `acp-worker.mjs` và `acp-session-context.mjs` bằng marker `ABSENT-*`.
- Chín asset trong deploy list được `cmp` với source; LaunchAgent restart thành công, sau deploy vẫn `running`; `/healthz` trả `{"ok":true}`.
- Sau deploy, `/api/console/state` và `/api/v1/omp/capabilities` đều HTTP 200. Khi mở draft Chat: quan sát 2 ACP worker `ready`, tổng context count 0; không tạo OMP session và không gửi prompt.
- Browser xác nhận `/chat` mở được, có composer và draft pill `Cuộc trò chuyện mới · bản nháp local`. Screenshot capture bị Ego/CDP timeout; xác minh UI còn lại dựa trên DOM/accessibility state. Không có ảnh chụp live trong evidence.

## 3. Luồng prompt, queue và workspace

1. Local draft prewarm worker, chưa có OMP session. API tạo chat session tường minh có thể cấp OMP session trước prompt.
2. Prompt đầu tạo chat session; CWD được lấy từ workspace đã chọn. Chat mới không chọn workspace dùng `~/Documents/OMP General Chat`, trừ khi `OMP_DASHBOARD_GENERAL_WORKSPACE` được cấu hình. Chat cũ dùng CWD đã lưu.
3. Server tạo ACP context và gọi OMP `session/new` với CWD. Mỗi prompt sau đi vào cùng OMP session của chat bằng `session/prompt`; model/provider/options và attachments được chuyển theo request.
4. OMP tools thao tác trên working directory thật. Dashboard không tự tạo branch/worktree, commit hay bản sao riêng cho từng chat. Hai chat cùng CWD nhìn thấy thay đổi trên cùng filesystem. CWD không phải OS sandbox; việc tool được phép chạy còn phụ thuộc OMP tools và approval mode.
5. Gửi một prompt khi chưa có lượt trước không tạo queue row vì prompt được dispatch trực tiếp. Nếu gửi thêm khi lượt cùng chat còn chạy, server queue FIFO theo context; worker process chia sẻ không làm trộn OMP session.
6. Queue tray UI chỉ render `state.pendingPrompts`. Luồng gửi thường gọi `startPrompt()` trực tiếp, nên prompt do server FIFO giữ chờ không nhất thiết xuất hiện thành row trong tray. Đây không phải thay đổi được thêm bởi worker pool.

## 4. Audit queue và giới hạn test

- Reviewer audit logic: prompt gửi trực tiếp được nhận vào server FIFO; worker được chia sẻ theo workspace/policy trong khi OMP session vẫn một-một theo chat; thao tác file chạy trên CWD chung.
- **Chưa có end-to-end test cho FIFO qua ACP `/api/v1/chat/stream`.** Test 86 scenarios bật RPC test override; `test-acp-worker.mjs` gọi trực tiếp `ConsoleBridge`, không chạy server Chat stream. Các test này chứng minh server FIFO tổng quát và worker/session isolation riêng, nhưng chưa chứng minh hai lớp kết hợp qua transport ACP.
- UI nhận SSE `waiting` với thông điệp “đang chờ OMP dispatch”, nhưng handler hiện gắn nhãn “Đang chờ Safety Guard”. Đây là status text có thể gây hiểu nhầm; chưa sửa trong đợt này.
- Không kiểm chứng lượt model thật, approval có side effect, share link hoặc thay đổi file project bằng prompt thật.

## 5. File và tài liệu liên quan

| Nhóm | File chính |
|---|---|
| ACP/server/UI | `server.mjs`, `console-bridge.mjs`, `acp-worker.mjs`, `acp-session-context.mjs`, `honpi-chat-dashboard-live.js` |
| Regression/contract | `test-acp-worker.mjs`, `test-session-actions.mjs`, `api-schema.json` |
| Deploy/package | `deploy-local-dashboard.sh`, `product-release/install-local-dashboard.sh`, `product-release/PRODUCT-MANIFEST.json`, năm runtime mirrors trong `product-release/` |
| Kỹ thuật | Technical docs 00–07 và `SYSTEM-FLOW-IMPORTANT-DO-NOT-DELETE.md`; báo cáo lịch sử này là mục 15. |

## 6. Rollback

Deploy script đã lưu backup code-only và LaunchAgent plist. Nếu cần rollback, script xác minh marker/checksum rồi phục hồi bundle và restart/health-check:

```sh
rtk ./deploy-local-dashboard.sh --rollback '/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260926-205243-88137'
```

Lệnh trên chỉ là hướng dẫn, **chưa được chạy**. Không commit trong đợt này.