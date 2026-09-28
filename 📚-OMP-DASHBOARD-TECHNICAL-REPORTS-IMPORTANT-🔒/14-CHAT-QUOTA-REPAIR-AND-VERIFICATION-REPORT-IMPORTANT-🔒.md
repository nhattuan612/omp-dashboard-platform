# Báo cáo sửa Quota và Chat — kiểm chứng 2026-09-24

## Mục tiêu và phạm vi

Báo cáo gồm kết quả sửa Quota account attribution và Chat/UI queue trước đó, cùng phần tiếp nối ở cuối tài liệu về fix CSP Quota. Phần tiếp nối cập nhật source/HTML của local runtime, restart service local; không đổi CSP policy hay deploy remote.

## Tiếp nối: Affinity, entitlement và model-family — 2026-09-27

- Session đã tồn tại nhưng thiếu pin/snapshot không còn kế thừa default mới; mọi request quota phải được ghim thủ công vào credential account chính xác, nếu không fail-closed.
- Health Gemini chỉ nhận telemetry cùng provider Google và không mang family Claude/GPT; lỗi provider/model khác không thể đổi trạng thái account thành `Google từ chối quyền`.
- Quota chỉ cho phép account có đủ 4 bucket Gemini và Claude/GPT shared ở 5 giờ/tuần. Đây là capability gate cho Pro/Ultra vì OMP không trả tier subscription trực tiếp.
- Dashboard hiển thị đủ 4 cửa sổ Gemini/Claude-GPT và chọn model theo catalog account, không ép `gemini-3.8-flash`.
- Regression tích hợp cuối: `test-session-actions.mjs` pass 98/98 scenario, gồm pin chính xác, legacy fail-closed, Claude/GPT của account đã chọn và không auto-switch.

## Backup trước sửa

- Thư mục: `/Users/trannhattuan/.omp/backups/omp-chat-before-fix-20260924-173349/`
- Backup gồm source, runtime/test và technical docs trước sửa; mục lục technical reports được bổ sung vào backup trước khi cập nhật mục lục.
- `SHA256SUMS` kiểm chứng thành công cho toàn bộ mục được liệt kê, gồm bản backup của `02-API-AND-CAPABILITY-CONTRACT`, `04-STATE-VARIABLES-AND-LIMITS` và `00-INDEX`.

## Thay đổi Quota

- Identity tài khoản được khóa theo cặp `(provider, email)` đã chuẩn hóa chữ hoa/thường; trạng thái auth và quota không còn bị gộp giữa hai provider dùng cùng email.
- Lỗi auth từ usage logs được quy về provider/account tương ứng; phân biệt trạng thái cần đăng nhập lại, bị từ chối quyền, lỗi CA/mạng và chưa xác định.
- Khi request chỉ rõ account/provider, lựa chọn không âm thầm rơi sang account cùng email ở provider khác. Account ID được tạo từ credential pin để nhận diện credential ổn định.
- Lịch sử usage chỉ nhận account còn map được về credential/account hợp lệ và model phù hợp provider. Gán usage cho account yêu cầu credential pin khớp cùng thứ tự thời gian/sequence, tránh tính nhầm quota cho account kế cận.

## Thay đổi Chat/UI

- Server tuần tự hóa lượt chat theo OMP context bằng FIFO; giới hạn **32 lượt đang chờ** (không tính lượt active). Hàng đầy trả `429 RATE_LIMITED`.
- `OMP_CHAT_RATE_LIMIT` mặc định 30 request/phút cho endpoint chat; giá trị `0` tắt giới hạn này, giá trị không hợp lệ quay về 30.
- Request options và model/provider được kiểm tra trước khi tạo/dispatch lượt; lỗi validation trả lỗi client thay vì gửi lệnh một phần tới OMP.
- Abort xử lý cả request còn trong queue lẫn lượt đã dispatch; kết quả hủy được đánh dấu `aborted`, queue được giải phóng để lượt kế tiếp tiếp tục.
- UI Alt-click chọn request live cũ nhất để dừng. Chuyển session và quay lại giữ view đang hoạt động, queue preview, trạng thái transient/approval và retry context; lỗi/hủy không làm mất lượt chưa gửi.

## API schema và tài liệu kỹ thuật

- `api-schema.json` mô tả model provider/source, request ID, browser/thinking/approval options, kết quả `aborted`, giới hạn FIFO/rate limit và phản hồi `409`/`429`.
- Technical docs cập nhật: `02-API-AND-CAPABILITY-CONTRACT-IMPORTANT-🔒.md` và `04-STATE-VARIABLES-AND-LIMITS-IMPORTANT-🔒.md`.
- Báo cáo này được thêm vào mục lục `00-INDEX-IMPORTANT-🔒.md` theo thứ tự đánh số hiện có.

## Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| `test-session-actions.mjs` trên server cô lập | **67 scenario passed** (port 61467), gồm regression cho provider/auth isolation và lựa chọn account stale. |
| `test-runtime-security.sh` trên process mới từ source hiện tại | Pass. |
| `node --check` cho `server.mjs`, `honpi-chat-dashboard-live.js`; parse `api-schema.json` bằng JSON parser | Pass; schema hợp lệ. |
| Browser smoke trên UI cô lập | Alt-click nhắm request live cũ nhất; UI chuyển request sang trạng thái `stopping`. |
| Review độc lập `ChatDashboardReview` | Không có finding (`findings: []`, confidence 0.98). |
| Runtime direct-check tại `http://127.0.0.1:4177/chat` | HTTP/UI kết nối thành công. Asset `/honpi-chat-dashboard-live.js` trả HTTP 200; source và asset cùng 199060 bytes, SHA-256 `15f27ec484d6109cc16211a4bb48d13e419eef3852d986656974ce23b901e039`. |
| Validation-only POST `/api/v1/chat/send` | Payload giả với `browserMode` không hợp lệ bị từ chối `400 BAD_REQUEST`, `field=browserMode`; không dispatch model/session. |

## Ranh giới an toàn

Không gửi prompt thật, không tạo lượt hội thoại thật và không deploy. Runtime check chỉ tải UI/asset và gửi payload validation-only bị chặn trước dispatch. Không có thay đổi cấu hình runtime lâu dài trong bước kiểm chứng.

## Tiếp nối: phục hồi tương tác Quota dưới CSP — 2026-09-24

### Thay đổi

- Nguyên nhân: các `onclick`/`oninput`/`onchange` trong HTML Quota bị CSP `script-src 'self' __NONCE__` chặn; không nới CSP.
- Chuyển thao tác tĩnh và nội dung render động sang event delegation cho `click`, `input`, `change`; giữ nguyên API/action mapping.
- Không đổi logic `canUse`: backend vẫn trả availability; nút chuyển account tiếp tục disabled khi account không khả dụng. Các route sync, switch, delete và OAuth không đổi.
- Đồng bộ source HTML và bản HTML ở `/Users/trannhattuan/.omp/usage-dashboard/`; SHA-256 hai bản: `bc65e1a5966fac3f6f5cf6ddad1e24698daa0387e2eff55a065e90d4fbe4fbfd`.

### Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| Parse inline JavaScript Quota và `node --check server.mjs` | Pass. |
| `test-session-actions.mjs` trên server cô lập | **68 scenario passed** (port 58082). |
| `test-runtime-security.sh` | Pass; kiểm tra CSP header và các boundary/security routes. |
| Browser live tại `http://127.0.0.1:4177/quota` | Chi tiết/đóng modal, filter, search, sort, theme, quick-check và đổi kỳ lịch sử hoạt động; 8 account còn nguyên, 3 nút Sử dụng disabled theo quota state. |
| Kiểm tra CSP trên browser | 0 inline event attributes trong DOM; 0 `securitypolicyviolation` và 0 CSP console events sau thao tác. |
| Delete action | Mở confirm; dismiss trước khi xác nhận, không xóa account. OAuth, sync, switch-account và Safety Guard write không được gọi trong smoke. |
| Screenshot | Giao diện live hiển thị đầy đủ header, filter và account cards; không thấy lỗi bố cục do thay event binding. |

## Tiếp nối: Folder dự án và ghim tài khoản Gemini theo phiên — 2026-09-25

### Thay đổi

- Khôi phục Folder trong lịch sử dự án; tạo project chat lấy CWD từ thư mục workspace đã chọn. Chat chưa phân loại giữ `folderId` rỗng; gắn/bỏ Folder không viết lại CWD của phiên hiện hữu.
- `/quota` chỉ liệt kê tài khoản OAuth Gemini. Danh mục provider/model OMP và mặc định ChatGPT vẫn độc lập.
- Thay xoay vòng bằng chọn tài khoản thủ công theo session. Extension OMP cục bộ giới hạn provider Google vào đúng credential đã ghim; pin stale hoặc không phân giải được thì fail-closed. Không fallback/đổi account tự động khi lỗi quota/429.
- Không ghi cấu hình OMP terminal-global. Chọn account không có `sessionId` chỉ đặt mặc định dashboard cho chat mới.
- Thêm `gemini-account-pin-extension.mjs` vào manifest và danh sách cài gói local.

### Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| `test-session-actions.mjs` với OMP giả trong môi trường cô lập | **71 scenario passed**, gồm CWD project, chat chưa phân loại, chuyển Folder không đổi CWD, pin theo phiên và giữ mặc định độc lập. |
| `test-gemini-account-pin.mjs` | **6 test passed**, gồm pin exact credential, fail-closed, provider ChatGPT không bị ảnh hưởng và không tự đổi khi gặp 429. |
| Kiểm tra cú pháp/API/package và đối chiếu bundle | Pass; schema JSON hợp lệ, asset phát hành khớp source. |
| Browser smoke trên server/workspace tổng hợp | Tạo Folder từ thư mục workspace có sẵn và project chat; chọn Gemini account cho session, default vẫn rỗng; `/quota` chỉ hiện 2 tài khoản Gemini tổng hợp. Chat mới hiển thị là draft chưa phân loại. |
| Ảnh giao diện | Chụp được trang Chat tổng hợp; Folder dự án, draft chat chưa phân loại và bố cục ba cột hiển thị. |

