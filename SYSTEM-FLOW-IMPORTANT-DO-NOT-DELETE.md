# 🧭 Hòn π · OMP Dashboard — 🔴 IMPORTANT — DO NOT DELETE

> Sơ đồ nghiên cứu và sửa lỗi lưu tại Local. File này không đưa lên GitHub cùng gói sản phẩm.

## 1. Ký hiệu bảo vệ file

| Icon | Mức độ | Quy tắc |
|---|---|---|
| 🔴 | Critical | Không xóa/sửa nếu chưa hiểu luồng; mất file là mất runtime hoặc giao diện chính. |
| 🟠 | Important | Có thể thay đổi có kiểm thử; dùng để vận hành, cài đặt, kiểm tra. |
| 🟢 | Product | Được phép đóng gói cho người dùng cuối. |
| 🔵 | Runtime | Chạy tại máy local trong `~/.omp`; không commit state/credential. |
| ⚪ | Research | Chỉ nghiên cứu local; không đưa vào package public/private product. |
| 🚫 | Exclude | Tuyệt đối không đẩy: tài liệu nội bộ, log, state, session, token, credential, backup. |

## 2. Sơ đồ tổng thể: từ người dùng đến OMP/Gemini

```mermaid
flowchart LR
  U[👤 Người dùng] --> B[🌐 Browser local<br/>127.0.0.1:4177]

  subgraph DASH[🟢 Dashboard product]
    C[🟢 /chat<br/>honpi-chat-dashboard-SKE.html]
    Q[🟢 /quota<br/>honpi-quota-dashboard-SKE.html]
    CJ[🟢 Chat live bridge<br/>honpi-chat-dashboard-live.js]
    CL[🟢 Chat compatibility<br/>honpi-chat-dashboard-legacy.js]
  end
  B --> C
  B --> Q
  C --> CJ
  C --> CL

  subgraph HTTP[🔴 Local API boundary — server.mjs]
    SEC[🔴 Host/Origin + CSP + nonce<br/>cookie/request-id/rate-limit]
    CHATAPI[🟢 Chat/session API<br/>/api/v1/*]
    QUOTAAPI[🟢 Quota API<br/>/api/v1/quota/*]
    CONSOLEAPI[🟢 OMP Console API<br/>/api/console/*]
    GATEWAY[🟢 OMP Gateway<br/>/api/omp/v1/*]
    CAPS[🟠 Capability contract<br/>/api/omp/v1/capabilities]
  end
  C --> SEC --> CHATAPI
  Q --> SEC --> QUOTAAPI
  C --> SEC --> CONSOLEAPI
  C --> SEC --> GATEWAY
  C --> SEC --> CAPS

  subgraph BRIDGE[🔴 Runtime bridge]
    CB[🔴 console-bridge.mjs<br/>ACP/RPC lifecycle + event stream]
    LOCK[🔴 Safety Guard<br/>account protection + concurrency 1]
    OMP[🔴 ~/.bun/bin/omp<br/>OMP agent process]
  end
  CHATAPI --> CB
  CONSOLEAPI --> CB
  GATEWAY --> CB
  QUOTAAPI --> LOCK
  CB --> LOCK
  CB --> OMP

  subgraph DATA[🔵 Local data and state — never package]
    SESS[🔵 ~/.omp/agent/sessions<br/>session JSONL/transcript]
    DB[🔵 ~/.omp/agent/agent.db<br/>OMP index]
    CRED[🚫 OAuth/credential store<br/>account tokens]
    STATE[🔵 ~/.omp/usage-dashboard/<br/>state + selected account + history]
    LOG[🚫 ~/.omp/logs + archive/trash<br/>runtime logs/session archive]
  end
  OMP --> SESS
  OMP --> DB
  OMP --> CRED
  CB --> SESS
  QUOTAAPI --> STATE
  LOCK --> STATE
  OMP --> LOG

  subgraph PROVIDER[☁️ External provider]
    GEM[☁️ Gemini/Google OAuth + quota]
    MODEL[☁️ Gemini model execution]
  end
  CRED --> GEM
  OMP --> GEM
  GEM --> MODEL
```

## 3. Các vùng và file chịu trách nhiệm

