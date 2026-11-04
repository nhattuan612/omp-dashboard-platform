# OMP Dashboard Platform

## Giới thiệu (About)

OMP Dashboard Platform là giao diện cục bộ giúp quản lý các tài khoản Google Gemini đã đăng nhập qua OMP, theo dõi quota và lịch sử sử dụng, đồng thời chọn tài khoản phù hợp cho phiên làm việc. Người dùng có thể lần lượt thêm các tài khoản mình sở hữu hoặc được ủy quyền để tạo pool tài khoản và chủ động chọn giữa chúng. Dashboard không tạo tài khoản Google và không cấp thêm quota; việc đăng nhập, xác thực và sử dụng vẫn do OMP cùng Google xử lý.

### Tác giả và lưu ý sử dụng

Tác giả: **Tuấn Vũng Tàu**.

- Tác giả không khuyến khích dùng công cụ để spam hoặc gửi yêu cầu hàng loạt.
- Người dùng tự chịu trách nhiệm với cách sử dụng, điều khoản dịch vụ và tình trạng tài khoản; tác giả không chịu trách nhiệm nếu Google hạn chế hoặc khóa tài khoản.
- Theo thử nghiệm cá nhân, tài khoản dùng gói Add Family có vẻ dễ bị Google khóa hơn tài khoản mua gói trực tiếp. Đây là quan sát chưa được kiểm chứng độc lập, không phải kết luận hay cam kết của Google.

Chỉ thêm tài khoản mà bạn có quyền sử dụng và tuân thủ điều khoản áp dụng của Google, OMP cùng các dịch vụ liên quan.

Dashboard chạy cục bộ trên macOS để:

- Chat với OMP qua giao diện `/chat`.
- Theo dõi quota Gemini, tài khoản OAuth, trạng thái bảo vệ và lịch sử token qua `/quota`.
- Chọn tài khoản Google ưu tiên cho session OMP.

Dashboard không phải backend cloud, không tự lưu credential Google lên GitHub và không sửa mã nguồn lõi của OMP.

## Giao diện

Dashboard gồm hai khu vực chính: `/quota` để theo dõi tài khoản, OAuth và quota; `/chat` để chat streaming qua OMP. Các request từ `/chat`, OpenAI-compatible API và local API đều chỉ dùng model khả dụng của account Quota đang chọn; API key xác thực caller, không cấp tuyến model ngoài Quota.

<p align="center">
  <img src="product-release/honpi-dashboard-mark-8138753b.png" alt="OMP Dashboard" width="128">
</p>

### Quota và tài khoản

| Sáng | Tối |
|---|---|
| <img src="docs/screenshots/quota-dashboard-light.png" alt="Quota dashboard giao diện sáng" width="420"> | <img src="docs/screenshots/quota-dashboard-dark.png" alt="Quota dashboard giao diện tối" width="420"> |

### Chat và công cụ

| Sáng | Tối |
|---|---|
| <img src="docs/screenshots/chat-dashboard-light.png" alt="Chat dashboard giao diện sáng" width="420"> | <img src="docs/screenshots/chat-dashboard-dark.png" alt="Chat dashboard giao diện tối" width="420"> |

### Điểm mới ở 1.1.0

- `/chat`, OpenAI-compatible API và local API chỉ định tuyến qua model của account Quota đang chọn; OMP Gateway dùng Bearer key riêng.
- ACP tạo nhiều session độc lập trên worker dùng chung. Session mới bỏ bước quét lịch sử OMP; Safety Guard vẫn giãn prompt toàn dashboard tối thiểu 1 giây và cooldown khi gặp 429.
- Account được ghim theo session; nếu cấu hình ghim bị lỗi, request dừng an toàn thay vì tự chuyển sang account khác.

## Kiến trúc và thành phần

```text
Trình duyệt trên cùng máy
        │
        └── http://127.0.0.1:4177
                ├── /chat   → giao diện chat streaming/session/tools
                ├── /quota  → quota, account, OAuth, lịch sử token
                └── /healthz → kiểm tra runtime
                         │
                         └── ~/.bun/bin/omp
                              ├── ACP cho /chat
                              ├── quota/auth cho /quota
                              └── dữ liệu account/session của OMP
```

Runtime production gồm `server.mjs`, `console-bridge.mjs`, ACP worker, các file giao diện SKE và dependency Node trong `product-release/`.

## Cần cài gì?

