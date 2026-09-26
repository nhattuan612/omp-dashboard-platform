# Runbook triển khai local

## Cập nhật dashboard

```sh
cd "/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI"
./deploy-local-dashboard.sh --restart
```

Script tạo checkpoint đầy đủ (backend, hai SKE, LaunchAgent, state/config, checksum) vào
`/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/<timestamp>/` trước khi copy.
Backup có quyền thư mục `700`, file `600`; không chứa log/session export/token.

## Kiểm tra

```sh
curl -I http://127.0.0.1:4177/chat
curl -I http://127.0.0.1:4177/quota
./test-runtime-security.sh
node test-session-actions.mjs
node test-mock-api.js
launchctl print gui/501/com.trannhattuan.omp-usage-dashboard
lsof -nP -iTCP:4177 -sTCP:LISTEN
```

## Rollback

```sh
./deploy-local-dashboard.sh --rollback /Users/trannhattuan/.omp/usage-dashboard/backups/deploy/YYYYMMDD-HHMMSS
```

Rollback khôi phục toàn bộ checkpoint và tự chờ `/healthz` sau restart. Runtime chỉ bind
`127.0.0.1:4177`; API yêu cầu cookie phiên process-scoped, Host/Origin loopback, CSP và
rate limit mutation. Không mở LAN/public.
