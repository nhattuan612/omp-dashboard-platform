# Báo cáo OMP Dashboard

**Ngày lập:** 20/09/2026  
**Cập nhật bổ sung:** 21/09/2026  
**Phạm vi:** OMP Dashboard, OMP Gateway, Gemini CLI/Open Design và hệ thống quản lý quota/token trên máy local.

> **Cách đọc báo cáo:** Các phần 4, 5, 7, 11 và một phần 13 giữ lại snapshot/lịch sử tại thời điểm chúng được ghi để truy vết. Phần 14 và các phần 15 trở đi là bản kiểm tra logic và trạng thái mới nhất. Khi số liệu khác nhau, ưu tiên snapshot mới nhất có timestamp và endpoint kiểm chứng.

## 1. Tóm tắt điều hành

OMP Dashboard là bảng điều khiển local dùng để:

- Theo dõi quota của các tài khoản Google Antigravity/Gemini.
- Chọn tài khoản ưu tiên cho các phiên OMP tiếp theo.
- Cung cấp Console để kiểm tra session, gateway và luồng prompt.
- Ghi nhận lịch sử sử dụng token theo account, model và thời gian.
- Làm lớp kết nối cho Gemini CLI/Open Design thông qua OMP Gateway.

Trạng thái hiện tại: dashboard và API đang hoạt động tại `http://127.0.0.1:4177/`; API trả `ok: true`. Tài khoản ưu tiên hiện tại là `bancuachungta123@gmail.com`.

## 2. Các địa chỉ và thành phần chính

| Thành phần | Địa chỉ/vị trí | Vai trò |
|---|---|---|
| Dashboard quota | `http://127.0.0.1:4177/` | Xem quota và account |
| Console OMP | `http://127.0.0.1:4177/console` | Theo dõi gateway/session và gửi prompt kiểm tra |
| Status API | `/api/status` | Account, quota, account ưu tiên, trạng thái runtime |
| History API | `/api/history?limit=N` | Lịch sử token và thống kê tổng hợp |
| Dashboard server | `~/.omp/usage-dashboard/server.mjs` | HTTP server và API |
| Quota UI | `~/.omp/usage-dashboard/quota-dashboard.html` | Giao diện quota |
| Live dashboard JS | `~/.omp/usage-dashboard/dashboard-live.js` | Đọc và render dữ liệu quota/history |
| Console bridge | `~/.omp/usage-dashboard/console-bridge.mjs` | Kết nối console với OMP protocol |
| OMP database | `~/.omp/agent/agent.db` | Credential/runtime metadata của OMP |
| Session logs | `~/.omp/agent/sessions/` | Nguồn token history |

## 3. Kiến trúc và luồng hoạt động

```text
Gemini CLI / Open Design
          |
          v
     OMP Gateway
          |
          +--> Session manager
          +--> Account/credential selector
          +--> Google Antigravity endpoint
          |
          v
     Session JSONL logs
          |
          v
     OMP Dashboard API
       |             |
       v             v
   Quota UI       History UI
```

Luồng chọn account:

1. Dashboard đọc danh sách credential Google Antigravity.
2. Người dùng chọn account bằng giao diện.
3. Dashboard lưu account ưu tiên.
4. Session OMP mới hoặc request tiếp theo đọc preference này.
5. Quota được lấy theo từng account, model/provider và cửa sổ giới hạn.

Luồng token history:

1. OMP ghi usage metadata vào session log JSONL.
2. Dashboard quét và tổng hợp các bản ghi assistant có usage.
3. API trả input, output, cache read/write, reasoning, tổng token, model, account và timestamp.
4. UI hiển thị KPI tổng hợp và bảng các lượt gần nhất.

Dashboard không cần đọc hoặc hiển thị nội dung prompt, tool output hay secret credential để làm History.

## 4. Snapshot account và quota lịch sử

API hiện nhận diện **6 account**. Các phần trăm dưới đây là số liệu tại thời điểm kiểm tra; quota có thể thay đổi ngay sau request mới.

| Account | Gemini 5 giờ | Gemini tuần | Ghi chú |
|---|---:|---:|---|
| `bancuachungta123@gmail.com` | Còn 61.01% | Còn 63.43% | Bình thường |
| `tuantuoitan006@gmail.com` | Chưa trả về cửa sổ 5 giờ | Còn 24.33% | Tuần đã dùng cao |
| `tuantuoitan004@gmail.com` | Còn 14.54% | Còn 13.04% | Đang là account ưu tiên, gần quota |
| `kuayay@gmail.com` | Còn 0.02% | Còn 83.33% | Cửa sổ 5 giờ gần cạn |
| `tai.mobile081@gmail.com` | Còn 100% | Còn 100% | Dư địa tốt |
| `aiaprompt00@gmail.com` | Còn 100% | Còn 71.10% | Dư địa tốt |

Capacity tổng hợp từ API:

- Cửa sổ 5 giờ: 5 account được dùng; mức sử dụng bình quân quy đổi còn khoảng 2.76 account.
- Cửa sổ 7 ngày: 6 account được dùng; mức sử dụng bình quân quy đổi còn khoảng 3.55 account.
- Nhóm Claude & GPT dùng quota shared riêng; hiện API trả 100% còn lại ở các account được kiểm tra.

### Đánh giá vận hành

Account đang ưu tiên `tuantuoitan004@gmail.com` chỉ còn khoảng 14.54% quota 5 giờ và 13.04% quota tuần. Đây là rủi ro vận hành rõ ràng: test Gemini/Open Design tiếp tục trên account này có thể sớm gặp quota error. Khi cần chạy ổn định, nên chuyển sang `tai.mobile081@gmail.com` hoặc `aiaprompt00@gmail.com`, sau đó chạy một prompt test ngắn.

## 5. Snapshot Token History lịch sử

Kết quả kiểm tra trực tiếp từ `/api/history?limit=3`:

| Chỉ số | Giá trị |
|---|---:|
| Tổng bản ghi đã quét | 8.643 |
| Request trong thống kê | 3.326 |
| Input token | 63.821.131 |
| Output token | 2.720.162 |
| Cache read | 446.448.224 |
| Cache write | 0 |
| Reasoning token | 1.553.227 |
| Tổng token | 512.989.517 |

Ba lượt mới nhất đều dùng account `tuantuoitan004@gmail.com`, model `gemini-3.8-flash`, provider `google-antigravity`. Mỗi lượt có tổng khoảng 195k–197k token, phần lớn là cache read. Điều này giải thích vì sao tổng token history tăng nhanh dù input/output trực tiếp nhỏ hơn nhiều.

History hiện hỗ trợ:

- KPI request trong ngày.
- Tổng token.
- Input cộng cache read.
- Output.
- Bảng thời gian, account, provider/model, input, output, cache và tổng.
- Nút làm mới dữ liệu.

## 6. Sự cố đã điều tra và cách xử lý

### 6.1. Lỗi `No API key found for google-antigravity`

Triệu chứng:

```text
Could not start Pi: prompt rejected: No API key found for google-antigravity
```

Nguyên nhân thực tế không phải thiếu API key thông thường. OAuth refresh gọi `https://oauth2.googleapis.com/token` thất bại với lỗi chứng chỉ:

```text
unable to verify the first certificate
```

AdGuard HTTPS inspection sử dụng CA riêng. macOS tin CA này nhưng runtime Bun/OMP không tự dùng CA đó, khiến token refresh thất bại. Credential cũ vì vậy không được cập nhật; bên ngoài nhìn giống như account chưa login.

### 6.2. Cách sửa

- Xuất CA AdGuard thành bundle local.
- Cấu hình runtime bằng `NODE_EXTRA_CA_CERTS`.
- Áp dụng cho Dashboard và wrapper Open Design/OMP.
- Không tắt TLS verification.
- Kiểm tra lại lệnh token refresh và prompt test tối giản.