| Vùng | File/thành phần | Vai trò | Mức |
|---|---|---|---|
| UI Chat | `honpi-chat-dashboard-SKE.html` | Layout, vùng chat, modal, header, quota summary, action buttons | 🔴🟢 |
| UI Chat runtime | `honpi-chat-dashboard-live.js` | Gọi API, SSE stream, render delta/tool/event, session state | 🔴🟢 |
| UI Chat compatibility | `honpi-chat-dashboard-legacy.js` | Fallback action và tương thích browser/contract cũ | 🟠🟢 |
| UI Quota | `honpi-quota-dashboard-SKE.html` | Account cards, quota windows, history, protection panel | 🔴🟢 |
| API/runtime | `~/.omp/usage-dashboard/server.mjs` | HTTP server, route, validation, auth boundary, session/quota orchestration | 🔴🔵 |
| OMP bridge | `~/.omp/usage-dashboard/console-bridge.mjs`, `acp-worker.mjs`, `acp-session-context.mjs` | Shared ACP worker pool, per-chat session routing; RPC console lifecycle remains separate | 🔴🔵 |
| OMP binary | `~/.bun/bin/omp` | Agent loop, model/provider, tool execution | 🔴🔵 |
| LaunchAgent | `~/Library/LaunchAgents/com.trannhattuan.omp-usage-dashboard.plist` | Tự khởi động server sau login | 🟠🔵 |
| Deploy script | `deploy-local-dashboard.sh` | Backup và đồng bộ runtime package assets vào target local | 🟠⚪ |
| Tests | `test-runtime-security.sh`, `test-mock-api.js` | Smoke/security/mock verification | 🟠⚪ |
| Schema | `api-schema.json` | Contract tham khảo cho API | ⚪ |
| Research docs | `tasks/`, `*.md`, handoff/notes | Phân tích, bàn giao, nghiên cứu | ⚪🚫 |

## 4. Flow /chat và toàn bộ action

```mermaid
flowchart TD
  C0[🏠 Mở /chat] --> C1[GET /api/v1/models]
  C0 --> C2[GET /api/v1/sessions]
  C0 --> C3[GET /api/v1/quota/overview]
  C0 --> C4[GET /api/omp/v1/capabilities]
  C1 --> C5[Hiển thị model/thinking/tools]
  C2 --> C6[Hiển thị session list + unread/pin/archive]
  C3 --> C7[Header quota + account availability]
  C4 --> C8[Feature status: supported/partial/unavailable]

  C9[➕ New session] --> A1[POST /api/v1/sessions]
  C10[📂 Chọn session] --> A2[GET /api/v1/sessions/:id/messages]
  C11[✏️ Rename] --> A3[PATCH /api/v1/sessions/:id]
  C12[📌 Pin/unpin] --> A4[PATCH /api/v1/sessions/:id]
  C13[📖 Read/unread] --> A5[PATCH /api/v1/sessions/:id]
  C14[🗄 Archive] --> A6[POST /api/v1/sessions/:id/action]
  C15[🗑 Delete/trash] --> A7[POST /api/v1/sessions/:id/action]
  C16[🧬 Fork] --> A8[POST /api/v1/sessions/:id/action → ACP session/fork]
  C17[🔗 Share local] --> A9[POST /api/v1/sessions/:id/action]

  C18[💬 Send prompt] --> V1[Validate message/model/images]
  V1 --> V2[GET protect-status + quota preflight]
  V2 --> V3[Ensure OMP context/session]
  V3 --> V4[Set model/thinking/fast/tools/approval/browser mode]
  V4 --> V5[POST /api/v1/chat/stream]
  V5 --> V6[SSE start/lifecycle/delta/tool/end/error]
  V6 --> V7[Render text/tool/approval/usage in chat]
  V7 --> V8[Persist transcript + schedule quota refresh]
  V6 -->|429/quota| E1[Show quota blocked + account guidance]
  V6 -->|approval| E2[Approve/deny tool action]
  V6 -->|error| E3[Structured error + request-id]

  C19[⏹ Abort] --> A10[POST /api/v1/chat/abort]
  C20[↩ Retry] --> A11[Requeue original prompt → POST /api/v1/chat/stream]
  C21[🧭 Follow-up; steer unavailable] --> A12[POST /api/v1/sessions/:id/action {action: follow_up}]
  C22[📎 File reference] --> A13[GET/POST /api/v1/sessions/:id/files]
  C23[⌘ OMP command/tool config] --> A14[POST /api/omp/v1/sessions/:id/command]
  C24[🧩 Agent Hub unavailable] --> A15[Read capability; do not request fake snapshot]
  C25[🛡 Safety/approval] --> A16[SSE approval + POST /api/v1/sessions/:id/approval]

  A1 & A2 & A3 & A4 & A5 & A6 & A7 & A8 & A9 & A10 & A11 & A12 & A13 & A14 & A15 & A16 --> S[🔴 server.mjs validation + route]
  S --> B[🔴 console-bridge.mjs]
  B --> ACP[🔴 Shared Chat ACP worker pool]
  ACP --> O[🔴 OMP ACP sessions]
  CONSOLEAPI[Legacy Console API] --> RPC[🟠 Separate RPC contexts]
  RPC --> ORPC[🟠 OMP RPC process]
  O --> R[🔵 sessions/agent.db/logs]
```

