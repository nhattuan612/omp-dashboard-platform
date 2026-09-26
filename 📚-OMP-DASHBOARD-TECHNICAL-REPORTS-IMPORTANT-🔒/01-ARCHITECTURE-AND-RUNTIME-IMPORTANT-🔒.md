# 01 — Kiến trúc & runtime 🔒

## 1. Ranh giới hệ thống

```text
Browser (127.0.0.1:4177/chat)
  └─ server.mjs (HTTP/SSE, auth, session API, policy)
       ├─ console-bridge.mjs (JSONL gateway tới OMP CLI)
       │    └─ ~/.bun/bin/omp (chat ACP, dashboard console RPC, share CLI)
       ├─ ~/.omp/agent/* (session, archive, trash, agent DB)
       ├─ ~/.omp/usage-dashboard/* (state, metadata, runtime config)
       └─ honpi-chat-dashboard-live.js (UI client được server phục vụ)

LaunchAgent com.trannhattuan.omp-usage-dashboard
  └─ giữ server.mjs chạy trên loopback port 4177
```

Browser chỉ nói chuyện với server local. Server là policy boundary: nó xác thực cookie, giới hạn origin/host, chọn session/workspace và chỉ sau đó mới gọi bridge/OMP. UI không được gọi OMP trực tiếp.

## 2. Thành phần và trách nhiệm

| Thành phần | File/vị trí | Trách nhiệm |
|---|---|---|
| HTTP + SSE server | `server.mjs` | Route API, SSE stream, session metadata, auth, policy, abort/approval/share và capability flags. |
| Gateway bridge | `console-bridge.mjs`, `acp-worker.mjs`, `acp-session-context.mjs` | Pool ACP worker theo workspace/policy, định tuyến session riêng, giữ RPC cho `/api/console/*`; đọc JSONL UTF-8 tăng dần, đổi frame thành API nội bộ và đọc file workspace an toàn. |
| UI chat | workspace `honpi-chat-dashboard-live.js` | Render conversation, menu/session, file picker, approval card, Agent Hub; chỉ enable action có adapter. |
| OMP CLI | `~/.bun/bin/omp` | Thực thi prompt, session, tool, share và subagent protocol. |
| LaunchAgent | `~/Library/LaunchAgents/com.trannhattuan.omp-usage-dashboard.plist` | Tự chạy lại dashboard process local. |
| Product release | workspace `product-release/` | Gói cho người dùng cài, không chứa state/tài liệu nội bộ. |

### Chat ACP worker pool

- Runtime và LaunchAgent đã deploy ngày 2026-09-26 bằng script có code-only backup; health pass. Xem [15 — ACP worker pool: triển khai, kiểm chứng và lịch sử](15-ACP-WORKER-POOL-IMPLEMENTATION-AND-DEPLOYMENT-HISTORY-IMPORTANT-🔒.md).
- Chat dùng ACP; `ConsoleBridge` chia sẻ một worker theo CWD canonical, approval mode và bộ OMP tools chuẩn hóa. Mỗi chat vẫn có Dashboard context và ACP `sessionId` riêng; notification được định tuyến theo session ID. Fork tạo context/session ACP mới.
- Chat mới gọi `POST /api/v1/omp/prewarm` khi bắt đầu draft và khi đổi workspace hoặc launch policy. Endpoint khởi động đúng worker nhưng không tạo OMP session; worker rỗng tự đóng sau 15 phút.
- `/api/console/*` tiếp tục dùng RPC `ConsoleContext`; không trộn vòng đời RPC với ACP.
- ACP có cancel nhưng không có steering giữa lượt theo chuẩn; Agent Hub chưa có snapshot subagent qua ACP. Capability/API/UI phải báo đúng phần chưa hỗ trợ.

## 3. Vùng dữ liệu và ý nghĩa