### 6.3. Khả năng tái diễn

Lỗi sẽ không thường xuyên lặp lại nếu CA AdGuard không thay đổi và bundle còn tồn tại. Có thể tái diễn khi:

- AdGuard tạo CA mới.
- CA bundle bị xóa hoặc đổi đường dẫn.
- Account OAuth hết hạn/revoke.
- Account đã hết quota.
- Session hoặc preference trỏ tới account cũ.

Cách phân biệt nhanh:

| Triệu chứng | Khả năng cao | Xử lý |
|---|---|---|
| `unable to verify the first certificate` | CA/proxy | Kiểm tra CA bundle và restart service |
| `No API key found` sau login | OAuth callback/refresh chưa ghi DB | Login lại, kiểm tra credential và log |
| `quota exceeded` | Hết quota account | Chuyển account |
| Dashboard `ok: false` | Service/API | Kiểm tra launchd và server log |
| Prompt trả lỗi/session không start | Session hoặc adapter | Kiểm tra console bridge, session ID, model |

## 7. Điểm đã kiểm chứng

- Dashboard API đang trả `ok: true`.
- Có 6 account được nhận diện.
- Preference hiện tại trả đúng `tuantuoitan004@gmail.com`.
- Quota được trả theo cửa sổ 5 giờ và 7 ngày.
- History API trả dữ liệu thật, không phải dữ liệu mẫu.
- History đã tăng lên 8.643 bản ghi tại lần kiểm tra mới nhất.
- Server và các file JavaScript liên quan đã được kiểm tra syntax trong task trước.
- Dashboard đã được restart và endpoint History đã phản hồi thành công.

## 8. Rủi ro và điểm cần cải thiện

### Rủi ro hiện tại

1. Account ưu tiên đang gần cạn quota cả 5 giờ lẫn tuần.
2. `tuantuoitan006@gmail.com` chỉ còn khoảng 24.33% quota tuần.
3. `kuayay@gmail.com` gần hết quota 5 giờ.
4. Quota thay đổi theo thời gian; số liệu trên dashboard cần có timestamp rõ ràng.
5. CA AdGuard là dependency ngoài OMP; thay đổi CA có thể làm OAuth hỏng lại.
6. History quét session log nên cần tránh đọc nội dung message khi mở rộng tính năng.

### Khuyến nghị ưu tiên

**P0 — ngay:** chuyển account ưu tiên khỏi `tuantuoitan004@gmail.com` sang account còn nhiều quota trước khi test Gemini/Open Design dài.

**P1 — nên làm:** thêm cảnh báo khi quota 5 giờ hoặc tuần xuống dưới 20%; hiển thị thời điểm reset và account đề xuất kế tiếp.

**P1 — nên làm:** thêm filter History theo account, model và ngày; hiện đây là phần còn thiếu được đề cập trong task trước.

**P2 — nên làm:** thêm health check định kỳ cho OAuth/CA và endpoint OMP, nhưng chỉ báo khi có thay đổi hoặc lỗi.

**P2 — nên làm:** ghi lại version/runtime của Bun, OMP, adapter và CA fingerprint để chẩn đoán nhanh khi môi trường thay đổi.

## 9. Quy trình xử lý sự cố chuẩn

1. Mở Dashboard và xem trạng thái API.
2. Kiểm tra account ưu tiên và quota 5 giờ/tuần.
3. Nếu quota thấp: chuyển account, không login lại vô ích.
4. Nếu lỗi OAuth/certificate: kiểm tra CA bundle và runtime environment.
5. Nếu lỗi `No API key`: xác minh callback đã ghi credential mới chưa.
6. Restart Dashboard/OMP sau khi sửa cấu hình.
7. Chạy prompt test tối giản: `Reply with exactly OK.`
8. Chỉ sau khi test đạt mới chạy lại Open Design/Gemini CLI.

## 10. Kết luận

OMP Dashboard hiện là lớp quản trị tập trung cho account, quota, session và token history của Gemini CLI/Open Design. Phần dashboard đang hoạt động và có dữ liệu thật. Sự cố nghiêm trọng trước đây đã được xác định là lỗi tin cậy CA trong OAuth refresh, không phải lỗi thiếu API key trực tiếp.

Việc cần ưu tiên tiếp theo là đổi account mặc định khỏi `tuantuoitan004@gmail.com` vì quota hiện tại thấp, sau đó chạy prompt test xác nhận. Tính năng đáng làm tiếp theo là cảnh báo quota thấp và bộ lọc History.

> Báo cáo không chứa access token, refresh token, mật khẩu, cookie hoặc nội dung prompt.

## 11. Nghiên cứu logic OMP Dashboard và Web UI Chat

### 11.1. Hai giao diện và mối quan hệ

Hai URL chạy trên cùng một local Node server tại `127.0.0.1:4177`, nhưng phục vụ hai mục đích khác nhau:

```text
http://127.0.0.1:4177/
  └─ Dashboard quota/token/account

http://127.0.0.1:4177/console
  └─ Web UI điều khiển OMP session và chat Gemini
```

| Giao diện | File HTML | File logic trình duyệt | Vai trò |
|---|---|---|---|
| Dashboard quota | `~/.omp/usage-dashboard/quota-dashboard.html` | `~/.omp/usage-dashboard/dashboard-live.js` | Hiển thị quota, account, token history và chọn account ưu tiên |
| Web UI Chat | `~/.omp/usage-dashboard/console.html` | `~/.omp/usage-dashboard/console-live.js` | Khởi động context, chọn session, gửi prompt, nhận streaming event, abort và quản lý session |

Backend dùng chung là `~/.omp/usage-dashboard/server.mjs`. Backend này:

- Phục vụ hai HTML và hai file JavaScript.
- Gọi `omp usage --json` cho Dashboard quota.
- Cung cấp `/api/status`, `/api/history`, `/api/refresh`, `/api/select-account`.
- Cung cấp `/api/console/*` cho Web UI Chat.
- Quản lý gateway `/api/omp/v1/*` cho Gemini CLI/Open Design.

Web UI Chat đi qua lớp `~/.omp/usage-dashboard/console-bridge.mjs`, lớp này chạy `omp acp`, giữ context/session và chuyển event qua SSE:

```text
console-live.js
    │ HTTP command + SSE event
    ▼
server.mjs
    ▼
console-bridge.mjs
    ▼
omp acp / OMP session / Gemini
```

Hai giao diện dùng chung OMP, credential và session storage nhưng không phải cùng một màn hình chat. Dashboard tập trung vào quan sát quota; Console tập trung vào điều khiển phiên chat. Khi chọn account, Dashboard ghi account ưu tiên cho các session OMP kế tiếp; Console không tự hiển thị biểu đồ quota.

### 11.2. Logic đã kiểm chứng live

- `GET /api/status` trả `ok: true` và nhận diện 6 account.
- `/api/omp/v1/capabilities` trả contract version `1`, transport HTTP/SSE và các feature sessions, streaming, commands, abort, ego-browser, slash-commands, file-references.
- Web UI đã kiểm chứng đủ luồng `start context → ready → nhận model → stop context`.
- Model live trả về là `google-antigravity/gemini-3.8-flash`.
- Đã chạy thành công các smoke test: `console-smoke`, `omp-gateway-smoke`, `omp-client-smoke`, `dsh-omp-adapter-smoke`.
- Đã dừng context test sau khi kiểm tra; không gửi prompt test nên không tiêu quota.

Tại lần kiểm tra live mới nhất, account ưu tiên là `tai.mobile081@gmail.com`. Một số account khác đang gần giới hạn: `tuantuoitan004@gmail.com` còn khoảng 1.35% cửa sổ 5 giờ và `kuayay@gmail.com` còn khoảng 0.02% cửa sổ 5 giờ. Số liệu quota là snapshot và thay đổi theo request mới.