### Ranh giới an toàn

Chỉ dùng HOME, OMP giả, account giả và thư mục workspace tổng hợp. Không truy cập database/token/account/log của OMP thật; không gửi prompt, không tiêu quota, không sửa cấu hình terminal-global, không đụng port runtime `4177`, không restart hoặc deploy. Máy chủ và dữ liệu smoke tổng hợp đã dừng/xóa.

## Tiếp nối: hardening session và deploy an toàn — 2026-09-25

### Thay đổi

- Chat mới chụp snapshot Gemini default lúc tạo; session/transcript cũ không metadata hoặc pin riêng không nhận default đặt sau đó. JSON metadata được ghi bằng temp file mode `0600` rồi atomic rename; JSON lỗi và I/O lỗi fail closed.
- JSON request parser giữ đúng UTF-8 khi code point bị chia giữa các chunk. ACP spawn/stdin/close lỗi được chuyển thành `502 UPSTREAM_UNAVAILABLE` với thông báo đã redacted.
- Deploy và installer dùng backup code-only có marker/checksum, gồm extension pin Gemini và LaunchAgent plist; rollback từ backup mới xác minh checksum. Không backup state/config/session/log/credential; không xóa `ego-browser-adapter.mjs`.

### Kiểm chứng trước rollout

| Kiểm tra | Kết quả |
|---|---|
| `test-session-actions.mjs` trên OMP giả | **75 scenario passed** (port 63205), gồm split UTF-8, legacy session không nhận Gemini default, metadata lỗi không bị ghi đè và ACP spawn lỗi không làm dừng server. |
| `test-gemini-account-pin.mjs` | **6 test passed**. |
| `test-runtime-security.sh` | Pass. |
| Node syntax, API/package JSON, shell syntax và LaunchAgent plist | Pass. |
| Source/release bundle | 7/7 app assets trùng byte-for-byte; manifest liệt kê extension pin Gemini. |

## Tiếp nối: kiểm chứng live rollout — 2026-09-25

### Backup, deploy và health

- Backup code-only: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260925-205231-99593/`. `MANIFEST.sha256` kiểm đủ 9 file (`server.mjs`, `console-bridge.mjs`, extension pin, 4 app assets, LaunchAgent plist và marker); tất cả checksum **OK**. Không gồm runtime state/config/log/session/credential.
- Deploy bằng `deploy-local-dashboard.sh --restart`; LaunchAgent `com.trannhattuan.omp-usage-dashboard` chạy PID `99750`, `LastExitStatus=0`. `/healthz` trả HTTP 200 và `ok=true`; `/chat`, `/quota` và JS asset đều HTTP 200. Không rollback vì health/parity đều đạt.

### Kiểm tra hai chat Gemini Flash

- Tạo hai chat riêng và pin cùng account đủ điều kiện theo session; hai lần `quota/switch` trả HTTP 200, mỗi chat thấy `gemini-3.8-flash`, account mặc định toàn cục không đổi.
- Gửi đúng một request `gemini-3.8-flash` cho mỗi chat. Cả hai stream HTTP 200 nhưng trả event lỗi `UPSTREAM_ERROR` trước khi có `end.done`; kiểm tra exact response thất bại. **Không retry, không đổi account**. Không kết luận model chưa xử lý request; response/isolation nội dung không xác nhận được.
- Usage 5h được báo 3.2% trước và sau hai request; default account vẫn giữ nguyên. Không ghi account ID/email.

### Kiểm chứng và giới hạn

| Kiểm tra | Kết quả |
|---|---|
| `test-session-actions.mjs` với OMP giả | **77 scenario passed**, gồm RPC v18.3 `prompt_result` xác nhận local pin, string error và abort khi agent turn ngoài dự kiến. |
| `test-gemini-account-pin.mjs` | **7 test passed**, gồm account OAuth không có `accountId`. |
| `test-runtime-security.sh` | Pass trên server cô lập sau khi sửa test gửi cookie xác thực và truyền `modelSource` ở đúng cấp body. |
| Node syntax, API schema JSON và source/release parity | Pass. |
| Browser smoke live | `/healthz`, `/chat`, `/quota` và JS asset trả HTTP 200. |
| `PreDeployReview` | Không có finding; review chéo Gemini bị bỏ qua theo lựa chọn của Síp. |

Hai prompt test không đạt acceptance do `UPSTREAM_ERROR`. Dừng tại đây theo yêu cầu không retry/không auto-switch; cần xử lý lỗi upstream riêng trước khi có thể xác nhận phản hồi Gemini Flash.
