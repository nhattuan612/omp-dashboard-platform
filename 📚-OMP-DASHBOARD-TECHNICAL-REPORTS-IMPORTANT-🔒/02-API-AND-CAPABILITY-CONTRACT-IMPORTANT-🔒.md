# 02 — API & capability contract 🔒

## 1. Quy ước chung

- Base URL: `http://127.0.0.1:4177`
- API cần cookie dashboard hợp lệ; origin/host local phải đúng.
- Lỗi trả HTTP status và code công khai. Redact stderr OMP và upstream diagnostics trong JSON, SSE status và SSE chat.
- Endpoint mutating dùng JSON body; server giới hạn body tối đa 1 MiB.
- Response thành công không có nghĩa OMP đã làm xong mọi thứ: với stream, trạng thái cuối theo SSE; với share encrypted phải có URL HTTPS thật, còn local phải có URL loopback của session.

### Nguồn model Chat và phạm vi Quota

`GET /api/v1/models` trả toàn bộ catalog model OMP, gồm OpenAI/ChatGPT và provider khác. `GET /api/v1/quota/accounts` và `/api/v1/quota/models` chỉ nhận provider OAuth `google-antigravity`; credential `google-gemini-cli`, OpenAI/ChatGPT và Anthropic không xuất hiện trong Quota. Account Antigravity được dùng khi OMP trả quota Google/Gemini và toàn bộ capability Claude/GPT (một counter shared, hoặc cả Anthropic và OpenAI); OMP có thể trả cửa sổ 5 giờ, tuần hoặc ngày. Thiếu một capability thì `canUse=false`/`entitlement_unverified`. OMP không công bố field subscription/tier, nên dashboard không suy đoán Pro/Ultra từ email hay chỉ từ tên cửa sổ quota. Query `sessionId` đọc lựa chọn riêng của chat; không chọn account thì `/quota/models` trả `409 ACCOUNT_SELECTION_REQUIRED`.

Chat dùng `modelSource: "quota"` cho toàn bộ catalog model OMP có provider `google-antigravity` thuộc account được chọn, không lọc theo tên family (Gemini/Claude/GPT). Cần `canUse=true`, tức đủ 4 bucket entitlement. Chọn thủ công là bắt buộc; `POST /api/v1/quota/switch` không có `sessionId` chỉ đặt default dashboard cho chat được tạo sau đó. Session hiện có thiếu pin/snapshot luôn trả `409 ACCOUNT_SELECTION_REQUIRED`, không được thừa kế default mới. Có `sessionId` thì switch ghim đúng credential Google Antigravity vào session bằng extension `dashboard-gemini-pin`; không fallback hoặc tự chuyển provider/account.

Chat dùng `modelSource: "omp"` để truy cập catalog OMP đa provider; OpenAI/ChatGPT và provider ngoài Google vẫn độc lập với Quota. Model thuộc `google-antigravity` vẫn ghim credential Google đã chọn để bảo toàn OAuth affinity. Quota không ghi `selected-account.json` hoặc đổi OMP terminal-global default. Google Protect ghi nhận quota nhưng không tự đổi account hoặc xoay vòng.

`GET /api/v1/quota/history` tính mọi usage Gemini/Claude/GPT gắn đúng credential và provider `google-antigravity` của account entitlement hợp lệ. Provider ngoài quota, account không đủ entitlement, model không nhận diện được và usage có credential pin không khớp bị loại, kể cả `scope=all`. Health của account Gemini chỉ nhận telemetry thuộc provider Google và không phải model Claude/GPT, nên lỗi 403/429 của provider/model khác không thể gán nhầm thành “Google từ chối quyền”. Usage chỉ được gắn khi credential pin đúng thứ tự thời gian/sequence.

Nguồn quota ưu tiên `omp usage --json`; nếu command không trả report thì dashboard dùng `omp auth-gateway check --json` của broker local, cache 60 giây. 429 lịch sử chỉ là warning khi quota live vẫn dưới 90% và Safety Guard không cooldown; quota hết/≥90%, lỗi OAuth hay cooldown hiện hành vẫn bị chặn fail-closed.

OMP công bố quota ở mức account/provider, không có entitlement riêng từng model. Catalog OMP xác nhận model khả dụng, không cam kết quota riêng cho từng model; các model family của Antigravity dùng các bucket account-level mà OMP trả về.