### 11.3. Vấn đề logic cần xử lý

#### Cao — SSE Web UI mặc định replay frame cũ khi reconnect

`console-live.js` mở EventSource mà không truyền `replay=0`. Backend tại `/api/console/events` mặc định replay buffer event cũ. Khi mạng rớt rồi kết nối lại, UI có thể xử lý lại frame cũ như event mới, dẫn tới lặp activity/message hoặc lấy nhầm trạng thái turn cũ.

Vị trí liên quan:

- `~/.omp/usage-dashboard/console-live.js:680`
- `~/.omp/usage-dashboard/server.mjs:499-509`
- `~/.omp/usage-dashboard/console-bridge.mjs:161-164`

Gateway client hiện đã có cách tránh tương tự bằng `replay=0`; Web UI nên dùng cùng quy ước hoặc đồng bộ theo sequence/frame ID.

#### Cao — History có thể gán sai account sau khi credential thay đổi trong session

`server.mjs` đọc các `credential_pin` trong một file session nhưng chỉ giữ `lastPinHash`. Sau khi đọc xong, toàn bộ assistant usage trong file được gán cho account tương ứng với pin cuối cùng. Nếu cùng session đổi account giữa chừng, các request cũ có thể bị gán nhầm account.

Vị trí liên quan:

- `~/.omp/usage-dashboard/server.mjs:103-137`

Đây là lỗi tính đúng đắn của báo cáo History, không làm hỏng việc gửi prompt nhưng có thể làm sai thống kê theo account.

#### Vừa — Danh sách session chưa phân trang

`console-bridge.mjs` yêu cầu `_omp/sessions/listAll` với `limit: 1000`, sau đó `console-live.js` render toàn bộ danh sách một lần. Kiểm tra live cho thấy UI có thể phải render khoảng 1.000 session, phần lớn có tên `Untitled session`, làm DOM và accessibility tree rất lớn.

Vị trí liên quan:

- `~/.omp/usage-dashboard/console-bridge.mjs:80-89`
- `~/.omp/usage-dashboard/console-live.js:542-546`

Nên ưu tiên phân trang hoặc lazy render trước khi session history tiếp tục tăng.

#### Vừa — Xử lý lỗi bind port của server chưa rõ ràng

Log launchd ghi nhận nhiều lần `EADDRINUSE` trên `127.0.0.1:4177`. Server hiện gọi `server.listen(...)` nhưng chưa có `server.on("error")` riêng để báo lỗi bind hoặc xử lý trùng tiến trình rõ ràng. Service hiện vẫn chạy, nhưng thao tác restart có thể tạo lỗi nhiễu hoặc trạng thái khó chẩn đoán.

Vị trí liên quan:

- `~/.omp/usage-dashboard/server.mjs:608`
- `~/.omp/usage-dashboard/launchd.error.log`

### 11.4. Kết luận nghiên cứu

Core logic hiện hoạt động: quota API, console runtime, OMP gateway và smoke tests đều đạt. Tuy nhiên, hệ thống chưa hoàn toàn ổn định ở ba điểm: replay SSE khi reconnect, attribution account trong History và render quá nhiều session cùng lúc. Đây là các mục nên xử lý trước khi mở rộng thêm tính năng UI hoặc chạy các phiên Gemini/Open Design dài.

## 12. Kết quả xử lý các lỗi logic

### 12.1. Các thay đổi đã triển khai

- **SSE replay:** Web UI kết nối với `replay=0`; backend đọc query này và không gửi lại frame cũ khi reconnect. Khi stream mở lại trên context đã `ready`, UI yêu cầu lại `get_state` và `get_messages` để đồng bộ trạng thái.
- **History attribution:** account được resolve ngay tại thời điểm đọc từng usage record theo `credential_pin` hiện hành, thay vì gán toàn bộ session theo pin cuối cùng. Cache History cũng được xoá sau khi đổi account.
- **Session list:** giữ dữ liệu session đầy đủ nhưng chỉ render 50 session mỗi lần. Nút `Hiển thị thêm` tăng thêm 50 session, tránh tạo DOM khổng lồ ngay khi mở Console.
- **`EADDRINUSE`:** server có handler lỗi bind port và thoát sạch với thông báo rõ ràng. LaunchAgent dùng `KeepAlive.SuccessfulExit=false` và `ThrottleInterval=5`, tránh restart vô hạn khi phát hiện một instance khác đã giữ port.

### 12.2. File đã cập nhật

- `~/.omp/usage-dashboard/server.mjs`
- `~/.omp/usage-dashboard/console-live.js`
- `~/Library/LaunchAgents/com.trannhattuan.omp-usage-dashboard.plist`
- Bản source tương ứng trong `omp-dashboard-platform/dashboard/`

### 12.3. Kiểm chứng sau khi fix

- Syntax check cho server và frontend: đạt.
- `console-smoke.mjs`: đạt.
- `omp-gateway-smoke.mjs`: đạt.
- `omp-client-smoke.mjs`: đạt.
- `dsh-omp-adapter-smoke.mjs`: đạt.
- `/healthz`: `ok: true`.
- `/api/status`: `ok: true`, 6 account.
- Web UI live: context đạt `ready`, nhận model `google-antigravity/gemini-3.8-flash`, nhận 11 event, sau đó dừng sạch.
- Live session list hiển thị `50/276`, không render toàn bộ một lần.
- Chạy thử một instance trùng port: thoát sạch với thông báo port đang được sử dụng, không còn uncaught `EADDRINUSE` stack trace.
- Browser console sau kiểm tra: không có error/warning.

Trạng thái sau fix: bốn lỗi logic đã được xử lý và service đang hoạt động tại `http://127.0.0.1:4177/`.

## 13. Phát hiện trạng thái đăng nhập từng tài khoản Google Gemini

### 13.1. Cách detect

Dashboard lấy danh sách account từ `omp usage --json`, sau đó đối chiếu log của đúng tiến trình `omp usage` vừa chạy. Log có thứ tự `Usage fetch queued` theo provider/email và lỗi `OAuth preflight refresh failed` có `index`, nên backend ghép `index → email` để xác định account lỗi.

Không dùng `omp auth-broker status` làm nguồn chính vì môi trường hiện tại trả `not_configured`. Không gửi prompt thật để kiểm tra; cách detect chỉ dựa trên OAuth refresh và kết quả usage.

### 13.2. Trạng thái API/UI

`GET /api/status` hiện trả thêm `authAccounts` và mỗi phần tử trong `accounts` có:

| `authStatus` | Ý nghĩa UI |
|---|---|
| `authenticated` | ✓ Đã đăng nhập |
| `reauth_required` | ⚠ Cần đăng nhập lại; có nút mở `/api/login` |
| `ca_or_network_error` | ⚠ Lỗi CA/mạng; chưa kết luận token hết phiên |
| `disabled` | ⛔ Disabled |
| `auth_unknown` | ⚠ Cần kiểm tra |

Tách riêng trạng thái xác thực khỏi trạng thái quota. Account đã đăng nhập nhưng chưa có quota hiển thị `Chưa có quota`, không bị gán nhầm thành lỗi đăng nhập.

### 13.3. Kiểm chứng live

- Service live tại `127.0.0.1:4177` trả `ok: true`.
- Hiện nhận diện 6 account; cả 6 đang ở trạng thái `authenticated`.
- Smoke test mới `auth-status-smoke.mjs` đạt; bốn smoke test nền cũng đạt.
- Không gửi prompt và không tạo request Gemini để kiểm tra trạng thái.

File chính:

- `~/.omp/usage-dashboard/server.mjs`
- `~/.omp/usage-dashboard/dashboard-live.js`
- `~/.omp/usage-dashboard/quota-dashboard.html`
- `omp-dashboard-platform/tests/auth-status-smoke.mjs`

