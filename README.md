# OMP Dashboard Platform

Dashboard chạy cục bộ trên macOS để:

- Chat với OMP qua giao diện `/chat`.
- Theo dõi quota Gemini, tài khoản OAuth, trạng thái bảo vệ và lịch sử token qua `/quota`.
- Chọn tài khoản Google ưu tiên cho session OMP.

Dashboard không phải backend cloud, không tự lưu credential Google lên GitHub và không sửa mã nguồn lõi của OMP.

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
| Open Design PI wrapper | Không | Chỉ cần khi một app Open Design/PI khác muốn gọi OMP qua wrapper `integrations/open-design-pi-omp`. |
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