## 2. Capability snapshot

`GET /api/v1/omp/capabilities` (tương thích: `/api/omp/v1/capabilities`)

| Key | Giá trị | Hợp đồng UI |
|---|---|---|
| `session-actions` | `supported` | Cho dùng action có adapter server. |
| `file-reference` | `supported` | Cho picker và tạo reference file thật. |
| `stream-recovery` | `partial` | Abort/follow-up/reconnect được hỗ trợ; ACP không hỗ trợ steer giữa lượt. `sessionActions.steer` báo `unavailable`. |
| `approval` | `supported` | Hiển thị approval card khi OMP gửi confirm frame. |
| `agent-hub` | `unavailable` | ACP không công bố subagent snapshot; UI không gọi endpoint rồi giả kết quả rỗng. |
| `share` | `partial` | Encrypted chỉ copy/báo success nếu server trả `https://…`; `local` tạo URL loopback rõ mode. |
| `memory` | `supported` | Adapter/API đã có; từng session vẫn báo `off`/`supported`/`unavailable` theo backend và command registry OMP. Không bật backend. |

Capability là nguồn sự thật UI. Khi thêm một feature, phải đồng thời: có adapter thật, thêm/trạng thái capability, test error path và không cho UI báo success giả.

`memory: supported` biểu thị adapter/API/UI đã được deploy trong runtime local, không có nghĩa backend hoặc dữ liệu Memory đã bật. `GET /api/v1/sessions/:id/memory` là nguồn sự thật theo session; lần kiểm tra rollout trả `off`. Xem [12 — OMP-native Memory deployment & rollback](12-OMP-NATIVE-MEMORY-DEPLOYMENT-REPORT-IMPORTANT-🔒.md).

Browser mode hiện có `ego-browser` (partial, inject `/skill:ego-browser` vào prompt), `none` (tắt) và các adapter relay/Chrome ở trạng thái unavailable; UI phải disable mode unavailable.

## 3. Session và stream

| Endpoint | Mục đích | Ghi chú |
|---|---|---|
| `POST /api/v1/omp/prewarm` (alias: `/api/omp/v1/prewarm`) | Khởi động trước worker ACP | Cùng CWD/approval/tools với chat; không tạo session; trả `202` khi worker sẵn sàng. |
| `GET /api/v1/sessions` | Danh sách session | Trả `cwd` workspace cùng `folderId`/`folderName` nếu đã gán; thiếu `folderId` nghĩa là chat không thuộc project. |
| `POST /api/v1/sessions` | Tạo session | `folderId` dùng CWD project; nếu không có folder, dùng `cwd` chat đã chọn hoặc `OMP_DASHBOARD_GENERAL_WORKSPACE` (mặc định `~/Documents/OMP General Chat`); chat vẫn không phân loại. |
| `GET /api/v1/folders`, `POST /api/v1/folders` | Liệt kê/tạo project folder | Tạo folder bắt buộc chọn CWD là thư mục thật bên trong workspace được phép. |
| `GET /api/v1/workspaces?path=...` | Duyệt thư mục workspace | Chỉ liệt kê thư mục thật trong các workspace được phép. |
| `PATCH /api/v1/folders/:id` | Đổi CWD của project folder | Yêu cầu đường dẫn thư mục workspace thật; không đổi CWD các chat đã tồn tại. |
| `POST /api/v1/sessions/:id/action` | Rename/pin/archive/delete/fork/reconnect/share/assign_folder/unassign_folder | Body chứa `action` và dữ liệu riêng của action. |
| `POST /api/v1/sessions/:id/stream` | Gửi prompt, nhận SSE | Alias tương thích của `/api/v1/chat/stream`; lượt mới có `AbortController` + request ID. |
| `POST /api/v1/sessions/:id/abort` | Hủy lượt active | Alias tương thích của `/api/v1/chat/abort`; không active thì trả conflict/not found thay vì success giả. |
| `POST /api/v1/sessions/:id/steer` | Hướng dẫn lượt active | Endpoint tương thích; ACP không có steering giữa lượt, trả `UNSUPPORTED_ACTION`. Dùng follow-up sau khi lượt kết thúc. |
| `POST /api/v1/chat/send` | Gửi prompt và trả kết quả hoàn chỉnh | Kiểm tra options trước khi tra catalog; `409` khi quota/model hoặc request xung đột, `429` khi chạm rate limit hoặc hàng đợi đầy. |
| `POST /api/v1/chat/stream` | Gửi prompt qua SSE | Dùng chung kiểm tra model/quota và hàng đợi FIFO có giới hạn theo context. |