## 14. Cập nhật mới: OMP Console và Dashboard — 21/09/2026

> Phần này là snapshot mới nhất và được ưu tiên khi có khác biệt với các số liệu quota ở các phần trước. Quota, số request và trạng thái generation thay đổi theo thời gian.

### 14.1. OMP Web Console

Console hiện đã là một giao diện điều khiển OMP đầy đủ, không chỉ là màn hình gửi prompt:

- Khởi động/dừng OMP ACP context; hiển thị PID, protocol version, runtime state và session đang dùng.
- SSE realtime qua `/api/console/events` với `replay=0`; khi reconnect, UI yêu cầu lại `get_state` và `get_messages` để tránh replay message cũ.
- Bridge phát `bridge_status` ngay khi nhận frame `ready`; UI và script kiểm thử không còn phải chờ sai trạng thái `starting`.
- Safety Guard hiển thị trực tiếp: auto-retry tắt, không tự đổi model/account, order được nhận ngay, FIFO theo từng session, các session khác nhau có thể chạy song song; khoảng cách dispatch tối thiểu 1 giây và cooldown 429 chỉ trì hoãn dispatch.
- Prompt hỗ trợ các chế độ `prompt`, `steer`, `follow_up`; có retry có kiểm soát, abort, compact, thinking level, fast mode và follow-up queue.
- Session list chỉ render 50 session mỗi lần; nút `Hiển thị thêm` tăng thêm 50 để tránh DOM quá lớn khi có hàng trăm session.
- Có thao tác session mới, switch, rename, fork, branch, archive, delete, compact, handoff và export HTML.
- Hỗ trợ file reference `@`, file đính kèm, ảnh, slash command, raw JSON-RPC, Bash command, todos, subagents, diagnostics và raw frame inspector.
- Console có link mở Quota Dashboard, hiển thị trạng thái OMP local control plane và các command/model/provider lấy trực tiếp từ runtime.

Luồng runtime hiện tại:

```text
console-live.js
    │ HTTP command + SSE replay=0
    ▼
server.mjs
    ▼
console-bridge.mjs
    ▼
omp --mode rpc / ACP → Gemini
```

### 14.2. Safety Guard và nguyên tắc chống 429

Safety Guard trong `console-bridge.mjs` hiện áp dụng policy bảo vệ:

| Chính sách | Trạng thái |
|---|---|
| Auto-retry | Tắt bắt buộc |
| Model switch | Chỉ thủ công |
| Account rotation/round-robin | Chỉ thủ công |
| Concurrent generation | Song song theo session; FIFO trong từng session |
| Khoảng cách giữa request | Tối thiểu 1 giây giữa các lần dispatch theo Safety Guard |
| Khi Google trả 429 | Dừng dispatch mới và cooldown tăng dần 15 phút → 1 giờ → 6 giờ → 24 giờ |

OMP đã được cài lại/kiểm tra ở bản `18.2.7`. Console bridge luôn gửi `set_auto_retry: false` khi context đạt `ready`.

### 14.3. Dashboard realtime và Generation Health

Dashboard hiện có hai luồng realtime tách biệt:

- Quota/status: `EventSource('/api/status/events')`.
- Console chat: `EventSource('/api/console/events?...&replay=0')`.

`/api/status` và status SSE hiện có thêm:

- `refreshing`: collector quota đang chạy hay không.
- `dataAgeMs`: tuổi dữ liệu hiện tại.
- `stale`: đánh dấu dữ liệu quá 90 giây.
- `generationStatus`, `generationReason`, `generationCheckedAt`, `generationModel` cho từng account.

UI không còn dùng nhãn tuyệt đối `Chat bị chặn`. Nhãn hiện tại phân biệt:

- `✓ Live gần nhất` — lần generation gần nhất có phản hồi.
- `⚠ 429 gần nhất` — lần generation được ghi nhận gần nhất trả quota/capacity 429.
- `⚠ Lỗi gần nhất` — lỗi generation khác.
- `? Chưa kiểm tra chat` — chưa có record generation trong cửa sổ kiểm tra.

Generation Health và History đều gán account theo `credential_pin` gần nhất với từng record timestamp. Vì vậy một session đổi credential giữa chừng không còn bị gán toàn bộ usage cho pin cuối cùng.

### 14.4. Token History theo khoảng thời gian

`GET /api/history?limit=N` giữ `summary` để tương thích, đồng thời trả thêm `periods`:

| Trường | Cách tính |
|---|---|
| `hour` | 1 giờ gần nhất, rolling 60 phút |
| `day` | 1 ngày gần nhất, rolling 24 giờ |
| `month` | Từ ngày 1 của tháng hiện tại đến hiện tại |
| `year` | Từ ngày 1/1 của năm hiện tại đến hiện tại |
| `total` | Toàn bộ session history đã quét |

Dashboard hiển thị 5 KPI: `1 giờ qua`, `1 ngày qua`, `Tháng này`, `Năm này`, `Tổng thời gian`. Phần chi tiết vẫn hiển thị request, input + cache read và output của 1 ngày qua.

Snapshot API tại lần kiểm tra ngày 21/09/2026:

| Khoảng | Request | Tổng token |
|---|---:|---:|
| 1 giờ qua | 301 | 40.171.982 |
| 1 ngày qua | 4.950 | 954.800.427 |
| Tháng này | 11.662 | 1.688.061.197 |
| Năm này | 11.673 | 1.688.347.434 |
| Tổng thời gian | 11.673 | 1.688.347.434 |

`Tổng token` là `usage.totalTokens` của OMP, có thể bao gồm input, output, cache và reasoning; không nên hiểu là chỉ output nhìn thấy.

### 14.5. Màu account trong History

Dashboard có color picker ở mỗi account card. Màu được lưu tại:

```text
~/.omp/usage-dashboard/account-colors.json
```

API:

- `GET /api/account-colors`: trả màu hiện tại của các account.
- `PUT /api/account-colors` với `{ "email": "...", "color": "#RRGGBB" }`: validate và lưu màu.

History trả thêm `item.color`; text email trong bảng History dùng đúng màu của account. Account mới chưa được chọn màu sẽ nhận palette mặc định xác định theo danh sách account hiện tại; sau khi người dùng chọn, màu được lưu riêng.

### 14.6. Ping thật và trạng thái hiện tại

Đã ping tuần tự bằng prompt nhẹ `Trả lời đúng một từ: OK`:

| Account | Kết quả live | Model |
|---|---|---|
| `kuayay@gmail.com` | Trả `OK` | `gemini-3.8-flash` |
| `tai.mobile081@gmail.com` | Trả `OK` | `gemini-3.8-flash` |
| `aiaprompt00@gmail.com` | Trả `OK` | `gemini-3.8-flash` |

Safety Guard sau kiểm tra:

```text
blocked: false
activeTurns: 0
recent429Count: 0
consecutive429: 0
lastDecision: healthy
```

Account ưu tiên hiện tại: `bancuachungta123@gmail.com`.

Lưu ý: nếu một account hiện `⚠ 429 gần nhất` nhưng `generationCheckedAt` cũ, đó là trạng thái lỗi lịch sử gần nhất, không phải kết luận account đang bị Google ban. Cần ping thật hoặc chờ generation mới để cập nhật trạng thái.

### 14.7. Kiểm chứng sau cập nhật

Đã chạy đạt:

```text
node --check dashboard/server.mjs
node --check dashboard/dashboard-live.js
node tests/quota-logic-smoke.mjs
node tests/console-smoke.mjs
node tests/auth-status-smoke.mjs
```

Runtime đã đồng bộ các file:

- `dashboard/server.mjs`
- `dashboard/console-bridge.mjs`
- `dashboard/console-live.js`
- `dashboard/console.html`
- `dashboard/dashboard-live.js`
- `dashboard/quota-dashboard.html`

