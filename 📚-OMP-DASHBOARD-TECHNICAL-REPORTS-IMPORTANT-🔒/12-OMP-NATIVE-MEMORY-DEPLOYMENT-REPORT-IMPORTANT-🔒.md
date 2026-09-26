# 12 — OMP-native Memory: triển khai live & rollback 🔒

**Ngày:** 2026-09-24  
**Phạm vi:** rollout adapter/API/UI Memory native trên dashboard local. OMP vẫn sở hữu backend, dữ liệu và lifecycle.

## Kết quả

- Runtime live đã nhận bản có Memory adapter. Bằng chứng: backup triển khai `20260924-171216` lưu checksum source; checksum `server.mjs` tại mốc deploy là `6906bba00e2f5281c0c5d51d684496eb1beb60e51094d7c23e564f4a292cbab4`, trùng runtime live. Các file còn lại trong bundle cũng khớp checksum source tại mốc đó.
- Backup ghi LaunchAgent đang chạy với `runs = 54`; trạng thái hiện tại `running`, `runs = 55`, `last exit code = 0`. `/healthz` trả HTTP `200`, `{"ok":true}`.
- `/api/v1/omp/capabilities` trả HTTP `200`, `featureStatus.memory = supported`.
- `GET /api/v1/sessions/:id/memory` trên một session đã tồn tại trả HTTP `200`, `backend = off`, `status = off`, `scope = null`, không có operation khả dụng, `busy = false`.
- `memory.backend` không bị bật/đổi. Không gọi `view`, `stats`, `diagnose`, `queue`, `sync`, `enqueue`, `rebuild`, `clear` hoặc `reset` trên production.
- Rollback snapshot được kiểm chứng: mọi file trong `MANIFEST.sha256` của backup trả `OK`.

Bản deploy được áp dụng trong lúc preflight đang diễn ra; backup/checksum và lần restart xác nhận thay đổi đã lên live. Sau khi phát hiện runtime đã đồng bộ, không chạy lại full deploy để tránh ghi đè thay đổi khác.

## Phạm vi đã lên live

- Capability `memory` và API trạng thái `GET /api/v1/sessions/:id/memory`.
- API thao tác `POST /api/v1/sessions/:id/memory/action`; chỉ allowlist native OMP, kiểm tra backend/command, yêu cầu `expectedBackend` và xác nhận với mutation, chặn session không tồn tại, session đang bận và thao tác không được công bố.
- Panel Memory trong Settings theo session; backend `off` không có đường bật từ UI. Dashboard không tạo kho Memory riêng, không ghi Memory output vào metadata/log.
- Không expose `mm …`; `scope` giữ `null` khi OMP không công bố cấu trúc. Hindsight `clear` không tuyên bố xóa bank phía server; Sharpshooter không expose `clear/reset`.

## Kiểm chứng

### Contract và UI cô lập

- `rtk node test-session-actions.mjs`: `59 scenarios passed`.
- `rtk node --check server.mjs`, `rtk node --check test-session-actions.mjs` và `rtk sh test-runtime-security.sh`: pass.
- Fake OMP/browser smoke: panel đọc backend `local` và output giả; bấm Clear chỉ mở cảnh báo/xác nhận, không dispatch lệnh xóa. Đã kiểm tra viewport desktop và mobile 390px, không tràn ngang.
- `rtk sh -n deploy-local-dashboard.sh`: pass.

### Live read-only

- Dashboard `http://127.0.0.1:4177/chat` tải được; health, capability và Memory status cho kết quả như phần Kết quả.
- `/api/v1/sessions` trả HTTP `200`, có 50 session; không ghi session ID vào báo cáo.
- DOM của live page có `#ompMemoryStatus`. Tuy vậy panel nằm trong tab OMP chưa active và không có session đang chọn; lần mở tab bị `#greetingSection` chặn pointer. Dừng tại đó, không click qua overlay, không chọn session và không chạy Memory action. Vì vậy trạng thái off được xác minh qua API; live panel không được mở trực quan trong lần kiểm tra này. UI panel đã được kiểm tra bằng fake OMP cô lập.

## Source/runtime sai khác lịch sử (trước follow-up deployment)

Các checksum sau ghi trạng thái tại thời điểm lập báo cáo ban đầu, không phải runtime hiện tại. Runtime `server.mjs` khi đó có checksum `6906bba00e2f5281c0c5d51d684496eb1beb60e51094d7c23e564f4a292cbab4`; source cùng thời điểm có checksum `a42f8fd224bb334ae7fa61b0388d9017d3f79f0e7452ae49c3698ae0a9114332`. Memory status/action handlers và guard unknown-session đã được đối chiếu; source còn khác ở phần đồng bộ tạo session ngoài phạm vi Memory. Follow-up rollout phía dưới đã xử lý sai khác source/runtime.

## Rollback

Snapshot trước rollout:

```text
/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-171216
```

Chạy lệnh sau để khôi phục runtime, state/config và plist từ snapshot, restart LaunchAgent, rồi chờ `/healthz`:

```sh
rtk sh '/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/deploy-local-dashboard.sh' --rollback '/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-171216'
```

