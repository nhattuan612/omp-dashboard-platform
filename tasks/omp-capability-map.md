# OMP 18.2.7 capability map

> **Historical only — không dùng làm source of truth cho `/chat` kể từ 2026-09-29.** Binary hiện tại là OMP 18.3.2; kế hoạch thay thế và audit mới ở `tasks/omp-tools-sidebar-plan-2026-09-29.md`.

Ngày kiểm chứng: 2026-09-22  
Binary: `/Users/trannhattuan/.bun/bin/omp` (`omp/18.2.7`)  
Runtime: `/Users/trannhattuan/.omp/usage-dashboard/server.mjs` + `console-bridge.mjs`  
Phạm vi: kiểm tra read-only bằng `omp --mode rpc`, không gửi prompt/model generation.

## Kết luận để UI dùng

UI chỉ được hiển thị capability khi có cả route của runtime và command OMP tương ứng. `supported` trong bảng dưới nghĩa là đã thấy command/transport thật; không có nghĩa action đã được expose an toàn trên `/chat`.

| Capability | OMP evidence | Runtime route/command | Trạng thái UI production |
|---|---|---|---|
| Model catalog | RPC `get_available_models`; probe trả 118 model | `GET /api/v1/models`; gateway command `get_available_models` | **Supported** |
| Chọn model | RPC command `set_model`; `applyChatModel()` dùng command này | `POST /api/v1/chat/send`, `GET/POST /api/v1/chat/stream` nhận `model`; gateway `set_model` | **Supported qua chat request**, chưa có selector đầy đủ |
| Chat final response | RPC `prompt`, nhận `message_end`/`turn_end` | `POST /api/v1/chat/send` | **Supported** |
| Chat streaming | RPC `prompt` + bridge SSE; frame `message_update`/`message_end` | `GET/POST /api/v1/chat/stream`; events `start/delta/end/error` | **Supported** |
| Dừng lượt | RPC `abort` | `POST /api/v1/chat/abort`; gateway `POST /sessions/:id/abort` | **Supported** |
| Danh sách session | ACP `omp acp`, `_omp/sessions/listAll` | `GET /api/v1/sessions`; `/api/console/sessions` | **Supported**, local JSONL + metadata |
| Đọc message | Đọc OMP session JSONL | `GET /api/v1/sessions/:id/messages` | **Supported** |
| Tạo session | RPC `new_session` / gateway context | `POST /api/v1/sessions`; gateway `POST /sessions` | **Supported** |
| Đổi tên | RPC `set_session_name` | `POST /api/v1/sessions/:id/action` `rename`; `/api/console/session` `rename` | **Supported** |
| Pin/unpin, read/unread | Metadata local, không có command cần gọi provider | `POST /api/v1/sessions/:id/action` | **Supported** |
| Archive/delete | Di chuyển JSONL vào `~/.omp/agent/archive|trash/console-sessions` | `POST /api/v1/sessions/:id/action` | **Supported**, cần UI refresh |
| Fork | RPC `new_session` với `parentSession` | session action `fork`; console action `fork` | **Queued/partial**: response có child metadata nhưng cần xác nhận OMP đã tạo child |
| File reference | `get_available_commands`/console bridge có `listFiles` | `GET /api/console/files`; prompt gateway | **Partial**; không phải upload |
| Tool read/write/edit/grep/glob/bash/eval | `get_state.dumpTools` hiện tại có: `read,bash,edit,eval,glob,grep,task,hub,todo,web_search,write` | RPC raw `/api/console/command`; gateway `/sessions/:id/command` chỉ allow command types | **Bridge-supported**, chưa hiển thị nút tool trên production Chat |
| Agent task | RPC tool `task` hiện enabled; `omp agents` CLI quản lý bundled agents | gateway command `get_subagents`, `get_subagent_messages`; `/api/v1/sessions/:id/agents` | **Partial**: live QA created bundled `QaAgent`; read-only snapshot, no control adapter |
| Agent Hub | RPC tool `hub` hiện enabled; Agent Hub là tool runtime, không phải slash command API | `/api/v1/sessions/:id/agents`; raw `get_subagents` | **Partial/read-only**: real agent observed and completed; control actions disabled |
| Ego Browser | OMP skill `/skill:ego-browser` | `gatewayPrompt` prefixes skill; chat prompt is the production entry | **Supported for chat order**; relay/Chrome/Electron unavailable |
| Computer use | Model hiện tại `gemini-3.8-flash` báo `supportsComputerUse: false`; `dumpTools` không có `computer` | Không có route UI | **Unavailable** |
| Approval | CLI hỗ trợ `--approval-mode=always-ask|write|yolo`; OMP emits `confirm` and `select` frames | SSE approval event + `POST /api/v1/sessions/:id/approval` | **Partial/supported roundtrip**: real approve/deny passed; select adapter forwards option value |
| Share URL | OMP CLI có `omp share SESSION [--gist]`; slash command `share` có trong catalog | Session action `share` returns local loopback or controlled HTTPS URL | **Local supported; encrypted partial**; Collab unavailable |
| Export HTML | RPC command `export_html` | `/api/console/session` action `export`; gateway `command` | **Partial**: chưa có artifact URL trả về |
| Handoff | Slash command `handoff`; gateway command allow-list có `handoff` | gateway `POST /sessions/:id/command` | **Bridge-supported**, chưa có UX production |
| Approval/tool queue/terminal | Có mô tả CLI/tool trong OMP, nhưng không có production adapter hoàn chỉnh | Không có route an toàn tương ứng trên `/api/v1` | **Hidden** |

## Probe thực tế OMP

Lệnh read-only đã dùng:

```sh
omp --version                 # omp/18.2.7
omp --mode rpc                # JSONL bridge
```