Service hiện chỉ có một listener tại `127.0.0.1:4177`; `/api/status` trả `ok: true`, và `/api/history` trả đủ `periods`, `accountColors` cùng màu cho từng item History.

### 14.8. Giới hạn còn lại

- `generationStatus` là trạng thái lần kiểm tra gần nhất, không phải một probe liên tục từng account.
- Dashboard chưa tự gửi prompt kiểm tra định kỳ; điều này là chủ ý để tránh làm tăng request và rủi ro 429.
- Màu account hiện là preference local, chưa đồng bộ sang máy khác.
- OpenDesign end-to-end chỉ nên đánh dấu thành công khi thực sự gửi prompt qua OpenDesign và thấy cùng lượt xuất hiện trong History; không suy luận thành công chỉ từ việc mở được giao diện.

## 15. Hồ sơ kiểm tra đầy đủ: nguồn dữ liệu và cách đối chiếu

Phần này ghi lại cách em xác định sự thật của hệ thống, để các lần kiểm tra sau không nhầm giữa code nguồn, bản runtime và snapshot UI.

| Nguồn kiểm tra | Vai trò bằng chứng | Kết quả dùng trong báo cáo |
|---|---|---|
| Repository `omp-dashboard-platform` | Code nguồn, test, kế hoạch triển khai | Logic dự kiến và thay đổi chưa/đã commit |
| `~/.omp/usage-dashboard/` | Bản code đang được LaunchAgent chạy | Logic thực tế đang phục vụ port 4177 |
| `GET /api/status` | Quota, auth, generation health, safety, tuổi dữ liệu | Trạng thái account hiện tại |
| `GET /api/history` | Usage records và thống kê kỳ | Token History hiện tại |
| `GET /api/safety` | Quyết định bảo vệ request | Có đang cooldown/chặn request không |
| `/healthz`, `lsof :4177` | Liveness và process listener | Có đúng một dashboard đang chạy không |
| Git log, `tasks/plan.md`, `tasks/todo.md` | Lịch sử triển khai và tiêu chí hoàn thành | Những gì đã làm và cách nghiệm thu |
| Smoke tests và ping thật | Bằng chứng hành vi | Phân biệt code chạy được với code chỉ đọc được |

Không coi tên task, nội dung chat tham chiếu, nhãn UI hoặc snapshot cũ là bằng chứng độc lập. Những dữ liệu đó chỉ được dùng để định hướng rồi phải đối chiếu lại source/runtime/API.

## 16. Bản đồ triển khai thực tế

```text
Repository source
  dashboard/*.mjs, *.js, *.html
  integrations/deepseek-harness-omp/*
  tests/*
        │ đồng bộ thủ công
        ▼
~/.omp/usage-dashboard/
  server.mjs  ─────── LaunchAgent
  console-bridge.mjs  ─── ~/.bun/bin/omp
  quota-dashboard.html
  console.html
        │
        ▼
127.0.0.1:4177
  /       quota dashboard
  /console OMP Web Console
  /api/*  local API + SSE + Gateway
```

Hiện runtime đã kiểm chứng:

- Node: `v24.13.0`.
- OMP: `18.2.7` tại `~/.bun/bin/omp`.
- Listener: một process Node PID `60402` tại `127.0.0.1:4177`.
- `/healthz`: `{"ok":true}`.
- LaunchAgent: `com.trannhattuan.omp-usage-dashboard`, `RunAtLoad=true`, `KeepAlive.SuccessfulExit=false`, `ThrottleInterval=5`.
- Server chỉ bind loopback; không mở dashboard ra LAN.
- Credential, database, session log, selected account, safety state, màu account và CA bundle nằm ngoài Git.

Luồng phát hành hiện tại là: sửa source → syntax/smoke test → chép các file dashboard cần thiết vào runtime → `launchctl kickstart -k gui/501/com.trannhattuan.omp-usage-dashboard` → kiểm tra listener/API. Đây là lý do phải kiểm tra cả repository và `~/.omp/usage-dashboard`; chỉ xem một bên chưa đủ.

## 17. Logic đầy đủ theo module

### 17.1. Server và bộ thu quota

1. `server.mjs` khởi động HTTP server loopback.
2. Mỗi lần refresh, server spawn `omp usage --json` với `NODE_EXTRA_CA_CERTS` nếu có `~/.omp/usage-dashboard/ca-bundle.pem`.
3. Process bị giới hạn 30 giây; exit khác 0 hoặc JSON lỗi làm snapshot chuyển `ok:false`, giữ dữ liệu cũ và phát status event.
4. Kết quả raw được `normalize()` thành account, provider, endpoint, project, limit, used, remaining, reset time và shared quota.
5. Refresh không chạy chồng: nếu đang có promise refresh thì request sau dùng cùng promise.
6. Server tự refresh mỗi 60 giây; UI có thể gọi `POST /api/refresh` để refresh ngay.
7. Mỗi refresh phát `status` SSE; heartbeat gửi định kỳ để giữ kết nối sống.

### 17.2. Logic xác thực account

`omp usage --json` là nguồn chính. Server đọc log của đúng PID vừa chạy, ghép các record `Usage fetch queued` với lỗi OAuth theo `provider` và `index`, rồi phân loại:

| Điều kiện | `authStatus` | Ý nghĩa |
|---|---|---|
| Có quota/usage hợp lệ, không có lỗi mạnh hơn | `authenticated` | Token dùng được cho lần kiểm tra usage |
| `invalid_grant`, 401, token/refresh expired hoặc revoked, login required | `reauth_required` | Cần đăng nhập lại |
| Certificate, TLS, network, timeout, ECONN | `ca_or_network_error` | Chưa được phép kết luận token chết |
| Credential disabled | `disabled` | OMP không sử dụng credential |
| Có account nhưng chưa đủ bằng chứng | `auth_unknown` | Cần kiểm tra thêm |

Điểm quan trọng: `authenticated` chỉ chứng minh OAuth/usage preflight đạt; nó không tự chứng minh generation chat đang live. Hai trạng thái được tách riêng.

### 17.3. Logic Generation Health

Đây là trạng thái “lần sinh nội dung gần nhất”, không phải probe liên tục.

1. Quét đệ quy các file `~/.omp/agent/sessions/**/*.jsonl`.
2. Chỉ xét file có mtime trong 24 giờ gần nhất.
3. Đọc record có `message.role=assistant`.
4. Tìm `credential_pin` gần timestamp của message nhất để gán đúng account tại thời điểm đó.
5. Phân loại record mới nhất của từng account:
   - Có `429`, `resource exhausted`, `quota` hoặc `rate limit` → `blocked`.
   - Có `stopReason=error` hoặc error message → `error`.
   - Có text assistant → `live`.
   - Không có record trong cửa sổ → `unknown`.
6. UI hiển thị timestamp, model và lý do; không dùng nhãn “đang bị ban” khi chỉ có một 429 lịch sử.

### 17.4. Logic Token History

1. Quét toàn bộ session JSONL, không chỉ session đang mở.
2. Chỉ ghi usage của assistant message có đủ `provider` và `model`.
3. Mỗi usage record gồm timestamp, sessionId, account, provider/model, input, output, cache read/write, reasoning và total.
4. Account được gán theo `credential_pin` gần timestamp usage nhất; không dùng pin cuối file cho cả session.
5. Cache kết quả raw trong 30 giây để tránh quét lại hàng nghìn file cho mỗi repaint.
6. API trả tối đa 200 item mới nhất, dù `totalRecords` phản ánh toàn bộ record đã quét.
7. `summary` vẫn là thống kê 24 giờ để tương thích frontend cũ.
8. `periods` tính độc lập:
   - `hour`: rolling 60 phút.
   - `day`: rolling 24 giờ.
   - `month`: từ ngày 1 tháng hiện tại.
   - `year`: từ ngày 1 năm hiện tại.
   - `total`: toàn bộ history đã quét.