## 5. Flow /quota và toàn bộ action

```mermaid
flowchart TD
  Q0[🏠 Mở /quota] --> Q1[GET /api/v1/quota/accounts]
  Q0 --> Q2[GET /api/v1/quota/overview]
  Q0 --> Q3[GET /api/v1/quota/history]
  Q0 --> Q4[GET /api/v1/quota/protect-status]
  Q1 --> Q5[Account cards + active account]
  Q2 --> Q6[Gemini 5h/week + Claude 5h/week]
  Q3 --> Q7[Token/request history + model]
  Q4 --> Q8[Safety Guard + nextRequestAllowed]

  Q9[🔄 Refresh/sync] --> R1[POST /api/v1/quota/sync]
  R1 --> R2[OMP account quota lookup]
  R2 --> R3[Update state.json/history]
  R3 --> Q1 & Q2 & Q3 & Q4

  Q10[⭐ Chọn account] --> R4[POST /api/v1/quota/switch]
  R4 --> R5[Persist selected-account.json]
  R5 --> R6[Recompute protected account + routing]

  Q11[➕ Thêm account/Login] --> R7[POST /api/login]
  R7 --> R8[OMP OAuth browser flow]
  R8 --> R9[Credential store + refresh quota]

  Q12[🗑 Remove account] --> R10[DELETE /api/v1/quota/accounts/:id]
  R10 --> R11[Validate target + remove OAuth credential]
  R11 --> R12[Clear selected account if needed]

  Q13[🛡 Protect toggle/config] --> R13[POST /api/v1/quota/protect-config]
  R13 --> R14[Validate mode/concurrency]
  R14 --> R15[Persist protect-config.json]
  R15 --> R16[Chat preflight enforces nextRequestAllowed]

  R2 & R4 & R7 & R10 & R13 --> S[🔴 server.mjs + ConsoleBridge]
  S --> O[🔵 OMP + Google/Gemini]
```

## 6. Contract, bảo mật và trạng thái capability

```mermaid
flowchart LR
  REQ[Browser request] --> H[Host/Origin allowlist]
  H --> C[Cookie + request-id + rate limit]
  C --> V[Body/query/path validation]
  V --> R[Route handler]
  R --> E[Structured JSON/SSE error]
  R --> LOG[Runtime log without credential]
  R --> OUT[Response]

  CAP[GET /api/omp/v1/capabilities] --> SUP[✅ supported]
  CAP --> PAR[🟠 partial: share]
  CAP --> UNA[⚠ unavailable: steer + Agent Hub]
  CAP --> MEM[🟡 memory adapter supported; backend/runtime state is separate]
```

Chat source workspace now uses ACP worker pooling; `/api/console/*` retains a separate RPC lifecycle. The installed LaunchAgent is unchanged by this local implementation. Verification here covered 86 isolated chat/API scenarios, ACP worker regressions, browser draft prewarm, and real OMP ACP session create/close without sending a model prompt. Earlier live-runtime smoke remains historical evidence; this task did not deploy or verify a real model turn.

## 7. Đóng gói GitHub

```text
🟢 product-release/
├── 🔴 server.mjs                         # runtime API
├── 🔴 console-bridge.mjs                 # worker pool + RPC console boundary
├── 🔴 acp-worker.mjs                     # ACP process and JSONL routing
├── 🔴 acp-session-context.mjs            # independent OMP session per chat
├── 🔴 gemini-account-pin-extension.mjs   # per-session Google account pin
├── 🔴 honpi-chat-dashboard-SKE.html      # /chat
├── 🔴 honpi-quota-dashboard-SKE.html     # /quota
├── 🟢 honpi-chat-dashboard-live.js       # chat live behavior
├── 🟢 honpi-chat-dashboard-legacy.js     # compatibility behavior
├── 🟠 install-local-dashboard.sh         # install to ~/.omp/usage-dashboard
├── 🟠 PRODUCT-MANIFEST.json              # machine-readable product allowlist
└── 🟠 .gitignore                         # excludes state/log/credential/backup
```

`SYSTEM-FLOW-IMPORTANT-DO-NOT-DELETE.md`, task notes, handoff files, mock data, tests, screenshots, local state, LaunchAgent generated for this Mac, OAuth/token/credential, logs and backups stay Local and are not part of the product push.