| Thành phần | Bắt buộc? | Dùng để làm gì? |
|---|---:|---|
| macOS | Có, với installer production | Dùng LaunchAgent, `launchctl`, `plutil` và bộ chọn thư mục native. |
| Node.js | Có | Chạy `server.mjs`. |
| npm | Có | Cài dependency production (`node-pty`, `ws`, xterm). |
| OMP CLI | Có | Dashboard gọi trực tiếp OMP để chat, OAuth, quota và ACP. |
| PI riêng | Không | Dashboard không cần cài một app PI riêng. Biến `PI_CODING_AGENT_DIR` chỉ là tùy chọn nếu muốn trỏ sang thư mục agent khác. |
| Database riêng | Không | Dashboard dùng dữ liệu OMP hiện có và state file cục bộ trong `~/.omp`. |

### Điều kiện quan trọng của OMP

Code hiện tại gọi đúng executable này:

```text
~/.bun/bin/omp
```

Kiểm tra trước khi cài:

```bash
test -x "$HOME/.bun/bin/omp" && echo "OMP OK" || echo "Thiếu ~/.bun/bin/omp"
"$HOME/.bun/bin/omp" --version
node --version
npm --version
```

Repo không bao gồm trình cài OMP. Hãy cài OMP theo bộ cài chính thức của môi trường đang dùng, sau đó bảo đảm binary nằm tại `~/.bun/bin/omp`.

## Cài đặt trên máy mới

### 1. Lấy source

```bash
git clone https://github.com/nhattuan612/omp-dashboard-platform.git
cd omp-dashboard-platform
```

### 2. Cài OMP và Node.js

Hoàn tất điều kiện ở phần trên. Không cần cài PI riêng để chạy dashboard.

### 3. Cài dashboard production

Chạy từ thư mục repo:

```bash
cd product-release
chmod +x install-local-dashboard.sh
./install-local-dashboard.sh
```

Installer sẽ tự:

1. Kiểm tra Node.js, npm và `~/.bun/bin/omp`.
2. Copy runtime vào `~/.omp/usage-dashboard/`.
3. Chạy `npm ci --omit=dev` trong runtime.
4. Copy extension chọn account vào `~/.omp/agent/extensions/omp-account-preference.js`.
5. Tạo LaunchAgent `com.trannhattuan.omp-usage-dashboard`.
6. Khởi động server bằng port `4177` và chờ `/healthz` trả thành công.
7. Tạo backup code-only trước khi thay file runtime.

Khi cài thành công, mở:

