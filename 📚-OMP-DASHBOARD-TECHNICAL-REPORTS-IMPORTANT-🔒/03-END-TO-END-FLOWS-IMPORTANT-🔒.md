# 03 — Flow end-to-end 🔒

## 1. Khởi động dashboard

```mermaid
flowchart TD
  A[launchd LaunchAgent] --> B[server.mjs port 4177]
  B --> C{Health / config hợp lệ?}
  C -- Có --> D[Phục vụ /chat + API]
  D --> E[Browser nhận cookie dashboard]
  E --> F[UI GET capabilities và sessions]
  C -- Không --> G[stderr LaunchAgent log]
```

`server.mjs` tạo token cookie trong runtime; token không persist vào report hay product release. UI tải capability trước để quyết định control nào enable.

## 2. Prompt streaming, abort, queued follow-up và reconnect

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Chat UI
  participant S as server.mjs
  participant B as ACP worker pool
  participant O as OMP ACP session
  U->>UI: Nhập prompt / Enter
  UI->>S: POST session stream
  S->>S: ensureChatSession, bind context + sessionId riêng
  S->>B: enqueue prompt theo context
  B->>O: session/prompt
  O-->>B: notification theo sessionId
  B-->>S: parsed updates/result
  S-->>UI: SSE events
  alt User bấm Stop
    UI->>S: POST abort
    S->>B: session/cancel(sessionId)
    S-->>UI: stream kết thúc/aborted
  else User xếp follow-up khi lượt active
    UI->>S: follow_up cùng context
    S->>B: serialize sau lượt hiện tại
    B->>O: session/prompt kế tiếp
  else Kết nối lỗi khi không active
    UI->>S: session action reconnect
    S->>S: load lại sessionId đã lưu
  end
```

Steer giữa lượt không có trong ACP chuẩn nên capability và API chat báo `unavailable`/`UNSUPPORTED_ACTION`. Follow-up được giữ trong hàng đợi và gửi bằng `session/prompt` riêng sau khi lượt trước kết thúc; không giả lập steer. Reconnect không được chen vào active turn.

## 3. Chọn file thật và đưa vào prompt

```mermaid
flowchart LR
  A[UI mở Files] --> B[GET files?mention=@]
  B --> C[console-bridge listWorkspaceFiles]
  C --> D{Trong OMP_DASHBOARD_WORKSPACE\nvà path an toàn?}
  D -- Không --> X[400 / không hiển thị]
  D -- Có --> E[UI chọn @relative/path]
  E --> F[POST files/reference]
  F --> G[realpath + size + UTF-8 + extension check]
  G --> H{File hợp lệ?}
  H -- Không --> X
  H -- Có --> I[Trả text thật, metadata, truncated]
  I --> J[UI đính reference vào prompt]
```

Không có upload giả. Nội dung chỉ được đọc từ file thật dưới workspace cấu hình; server hạn chế 512 KiB/file và 200.000 ký tự text trước khi chuyển thành reference. File binary/secret/traversal/symlink escape bị dừng trước khi nội dung tới prompt.

## 4. Native approval roundtrip

```mermaid
sequenceDiagram
  participant O as OMP
  participant S as server.mjs
  participant UI as Chat UI
  participant U as User
  O->>S: extension_ui_request confirm/select/input/editor
  S->>S: pendingApprovalRequests.set + expiry 10 phút
  S-->>UI: SSE approval card + method/options/default
  U->>UI: Allow/Deny, chọn option hoặc nhập giá trị
  UI->>S: POST approval {id, decision/value/cancelled}
  S->>O: extension_ui_response đúng protocol
  S->>S: pendingApprovalRequests.delete
  O-->>S: tiếp tục/kết thúc turn
```

UI chỉ là nơi hỏi người dùng, không tự cấp quyền. Approval ID gắn với đúng gateway session; value `select` phải nằm trong options; approval stale hoặc sai session không được coi là đã duyệt.

## 5. Share link

```mermaid
flowchart TD
  A[User chọn Share] --> B[POST session action share]
  B --> C[Tìm session file thật]
  C --> D[spawn: omp share session-file]
  D --> E{stdout/stderr có URL HTTPS hợp lệ?}
  E -- Có --> F[Trả shareMode encrypted + shareUrl]
  F --> G[UI copy URL và báo thành công]
  E -- Không --> H[502 UPSTREAM_UNAVAILABLE]
  H --> I[UI không copy, không báo success]
```

Không dùng local URL `/chat?session=…` làm share success. Chưa tạo share link thật trong đợt kiểm thử vì đó là external side effect.

## 6. Agent Hub

```mermaid
flowchart LR
  A[UI đọc capabilities] --> B{Chat ACP hỗ trợ snapshot?}
  B -- Không --> C[Agent Hub unavailable]
  C --> D[UI không gọi snapshot, không dựng danh sách rỗng]
  E[Request trực tiếp tới sessions/:id/agents] --> F[UNSUPPORTED_ACTION]
  G[/api/console/* RPC riêng/] -. không dùng lifecycle ACP .-> H[Không phải Chat Agent Hub]
```

Chat ACP hiện không công bố `get_subagents` snapshot nên capability là `unavailable`; request trực tiếp trả lỗi thay vì thành công với danh sách rỗng. `/api/console/*` giữ RPC riêng, không đổi capability cho Chat.

## 7. Quota dashboard và Chat

```mermaid
flowchart LR
  A[/Quota đọc state/account local/] --> B[server route quota]
  B --> C[Runtime state files]
  D[/Chat chạy OMP/] --> E[Gateway/session state]
  C --> F[Browser dashboard]
  E --> F
```

Hai vùng dùng chung server local và policy/auth, nhưng nguồn dữ liệu khác nhau: Quota đọc dữ liệu tài khoản/runtime; Chat sử dụng gateway/session OMP. Không để UI suy diễn quota từ một prompt test; đợt này không gửi prompt mới để tránh tiêu quota.

## 8. OMP Chat parity turn flow

Parity chi tiết không nằm trong flow tổng quan này để tránh trộn quota/session/file flow với native turn semantics. Đọc [10 — OMP Chat parity flow & handoff](10-OMP-CHAT-PARITY-FLOW-AND-HANDOFF-IMPORTANT-🔒.md) khi cần:

- phân biệt `agent_end` terminal/non-terminal và `prompt_result` local-only;
- lần theo queue `pendingPrompts` → native `follow_up` → `pendingTurns`;
- kiểm tra RPC v2 negotiation/chunk reassembly;
- kiểm tra approval `confirm/select/input/editor`;
- debug native state projection mà không ghi đè model/thinking của HON PI.

