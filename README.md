# OMP Dashboard Platform

Dashboard local để theo dõi quota Gemini của OMP, chọn account ưu tiên, xem nhật ký token và mở OMP Web Console.

## Thành phần

- `dashboard/`: server Node.js, giao diện quota và History token.
- `dashboard/console.html`, `dashboard/console-live.js`, `dashboard/console-bridge.mjs`: OMP Web Console Slice 1, gọi OMP RPC trực tiếp và hiển thị raw capability/event.
- `integrations/deepseek-harness-omp/`: host-side client để DeepSeek Harness dùng OMP Gateway, giữ Google auth/quota/skill ở OMP.
- `omp/agent/extensions/omp-account-preference.js`: extension OMP tự pin account được chọn khi mở session.
- `integrations/open-design-pi-omp`: wrapper tùy chọn cho app gọi OMP; không chứa logic account.
- `launchd/`: template tự khởi động dashboard trên macOS.

Platform không sửa mã nguồn lõi OMP và không chứa credential Google.

## Cài trên máy mới

1. Cài OMP bản mới nhất và Node.js. OMP cần chạy được tại `~/.bun/bin/omp`.
2. Chép `dashboard/*` vào `~/.omp/usage-dashboard/`.
3. Chép extension vào `~/.omp/agent/extensions/`.
4. Nếu cần wrapper, chép `integrations/open-design-pi-omp` vào thư mục executable và cấp quyền chạy.
5. Đăng nhập lại từng tài khoản Google bằng nút `Thêm tài khoản` trên dashboard.
6. Chọn account ưu tiên, rồi mở `http://127.0.0.1:4177/`.

Nếu máy dùng AdGuard hoặc proxy HTTPS có CA riêng, xuất CA công khai vào `~/.omp/usage-dashboard/ca-bundle.pem`. Dashboard và wrapper sẽ tự dùng file này cho OAuth; file `.pem` bị loại khỏi Git vì phụ thuộc từng máy.

Muốn tự chạy khi đăng nhập macOS thì thay `__HOME__` và `__NODE__` trong template LaunchAgent rồi nạp file vào `~/Library/LaunchAgents/`.

## Dữ liệu không đưa lên GitHub

Token OAuth, database OMP, session log, account đang chọn, state cache và log runtime đều bị loại khỏi repository. History trên máy mới sẽ bắt đầu từ các session mới.

## API local

- `GET /api/status`: quota và trạng thái account.
- `POST /api/refresh`: đồng bộ quota.
- `POST /api/login`: mở đăng nhập Google qua OMP.
- `POST /api/select-account`: chọn account ưu tiên.
- `GET /api/history?limit=50`: nhật ký token gần nhất.

## OMP Gateway cho DeepSeek Harness

Gateway version `1` dùng chung với Dashboard, chỉ bind loopback và không mở credential/token cho Harness:

- `GET /api/omp/v1/capabilities`: contract và feature flags.
- `POST /api/omp/v1/sessions`: tạo hoặc lấy OMP context theo `sessionId` của Harness.
- `GET /api/omp/v1/sessions/:id/events`: SSE raw OMP frames.
- `POST /api/omp/v1/sessions/:id/prompt`: gửi prompt; `useEgoBrowser: true` tự gọi `/skill:ego-browser`.
- `POST /api/omp/v1/sessions/:id/command`: gọi command OMP đã allowlist.
- `POST /api/omp/v1/sessions/:id/abort`, `DELETE /api/omp/v1/sessions/:id`.

Harness nên dùng `integrations/deepseek-harness-omp/client.mjs` từ host/plugin backend, không gọi Gateway trực tiếp từ browser. Client chuẩn hóa stream thành `text-delta`, `tool-start`, `tool-end`, `extension-request`, `finish` và `error`; OMP vẫn là agent loop thực thi.

### Bật route OMP trong DSH Web trên máy hiện tại

Bundle `dsh-omp-client` đã có patch native `ctx.llm.registerAdapter`, hai route `OMP · Gemini Pro`/`OMP · Gemini Pro · Ego` và model `gemini-3.8-flash`. Cài lại sau mỗi lần đổi connector:

```sh
pnpm --dir integrations/deepseek-harness-omp pack --pack-destination ~/.omp/usage-dashboard
dsh plugin --profile web remove dsh-omp-client
dsh plugin --profile web add ~/.omp/usage-dashboard/dsh-omp-client-0.1.0.tgz
dsh web --no-open
```

DSH Web dùng OMP route khi chọn `OMP · Gemini Pro` hoặc `OMP · Gemini Pro · Ego`; tài khoản, quota, skill và Ego vẫn do OMP quản lý. Không đưa `.dsh/.credentials.yaml` hoặc token vào repository.

## OMP Web Console

Mở `http://127.0.0.1:4177/console`, bấm `Khởi động OMP context`, rồi nhập prompt. Console hiện session/project list từ ACP, prompt/steer/follow-up, model, thinking, fast mode, queue, compaction, retry, bash, todos, subagents, login providers, extension dialogs, transcript/history, slash-command palette và `Advanced / Raw` RPC luôn hiển thị.

Chạy test smoke không gọi model:

```sh
node tests/console-smoke.mjs
node tests/omp-gateway-smoke.mjs
node tests/omp-client-smoke.mjs
```
