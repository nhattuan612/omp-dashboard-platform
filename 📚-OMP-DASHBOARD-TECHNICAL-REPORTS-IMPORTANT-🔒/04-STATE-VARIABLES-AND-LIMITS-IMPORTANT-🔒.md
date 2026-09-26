# 04 — State, biến & giới hạn 🔒

## 1. Server runtime constants (`server.mjs`)

| Biến | Giá trị/nguồn | Vai trò |
|---|---|---|
| `ROOT` | `~/.omp/usage-dashboard` | Root runtime dashboard. |
| `PORT` | `OMP_DASHBOARD_PORT` hoặc `4177` | Port loopback. |
| `OMP_BIN` | `~/.bun/bin/omp` | OMP CLI gọi share/gateway. |
| `DEFAULT_CHAT_CWD` | `OMP_DASHBOARD_WORKSPACE || process.cwd()` | CWD mặc định session mới. |
| `MAX_JSON_BODY_BYTES` | `1,048,576` | Cap JSON request body (1 MiB). |
| `MAX_CHAT_PROMPT_CHARS` | `900,000` | Cap prompt trước upstream. |
| `MAX_PENDING_CHAT_TURNS` | `32` mỗi OMP context | Tối đa 32 lượt chờ; lượt đang chạy không tính. Vượt giới hạn trả `429 RATE_LIMITED`. |
| `OMP_CHAT_RATE_LIMIT` | Mặc định `30` yêu cầu/phút; `0` tắt; giá trị không hợp lệ dùng lại `30` | Áp dụng theo IP và endpoint Chat (`/chat/send`, `/chat/stream`). |
| `DASHBOARD_SESSION_COOKIE` | `omp_dashboard_session` | Tên cookie auth; không phải giá trị secret. |
| `DASHBOARD_SESSION_TOKEN` | random runtime | Giá trị xác thực cookie; không log/commit. |
| `DASHBOARD_ORIGINS` | local origins port 4177 | Origin allowlist. |
| `DASHBOARD_HOSTNAMES` | `127.0.0.1`, `localhost` | Host allowlist. |
| `CSP_HEADER` | nonce-based CSP | Browser policy chống injection. |

Các path state server quản lý: `state.json`, `selected-account.json`, `protect-config.json`, `auth-events.json`, `account-colors.json`, `chat-metadata.json`; session/log path là `~/.omp/agent/sessions`, `~/.omp/agent/archive/console-sessions`, `~/.omp/agent/trash/console-sessions`, `~/.omp/agent/agent.db`, `~/.omp/logs`.

## 2. Server in-memory state

| Biến | Kiểu khái niệm | Vòng đời |
|---|---|---|
| `gatewaySessions` | Map context/session → gateway record | Tạo qua `ensureChatSession`; bỏ khi reconnect/close. |
| `activeChatRequests` | Map session → active request | Có trong lúc SSE prompt chạy; chứa controller/request status. |
| `chatTurnQueues` | Map OMP context → lượt active + hàng đợi FIFO | Xóa hàng đợi khi rỗng; tối đa `MAX_PENDING_CHAT_TURNS` lượt chờ. |
| `requestRateBuckets` | Map IP + pathname → bucket 60 giây | Lưu trong bộ nhớ; áp giới hạn cấu hình trước khi xử lý route. |
| `pendingApprovalRequests` | Map approval ID → pending approval | Tạo bởi confirm frame; xóa sau approve/deny/hết hạn 10 phút. |

Không persist các map này như nguồn sự thật dài hạn. Sau restart, server khởi tạo sạch và session có thể cần reconnect; metadata/session file OMP là nguồn để dựng lại context.

## 3. Bridge constants (`console-bridge.mjs`)