| Vùng | Ví dụ | Được phép đưa vào product/GitHub? |
|---|---|---|
| Source workspace | `/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI` | Có, chỉ file sản phẩm đã chọn. |
| Runtime | `~/.omp/usage-dashboard` | Không. Có state, CA/cấu hình cục bộ, metadata. |
| OMP agent state | `~/.omp/agent` | Không. Có session, DB, archive/trash. |
| OMP logs | `~/.omp/logs` | Không. Có thể chứa dữ liệu hoạt động. |
| Local report | `📚-OMP-DASHBOARD-TECHNICAL-REPORTS-IMPORTANT-🔒/` | Không theo chính sách hiện tại. |
| Backup | `~/.omp/usage-dashboard/backups/capability-sprint/20260923-074054` | Không. Chỉ để recovery local. |

Các file runtime quan trọng gồm `state.json`, `selected-account.json`, `protect-config.json`, `auth-events.json`, `account-colors.json`, `chat-metadata.json` và `safety-state.json`. Đây là dữ liệu máy cục bộ: không copy vào source control hoặc attach vào ticket công khai.

## 4. LaunchAgent và workspace source

LaunchAgent đang dùng label:

```text
com.trannhattuan.omp-usage-dashboard
```

Biến môi trường quan trọng trong plist là:

```text
OMP_DASHBOARD_WORKSPACE=/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI
```

`OMP_DASHBOARD_WORKSPACE` tách **workspace được File reference duyệt** khỏi **working directory của session OMP**. Điều này giải quyết lỗi cũ: File picker từng nhìn vào `~/.omp/usage-dashboard` và lộ các file runtime như `state.json`/`chat-metadata.json` trong danh sách. Hiện picker chỉ hiển thị file hợp lệ dưới workspace trên.

`DEFAULT_CHAT_CWD` trong server lấy `OMP_DASHBOARD_WORKSPACE || process.cwd()`. Session mới dùng giá trị này nếu request và metadata không chỉ định `cwd`. Session cũ có CWD đã persist có thể vẫn chạy trong CWD lịch sử; đây là hành vi giữ tương thích, không phải lỗi.

## 5. Boundary bảo mật

| Guard | Cách thực hiện | Lý do |
|---|---|---|
| Network | Chỉ loopback `127.0.0.1` / `localhost` | Không mở dashboard ra LAN/Internet. |
| Auth | Cookie `omp_dashboard_session`, token ngẫu nhiên runtime | Chặn request local không có phiên dashboard. |
| Origin | `DASHBOARD_ORIGINS` chỉ cho origin local đúng port | Giảm CSRF. |
| Host | `DASHBOARD_HOSTNAMES` chỉ localhost/127.0.0.1 | Chặn Host-header lạ. |
| Browser policy | CSP nonce, `nosniff`, `DENY` frame | Hạn chế script injection/clickjacking. |
| API input | JSON body cap, prompt cap, public error codes | Tránh payload quá lớn và lộ upstream detail. |
| File reference | Canonical path + allowlist + content checks | Chặn traversal, symlink escape, binary/secret. |

Không ghi giá trị thực của token/cookie/CA certificate vào tài liệu, console log hay Git.

## 6. Điểm vào code để lần lỗi

| Luồng | Hàm chính trong `server.mjs` |
|---|---|
| Mở/tái sử dụng gateway session | `ensureChatSession` |
| Prompt SSE | `streamChatTurn` |
| Gửi frame gateway | `gatewayCommand`, `gatewayPrompt` |
| Stop lượt chạy | `abortChatRequest` |
| Phản hồi approval | `resolveApproval` |
| Lấy subagent thật | `agentHubSnapshot` |
| Action session | `sessionAction` |
| Tạo share link thật | `runOmpShare` |

| Luồng | Hàm/chốt trong `console-bridge.mjs` |
|---|---|
| Đọc file đã chọn | `readWorkspaceFile` |
| Duyệt file/folder | `listWorkspaceFiles` |
| Kiểm tra thư mục | `isSafeWorkspaceDirectory` |
| Kiểm tra path/file | `isSafeWorkspaceFilePath` |

Khi debug một bug UI, kiểm tra theo thứ tự: UI gọi endpoint nào → status/code server trả về → gateway frame OMP (nếu có) → state/metadata persist. Không sửa bằng cách để UI tự giả thành công.
