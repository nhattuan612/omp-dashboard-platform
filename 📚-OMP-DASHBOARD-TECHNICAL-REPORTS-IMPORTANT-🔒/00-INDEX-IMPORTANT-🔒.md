# OMP Dashboard — bộ tài liệu kỹ thuật nội bộ 🔒

**Cập nhật:** 2026-09-28 (Asia/Ho_Chi_Minh)
**Phạm vi:** runtime OMP Usage Dashboard tại máy local; không phải tài liệu phát hành cho khách hàng.  
**Mục đích:** tra cứu nhanh khi vận hành, sửa lỗi, kiểm thử capability và bàn giao kỹ thuật.

> Không đưa thư mục này vào `product-release` hoặc GitHub product. Tài liệu chỉ nêu tên biến/đường dẫn/cấu trúc; không chứa token, cookie, CA bundle, log hội thoại hoặc nội dung phiên thật.

## Đọc theo mục đích

| Cần làm gì | Mở tài liệu |
|---|---|
| Hiểu các process, vùng lưu trữ, bảo mật và biến môi trường | [01 — Kiến trúc & runtime](01-ARCHITECTURE-AND-RUNTIME-IMPORTANT-🔒.md) |
| Tích hợp UI/API, biết HTTP status và capability nào dùng được | [02 — API & capability](02-API-AND-CAPABILITY-CONTRACT-IMPORTANT-🔒.md) |
| Lần theo một thao tác từ click đến OMP | [03 — Flow end-to-end](03-END-TO-END-FLOWS-IMPORTANT-🔒.md) |
| Tra cứu state, biến, giới hạn kích thước và timeout | [04 — State, biến & giới hạn](04-STATE-VARIABLES-AND-LIMITS-IMPORTANT-🔒.md) |
| Restart, test, xử lý sự cố hoặc rollback | [05 — Vận hành, test & rollback](05-OPERATIONS-TESTS-AND-ROLLBACK-IMPORTANT-🔒.md) |
| Hiểu lý do các quyết định và các phần còn partial | [06 — Quyết định kỹ thuật](06-ADR-CAPABILITY-DECISIONS-IMPORTANT-🔒.md) |
| Quy trình nâng cấp, vai trò file & hướng dẫn cho AI | [07 — Phát triển, nâng cấp & cẩm nang AI](07-DEVELOPMENT-UPGRADE-AND-WORKFLOW-GUIDE-IMPORTANT-🔒.md) |
| Session isolation / cross-project security boundary | [08 — Session isolation & cross-project security](08-SESSION-ISOLATION-AND-CROSS-PROJECT-SECURITY-IMPORTANT-🔒.md) |
| Approval mode UI, palette và flow approval timeout | [09 — Approval mode palette & flow](09-APPROVAL-MODE-PALETTE-AND-FLOW-IMPORTANT-🔒.md) |
| Hiểu full OMP Chat parity turn flow, state invariants và handoff | [10 — OMP Chat parity flow & handoff](10-OMP-CHAT-PARITY-FLOW-AND-HANDOFF-IMPORTANT-🔒.md) |
| Điều tra lỗi tạo ảnh, model image-output và prompt handoff | [11 — Image generation output fix & session handoff](11-IMAGE-GENERATION-OUTPUT-FIX-AND-SESSION-HANDOFF-IMPORTANT-🔒.md) |
| Tra cứu rollout Memory native, live verification và rollback | [12 — OMP-native Memory deployment & rollback](12-OMP-NATIVE-MEMORY-DEPLOYMENT-REPORT-IMPORTANT-🔒.md) |
| Kiểm tra concurrency, queue và QA ego-browser | [13 — Chat concurrency, queue isolation và ego-browser QA](13-CHAT-CONCURRENCY-QUEUE-AND-EGO-QA-REPORT-IMPORTANT-🔒.md) |
| Tra cứu sửa Quota/Chat và bằng chứng kiểm chứng | [14 — Quota & Chat repair verification](14-CHAT-QUOTA-REPAIR-AND-VERIFICATION-REPORT-IMPORTANT-🔒.md) |
| Theo dõi ACP worker pool, queue, deploy và lịch sử | [15 — ACP worker pool: triển khai, kiểm chứng và lịch sử](15-ACP-WORKER-POOL-IMPLEMENTATION-AND-DEPLOYMENT-HISTORY-IMPORTANT-🔒.md) |
| Đối chiếu trạng thái trước khi đăng nhập lại Quota | [15 — Quota auth baseline](15-QUOTA-AUTH-BASELINE-2026-09-27-171244-IMPORTANT-🔒.md) |
| Xác minh Quota sau đăng nhập | [16 — Quota post-login check](16-QUOTA-POST-LOGIN-CHECK-2026-09-27-182904-IMPORTANT-🔒.md) |
| Khôi phục fallback nguồn Quota qua Auth Broker | [17 — Auth Broker recovery](17-AUTH-BROKER-RECOVERY-2026-09-27-IMPORTANT-🔒.md) |
| Hiệu chỉnh entitlement và Google verification | [18 — Entitlement verification correction](18-ENTITLEMENT-VERIFICATION-CORRECTION-2026-09-27-IMPORTANT-🔒.md) |


## Trạng thái hiện tại