- Chat: [http://127.0.0.1:4177/chat](http://127.0.0.1:4177/chat)
- Quota: [http://127.0.0.1:4177/quota](http://127.0.0.1:4177/quota)
- Health: [http://127.0.0.1:4177/healthz](http://127.0.0.1:4177/healthz)

## IP, port và phạm vi truy cập

Server bind cứng vào loopback:

```js
server.listen(PORT, "127.0.0.1", ...)
```

Vì vậy:

- `127.0.0.1` và `localhost` là địa chỉ đúng trên chính máy cài dashboard.
- Port mặc định là `4177`.
- Dashboard không mở cho LAN, không dùng IP Wi-Fi, không dùng public IP và không có ý định chạy trực tiếp qua Internet.
- Máy khác muốn dùng dashboard phải cài và chạy một runtime riêng trên chính máy đó.

Khi chạy Node trực tiếp, port có thể đổi bằng `OMP_DASHBOARD_PORT`; installer production hiện cấu hình cố định `4177` trong LaunchAgent.

## Sử dụng lần đầu

1. Mở `/quota`.
2. Dùng nút thêm/đăng nhập tài khoản để hoàn tất Google OAuth qua OMP.
3. Chờ quota load xong, kiểm tra trạng thái tài khoản và lịch sử token.
4. Chọn account đang dùng nếu cần ưu tiên một tài khoản.
5. Mở `/chat`, tạo hoặc chọn session, chọn model/tool theo quyền OMP rồi gửi prompt.
6. Khi chat cần browser, chỉ bật capability browser khi endpoint local đã sẵn sàng.

Dashboard không tự tạo tài khoản Google. OAuth và credential nằm trong vùng dữ liệu OMP của người dùng.

## Chạy thủ công để phát triển hoặc chẩn đoán

Không cần LaunchAgent khi chỉ muốn chạy tạm:

```bash
npm ci
node server.mjs
```

Sau đó mở `/chat` hoặc `/quota` ở port `4177`. Lệnh này vẫn yêu cầu `~/.bun/bin/omp` nếu dùng chức năng live.

Kiểm tra nhanh:

```bash
curl -fsS http://127.0.0.1:4177/healthz
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4177/chat
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4177/quota
```

## Các đường dẫn chính

### Giao diện

| URL | Chức năng |
|---|---|
| `/chat` | Chat streaming, session, tool, approval và browser capability. |
| `/quota` | Account Google, quota 5 giờ/tuần, OAuth, rotation, chart và lịch sử token. |
| `/healthz` | Health check cho installer/LaunchAgent. |

### API chính

| API | Chức năng |
|---|---|
| `GET /api/v1/quota/accounts` | Danh sách account quota live. |
| `GET /api/v1/quota/overview` | Tổng quan quota. |
| `GET /api/v1/quota/history` | Lịch sử token theo khoảng thời gian. |
| `POST /api/v1/quota/switch` | Chuyển account đang ưu tiên. |
| `POST /api/v1/quota/sync` | Đồng bộ quota. |
| `POST /api/v1/chat/send` | Gửi chat request. |
| `GET/POST /api/v1/chat/stream` | Nhận stream chat. |
| `POST /api/v1/chat/abort` | Hủy lượt chat đang chạy. |

API dashboard được bảo vệ bằng session cookie local; không coi đây là API public để expose ra mạng.

OMP Gateway (`/api/omp/v1/*`) yêu cầu Bearer key riêng, được tạo lần đầu khi service khởi động và lưu tại `~/.omp/usage-dashboard/omp-gateway-api-key` với quyền `0600`. Key này khác key của `/api/local/v1`; client cần gửi `Authorization: Bearer <key>` và giữ key trong cấu hình bí mật của client.

## Kiểm tra service và log

```bash
LABEL=com.trannhattuan.omp-usage-dashboard
DOMAIN="gui/$(id -u)"

launchctl print "$DOMAIN/$LABEL"
curl -fsS http://127.0.0.1:4177/healthz
tail -n 100 "$HOME/.omp/usage-dashboard/server.stdout.log"
tail -n 100 "$HOME/.omp/usage-dashboard/server.stderr.log"
```

Nếu port bị chiếm:

```bash
lsof -nP -iTCP:4177 -sTCP:LISTEN
```

Nếu OMP không được tìm thấy:

```bash
ls -l "$HOME/.bun/bin/omp"
"$HOME/.bun/bin/omp" --version
```

Nếu OAuth/proxy dùng CA riêng, đặt CA công khai tại:

```text
~/.omp/usage-dashboard/ca-bundle.pem
```

Runtime tự nạp file này qua `NODE_EXTRA_CA_CERTS`. Không commit file CA vào GitHub.

## Cập nhật dashboard

Từ source mới:

```bash
git pull --ff-only
cd product-release
./install-local-dashboard.sh
```

Installer tạo backup trước khi copy. Script rollback hiện có ở repo là flow bảo trì cho máy maintainer và có đường dẫn cấu hình riêng; trước khi dùng trên máy khác phải kiểm tra các biến đường dẫn trong script:

```bash
cd /path/to/omp-dashboard-platform
./deploy-local-dashboard.sh --rollback "$HOME/.omp/usage-dashboard/backups/deploy/<timestamp>"
```

Chỉ rollback backup nằm bên trong `~/.omp/usage-dashboard/backups/deploy/`.

## Dừng hoặc gỡ dashboard

Dừng LaunchAgent:

```bash
LABEL=com.trannhattuan.omp-usage-dashboard
DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL"
```

Gỡ hoàn toàn cần cân nhắc vì sẽ xóa runtime và state dashboard; dữ liệu account/session của OMP nằm ở vùng khác. Repo hiện chưa có lệnh uninstall tự động, nên không chạy lệnh xóa hàng loạt nếu chưa backup.

## Dữ liệu và bảo mật

Không đưa các dữ liệu sau lên GitHub:

- Google OAuth token/credential.
- Database, session và archive của OMP.
- Account đang chọn, quota state, history cache, log và backup runtime.
- CA bundle riêng của máy.

Các file dashboard được phục vụ local qua loopback. Nếu cần chia sẻ cho người khác, hãy triển khai một lớp gateway/auth riêng; không đổi bind address một cách tùy tiện.

## Kiểm tra source trước khi phát hành

```bash
cmp -s honpi-quota-dashboard-SKE.html product-release/honpi-quota-dashboard-SKE.html
node --check server.mjs
node --check console-bridge.mjs
node --check acp-worker.mjs
sh -n product-release/install-local-dashboard.sh
git diff --check
```

Tài liệu backend/API chi tiết nằm trong [`BACKEND_HANDOFF.md`](BACKEND_HANDOFF.md). `dashboard/` và các HTML legacy là tài sản tham khảo/compatibility, không phải entrypoint production của `/chat` và `/quota`.
