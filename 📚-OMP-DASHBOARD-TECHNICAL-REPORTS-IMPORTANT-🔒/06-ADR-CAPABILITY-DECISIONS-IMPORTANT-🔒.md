# 06 — Quyết định kỹ thuật & phần còn partial 🔒

## ADR-01 — Không báo thành công khi chưa có adapter thật

**Bối cảnh:** UI từng có khả năng hiển thị thao tác share/agent/memory như đã hoạt động dù server không xác nhận được kết quả upstream.

**Quyết định:** Mỗi action chỉ success khi adapter trả output kiểm chứng được. Nếu thiếu adapter thì capability là `partial`/`unavailable` và control bị disable hoặc trả lỗi rõ.

**Hệ quả:** UX thận trọng hơn, nhưng operator không bị đánh lừa bởi state giả. Đây là nguyên tắc áp dụng cho mọi feature sau này.

## ADR-02 — File reference chỉ đọc workspace cấu hình

**Bối cảnh:** Duyệt theo runtime CWD đưa các file nội bộ của `~/.omp/usage-dashboard` vào picker.

**Quyết định:** Dùng `OMP_DASHBOARD_WORKSPACE` làm root picker; canonicalize bằng `realpath`; chặn escape path, hidden segment, secret-name, binary và file lớn.

**Hệ quả:** Có thể cần đặt đúng env khi chuyển dự án, nhưng đổi lại prompt không vô tình đọc runtime state. Cách đổi workspace là cập nhật plist/env rồi restart, không nới allowlist toàn máy.

## ADR-03 — Reconnect không được chen vào active turn

**Bối cảnh:** Reconnect mở lại gateway trên session đang chạy có nguy cơ bỏ stream/tool state.

**Quyết định:** `reconnect` reject khi live record/active turn còn tồn tại. Luồng recovery là abort hoặc chờ kết thúc trước, rồi reconnect.

**Hệ quả:** Có thêm một bước cho user trong lỗi mạng, nhưng không gây race condition hoặc success giả.

## ADR-04 — Chat ACP không giả lập steer giữa lượt

**Trạng thái:** Thay thế hành vi steer của Chat RPC (2026-09-26); `/api/console/*` vẫn là RPC riêng.

**Bối cảnh:** ACP chuẩn không có thao tác steer giữa lượt; gửi command RPC cũ vào context ACP sẽ báo lỗi hoặc tạo cảm giác đã nhận lệnh.

**Quyết định:** Chat công bố `sessionActions.steer=unavailable`; endpoint steer trả `UNSUPPORTED_ACTION`. Follow-up được serialize thành `session/prompt` sau khi lượt active kết thúc.

**Hệ quả:** UI chỉ báo action đã làm khi ACP xác nhận; muốn đổi nội dung lượt đang chạy thì abort hoặc chờ lượt hiện tại rồi gửi follow-up.

## ADR-05 — Approval dùng protocol UI chính thức của OMP

**Bối cảnh:** Approval/input là security boundary, không thể dựng modal rồi tự coi là đã duyệt hoặc tự suy diễn giá trị.

**Quyết định:** Nhận `extension_ui_request` với method `confirm`, `select`, `input`, `editor`; gửi `extension_ui_response` với payload đúng method; expire pending request sau 10 phút và khóa theo session/gateway.

**Hệ quả:** Quyết định và dữ liệu nhập của user đến đúng OMP gateway. Method khác chưa có adapter phải bị bỏ qua, không báo thành công giả.

## ADR-06 — Share phân biệt encrypted và local

**Bối cảnh:** Local URL session không phải public/encrypted share và không được quảng bá như URL chia sẻ qua mạng; encrypted share phải do OMP tạo.

**Quyết định:** `shareMode:"encrypted"` gọi CLI `omp share <session-file>`, parse URL HTTPS thật, timeout 30 giây. `shareMode:"local"` chỉ lưu/trả URL loopback của dashboard. Mode khác trả conflict.

**Hệ quả:** Capability `share` vẫn `partial`: encrypted phụ thuộc external side effect thật; local chỉ dành cho dashboard đang chạy trên cùng máy và UI phải hiển thị đúng mode.

## ADR-07 — Agent Hub cần snapshot adapter cho protocol đang dùng

**Trạng thái:** Chat ACP `unavailable` từ 2026-09-26; không tái sử dụng RPC snapshot như thể ACP hỗ trợ.

**Bối cảnh:** Chat gateway ACP không công bố `get_subagents` snapshot. RPC console là transport/lifecycle riêng và không chứng minh khả năng trên ACP.

**Quyết định:** Capability Agent Hub là `unavailable`; UI không gọi snapshot hay dựng danh sách rỗng giả; request trực tiếp bị từ chối.