| Nhóm | Trạng thái | Ý nghĩa vận hành |
|---|---|---|
| Session actions | Supported | Rename, pin, archive, delete, fork, reconnect dùng adapter thật. |
| File reference | Supported | Đọc file thật trong workspace đã cấu hình, có kiểm tra path/nội dung. |
| Abort / steer / reconnect | Partial | Abort/reconnect dùng ACP adapter; `steer` unavailable theo ACP, follow-up chỉ xếp sau lượt active. |
| Active-turn queue | Supported | Follow-up được serialize thành ACP `session/prompt` sau lượt active; không mở stream song song. |
| Gateway protocol | Supported | Chat dùng ACP session trên worker pool; `/api/console/*` giữ RPC riêng, không trộn lifecycle. |
| Approval roundtrip | Supported | Confirm/select/input/editor của OMP hiển thị UI và trả giá trị thật. |
| Agent Hub | Unavailable | Chat ACP không công bố subagent snapshot; API/UI không giả danh sách rỗng. |
| Share | Partial | Chỉ thành công khi OMP CLI trả URL HTTPS thật; collab chưa có adapter. |
| Image generation output | Conditional | `gemini-3.1-flash-image` có media contract; lượt production mới nhất timeout sau 120s dù quota account-level khả dụng, chưa có assistant image attachment. |
| Memory | Deployed; backend production `off` | API/status/UI đã lên runtime; chưa bật backend hoặc chạy Memory operation thật. Xem report 12. |
| Chat concurrency / queue / UI isolation | Deployed; health verified | 86 scenarios dùng RPC test override; ACP pool tests cover worker/session isolation; chưa có ACP stream FIFO E2E. Browser draft/API smoke pass; không gửi model prompt. |

## Vị trí chính

| Loại | Đường dẫn |
|---|---|
| Source UI | `/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/honpi-chat-dashboard-live.js` |
| Runtime server | `/Users/trannhattuan/.omp/usage-dashboard/server.mjs` |
| OMP bridge | `/Users/trannhattuan/.omp/usage-dashboard/console-bridge.mjs` |
| LaunchAgent | `/Users/trannhattuan/Library/LaunchAgents/com.trannhattuan.omp-usage-dashboard.plist` |
| Dashboard | `http://127.0.0.1:4177/chat` |
| Health check | `http://127.0.0.1:4177/healthz` |
| Test smoke | `/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/test-runtime-security.sh` |
| Backup capability sprint | `/Users/trannhattuan/.omp/usage-dashboard/backups/capability-sprint/20260923-074054` |

## Những gì đã thực hiện trong đợt này

1. Sửa runtime để session, file reference, abort/steer/reconnect, approval, share và Agent Hub không báo thành công giả.
2. Khóa file picker vào workspace cấu hình thay vì thư mục runtime `~/.omp/usage-dashboard`.
3. Thêm các guard path, giới hạn file, HTTP error có mã công khai và capability status thật.
4. Đồng bộ file sản phẩm cần thiết vào GitHub private; không đưa state, log, tài liệu nội bộ hoặc secret lên đó.
5. Restart LaunchAgent và kiểm tra `/healthz`, API smoke, UI Files/Agent Hub. Không tạo share link thật; lượt production image-generation mới nhất timeout như ghi ở tài liệu 11.
6. Sửa image-generation model routing/guard: model picker có nhãn `Tạo ảnh`, capability API công bố image model, prompt sai model bị chặn trước queue/request và media output được regression-test.
7. Ghi lại incident, evidence quota `429`, lượt production timeout 120 giây, deploy marker và prompt handoff trong [11 — Image generation output fix & session handoff](11-IMAGE-GENERATION-OUTPUT-FIX-AND-SESSION-HANDOFF-IMPORTANT-🔒.md).
8. Thêm OMP-native Memory adapter/API/UI và contract test; rollout live được xác nhận bằng backup/checksum, health/API và backend `off`. Không chạy operation Memory thật; xem [12 — OMP-native Memory deployment & rollback](12-OMP-NATIVE-MEMORY-DEPLOYMENT-REPORT-IMPORTANT-🔒.md).
9. Kiểm thử bổ sung chat concurrency, queue lifecycle và session isolation trực tiếp trên ego-browser; xem [13 — Chat concurrency, queue isolation và ego-browser QA](13-CHAT-CONCURRENCY-QUEUE-AND-EGO-QA-REPORT-IMPORTANT-🔒.md).
10. Sửa Quota account attribution và Chat/UI queue lifecycle; tổng hợp 67 contract scenarios, security/runtime checks và giới hạn không deploy tại [14 — Quota & Chat repair verification](14-CHAT-QUOTA-REPAIR-AND-VERIFICATION-REPORT-IMPORTANT-🔒.md).
11. Khắc phục tương tác Quota bị CSP chặn bằng event delegation; browser live xác nhận Details, filter, search/sort, theme, quick-check, lịch sử hoạt động và CSP vẫn nghiêm. Xem phần tiếp nối trong [14 — Quota & Chat repair verification](14-CHAT-QUOTA-REPAIR-AND-VERIFICATION-REPORT-IMPORTANT-🔒.md).

12. Thêm Chat ACP worker pool theo workspace/policy, giữ OMP session riêng từng chat; regression prewarm/fork/replay/approval namespace. Deploy/restart LaunchAgent ngày 2026-09-26 sau backup; kiểm chứng và giới hạn ở [15 — ACP worker pool: triển khai, kiểm chứng và lịch sử](15-ACP-WORKER-POOL-IMPLEMENTATION-AND-DEPLOYMENT-HISTORY-IMPORTANT-🔒.md).
13. Ngày 2026-09-28, bỏ route legacy `/dashboard-live.js`; tách PNG dùng chung khỏi HTML Chat/Quota để giảm payload và cache theo hash. Source, product release và runtime được kiểm tra khớp 10/10 asset.

Tài liệu flow tổng quan cũ vẫn được giữ tại `/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/SYSTEM-FLOW-IMPORTANT-DO-NOT-DELETE.md`. Bộ này là phần chi tiết, cập nhật theo runtime hiện tại.