### Session action semantics

| Action | Kết quả thật | Điều kiện/cảnh báo |
|---|---|---|
| `rename` | Cập nhật metadata title | Không tác động nội dung OMP. |
| `pin` / `unpin` | Cập nhật metadata | Chỉ thay đổi hiển thị/ưu tiên dashboard. |
| `archive` | Đưa session vào archive | Không dùng khi cần tiếp tục session ngay. |
| `delete` | Chuyển theo policy session storage | Là action có ảnh hưởng dữ liệu; UI cần xác nhận. |
| `fork` | Tạo nhánh session | ACP `session/fork` tạo OMP session và Dashboard context riêng trên worker dùng chung; không tự merge nội dung giữa các nhánh. |
| `reconnect` | Đóng live record cũ và mở gateway bằng cùng session/CWD/tool policy | Bị từ chối nếu session có lượt active. |
| `share` | Gọi `omp share <session-file>` khi `shareMode` là `encrypted`; với `local`, lưu session URL loopback của dashboard. | Encrypted chỉ success khi parse được URL HTTPS thật; local không được quảng bá là public share. |

## 4. File reference

| Endpoint | Input | Output/điều kiện |
|---|---|---|
| `GET /api/v1/sessions/:id/files?mention=@…` | Path/mention tương đối workspace | Chỉ list các entry safe. |
| `POST /api/v1/sessions/:id/files/reference` | `{ "path": "@relative/path" }` | Trả tên/path/type/size/text/truncated/source từ file thật. |

Server không tin dữ liệu UI. File phải qua `realpath`, ở trong workspace root canonical, không phải directory, không binary/NUL/UTF-8 lỗi, không vượt giới hạn và extension được allow. Mọi path component (directory và filename) đều bị kiểm tra: từ khóa secret/credential/token/password/cookie/private key, dot segment và thư mục `backups`, `quarantine`, `node_modules` đều bị từ chối. Absolute path, `~`, `..` và symlink đi ra ngoài cũng bị từ chối.

## 5. Approval roundtrip

| Endpoint/SSE | Dữ liệu | Ý nghĩa |
|---|---|---|
| SSE event `approval` | Approval object gồm `method` và dữ liệu an toàn | OMP yêu cầu `confirm`, `select`, `input` hoặc `editor`; UI render control tương ứng. |
| `POST /api/v1/sessions/:id/approval` | Confirm: `{ "id": "…", "decision": "approve" hoặc "deny" }`; select/input/editor: `{ "id": "…", "value": "…" }` hoặc `{ "id": "…", "cancelled": true }` | Server gửi `extension_ui_response` thật về đúng gateway request. |

Server chỉ nhận các method OMP đã có adapter: `confirm`, `select`, `input`, `editor`. `approve`/`deny` map sang `confirmed`/`cancelled`; giá trị select phải thuộc options; input/editor bị giới hạn kích thước. Request chưa được phản hồi hết hạn sau 10 phút; select hết hạn gửi cancel, không tự chọn option. Approval được key theo cặp `(chat sessionId, upstream request id)` nên ID trùng giữa worker/session không ghi đè; ID không tồn tại/không còn pending phải trả lỗi.

`GET /api/v1/sessions/:id/state` trả projection an toàn của OMP (`status`, `protocolVersion`, `activeTurn`, `queuedTurns`, `messageCount`, model/thinking native nếu OMP công bố) với `settingsSource: "omp"`. UI chỉ dùng để quan sát; không đồng bộ ngược vào model/thinking settings riêng của HON PI.

## 6. Agent Hub và Share

| Endpoint | Hành vi |
|---|---|
| `GET /api/v1/sessions/:id/agents` | Agent Hub snapshot | OMP ACP hiện không công bố subagent snapshot; endpoint trả `UNSUPPORTED_ACTION`, capability `agent-hub` là `unavailable`. |
| Share qua session action | `encrypted` spawn OMP CLI với `share` và timeout 30 giây; `local` trả URL loopback rõ mode. |

