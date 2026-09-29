# Kế hoạch chuẩn hoá Catalog OMP → `/chat` và sidebar Công cụ

Trạng thái: đã triển khai source map, audit/drift, API validation và sidebar data-driven ngày 2026-09-29. Tài liệu giữ baseline, quyết định và gate vận hành khi OMP cập nhật.

## Kết quả audit làm baseline

- OMP đang chạy: `omp/18.3.2`, không còn là `18.2.7` như tài liệu cũ.
- Probe RPC không gửi prompt/model cho thấy roster mặc định gồm 11 native tool: `read`, `write`, `edit`, `grep`, `glob`, `bash`, `eval`, `task`, `todo`, `wait`, `web_search`.
- Probe `--tools` và ACP thật xác nhận `/chat` có thể khởi tạo chung 14 native tool: 11 tool trên cộng `ast_edit`, `lsp`, `debug`. Context ACP đạt `ready`; sau đó đã đóng session audit.
- `hub` lỗi `UPSTREAM_ERROR: Internal error` ngay ở ACP; phải là `blocked`, không thể có switch và không được gửi vào `--tools`.
- `wait` là tool thật nhưng sidebar hiện không có. Ngược lại `goal`, `init_experiment`, `run_experiment`, `log_experiment`, `update_notes` đang bị UI quảng cáo từ hardcode/config, nhưng chưa có bằng chứng active/current ACP; mặc định phải giữ ngoài lựa chọn Chat.
- Khi tool selection thay đổi, OMP có thể nạp roster MCP động (đã thấy provider `onedevtool`). Đây là tool external/dynamic, không phải ID builtin được tự ý truyền vào `--tools`; phải theo dõi riêng và không biến thành switch giả.
- Có hiệu ứng phụ thuộc/effective roster: một lựa chọn có thể làm OMP thêm tool khác. Catalog phải lưu cả `requestedTools` và `effectiveTools`, không suy diễn từ input UI.

`tasks/omp-capability-map.md` là bản ghi lịch sử 18.2.7, không còn được dùng làm nguồn sự thật.

## Quyết định kiến trúc

### Một source map có version, một snapshot runtime không chứa secret

Đã thêm:

- `omp-tool-map.json`: map source-controlled OMP → Chat. Nó giữ ID canonical, nhóm UI, label/icon, tier approval, kiểu lựa chọn, config evidence và lifecycle; không tự khẳng định một tool đang usable.
- `omp-tool-catalog.mjs`: một module nhỏ dùng chung bởi server và lệnh audit. Module đọc map, probe OMP, canonicalize roster, tính digest và fail-closed khi map/audit lỗi.
- Audit nội bộ của catalog chạy không gửi prompt/model, ghi snapshot đã redaction vào `~/.omp/usage-dashboard/tool-audits/`. Thư mục runtime này không vào Git.

Map không nhân bản danh sách tool trong `server.mjs`. `OMP_TOOL_DEFINITIONS`, `OMP_TOOL_APPROVAL`, `OMP_OBSERVED_TOOL_IDS` và blacklist ad-hoc được thay bằng output catalog duy nhất.

### Schema tối thiểu của từng tool

```json
{
  "id": "wait",
  "omp": {
    "kind": "builtin",
    "cliId": "wait",
    "configKeys": [],
    "probe": ["rpc.dumpTools", "acp.sessionNew"]
  },
  "chat": {
    "group": "orchestration",
    "label": "Chờ tác vụ",
    "icon": "wait",
    "approval": "read",
    "selection": "cli"
  },
  "lifecycle": { "state": "active" }
}
```

Runtime snapshot thêm `ompVersion`, thời điểm, config digest đã lọc, descriptor/schema digest, source (`builtin`/`mcp`), `requestedTools`, `effectiveTools`, ACP result và thay đổi so với snapshot trước. Không lưu prompt, token, cookie, credential, đường dẫn session hay raw config.

### State machine và fail-closed

Mỗi tool có trạng thái tách bạch: `verified`, `disabled_by_config`, `blocked`, `unmapped`, `removed`, `stale`, `probe_error`.

- Chỉ `verified` + `kind: builtin` + `selection: cli` mới có `canToggle: true`.
- Tool MCP được liệt kê trong nhóm Kết nối OMP với provider/source và trạng thái read-only; chỉ được toggle khi OMP công bố cơ chế chọn riêng và ACP đã pass.
- Tool mới, tool đổi schema, tool biến mất hoặc audit stale hiển thị rõ drift, nhưng không tự bật, không được gửi vào session và không được báo usable.
- `hub` được map vĩnh viễn như một record `blocked` có reason/evidence; khi OMP sửa, audit ACP mới có quyền chuyển nó thành `verified`.

## Contract `/api/v1/omp/capabilities`

Route giữ compatibility `tools[]` nhưng mỗi item phải trả metadata từ map + audit: `id`, `group`, `icon`, `status`, `reason`, `source`, `selection`, `approval`, `canToggle`, `lastVerifiedAt`, `effectiveIds` và `schemaDigest`.

Thêm `catalog` gồm `mapVersion`, `ompVersion`, `auditAt`, `stale`, counts, fingerprint và danh sách drift `added|removed|changed|blocked`. Response không trả raw OMP config/descriptions có thể nhạy cảm.

`POST /sessions`, prewarm và action `tools` dùng duy nhất catalog để validate. Backend chỉ chấp nhận ID toggleable của snapshot còn valid, gửi list canonical đã sort, rồi xác nhận effective roster. Nếu combo fail thì rollback selection và trả reason cụ thể; không tạo context “nửa sống nửa chết”.

## Sidebar đích