Rollback **không được chạy trong rollout này** vì health và API đều pass. Script lưu/khôi phục cả `ego-browser-adapter.mjs` nếu file có tồn tại. Trước rollback thật, chụp lại state/config hiện hành nếu cần giữ thay đổi phát sinh sau snapshot; lệnh rollback sẽ khôi phục các bản state/config ở thời điểm backup.

## Ranh giới vận hành

- Capability `supported` nghĩa là adapter được triển khai; không có nghĩa backend hoặc Memory data đang bật.
- Production backend hiện `off`. Bật backend, đổi cấu hình, chạy xử lý model-backed hoặc gọi mutation thật là thay đổi riêng, cần operator approval.
- API status đọc-only đã chạy live; không thực hiện thao tác Memory thật trong rollout này.

## Follow-up deployment — 2026-09-24 18:39 🔒

- `deploy-local-dashboard.sh --restart` triển khai bundle mới; backup: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-183906`.
- `MANIFEST.sha256` của backup xác minh `OK` cho app files và LaunchAgent. SHA-256 của cả sáu file deploy khớp giữa source và runtime; `server.mjs`: `90badc19995fe869ef531ee35058d350cf908e0243b39c8d9f9fcaf74d80cde1`.
- LaunchAgent `running`, `runs=59`, PID `26335`, exit code `0`; `/healthz` trả `200 {"ok":true}`.
- Capability API trả `memory=supported`; GET Memory status trên session tồn tại trả `backend=off`, `status=off`, `busy=false`. Không đổi backend, không gọi Memory operation hoặc model thật.
- Regression cô lập: `64 scenarios passed`; Node syntax và deploy shell syntax pass. Live invalid `requestId` trả `400`, `field=requestId`; invalid `browserMode` trả `400`, `field=browserMode`, không dispatch OMP.
- `rtk sh test-runtime-security.sh` hai lần báo `expected HTTP 400, got 500` tại request `browserMode`. Sau đó browser, Node fetch và chuỗi curl tương đương đều trả đúng `400 BAD_REQUEST`; nguyên nhân lệch giữa script và replay chưa xác định. Health/API hiện hoạt động, không rollback.

Rollback về snapshot follow-up nếu cần:

```sh
rtk sh '/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/deploy-local-dashboard.sh' --rollback '/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-183906'
```


## Independent live verification — 2026-09-24 22:28 +07

- Read-only agent check: `/healthz` HTTP `200`; LaunchAgent `running`, `runs=60`, PID `54641`, exit code `0`.
- Capability endpoint returned HTTP `200`, 12 features, Memory `supported`. Memory status on an existing session returned HTTP `200`, backend/status `off`, `busy=false`, no available operation. No Memory action or model request was issued.
- Invalid `requestId` and `browserMode` each returned HTTP `400`, `BAD_REQUEST`, with the correct `field`.
- Direct curl did not reproduce the packaged security script's earlier `500`. The script/replay discrepancy remains unresolved; the full script was not rerun.

### Current source/runtime checksums

The runtime `server.mjs` matches the deployment checksum recorded in `backups/deploy/20260924-185433/source-checksums.sha256`; current source has since changed:

| File | Source SHA-256 | Runtime SHA-256 | Result |
|---|---|---|---|
| `server.mjs` | `a996a0242661babcfd8131f2253ca0bf8755b15897468ec5f544b01419f1faee` | `f183038798344027429cd67afad758295c0cf59c2d1c7e5e656dde870320ddcd` | Mismatch |
| `console-bridge.mjs` | `55766f63536ceb70e28a187e1c9493918a14bed246e1d18c66cfdc82b3aace43` | `55766f63536ceb70e28a187e1c9493918a14bed246e1d18c66cfdc82b3aace43` | Match |
| `honpi-chat-dashboard-SKE.html` | `10959edbd88f95f426c4a727fe18ceea96e5463d4b170c0856444fb8199f091c` | `10959edbd88f95f426c4a727fe18ceea96e5463d4b170c0856444fb8199f091c` | Match |
| `honpi-chat-dashboard-live.js` | `15f27ec484d6109cc16211a4bb48d13e419eef3852d986656974ce23b901e039` | `15f27ec484d6109cc16211a4bb48d13e419eef3852d986656974ce23b901e039` | Match |
| `honpi-chat-dashboard-legacy.js` | `29c2cd5c37df4a082910ee61b7287f33f22e90c2730db2349ff32409fbb72ee1` | `29c2cd5c37df4a082910ee61b7287f33f22e90c2730db2349ff32409fbb72ee1` | Match |
| `honpi-quota-dashboard-SKE.html` | `ba182b3b95297fc1d511c2f51b71ed5128a6b1267364a345d6b8deea4ab69156` | `ba182b3b95297fc1d511c2f51b71ed5128a6b1267364a345d6b8deea4ab69156` | Match |

Source `server.mjs` contains the later `authAccountKey` refactor and has mtime `19:07:22 +07`; runtime mtime is `18:54:34 +07`. Thus the `18:39` source/runtime parity above is historical, not the current state.

### Operator decision

Operator chose to keep the current runtime. The newer source was not deployed because it had not been regression-tested. No rollback was performed: health and direct validation checks passed.