`total` là tổng usage OMP, có thể gồm cache và reasoning; không đồng nghĩa với số token output hiển thị cho người dùng.

### 17.5. Chọn account, màu account và cảnh báo quota

- Chọn account: UI gọi `POST /api/select-account`; server validate account tồn tại, ghi `selected-account.json`, xoá history cache và phát status mới. Preference global chỉ áp dụng ở `session_start` cho phiên OMP mới; không áp dụng lại trước từng lượt chat, để không ghi đè pin Gemini riêng của chat dashboard. Không di chuyển credential và không tự round-robin.
- Pin Gemini chat: resolver lấy access token bằng `getOAuthAccessByCredentialId(provider, credentialId)` đúng row đã pin, không dùng session-preferred resolver mềm để fallback sang account sibling. Nếu row đó không còn hoặc refresh thất bại, request bị từ chối.
- Màu account: UI gọi `PUT /api/account-colors` với email và màu `#RRGGBB`; server validate, ghi `account-colors.json`; History nhận `item.color` và dùng màu đó cho email.
- Màu mặc định: palette cố định theo danh sách email sort ổn định; màu người dùng chọn được lưu riêng.
- Cảnh báo quota: khi `usedFraction >= 0.9`, server ghi state chống lặp và gửi macOS notification một lần cho mỗi account/window; khi xuống dưới ngưỡng, cờ cảnh báo được xoá.

### 17.6. Login flow

`POST /api/login` spawn `omp auth-broker login google-antigravity`, bắt URL OAuth từ stdout/stderr, mở URL bằng macOS `open`, rồi cung cấp trạng thái qua `GET /api/login-status`. Khi process kết thúc, server refresh quota. Token/code không được lưu vào dashboard state hoặc report.

### 17.7. Console Bridge và lifecycle OMP

`console-bridge.mjs` giữ một `ConsoleContext` cho mỗi context interactive:

1. Validate `cwd` là absolute path tồn tại.
2. Spawn một child `omp --mode rpc` với stdin/stdout/stderr riêng.
3. Parse JSON Lines, giới hạn frame 1 MiB; giữ tối đa 300 raw frame đã redact.
4. Khi nhận `ready`, cập nhật protocol version, gửi `set_auto_retry:false` và phát `bridge_status`.
5. Browser nhận event qua SSE; reconnect của UI dùng `replay=0`, sau đó request lại state/messages.
6. Khi không còn client, context tự đóng sau 15 phút idle.
7. Stop gửi SIGTERM, chờ 1,5 giây, rồi SIGKILL nếu child chưa thoát.
8. Khi server nhận SIGINT/SIGTERM, đóng toàn bộ context trước khi thoát.

### 17.8. Safety Guard chống 429

Safety Guard áp dụng trước mọi generation command `prompt`, `steer`, `follow_up`, `abort_retry`:

- Không auto-retry.
- Không tự đổi model.
- Không tự đổi account/round-robin.
- Chỉ một generation đang chạy.
- Khoảng cách request tối thiểu 20 giây.
- 429 liên tiếp tăng cooldown: 15 phút → 1 giờ → 6 giờ → 24 giờ.
- State lưu tại `~/.omp/usage-dashboard/safety-state.json`, nên restart không xoá lịch sử bảo vệ.
- Thành công chỉ reset chuỗi 429 khi đã hết cooldown.

Guard có hai lớp: global guard trong bridge và `activeTurn/lastPromptAt` của từng context. Vì vậy một tab không thể né giới hạn bằng cách mở tab/context thứ hai.

### 17.9. OMP Gateway, DeepSeek Harness và OpenDesign

- Gateway là HTTP/SSE loopback tại `/api/omp/v1/*`, không expose credential.
- Một Harness `sessionId` ánh xạ vào một `ConsoleContext`; mapping hiện giữ trong memory của process.
- `prompt` hỗ trợ behavior `prompt`, `steer`, `follow_up`; `useEgoBrowser:true` thêm `/skill:ego-browser` nếu prompt chưa có.
- `command` chỉ nhận command trong allowlist; prompt tối đa 900.000 ký tự.
- DSH adapter đăng ký route `OMP · Gemini Pro` và `OMP · Gemini Pro · Ego`, chuẩn hoá raw OMP event thành text/tool/extension/finish/error.
- OpenDesign dùng OMP thông qua wrapper/connector; browser mở được OpenDesign nhưng lượt E2E gửi prompt chưa được tính là pass vì bị notification permission làm gián đoạn kiểm tra.

## 18. Bảng API và hợp đồng dữ liệu

### 18.1. Trang và API Dashboard

| Method | Route | Logic |
|---|---|---|
| GET | `/` | Quota Dashboard, inject `dashboard-live.js` |
| GET | `/console` | OMP Web Console |
| GET | `/healthz` | Liveness tối giản |
| GET | `/api/status` | Snapshot quota/auth/generation/safety/staleness |
| GET | `/api/status/events` | SSE status + heartbeat |
| POST | `/api/refresh` | Chạy quota refresh ngay |
| GET | `/api/history?limit=N` | History + periods + colors |
| GET/PUT | `/api/account-colors` | Đọc/lưu màu account |
| POST | `/api/select-account` | Đặt account ưu tiên |
| POST/GET | `/api/login`, `/api/login-status` | Bắt đầu và theo dõi OAuth login |
| GET | `/dashboard-live.js`, `/console-live.js` | Browser controller |

### 18.2. API Console

| Method | Route | Logic |
|---|---|---|
| POST | `/api/console/connect` | Tạo browser client ID |
| GET | `/api/console/state` | Tất cả context và safety |
| GET | `/api/safety` | Safety snapshot |
| GET | `/api/console/sessions` | ACP listAll, lọc cwd nếu có |
| GET | `/api/console/files` | Gợi ý file `@`, chặn path thoát cwd |
| POST | `/api/console/start` | Tạo RPC context |
| GET | `/api/console/events` | SSE raw OMP frame; có `replay=0` |
| POST | `/api/console/command` | Gửi command đã validate |
| POST | `/api/console/session` | New/switch/fork/branch/rename/archive/delete/compact/export/handoff/abort/retry |
| POST | `/api/console/stop` | Dừng context và child process |

### 18.3. API Gateway

| Method | Route | Logic |
|---|---|---|
| GET | `/api/omp/v1/capabilities` | Contract version và feature flags |
| POST | `/api/omp/v1/sessions` | Tạo/lấy context theo sessionId |
| GET | `/api/omp/v1/sessions/:id` | Context summary |
| GET | `/api/omp/v1/sessions/:id/events` | SSE raw frame, client nên dùng `replay=0` |
| POST | `/api/omp/v1/sessions/:id/prompt` | Prompt/steer/follow-up |
| POST | `/api/omp/v1/sessions/:id/command` | Command allowlist |
| POST | `/api/omp/v1/sessions/:id/abort` | Abort lượt đang chạy |
| DELETE | `/api/omp/v1/sessions/:id` | Stop context, xoá mapping memory |

## 19. Luồng thao tác end-to-end

### 19.1. Khi mở Dashboard `/`

```text
Browser tải HTML
  → dashboard-live.js gọi /api/status, /api/history, /api/account-colors
  → render account/quota/auth/generation/safety/history
  → mở EventSource /api/status/events
  → status thay đổi thì cập nhật realtime; history chỉ quét lại khi cần
  → refresh quota mỗi 60s; safety mỗi 10s; countdown mỗi 1s
```

Nếu `dataAgeMs > 90s`, UI đánh dấu stale; điều này là cảnh báo tuổi dữ liệu, không tự kết luận account chết. Nếu collector đang chạy, UI hiển thị refreshing.

