# 05 — Vận hành, test & rollback 🔒

## 1. Kiểm tra nhanh

Chạy từ Terminal local:

```sh
launchctl list | rg 'com\.trannhattuan\.omp-usage-dashboard'
curl -fsS http://127.0.0.1:4177/healthz
sh '/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/test-runtime-security.sh'
```

Kết quả health đúng là JSON có `"ok":true`. Smoke test kiểm tra HTTP runtime: health, cookie/auth, host/origin, command guard và validation; không gửi lượt prompt tới OMP.

## 2. Restart đúng cách

Restart service đã được load:

```sh
launchctl kickstart -k gui/$(id -u)/com.trannhattuan.omp-usage-dashboard
```

Nếu label chưa load, load plist rồi kiểm tra health:

```sh
launchctl load -w '/Users/trannhattuan/Library/LaunchAgents/com.trannhattuan.omp-usage-dashboard.plist'
curl -fsS http://127.0.0.1:4177/healthz
```

Không chạy thêm server thủ công trên port 4177 khi LaunchAgent đang quản lý nó; hai process sẽ tranh port và khiến trạng thái launchd khó đọc.

## 3. Vị trí log và cách khoanh vùng lỗi

| Triệu chứng | Kiểm tra trước | Vị trí tiếp theo |
|---|---|---|
| Dashboard không mở | `curl /healthz`, `launchctl list` | stdout/stderr LaunchAgent theo plist. |
| 401/403 trong browser | Cookie/origin/host, đúng `127.0.0.1:4177` | `DASHBOARD_ORIGINS`, CSP, browser storage. |
| File picker sai folder | `OMP_DASHBOARD_WORKSPACE` trong plist | `listWorkspaceFiles`, canonical root. |
| File bị từ chối | Path relative, extension, kích thước, binary/secret name | `readWorkspaceFile` guard. |
| OMP Bash báo `rtk: command not found` | LaunchAgent cấp PATH chỉ gồm thư mục hệ thống; `rtk` nằm trong Homebrew | `server.mjs` thêm `/opt/homebrew/bin` và `/usr/local/bin` vào `OMP_ENV.PATH`; regression kiểm tra PATH kiểu LaunchAgent trong `test-session-actions.mjs`. |
| Steer/abort lỗi | Chat ACP không có steer; abort phải khớp active request/context | `UNSUPPORTED_ACTION` cho steer; `activeChatRequests`/ACP `session/cancel` cho abort. |
| Follow-up không chạy | Lượt trước đã kết thúc chưa; cùng context/session không | FIFO context; ACP gửi `session/prompt` kế tiếp sau settle. |
| Approval không hiện | OMP có permission/elicitation request đúng session không | SSE frames; `pendingApprovalRequests` được key theo chat session + upstream ID. |
| Agent Hub không khả dụng | Chat capability phải báo `unavailable` | ACP không có snapshot adapter; không giả `agents=[]`. |

Log/session OMP ở `~/.omp/logs` và `~/.omp/agent`. Chỉ trích đoạn đã redact khi gửi ra ngoài vì có thể chứa prompt, path hoặc dữ liệu hoạt động.

## 4. Ma trận kiểm thử đợt capability

Kết quả `test-session-actions.mjs` bên dưới dùng test-only RPC override để giữ contract cũ; không thay thế ACP-specific coverage.

| Kiểm tra | Kết quả | Cách chứng minh |
|---|---|---|
| Server/bridge/UI cú pháp và smoke security | Pass | `test-runtime-security.sh`. |
| Health service | Pass | `/healthz` trả `{"ok":true}` sau restart. |
| Capability API | Pass | Trả đúng `supported`/`partial`/`unavailable`. |
| Legacy RPC v2/event contract | Pass | `test-session-actions.mjs` với RPC test override: chunk, terminal event, local command output, native state. `/api/console/*` vẫn tách khỏi Chat ACP. |
| Legacy RPC active-turn follow-up | Pass | `test-session-actions.mjs` với RPC test override; Chat ACP follow-up có verification riêng bên dưới. |
| UTF-8 qua chunk OMP/ACP | Pass | `test-session-actions.mjs`: OMP chat delta và ACP session title giữ nguyên khi code point bị chia giữa byte. |
| Redaction lỗi SSE status/chat | Pass | `test-session-actions.mjs`: sentinel stderr và lỗi OMP không xuất hiện trong SSE; chat giữ `UPSTREAM_ERROR` và thông báo an toàn. |
| Legacy RPC steer khi không active | Pass | Test-only RPC path trả `409 CONFLICT`; Chat ACP luôn báo `UNSUPPORTED_ACTION`. |
| Approval ID giả | Pass | Trả `404 NOT_FOUND`, không tự approve. |
| Approval input/select | Pass | Giá trị roundtrip về đúng `extension_ui_response`, không coercion decision. |
| Legacy RPC Agent snapshot | Pass | Contract RPC cũ; Chat ACP mới báo `unavailable`, direct API trả unsupported. |
| File reference safe | Pass | Trả metadata/nội dung file source thật. |
| File traversal | Pass | `../server.mjs` bị `400`. |
| UI Files | Pass | Chỉ thấy source workspace, không thấy `state.json`/`chat-metadata.json`. |
| UI Agent Hub | Unavailable | Capability hiện trạng unavailable; UI giải thích ACP không có adapter và không dựng snapshot giả. |