**Hệ quả:** Chỉ bật lại khi ACP có adapter snapshot/control và test request/response/error đầy đủ.

## ADR-08 — Memory chưa có adapter (quyết định được thay thế)

**Trạng thái:** Quyết định lịch sử; được thay thế bởi ADR-12 (2026-09-24).

**Bối cảnh:** Không có adapter OMP được xác minh để lưu/đọc memory theo session với semantics rõ ràng.

**Quyết định:** Không bật memory UI hoặc local persistence thay thế.

**Hệ quả:** Không có dữ liệu “memory” mơ hồ, không có kỳ vọng sai về retention. Mở lại sau khi có adapter/contract và policy privacy.

## Điều kiện để đóng các partial

| Hạng mục | Evidence cần có trước khi đổi trạng thái |
|---|---|
| Stream recovery | Một turn thật: steer thay đổi hành vi, abort dừng, reconnect khôi phục đúng session; đo quota có chấp thuận. |
| Share | `omp share` trả HTTPS URL thật; mở/kiểm tra URL theo policy; xác nhận collab nếu muốn hỗ trợ collaboration. |
| Agent Hub | Có subagent thật xuất hiện; protocol action control được xác nhận và test deny/error/retry. |
| Memory | Adapter native/API/UI đã deploy (2026-09-24); runtime backend hiện `off`. Backend mới/phạm vi mới cần contract chính thức, privacy review và test lifecycle. Bật backend hoặc chạy mutation thật cần operator approval. |

Nguyên tắc release: không nâng `partial` thành `supported` chỉ vì UI đẹp hoặc endpoint trả 200; phải có output upstream thật và test thất bại an toàn.

## ADR-09 — Active queue phải giữ một native OMP stream

**Bối cảnh:** Gửi prompt mới khi turn đang chạy tạo hai stream cạnh tranh cùng context, làm lệch tool state, approval và transcript.

**Quyết định:** Queue của HON PI gửi native `follow_up` vào stream hiện tại; server theo dõi `pendingTurns`; chỉ terminal `agent_end` hoặc local-only `prompt_result` mới đóng SSE.

**Hệ quả:** Queue giữ được context OMP và tránh parallel turn. Contract bắt buộc phải kiểm tra nhiều follow-up, intermediate event và retry khi follow-up lỗi.

## ADR-10 — Model/thinking của HON PI tách khỏi native state projection

**Bối cảnh:** OMP có thể trả model/thinking trong state hoặc transcript, nhưng HON PI đang có controls và semantics riêng cho hai setting này.

**Quyết định:** `model` và `thinking` do HON PI validate/điều khiển; `/state` chỉ project native state với `settingsSource:"omp"` và không ghi đè `state.activeModel`/`state.thinking`.

**Hệ quả:** Có hai nguồn state có chủ đích: settings điều khiển từ HON PI và native observation từ OMP. Session switch phải reset projection để không hiển thị state stale.

## ADR-11 — RPC v2 chunk phải reassemble có giới hạn và đúng thứ tự

**Bối cảnh:** Native frame lớn có thể vượt một JSONL line; ghép chunk không kiểm tra sẽ làm lẫn frame hoặc tạo memory amplification.

**Quyết định:** Negotiation lên protocol v2 khi OMP quảng cáo hỗ trợ; bridge giữ một reassembly slot theo context, kiểm tra `chunkId/index/count/byteLength`, UTF-8/JSON và giới hạn 64 MB; chunk xen kẽ/sai thứ tự bị reject.

**Hệ quả:** An toàn với giả định OMP serialize RPC turn trong context. Nếu upstream hỗ trợ concurrent chunk streams, phải đổi contract sang correlation nhiều slot trước khi triển khai.

Chi tiết flow, state registry, verification và handoff nằm trong [10 — OMP Chat parity flow & handoff](10-OMP-CHAT-PARITY-FLOW-AND-HANDOFF-IMPORTANT-🔒.md).

## ADR-12 — Memory dùng native OMP, không tạo kho dashboard

**Bối cảnh:** ADR-08 ghi nhận trạng thái trước khi có contract transport đã xác minh. OMP 18.3 công bố built-in `memory` cùng operation qua RPC; fake-OMP contract và UI flow cô lập kiểm tra adapter, output và boundary.