RPC commands đã gọi trong context mới: `get_available_commands`, `get_available_models`, `get_login_providers`, `get_state`, `get_subagents`, `get_session_stats`.

Kết quả đáng chú ý:

- Model hiện tại: `gemini-3.8-flash`, provider `google-antigravity`, `supportsComputerUse=false`, reasoning level `high`.
- Model catalog: 118 model.
- Provider `google-antigravity`: `authenticated=true`; các provider khác không được dùng làm fallback tự động.
- Tool runtime đang bật: `read`, `bash`, `edit`, `eval`, `glob`, `grep`, `task`, `hub`, `todo`, `web_search`, `write`.
- `get_subagents`: không có subagent đang chạy.
- OMP slash command catalog có `share`, `browser`, `session`, `handoff`, `tools`, `model`, `switch`, `task`/skills và `security`.

Không ghi prompt, token, cookie, credential hoặc raw credential response vào tài liệu này.

## Mapping route hiện có

| Route | Adapter thật |
|---|---|
| `GET /api/v1/models` | Tạo context tạm, gửi `get_available_models`, normalize rồi đóng context |
| `GET /api/v1/sessions` | `ConsoleBridge.listSessions()` → `omp acp` → `_omp/sessions/listAll` + JSONL summary |
| `GET /api/v1/sessions/:id/messages` | `readPersistedChatSession()` + cache runtime |
| `POST /api/v1/sessions/:id/action` | `set_session_name`, local metadata, move JSONL, `new_session parentSession`, `export_html` |
| `POST /api/v1/chat/send` | `ensureChatSession` → `set_model` → `prompt` → collect final message |
| `GET/POST /api/v1/chat/stream` | Cùng adapter, phát SSE `start/delta/end/error` |
| `POST /api/v1/chat/abort` | `abort` vào context đang chạy |
| `POST /api/omp/v1/sessions/:id/prompt` | Raw prompt, có thể prefix `/skill:ego-browser` khi caller yêu cầu |
| `POST /api/omp/v1/sessions/:id/command` | Chỉ command trong `GATEWAY_COMMANDS`; cần UI/adapter tự chịu trách nhiệm capability |
| `GET /api/omp/v1/sessions/:id/events` | SSE raw bridge frame |
| `GET /api/console/events` | SSE raw bridge frame cho console host-side |

## Các giới hạn còn lại sau focused QA

1. Capability catalog phải tiếp tục phân biệt `observed`/`declared`; UI không bật capability chưa có adapter thật.
2. Encrypted share vẫn phụ thuộc `omp share` trả external HTTPS URL hợp lệ; local share chỉ loopback.
3. Approval `confirm`/`select` roundtrip đã chạy thật; approval modes khác vẫn phải giữ theo capability status.
4. `GATEWAY_COMMANDS` là allow-list transport, không phải bằng chứng mọi command đã thành công; chỉ báo success sau response OMP.
5. Stream recovery còn `partial`; relay/Chrome/Electron, Collab share và Agent Hub control adapter chưa có.

## Nguyên tắc triển khai

- Loopback-only; không mở raw gateway ra mạng.
- Capability endpoint chỉ xuất metadata/enum/status, không xuất secret và không echo payload.
- UI chỉ render action có `status: supported` và route đã kiểm thử; `partial`/`unavailable` không được hiển thị như thành công.
- Khi OMP context thay đổi tool/model, probe lại `get_state` và `get_available_models`; không hardcode demo.

## 2026-09-22 — Probe CLI thật và allowlist tool production

### Quy tắc giữ trạng thái tool

- Tool được chọn là allowlist của từng OMP session, không phải cờ tạm của một prompt.
- Gửi thêm order trong cùng session giữ nguyên allowlist; toggle chỉ áp dụng từ lượt kế tiếp sau khi context được dựng lại an toàn.
- Chat mới nhận lựa chọn hiện tại của giao diện; session cũ khôi phục danh sách đã lưu trong metadata.
- UI dùng switch có mô tả tiếng Việt theo Design System; khi backend đang restart context, mọi switch tạm khóa và lỗi được hoàn tác về trạng thái trước đó.

Đã kiểm tra binary `/Users/trannhattuan/.bun/bin/omp` bằng `omp/18.2.7` và chạy đúng một lượt an toàn:

```text
omp -p --no-session --mode json --approval-mode always-ask --thinking medium "Trả lời đúng một từ: OK"
→ provider google-antigravity / model gemini-3.8-flash / output OK
```

`--tools` của OMP đã được probe trực tiếp. Allowlist hợp lệ trong RPC hiện tại là:

```text
read, write, edit, ast_edit, grep, glob, bash, eval, lsp, debug,
task, hub, web_search, todo, goal, init_experiment, run_experiment,
log_experiment, update_notes
```

Các tên `browser`, `ask`, `fetch`, `computer`, `github`, `memory`, `security_scan`, `tts`, `generate_image`, `ast_grep` không hợp lệ cho `--tools` của context này; không đưa vào drawer Công cụ. Browser Relay/Ego Browser giữ ở nhóm Browser mode vì đó là runtime/skill, không phải tool ID.

Runtime đã nối allowlist thật vào `omp --tools=<csv>` khi tạo RPC context. Drawer Công cụ dùng checkbox thật; action `tools` restart context an toàn, giữ session path và lưu allowlist vào metadata. Session cũ không có context sẽ tự dựng context trước khi áp dụng toggle. `GET /api/v1/omp/capabilities` hiện trả đúng 19 tool hợp lệ, `canToggle: true`; UI live phản ánh Todo tắt theo metadata session. Không gửi thêm prompt model trong lúc kiểm chứng toggle.