### ACP chat worker pool verification (2026-09-26)

| Kiểm tra | Kết quả | Cách chứng minh |
|---|---|---|
| Shared worker, isolated chat sessions, fork và sibling lifetime | Pass | `test-acp-worker.mjs`; live OMP smoke tạo hai session, đóng một context, session sibling vẫn `ready`; không gửi prompt. |
| Worker startup failure cleanup | Pass | `test-acp-worker.mjs`: lỗi initialize không để worker trong pool hoặc process sống. |
| SSE history replay isolation | Pass | `test-acp-worker.mjs`: replay chỉ tới client mới, không nhân đôi frames hoặc phát lại cho client cũ. |
| Approval IDs trùng giữa chat | Pass | `test-session-actions.mjs`: cùng upstream ID ở hai session xử lý độc lập. |
| ACP capability catalog | Pass | `test-session-actions.mjs`: steer/Agent Hub unsupported và command chưa cài adapter không được quảng cáo. |
| Draft prewarm trong UI | Pass | Browser local smoke: tạo draft, worker ready/context-free; không tạo OMP session hoặc gửi prompt. |
| ACP runtime deploy + LaunchAgent restart | Pass | Backup code-only `20260926-205243-88137`; 9 source/runtime assets `cmp`; LaunchAgent `running`; `/healthz` và hai API HTTP 200. |
| Live Chat draft after deploy | Pass with limit | `/chat`/DOM, local-draft pill và composer verified; screenshot capture timeout; không gửi prompt. |
| ACP stream FIFO integration coverage | Gap | HTTP FIFO case nằm trong `test-session-actions.mjs` 86-scenario suite nhưng test server bật RPC override; `test-acp-worker.mjs` gọi bridge trực tiếp. Chưa có ACP `/api/v1/chat/stream` E2E. |

### Chưa chạy có chủ đích

- Prompt streaming thật và abort trên lượt model thật: tránh tiêu quota; ACP smoke chỉ mở/đóng session, không gửi prompt.
- Approval thật: cần thao tác OMP phát sinh confirm và có side effect.
- Share thật: tạo external encrypted URL.
- Agent Hub task thật: không có snapshot adapter ACP trong Chat hiện tại.

Không chạy live model prompt, approval có side effect hoặc encrypted share; thiếu bằng chứng runtime thật không được nâng các đường đó thành `PASS`.

## 5. Checklist sau mỗi thay đổi runtime

1. Backup file runtime bị sửa trước khi ghi đè.
2. Kiểm tra `OMP_DASHBOARD_WORKSPACE` vẫn trỏ source workspace mong muốn.
3. Restart bằng `launchctl kickstart`.
4. Chạy `/healthz` và `test-runtime-security.sh`.
5. Test error path trước: invalid file path, idle steer, fake approval.
6. Chỉ chạy prompt/share/approval thật khi người vận hành chấp thuận quota và external side effect.

## 6. Rollback có kiểm soát

Backup baseline của đợt này:

```text
/Users/trannhattuan/.omp/usage-dashboard/backups/capability-sprint/20260923-074054
```

Backup parity gần nhất sau đợt OMP Logic Parity Pass:

```text
/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-113112
```
Flow parity chi tiết: [10 — OMP Chat parity flow & handoff](10-OMP-CHAT-PARITY-FLOW-AND-HANDOFF-IMPORTANT-🔒.md).

Trước rollback, chụp trạng thái để không mất sửa đổi mới hơn:

```sh
mkdir -p '/Users/trannhattuan/.omp/usage-dashboard/backups/pre-rollback-20260923'
cp '/Users/trannhattuan/.omp/usage-dashboard/server.mjs' '/Users/trannhattuan/.omp/usage-dashboard/backups/pre-rollback-20260923/server.mjs'
cp '/Users/trannhattuan/.omp/usage-dashboard/console-bridge.mjs' '/Users/trannhattuan/.omp/usage-dashboard/backups/pre-rollback-20260923/console-bridge.mjs'
```

Sau đó chỉ copy lại đúng file cần phục hồi từ backup baseline, rồi restart service và chạy health/smoke. Không dùng `git reset --hard`, không xóa `~/.omp`, không đụng `~/.omp/agent` khi rollback dashboard.

Ví dụ phục hồi server/bridge:

```sh
cp '/Users/trannhattuan/.omp/usage-dashboard/backups/capability-sprint/20260923-074054/server.mjs' '/Users/trannhattuan/.omp/usage-dashboard/server.mjs'
cp '/Users/trannhattuan/.omp/usage-dashboard/backups/capability-sprint/20260923-074054/console-bridge.mjs' '/Users/trannhattuan/.omp/usage-dashboard/console-bridge.mjs'
launchctl kickstart -k gui/$(id -u)/com.trannhattuan.omp-usage-dashboard
curl -fsS http://127.0.0.1:4177/healthz
```

Chỉ rollback UI source khi đã xác định lỗi thuộc UI; runtime server, source UI và product release là ba bản khác phạm vi nên không copy chéo tùy tiện.

### OMP-native Memory rollout checkpoint — 2026-09-24

- Backup trước rollout: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-171216`; `MANIFEST.sha256` xác minh tất cả file `OK`.
- Runtime sau rollout: LaunchAgent `running`, `runs=55`; `/healthz` `200`; capability `memory=supported`; session status `backend=off`.
- Không đổi `memory.backend`, không chạy Memory operation thật. Không rollback vì health/API pass.
- Khôi phục bằng:

```sh
rtk sh '/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/deploy-local-dashboard.sh' --rollback '/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-171216'
```

Lệnh rollback phía trên ghi nhận checkpoint lịch sử 2026-09-24, khi deploy script cũ còn phục hồi state/config và backup `ego-browser-adapter.mjs`. Không chạy lại với script hiện tại: backup lịch sử thiếu marker `code-only-v1` nên bị từ chối.

Deploy hiện tại chỉ backup app code (kể cả `gemini-account-pin-extension.mjs`) và LaunchAgent plist; không backup state, config, session, log hoặc credential. `ego-browser-adapter.mjs` được giữ nguyên, không bị copy/xóa. Rollback xác minh manifest/checksum trước khi phục hồi danh sách code/plist và kiểm tra `/healthz` sau restart.

- Tại checkpoint Memory ban đầu, source/runtime `server.mjs` chưa đồng bộ như báo cáo 12 ghi nhận. Follow-up deployment lúc 18:39 ngày 2026-09-24 đã đồng bộ bundle sáu file; checksum source/runtime khớp. Evidence và checksum chi tiết nằm trong [12 — OMP-native Memory deployment & rollback](12-OMP-NATIVE-MEMORY-DEPLOYMENT-REPORT-IMPORTANT-🔒.md).

### Follow-up deployment checkpoint — 2026-09-24 18:39

- Backup: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-183906`; `MANIFEST.sha256` xác minh `OK`.
- Bundle sáu file đã đồng bộ; `server.mjs` SHA-256 `90badc19995fe869ef531ee35058d350cf908e0243b39c8d9f9fcaf74d80cde1`. LaunchAgent `running`, `runs=59`, PID `26335`, exit code `0`; `/healthz` `200`.
- Capability `memory=supported`; GET Memory status trả `backend=off`, `status=off`, `busy=false`. Không đổi cấu hình, không gọi Memory operation hoặc model thật.
- Predeploy: `rtk node test-session-actions.mjs` — `64 scenarios passed`; Node syntax và `rtk sh -n deploy-local-dashboard.sh` pass. Live invalid `requestId` và `browserMode` trả HTTP `400` với đúng field.
- `rtk sh test-runtime-security.sh` báo 500 hai lần tại probe `browserMode`; replay trực tiếp bằng browser, Node và chuỗi curl tương đương trả 400. Sai khác chưa tái hiện trong replay; không rollback vì health/API trực tiếp đều pass.
- Rollback follow-up:

```sh
rtk sh '/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/deploy-local-dashboard.sh' --rollback '/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-183906'
```

### Independent live verification checkpoint — 2026-09-24 22:28 +07

- Health `200`; LaunchAgent `running` (`runs=60`, PID `54641`, exit code `0`). Memory capability is supported; live backend/status is `off`. No Memory operation or model request was issued.
- Invalid `requestId` and `browserMode` return `400` with the expected field. Direct curl did not reproduce the earlier packaged-smoke `500`; that discrepancy remains unresolved.
- Source `server.mjs` (`a996a024…`, mtime `19:07:22 +07`) differs from runtime (`f1830387…`, mtime `18:54:34 +07`); the runtime checksum is recorded in backup `20260924-185433`. The other five bundle files match.
- Operator decision: retain current runtime; do not deploy the untested newer source or rollback. See [12 — OMP-native Memory deployment & rollback](12-OMP-NATIVE-MEMORY-DEPLOYMENT-REPORT-IMPORTANT-🔒.md) for full checksums and evidence.

### Review remediation deployment checkpoint — 2026-09-25 08:22:56

- Deploy source bằng `deploy-local-dashboard.sh --restart`; backup runtime: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260925-082256`. SHA sáu code file trong backup khớp hash predeploy.
- LaunchAgent có PID `69882`, chỉ nghe `127.0.0.1:4177`; `/healthz` trả `{"ok":true}`. Source/runtime SHA khớp 6/6; `server.mjs` `18522bfed53a13ddd043a998f00569c6cc072c5a182420c6cefa8dc35823474f`, `console-bridge.mjs` `5e2414963fbe9508b73347c5346fb6f3f0d3702c3203366eb92777c5ac02016d`.
- `rtk sh test-runtime-security.sh`: pass. Không chạy product-release installer, không gửi prompt/approval thật, không tạo share hoặc phát sinh quota; không đổi config/state ngoài snapshot backup.
- Rollback nếu cần:

```sh
rtk sh '/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/deploy-local-dashboard.sh' --rollback '/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260925-082256'
```

### SSE/UTF-8 remediation deployment checkpoint — 2026-09-26 09:24:48

- Deploy bằng `deploy-local-dashboard.sh --restart`; backup code-only: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260926-092448-8553`. Script xác minh checksum backup và `cmp` cả 7 app assets source/runtime.
- LaunchAgent `com.trannhattuan.omp-usage-dashboard` đã restart; PID `8618`, `LastExitStatus=0`; `/healthz` trả `{"ok":true}`.
- `rtk sh test-runtime-security.sh`: pass. Không gửi prompt, không thao tác approval/share, không phát sinh quota; không sửa state/config/session/log/credential.
- Rollback nếu cần:

```sh
rtk sh '/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/deploy-local-dashboard.sh' --rollback '/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260926-092448-8553'
```

### ACP worker pool deployment checkpoint — 2026-09-26

- Source archive trước thay đổi: `/Users/trannhattuan/Documents/CODE/omp-dashboard-acp-prechange-20260926.tar.gz`, 86 mục; SHA-256 `6afcb93cb6287b6faa9a4063e3146616190b51c8e83d1874d3fdc348ac706a8d`.
- Deploy bằng `deploy-local-dashboard.sh --restart`; runtime backup code-only `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260926-205243-88137`; `MANIFEST.sha256` toàn bộ `OK`.
- Chín asset source/runtime khớp; LaunchAgent `com.trannhattuan.omp-usage-dashboard` `running`; `/healthz` trả `{"ok":true}`. Hai API Chat status/capabilities trả HTTP 200.
- Browser xác nhận Chat draft, composer và API prewarm; không tạo OMP session hoặc gửi prompt. Screenshot không lấy được do Ego/CDP timeout; DOM/accessibility state vẫn kiểm tra được.
- Không gửi prompt/model/approval/share thật; không đổi config/state/session/log/credential; không commit. Rollback code-only bằng deploy script và backup trên.
- Queue test limit: HTTP stream FIFO tests chạy với RPC test override; chưa có ACP stream FIFO E2E. Chi tiết: [15 — ACP worker pool: triển khai, kiểm chứng và lịch sử](15-ACP-WORKER-POOL-IMPLEMENTATION-AND-DEPLOYMENT-HISTORY-IMPORTANT-🔒.md).