### 19.2. Khi mở Console `/console`

1. Chỉ tải shell, chưa spawn OMP.
2. User bấm khởi động; browser tạo `clientId`, gọi `/api/console/start`.
3. Server tạo context và spawn `omp --mode rpc`.
4. Browser mở SSE với `replay=0`.
5. OMP gửi `ready`; bridge phát status, tắt auto-retry và UI gửi negotiate/state/model/provider/command requests.
6. User gửi prompt; UI gửi command HTTP; Safety Guard kiểm tra gap/concurrency/cooldown rồi mới ghi JSONL vào stdin OMP.
7. OMP stream frame; bridge parse, redact raw storage và phát SSE; UI render transcript, tool, usage, error và raw frame.
8. Khi `turn_end/agent_end`, Guard đóng active turn, phân loại 429/thành công và dashboard schedule refresh sau 750ms.
9. Reconnect không replay buffer; UI resync state/messages. Stop/idle/shutdown đóng child.

### 19.3. Khi OpenDesign/DSH gọi Gateway

```text
DSH/OpenDesign connector
  → POST /api/omp/v1/sessions
  → GET .../events?replay=0
  → POST .../prompt hoặc .../command
  → OMP RPC child
  → raw SSE event
  → connector normalize
  → UI/agent nhận text, tool, finish hoặc error
```

Không có bước nào tự chọn account mới khi request lỗi. Account preference đã lưu chỉ ảnh hưởng session OMP kế tiếp theo cơ chế OMP extension/preference.

## 20. Bảo mật, giới hạn và các chốt an toàn

- Loopback-only là ranh giới chính; local API hiện không có user authentication. Nếu reverse proxy hoặc bind ra LAN, phải thêm auth trước khi mở rộng.
- OAuth token, cookie, password, API key, authorization, code và secret được redact trong raw diagnostics/log payload.
- Request body JSON tối đa 1 MiB; OMP frame tối đa 1 MiB; raw frame buffer tối đa 300.
- Gateway prompt tối đa 900.000 ký tự; command phải nằm trong allowlist.
- `cwd` phải absolute và tồn tại; file suggestion chặn `.git`, absolute path, `~`, `../`; session archive/delete chỉ move file trong session root sang archive/trash.
- TLS verification không bị tắt; CA riêng được thêm qua bundle local.
- History không cần đọc nội dung prompt/tool output, chỉ lấy metadata usage và assistant message cần phân loại.
- `EADDRINUSE` được bắt riêng, ghi thông báo rõ và thoát có kiểm soát; LaunchAgent không tạo vòng restart khi process kết thúc thành công do port đã có owner.

## 21. Lịch sử thực hiện và quyết định kỹ thuật

### 21.1. Timeline theo Git và triển khai

| Thời điểm | Mốc | Kết quả |
|---|---|---|
| 16/09/2026 | `63fcf21 feat: add OMP dashboard platform` | Tạo Dashboard local, quota API, History, account preference |
| 19/09/2026 | `db0cfc5 fix: trust local CA for OMP OAuth` | Cho runtime tin CA local, xử lý lỗi OAuth qua AdGuard |
| 19/09/2026 | `213ff66 feat: add versioned OMP gateway` | Thêm contract Gateway HTTP/SSE loopback |
| 19/09/2026 | `6750986 feat: add DeepSeek Harness OMP client` | Thêm client host-side cho DSH |
| 19/09/2026 | `11e11d9`, `af1d3af`, `e212bf3`, `4ba1558` | Kết nối adapter, route Ego, context payload và optional ego-browser |
| 20–21/09/2026 | Các thay đổi hiện còn trong working tree | Hoàn thiện Console UI, SSE, session paging, auth/generation health, Safety Guard, periods, colors và test |

### 21.2. Từ vấn đề đến root cause và fix

| Vấn đề phát hiện | Root cause | Fix đã làm | Bằng chứng |
|---|---|---|---|
| `No API key found` | OAuth refresh không qua được CA AdGuard | CA bundle + `NODE_EXTRA_CA_CERTS`, không tắt TLS | OMP login/usage và commit CA |
| Chat bị 429 | Capacity/quota Google và dispatch quá dày | Guard: không retry, không đổi model/account; nhận order trước, FIFO theo session, dispatch song song giữa session, gap 1s, cooldown tăng dần | `/api/safety`, contract concurrency |
| SSE replay lặp message | Reconnect mặc định replay raw buffer | UI/Gateway dùng `replay=0`, resync state/messages | `console-smoke`, source bridge/client |
| History sai account | Gán theo pin cuối session | Nearest `credential_pin` theo timestamp | `quota-logic-smoke`, API history |
| Render 1.000 session | `listAll limit=1000` và render một lần | Render page 50 + “Hiển thị thêm” | live list `50/276` |
| `EADDRINUSE` nhiễu | Instance cũ giữ 4177, thiếu handler rõ | `server.on('error')` + LaunchAgent policy | duplicate-port test |
| UI nói “Chat bị chặn” tuyệt đối | Trộn auth/quota/generation và không có timestamp | Tách authStatus/generationStatus/reason/checkedAt/stale | `/api/status` + UI labels |
| Dashboard không realtime đủ | Chỉ polling hoặc status cũ | status SSE, heartbeat, `refreshing`, `dataAgeMs`, `stale` | `/api/status/events` |
| Token chỉ xem “hôm nay” | Summary chỉ có một kỳ | periods hour/day/month/year/total | `quota-logic-smoke`, `/api/history` |
| Không phân biệt account trong History | Email hiển thị cùng style | account-colors API/file + `item.color` | `/api/account-colors`, History API |
| Bridge báo `starting` quá lâu | Không broadcast khi OMP gửi `ready` | phát `bridge_status` ngay khi ready | console live smoke |

### 21.3. Các quyết định không làm

- Không sửa OMP core/installed package.
- Không đưa credential hoặc session content vào Git.
- Không dùng round-robin account để né 429.
- Không tự động đổi model để né lỗi.
- Không tạo background prompt probe định kỳ vì sẽ tự tiêu quota và có thể làm tăng risk block.
- Không đánh dấu OpenDesign E2E pass khi browser test chưa gửi/nhận được prompt hoàn chỉnh.

### 21.4. File và thành phần đã rà soát

| Nhóm | File/thành phần | Nội dung đã kiểm tra |
|---|---|---|
| Backend | `dashboard/server.mjs` | HTTP route, quota collector, auth, generation health, history, colors, login, status SSE, Gateway, shutdown |
| Bridge | `dashboard/console-bridge.mjs` | RPC/ACP child lifecycle, JSONL parser, redact, SSE, reconnect, idle cleanup, Safety Guard |
| Dashboard UI | `dashboard/quota-dashboard.html`, `dashboard/dashboard-live.js` | Account card, quota, auth/generation labels, countdown, periods, color picker, History |
| Console UI | `dashboard/console.html`, `dashboard/console-live.js` | Context, transcript, command surface, session paging/actions, raw frames, reconnect, safety |
| Integration | `integrations/deepseek-harness-omp/client.mjs` | Gateway HTTP/SSE client và event normalization |
| Integration | `integrations/deepseek-harness-omp/adapter.mjs` | DSH route/model registration |
| Integration | `integrations/deepseek-harness-omp/ego-mode.mjs` | Optional `/skill:ego-browser` route |
| Test | `tests/*.mjs` liên quan OMP/Console/Auth/Quota/DSH | Smoke contract và regression logic |
| Vận hành | LaunchAgent, `README.md`, `tasks/plan.md`, `tasks/todo.md` | Startup, migration, acceptance và lịch sử quyết định |

Các file trên trong repository đã được đối chiếu với bản runtime tương ứng; sáu file dashboard chính đều khớp byte-for-byte tại lượt kiểm cuối.

