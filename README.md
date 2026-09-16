# OMP Dashboard Platform

Dashboard local để theo dõi quota Gemini của OMP, chọn account ưu tiên và xem nhật ký token.

## Thành phần

- `dashboard/`: server Node.js, giao diện quota và History token.
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

Muốn tự chạy khi đăng nhập macOS thì thay `__HOME__` và `__NODE__` trong template LaunchAgent rồi nạp file vào `~/Library/LaunchAgents/`.

## Dữ liệu không đưa lên GitHub

Token OAuth, database OMP, session log, account đang chọn, state cache và log runtime đều bị loại khỏi repository. History trên máy mới sẽ bắt đầu từ các session mới.

## API local

- `GET /api/status`: quota và trạng thái account.
- `POST /api/refresh`: đồng bộ quota.
- `POST /api/login`: mở đăng nhập Google qua OMP.
- `POST /api/select-account`: chọn account ưu tiên.
- `GET /api/history?limit=50`: nhật ký token gần nhất.