**Quyết định:** OMP tiếp tục sở hữu backend, dữ liệu và lifecycle. Adapter chỉ dùng command/subcommand đã allowlist theo CWD của session; `mm …` và raw command không được expose. Capability `memory:supported` mô tả adapter đã deploy, không hàm ý backend được bật; từng session vẫn báo `off`/`supported`/`unavailable` theo OMP. `off` không có đường bật từ UI. Mutations yêu cầu `expectedBackend` và xác nhận rõ; active chat, Safety Guard cooldown, backend đổi hoặc operation không được công bố sẽ bị chặn. Unknown session trả `404`, không tạo OMP context. Hindsight clear chỉ nêu xóa session state/recall cache cục bộ; Sharpshooter không expose clear/reset. Output chỉ hiển thị tạm thời dưới dạng untrusted text, không vào log hoặc dashboard persistence.

**Hệ quả:** Memory adapter/API/UI đã được xác nhận trên live runtime; backend production vẫn `off`, không đổi cấu hình và không có Memory operation thật trong rollout. Rollback snapshot cùng lệnh được ghi tại [12 — OMP-native Memory deployment & rollback](12-OMP-NATIVE-MEMORY-DEPLOYMENT-REPORT-IMPORTANT-🔒.md). Bật backend, gọi model-backed processing hoặc mutation trên Memory thật cần operator approval. Backend mới hoặc semantics mới cần contract, privacy review và isolated lifecycle tests trước khi expose.

## ADR-13 — Project folder phải gắn với workspace thật, chat generic luôn unassigned

**Bối cảnh:** Folder chỉ có ý nghĩa khi xác định được thư mục làm việc; tự gán một chat mới vào project cũ có thể đổi CWD và phạm vi đọc/ghi ngoài ý muốn.

**Quyết định:** Tạo project folder bắt buộc chọn một thư mục thật trong workspace được phép. Chat tạo với `folderId` dùng CWD đã lưu của project; chat không có `folderId` vẫn unassigned. Assign/unassign chỉ đổi metadata hiển thị, không đổi CWD của chat hiện có.

**Hệ quả:** Lịch sử chat giữ folder metadata; project chat mới chạy tại workspace đã chọn; chat generic không bị tự gán và không kế thừa CWD project ngẫu nhiên.

## ADR-14 — Quota chỉ quản lý Gemini OAuth; account được ghim thủ công theo chat (ranh giới provider được ADR-15 thay thế)

**Bối cảnh:** Catalog OMP có nhiều provider và account ChatGPT, nhưng Quota chỉ có ý nghĩa với quota Google Gemini. Dùng chung terminal-global selection hoặc tự xoay account sẽ làm thay đổi chat ngoài ý muốn.

**Quyết định:** Quota chỉ liệt kê tài khoản OAuth `google-antigravity`/`google-gemini-cli`. Default Gemini được lưu cục bộ cho chat mới; `sessionId` ghim đúng Gemini OAuth credential cho chat qua extension `dashboard-gemini-pin`. Extension giới hạn resolver vào credential ID chính xác và fail closed nếu account/extension không còn. Không có fallback/auto-rotation; không ghi OMP `selected-account.json` hoặc terminal-global default. Nguồn Chat `omp` tiếp tục dùng catalog OMP đầy đủ, độc lập với Quota.

**Hệ quả:** Account Gemini phải được chọn thủ công; chat có pin stale không tự kế thừa account khác. OpenAI/ChatGPT vẫn dùng OMP selection riêng; nếu extension local thiếu, Gemini generation bị từ chối thay vì chạy không có affinity.

## ADR-15 — Quota chỉ nhận Google Antigravity và toàn bộ catalog provider

**Bối cảnh:** OMP báo usage `Google` theo ngày nhưng không có Gemini 5 giờ/tuần cho một số tài khoản; các báo cáo này không chứng minh account đủ quota để dùng. Ngược lại, OMP catalog có thể expose model Claude/GPT dưới cùng provider `google-antigravity`. Lọc theo tên model che mất các family này, còn nhận credential provider khác sẽ nhầm account OAuth.

**Quyết định:** Supersede ranh giới provider của ADR-14: Quota chỉ nhận provider `google-antigravity`, giữ account có usage trong danh sách nhưng `canUse=false` nếu thiếu Gemini 5 giờ hoặc tuần. Chỉ hai Gemini window này đủ điều kiện theo profile Pro/Ultra đã xác nhận; metadata OMP hiện không cung cấp tên plan. Catalog Quota gồm mọi model OMP có provider khớp chính xác `google-antigravity`, bất kể tên family, và chat ghim đúng credential của account được chọn. Không đưa Google Gemini CLI hay credential OpenAI/Anthropic riêng vào Quota.

**Hệ quả:** Account daily-only/thiếu window vẫn nhìn thấy nhưng không chọn hoặc chat được. Model Claude/GPT do Antigravity expose được dùng cùng OAuth Google và quota account-level; quota không được suy diễn thành entitlement riêng cho từng model. Catalog OMP ngoài Quota vẫn giữ các provider khác.