Agent Hub chưa khả dụng qua ACP vì chưa có adapter snapshot/control. Share encrypted chỉ đạt khi upstream thật trả URL HTTPS; share local chỉ dùng trong dashboard local và UI phải hiển thị đúng mode.

## 7. Memory

`GET /api/v1/sessions/:id/memory` đọc backend trong CWD của session và command registry OMP; response đã sanitize. Session chưa đăng ký hoặc đã xóa trả `404`, không tạo OMP context mới:

| Field | Hợp đồng |
|---|---|
| `status` | `off` khi backend là `off`; `supported` khi backend nhận diện và OMP công bố operation native; nếu backend/command không nhận diện thì `unavailable`. |
| `backend` | `off`, `local`, `hindsight`, `mnemopi`, `sharpshooter`, hoặc `unknown`. |
| `scope` | `null` trong adapter hiện tại; không suy đoán scope khi OMP không công bố. |
| `operations` | Giao của allowlist `view`, `stats`, `diagnose`, `queue`, `sync`, `clear`, `reset`, `enqueue`, `rebuild` với built-in `memory` command/subcommands của OMP. Backend `off`/`unknown` không có operations; `clear`/`reset` bị loại với `sharpshooter` vì chưa xác minh boundary. |
| `warnings` | Cảnh báo xử lý cho action mutating và boundary `clear` theo backend. Không trả raw config, credential, stderr hoặc chẩn đoán OMP. |
| `busy` | Session đang có lượt chat hoặc Memory operation. |

`POST /api/v1/sessions/:id/memory/action` nhận duy nhất `action` trong allowlist. Dashboard gửi local command `/memory <action>` qua ACP `session/prompt`; không nhận raw command hoặc đổi backend. Payload đọc-only có thể gửi `expectedBackend`; mọi action mutating (`sync`, `enqueue`, `rebuild`, `clear`, `reset`) bắt buộc gửi `expectedBackend` và `confirmed: true`.

Ví dụ:

```json
{ "action": "stats", "expectedBackend": "local" }
```

```json
{ "action": "clear", "expectedBackend": "local", "confirmed": true }
```

Action thành công chỉ sau response khớp request xác nhận `agentInvoked: false` và có `command_output`. Response gồm `sessionId`, `action`, `backend`, `scope`, `text`, `truncated`; action mutating kèm `warning`. Output được giới hạn 200.000 ký tự, render như untrusted text, chỉ giữ trong UI session và không ghi log/dashboard persistence.

`sync`/`enqueue`/`rebuild` cảnh báo OMP có thể xử lý nội dung phiên/gọi model; `clear`/`reset` nêu boundary theo backend. Hindsight clear chỉ xóa session state/recall cache cục bộ, không xóa bank trên server. Session có chat turn, Memory operation khác, Safety Guard cooldown, backend đổi/off hoặc operation không được OMP công bố trả conflict; upstream error/timeout trả lỗi, không success giả. `off` không có nút bật backend.

OMP cũng quảng cáo nhóm lệnh `mm …`, nhưng adapter chưa expose nhóm này vì semantics/UI contract chưa được xác minh.


## 8. HTTP error nên xử lý ở UI

| Status thường gặp | Ý nghĩa | Hành động UI |
|---|---|---|
| `400` | Input/path/decision không hợp lệ | Giữ input, hiển thị validation message. |
| `401`/`403` | Cookie, origin hoặc host không hợp lệ | Reload dashboard local; không retry mù. |
| `404` | Session/approval record/gateway item không tồn tại | Refresh danh sách hoặc bỏ card stale. |
| `409` | State xung đột (gồm active chat/Memory operation hoặc backend đổi), account quota không khả dụng hoặc model/provider ngoài phạm vi khi `modelSource=quota` | Kiểm tra trạng thái session/backend; với Chat, chọn model của provider quota active hoặc đổi nguồn Chat sang `omp`. |
| `502` | OMP/upstream không trả thành quả hợp lệ | Không báo success; hiển thị retry có chủ đích. |
| `504` | Upstream hết thời gian chờ | Khuyến nghị reconnect/kiểm tra service. |