| Biến | Giá trị | Vai trò |
|---|---:|---|
| `MAX_LINE_BYTES` | 1 MiB | Cap JSONL line từ gateway. |
| `MAX_RAW_FRAMES` | 300 | Cap số raw frame giữ lại/debug. |
| `MAX_WORKSPACE_FILE_BYTES` | 512 KiB | Không đọc file tham chiếu quá lớn. |
| `MAX_WORKSPACE_FILE_TEXT_CHARS` | 200,000 | Cap text đưa vào prompt/reference. |
| `IDLE_CLOSE_MS` | 15 phút | Đóng gateway idle. |
| `SAFETY_MIN_REQUEST_GAP_MS` | 1 giây | Khoảng cách request tối thiểu. |
| `SAFETY_COOLDOWN_MS` | 15 phút / 1 giờ / 6 giờ / 24 giờ | Backoff theo mức safety. |
| `SAFETY_WINDOW_MS` | 10 phút | Cửa sổ tính safety. |
| `SAFETY_STATE_FILE` | env hoặc `~/.omp/usage-dashboard/safety-state.json` | Persist state safety. |

`SAFE_WORKSPACE_FILE_EXTENSIONS` chỉ cho phép: `.c`, `.cc`, `.cpp`, `.css`, `.csv`, `.go`, `.h`, `.html`, `.java`, `.js`, `.json`, `.jsx`, `.md`, `.py`, `.rs`, `.sh`, `.sql`, `.toml`, `.ts`, `.tsx`, `.txt`, `.xml`, `.yaml`, `.yml`.

`DEFAULT_WORKSPACE_ROOTS` chứa `process.cwd()` và `~/Documents/CODE`; `OMP_ALLOWED_WORKSPACES` có thể bổ sung root theo delimiter hệ điều hành. Tuy nhiên File picker dashboard dùng workspace được server gửi theo `OMP_DASHBOARD_WORKSPACE`, không tự quét toàn bộ các root này.

## 4. File reference result shape

```json
{
  "name": "honpi-chat-dashboard-live.js",
  "path": "@honpi-chat-dashboard-live.js",
  "type": "text/javascript",
  "size": 12345,
  "text": "nội dung file thật, có thể đã truncate",
  "truncated": false,
  "source": "workspace"
}
```

Các giá trị `size`, `text`, `truncated` là output thực tế theo file đã chọn; không suy đoán từ filename.

## 5. UI state đáng chú ý (`honpi-chat-dashboard-live.js`)

| State | Ý nghĩa |
|---|---|
| `sessions`, `nextCursor`, `activeId` | Danh sách và session đang mở. |
| `messages`, `pendingPrompts` | Nội dung render và prompt đang chờ; item active-turn được gửi qua native `follow_up`. |
| `nativeState` | Projection an toàn từ OMP state; không ghi đè `activeModel` hoặc `thinking` riêng của HON PI. |
| `models`, `activeModel`, `thinking` | Chọn model/độ suy nghĩ của HON PI, giữ tách khỏi native OMP defaults. |
| `controller`, `requestId` | Lượt SSE active, phục vụ stop/anti-stale. |
| `attachments`, `workspaceFiles`, `workspaceMention` | File reference đã chọn và dữ liệu picker. |
| `capabilities` | Snapshot enable/disable feature. |
| `selectedTools`, `toolsUpdating` | Tool policy UI. |
| `folderExpanded`, `folderCollapsed`, `folderMenu` | Navigation file/session folder. |
| `quota`, `accounts` | Dữ liệu dashboard quota/account. |
| `approvalMode` | Card/flow approval đang hiển thị. |
| `enterBehavior` | UI giữ `send`; Chat ACP không hỗ trợ steer. Follow-up được serialize sau lượt active qua gateway. |
| `conversationDisplay`, `browserMode`, `menu` | State hiển thị local. |

Rule quan trọng: `controller`/`requestId` chỉ là state UI. Server xác nhận active request; steer phải trả `UNSUPPORTED_ACTION` trên ACP, còn abort xử lý 409/state conflict thật. |

## 6. Timeout và cleanup cần nhớ

| Cơ chế | Giá trị | Hậu quả |
|---|---:|---|
| Approval expiry | 10 phút | Không trả lời kịp sẽ không thể approve stale request. |
| Share process | 30 giây | Quá hạn trả failure, không sinh URL giả. |
| ACP worker/context idle | 15 phút | Context/worker rỗng tự cleanup; lần dùng sau tạo/lấy session lại. |
| File byte cap | 512 KiB | File lớn phải trích/tách phần cần thiết. |
| File text cap | 200,000 chars | Nội dung có thể `truncated: true`. |
