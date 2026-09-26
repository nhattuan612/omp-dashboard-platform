# Kế hoạch sửa findings review — 2026-09-25

## Mục tiêu

Sửa các finding trên source/release; triển khai runtime chỉ sau khi Síp xác nhận riêng.
1. Approval `select` hết hạn không được tự chọn một option.
2. Workspace file guard phải chặn file nằm trong thư mục nhạy cảm, kể cả basename bình thường.
3. Mock server chỉ nghe loopback và không cho CORS wildcard.
4. Bundle `product-release/` phải đồng nhất với source được kiểm tra.

## Bảo toàn dữ liệu và Git

- Backup code-only đã tạo trước khi sửa: `/Users/trannhattuan/Documents/CODE/omp-dashboard-review-fix-backup-20260925.tar.gz`.
- Archive chứa server/bridge/mock/tests/schema và các runtime assets/manifest/installer trong `product-release/`; không chứa runtime state, config, log, credential hoặc session data.
- Project hiện là thư mục untracked dưới Git root `Documents`; root đó có nhiều thay đổi người dùng khác. Không dùng root Git này để branch/worktree, không stage/commit/push các thay đổi đó.
- Tạo một Git snapshot tạm chỉ từ code/test/release files được phép, ở ngoài project; tạo ba branch/worktree độc lập cho ba lát dưới đây. Tích hợp patch trở lại project sau khi review.
- Không chạy product-release installer; `deploy-local-dashboard.sh --restart` và `test-runtime-security.sh` chỉ chạy sau xác nhận riêng. Không đọc nội dung state/config/log hoặc thao tác OMP thật.

## Các lát song song

### A — Approval expiry
- Sửa `server.mjs`: timeout của `select` trả `{ cancelled: true }`, không gửi `denyValue`/option tùy ý.
- Giữ nguyên expiry semantics của `confirm`, `input`, `editor` ngoài phạm vi finding.
- Bổ sung integration regression test qua fake OMP: option thường như `feature/main`, `feature/release` hết hạn phải nhận cancel; explicit selection vẫn round-trip đúng.
- Timeout test phải deterministic, không chờ 10 phút; test seam nếu cần phải chỉ hoạt động khi chạy test và mặc định production vẫn là 600.000 ms.

### B — Sensitive workspace path
- Sửa `console-bridge.mjs`: áp dụng deny pattern nhạy cảm cho mọi path component khi list/read; không cho duyệt thư mục nhạy cảm.
- Bổ sung fixture `secrets/config.json`; autocomplete không liệt kê directory/file và API direct reference trả `403 FORBIDDEN`.
- Giữ nguyên file hợp lệ, giới hạn size, hidden path, symlink và cross-project boundaries hiện có.

### C — Mock server exposure
- Sửa `mock-server.js`: bind `127.0.0.1`; bỏ `Access-Control-Allow-Origin: *` ở response và preflight.
- Cập nhật `test-mock-api.js` dùng IPv4 loopback và assert API không phát CORS wildcard.
- Không đổi hành vi fixture API ngoài security boundary.

## Tích hợp release

Sau khi A/B/C được review và tích hợp:
- Đồng bộ sáu runtime assets từ source sang `product-release/`: server, bridge, live/legacy JS và hai HTML.
- Cập nhật `PRODUCT-MANIFEST.json` từ ngày version cũ sang `2026.09.25` (giữ định dạng date-version hiện có).
- So sánh SHA-256 từng cặp source/release; mục tiêu sáu cặp khớp.

## Acceptance và kiểm chứng

- Approval expiry regression pass; test select thủ công, confirm approve/deny vẫn pass.
- Workspace path regression pass; các traversal/symlink/.git/size guard cũ vẫn pass.
- Mock suite pass trên port 4178 chỉ sau khi xác nhận port trống; không kết nối service đang tồn tại.
- Chạy `node test-session-actions.mjs`, `node test-mock-api.js` (khi port 4178 trống), `node --check` trên JS nguồn/release, parse schema/manifest, parse inline JS HTML, và `sh -n` ba shell scripts.
- Trước deploy, đối chiếu runtime chỉ bằng hash code/HTML/JS; không đọc state/config/log. Sau xác nhận riêng, restart qua script chuẩn, kiểm tra `/healthz` và chạy security smoke không gửi prompt thật.
- Rà diff tích hợp để bảo đảm không chứa file ngoài scope hoặc secret.

## Rủi ro / giới hạn

- Test timeout seam chỉ được đọc khi `NODE_ENV === "test"`; production vẫn dùng mặc định 600.000 ms.
- Ba agent làm trên worktree tạm độc lập; test suite chỉ chạy sau khi tích hợp theo quy tắc workspace.
- Vì source project không được track trong Git riêng, kết quả agent sẽ được review/merge trong snapshot repo rồi áp dụng có kiểm soát lên source gốc; parent Documents Git không bị đổi.
## Kết quả kiểm chứng — 2026-09-25

- `rtk node test-session-actions.mjs`: PASS — 72 scenario trên isolated port 52491; gồm select expiry và sensitive workspace path regressions.
- `rtk node test-mock-api.js`: PASS — 12 scenario, 267 kiểm tra; port 4178 đã được xác nhận trống trước khi chạy.
- Node syntax checks, JSON parse, inline-script parse và `sh -n` cho ba shell scripts: PASS.
- SHA-256 source/release khớp 6/6 runtime assets; manifest `product-release` là `2026.09.25`.
- Deploy runtime được Síp xác nhận bằng `deploy-local-dashboard.sh --restart`; backup tại `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260925-082256`. LaunchAgent PID `69882`, listener `127.0.0.1:4177`, `/healthz` trả `{"ok":true}`; runtime/source SHA khớp 6/6.
- `rtk sh test-runtime-security.sh`: PASS. Sáu code asset trong backup khớp hash predeploy; không chạy product-release installer, không gửi prompt thật/share hoặc phát sinh quota.