1. Header tóm tắt: OMP version, lần audit, `verified/blocked/drift` và nút Đồng bộ OMP.
2. Nhóm do map quyết định, không còn hardcode Cơ bản/Nâng cao: Workspace, Code intelligence, Thực thi, Điều phối, Web, Kết nối OMP và Không khả dụng/đã thay đổi.
3. Mỗi hàng có icon/label/mô tả, chip trạng thái, switch chỉ khi đủ điều kiện và nút Details. Details hiển thị nguồn OMP, selection mode, approval, config/probe evidence, last verified và reason.
4. Badge tab đếm tool `verified` có thể chọn; không đếm unavailable/MCP read-only như switch usable.
5. Khi OMP update: drawer hiện chip Drift; tool mới/đổi/bỏ vẫn nhìn thấy để Síp biết, nhưng không thể tác động Chat cho đến khi map được review. Tab Files không đổi flow.
6. Keyboard, `role=switch`, `aria-disabled`, focus, loading/rollback và desktop/tablet/mobile phải giữ đúng; không inject HTML từ metadata OMP.

## Các phase triển khai

### P0 — Baseline và contract map

- Thêm source map với 14 native đã xác nhận, `hub: blocked`, record lịch sử cho 5 ID chưa xác minh và khả năng MCP dynamic.
- Đánh dấu map 18.2.7 là historical; không xoá lịch sử audit.
- Chốt JSON schema/validator và migration storage v1 → v2.

Acceptance: map hợp lệ, không còn danh sách tool song song trong server/client, map chưa verified không thể ra `canToggle`.

### P1 — OMP audit và drift detector

- Probe no-session RPC để lấy default/effective descriptors; normalized digest không dựa vào source cache.
- Thêm ACP probe chỉ khi session isolation bằng `--session-dir` được xác minh; nếu không isolate được, không chạy background ACP probe và status là stale/manual-review.
- Phân loại builtin/MCP, added/removed/changed/blocked; lưu snapshot redacted ngoài repo.
- So sánh OMP version + config digest mỗi capability refresh theo TTL; OMP update làm catalog stale ngay thay vì giữ success cũ.

Acceptance: tool mới và schema đổi được phát hiện; không phát sinh model prompt/quota; unknown bị fail-closed.

### P2 — Server, selection và session migration

- Thay `readOmpToolCatalog`, approval map, observed IDs và blacklist bằng catalog compiled.
- Persist selection theo `{ mapVersion, fingerprint, selectedIds }`; migrate `localStorage['omp.tools']`/session metadata cũ, loại ID không verified và báo một lần.
- Validate combo trên boundary ACP, nhận effective roster; session action failure hoàn tác đúng selection cũ.
- Cập nhật API schema và fake-OMP fixtures.

Acceptance: mọi ID advertised toggleable khởi tạo chung ACP được; hub/unknown/MCP readonly bị từ chối trước spawn.

### P3 — Sidebar data-driven

- Bỏ `basicIds`, `glyphs` và trạng thái hardcode trong `renderOmpTools`.
- Render nhóm, row, detail, drift summary và manual audit action chỉ từ API catalog.
- Cập nhật Agent Hub/Settings để lấy cùng record `hub`, không còn hai trạng thái mâu thuẫn.

Acceptance: `wait` xuất hiện đúng, `hub` hiện blocked có lý do, tool mới hiện unmapped/read-only, không có switch vô hiệu nhưng nhìn như bật.

### P4 — Regression và nghiệm thu giao diện

- Unit/contract: map validator, status transitions, ID validation, migration, effective roster, diff added/removed/schema-changed và redaction.
- Integration: 14-tool ACP combo, `hub` blocked, stale audit, rollback context, dynamic MCP read-only.
- Ego Browser: mở/đóng drawer, tất cả row/switch/detail/a11y, session mới, đổi selection, lỗi/rollback, 360/390/768/1440, overflow/console/network.

Acceptance: không có 502 từ tool list do UI phát, test bảo vệ “advertised = ACP-startable”, live UI đúng ở bốn viewport.

### P5 — Release và vận hành cập nhật OMP

- Chạy audit trước deploy, checkpoint, syntax/security/contract/browser QA; deploy/restart riêng theo quy trình hiện có.
- Sau mỗi OMP update: audit → review drift → cập nhật source map → test ACP combo → release UI. Không merge tool mới chỉ vì nó xuất hiện trong snapshot.
- Dashboard có banner stale/drift để phát hiện update khi chưa review, kèm snapshot fingerprint để truy vết.

## Rollback và rủi ro

| Rủi ro | Cách chặn |
|---|---|
| OMP đổi tool nhưng UI vẫn bật | fingerprint/version đổi làm fail-closed, không reuse verified state cũ |
| Tool MCP động bị gửi sai qua `--tools` | phân loại `selection: readonly` mặc định |
| Tool đơn lẻ pass nhưng combo fail | contract bắt buộc test toàn bộ danh sách advertised |
| Audit làm đầy session/quota | RPC `--no-session`; ACP chỉ sau khi xác nhận isolation, tuyệt đối không gửi prompt |
| Local storage cũ chứa tool bỏ đi | migration sanitize + thông báo, server validate lại |
| Agent Hub quay lại usable | chỉ audit ACP success mới thay record từ blocked sang verified |

## Completion gate

- Một map JSON là source-controlled truth cho OMP → Chat.
- Mọi tool sidebar đều truy được bằng chứng runtime/version/probe và state history.
- OMP update tạo drift rõ ràng; không auto-enable, không gửi unknown IDs.
- Browser, contract và ACP combo pass trước deploy.