## 22. Sổ kiểm chứng hiện tại

### 22.1. Automated checks

Đã chạy đạt:

```text
node --check dashboard/server.mjs
node --check dashboard/dashboard-live.js
node tests/quota-logic-smoke.mjs
node tests/console-smoke.mjs
node tests/auth-status-smoke.mjs
node tests/omp-gateway-smoke.mjs
node tests/omp-client-smoke.mjs
node tests/dsh-omp-adapter-smoke.mjs
```

Các smoke test bao phủ: normalize quota/auth, period summary, attribution theo credential pin, màu account, Safety Guard, Gateway capabilities/session/prompt/abort, client SSE normalization và DSH adapter route.

### 22.2. Runtime checks

- `/healthz` đạt.
- `/api/status` đạt `ok:true`, `stale:false`, `refreshing:false` tại lần đọc.
- `/api/safety` đạt `blocked:false`, `activeTurns:0`, `recent429Count:0`, `consecutive429:0`, `lastDecision=healthy`.
- Port 4177 có đúng một listener.
- `/api/history` trả `periods`, `accountColors`, màu từng History item.
- Test instance trùng port thoát có thông báo rõ, không còn uncaught stack trace.
- Repository và runtime khớp ở `server.mjs`, `console-bridge.mjs`, `console-live.js`, `dashboard-live.js`, `quota-dashboard.html` và `console.html`.

### 22.3. Ping thật

Đã gửi tuần tự prompt nhẹ `Trả lời đúng một từ: OK` cho:

- `kuayay@gmail.com` → `OK`, `gemini-3.8-flash`.
- `tai.mobile081@gmail.com` → `OK`, `gemini-3.8-flash`.
- `aiaprompt00@gmail.com` → `OK`, `gemini-3.8-flash`.

Sau ping, Guard không cooldown và account ưu tiên được khôi phục về `bancuachungta123@gmail.com`.

## 23. Nguồn sự thật hiện tại — snapshot 21/09/2026

Đây là snapshot lấy trực tiếp từ runtime sau lần refresh gần nhất; không dùng số liệu lịch sử ở phần 4/5 để thay thế.

| Account | Auth | Generation gần nhất | Gemini 5 giờ còn | Gemini tuần còn | Diễn giải |
|---|---|---|---:|---:|---|
| `bancuachungta123@gmail.com` | authenticated | live | 29.57% | 35.64% | Account ưu tiên hiện tại |
| `tuantuoitan006@gmail.com` | authenticated | blocked lịch sử | chưa có | 24.33% | 429 gần nhất, chưa phải kết luận ban hiện tại |
| `tuantuoitan004@gmail.com` | authenticated | blocked lịch sử | 100.00% | 11.65% | Tuần gần quota, không nên dùng test dài |
| `kuayay@gmail.com` | authenticated | live | 99.56% | 66.57% | Ping thật đạt |
| `tai.mobile081@gmail.com` | authenticated | live | 99.91% | 76.25% | Ping thật đạt |
| `aiaprompt00@gmail.com` | authenticated | live | 99.88% | 54.31% | Ping thật đạt |

History runtime tại snapshot:

- `totalRecords`: `11.716`.
- 1 giờ: `323` request, `42.975.919` token.
- 1 ngày: `4.936` request, `954.856.715` token.
- Tháng: `11.705` request, `1.692.968.777` token.
- Năm: `11.716` request, `1.693.255.014` token.
- Total: `11.716` request, `1.693.255.014` token.

## 24. Giới hạn còn lại và backlog có chủ ý

1. Generation Health không phải live probe. Muốn biết account vừa chết hay vừa hồi phục, phải có generation mới hoặc ping thủ công; không tự ping nền để bảo vệ quota.
2. Hai account `tuantuoitan006` và `tuantuoitan004` đang có `blocked` là 429 lịch sử, không được UI diễn giải thành “Google ban account”.
3. History scan là O(số file + số dòng) khi cache hết hạn; nếu session log tăng rất lớn, bước tiếp theo nên là index metadata, chưa cần làm trước khi có bằng chứng chậm.
4. Gateway session map hiện chỉ ở memory; restart dashboard làm mất mapping Harness → context, nhưng không xoá session JSONL của OMP.
5. API loopback có cookie dashboard auth cùng Host/Origin allowlist và không được bind ra địa chỉ mạng nếu chưa có policy mở rộng được review.
6. Màu mặc định phụ thuộc danh sách account hiện tại; màu đã chọn thủ công mới là ổn định tuyệt đối.
7. Quota refresh 60 giây và History cache 30 giây nên “realtime” là gần realtime, không phải đồng hồ từng mili-giây.
8. Browser E2E OpenDesign chưa đạt đủ bằng chứng do notification permission chặn thao tác Run; phần này vẫn để trạng thái chưa xác nhận.

## 25. Quy trình vận hành chuẩn sau báo cáo

1. Kiểm tra `/healthz`, `/api/status`, `/api/safety`.
2. Chọn account còn quota phù hợp; không dùng account đang gần quota tuần/5 giờ cho test dài.
3. Gửi tối đa một prompt ngắn; chờ tối thiểu 20 giây trước lượt tiếp theo.
4. Xác minh frame `ready`/`turn_end`, response model, generation health và History.
5. Nếu 429: dừng, giữ model/account, không retry tự động, chờ cooldown hiển thị trên UI.
6. Nếu auth lỗi: phân biệt `reauth_required` với `ca_or_network_error` trước khi login lại.
7. Nếu UI và API khác nhau: ưu tiên API runtime, kiểm tra `dataAgeMs/stale`, sau đó restart LaunchAgent nếu cần.
8. Khi thay code: test → sync runtime → restart một service → kiểm tra đúng một listener → ghi snapshot mới vào báo cáo.

> Báo cáo đã ghi nhận cả logic đang chạy, lịch sử thay đổi, bằng chứng test, quyết định an toàn và giới hạn chưa giải quyết. Không có secret, token, cookie, password hoặc nội dung prompt riêng tư trong file này.

## 26. Cập nhật runtime 23/09/2026

Đây là addendum mới nhất; các bảng snapshot cũ trong báo cáo vẫn giữ timestamp lịch sử.

- Source/runtime `server.mjs`, `console-bridge.mjs` và live chat controller đã khớp checksum.
- `server.on("error")` đã xử lý bind-port; `EADDRINUSE` được báo có kiểm soát, không còn uncaught stack trong source hiện tại.
- `NODE_EXTRA_CA_CERTS` dùng CA bundle local cho OMP child process; chat order Ego Browser trước đó đã pass và không tái hiện lỗi certificate.
- Shared API hiện có cookie auth, Host/Origin check, CSP và redaction; không coi các ghi chú security cũ ở phần snapshot là trạng thái hiện tại.
- Historical 23/09 browser QA had the selected account blocked by `ACCOUNT_UNAVAILABLE`; it is superseded by the focused 24/09 production QA addendum below.
- No account/model switching or background prompt probe was used; the 24/09 rerun kept the selected live account and restored approval/tools settings afterward.

## 27. Focused production browser QA — 24/09/2026

- **PASS:** real Stop/abort, approval deny/approve, active steer plus reconnect guard/recovery, local/encrypted share, and Agent Hub subagent.
- Approval fix: OMP `extension_ui_request.method=select` now forwards the selected `Approve`/`Deny` value.
- Stop fix: explicit user abort/cancel/interruption no longer marks generation health as `chat_error`.
- Verification: `node --check server.mjs`, `./test-runtime-security.sh`, `node test-session-actions.mjs` (`22 scenarios passed`), production abort recovery smoke, and `/healthz` all pass.
- P2 recovery fix: `get_state` session path mapping plus user-prompt cache keeps an aborted ephemeral session listed, readable, and reconnectable after bridge recycle.
