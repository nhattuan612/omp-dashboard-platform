# Kế hoạch audit và nâng cấp `/quota`

Ngày audit: 2026-10-24
Phạm vi: code backend/frontend, API live tại `http://127.0.0.1:4177/quota`, responsive desktop/mobile, luồng History và Quick Check.

## Kết luận audit

1. **Sai ngữ nghĩa và hiển thị ở toàn bộ bộ lọc thời gian**
   - Backend đang dùng cửa sổ trượt 30 ngày (`30d`), nhưng UI hiển thị `Tháng này (30n)`.
   - Lỗi chung không chỉ ở `30d`: cả `1h`, `24h`, `7d`, `30d` và `all` đều bị ép vào 12 bucket, khiến cùng một kiểu label không phù hợp với từng khoảng.
   - `1h`/`24h` chỉ hiện giờ nên còn đọc được tương đối; `7d`/`30d` bị lặp giờ và mất ngày; `all` mất cả ngữ cảnh ngày/năm.
   - Cần chọn và ghi rõ một hợp đồng duy nhất: `30 ngày qua` (rolling window) hoặc `Tháng hiện tại` (calendar month). Theo hành vi API hiện tại, giữ rolling window và sửa nhãn.

2. **Chart không đủ ngữ cảnh ngày tháng**
   - Backend chia mỗi scope thành đúng 12 bucket bằng nhau, trả label chỉ `HH:mm`.
   - Với 7 ngày, 30 ngày và toàn bộ lịch sử, label bị lặp/không thể biết ngày; dữ liệu live đã cho thấy 30 ngày lặp các mốc giờ.
   - Legend đang nói `Input + Cache` và `Output`, nhưng frontend chỉ vẽ một đường tổng `bar.total`.

3. **History chậm do kiến trúc đọc dữ liệu**
   - `readTokenHistory()` quét và parse toàn bộ JSONL rồi sort toàn bộ dữ liệu.
   - `loadAll()` gọi 5 scope History; interval 30 giây tiếp tục gọi lại. Single-flight hiện tại chỉ ngăn scan trùng đồng thời, chưa loại bỏ full scan.

4. **Filter trạng thái dễ gây hiểu sai**
   - `filterCategory` đang trộn mức quota (`warning/danger/depleted`) với lỗi khả dụng/auth/transient.
   - Cần xác định rõ bộ lọc đang lọc theo mức quota hay theo khả năng dùng tài khoản; nếu giữ một nhóm nút thì tên và count phải phản ánh đúng một chiều dữ liệu.
   - Cần kiểm tra riêng từng nút `Tất cả / Bình thường / Cảnh báo / Nguy hiểm / Hết quota`: count, danh sách sau lọc và trạng thái active phải cùng một nguồn dữ liệu.

5. **Có nguy cơ race khi đổi scope liên tục**
   - `selectTimePeriod()` đổi `currentPeriod` rồi chờ request; response cũ có thể về sau response mới và ghi đè chart/table bằng scope cũ.
   - Request preload các scope phụ dùng `Promise.allSettled()` nhưng lỗi bị nuốt, không có trạng thái lỗi theo từng scope.

6. **Model panel chưa dùng đúng nguồn account-specific**
   - Backend đã có `/api/v1/quota/models`; frontend lại gọi `/api/v1/models` rồi lọc theo provider.
   - Hai payload live khác provider key (`google` và `google-antigravity`), nên danh sách model theo account có thể rỗng/sai.
   - Payload account hiện chưa có trường tier/entitlement có bằng chứng để khẳng định Pro hoặc Ultra.

7. **Table/modal bị chật và cắt nội dung**
   - History table dùng `table-layout: fixed`, tỷ lệ cột cố định và `white-space: nowrap` + ellipsis.
   - Quick Check table có `min-width` và cell một dòng; reset time bị cắt trên modal.
   - Đây là clipping/khó đọc đã xác nhận qua live screenshot; chưa có bằng chứng backend làm mất dữ liệu.

8. **History hiển thị sai nội dung cột**
   - Header ghi `Input / Output / Cache` nhưng row chỉ render input/output/total; cache không được trả riêng trong `mappedItems`.
   - Summary tính Input bao gồm `input + cacheRead + cacheWrite`, còn row lại hiển thị `item.input` nên số tổng và số từng dòng không cùng định nghĩa.
   - Cột trạng thái đang hardcode `Thành công`, không phản ánh trạng thái thật của từng record.

9. **Layout đang quá nhiều lớp container/card**
   - Page, suite, panel, card lồng nhau làm giảm diện tích đọc; cần đưa hierarchy về page grid + section rõ ràng, không tạo thêm card mới.

## Kế hoạch triển khai tối thiểu

### P0 — Sửa tính đúng của dữ liệu

- Chuẩn hóa scope contract và timezone `Asia/Ho_Chi_Minh`.
- Trend trả dữ liệu có `startAt`, `endAt`, `label`, `input`, `cache`, `output`, `total`, `isPeak`; sort tăng dần theo thời gian.
- Label thích ứng: 1h/24h dùng giờ; 7d/30d dùng ngày-tháng; toàn bộ lịch sử dùng ngày-tháng và thêm năm khi cần tránh mơ hồ.
- Sửa UI `30n` thành `30 ngày qua`; title chart và card dùng cùng một mapping.
- Legend phải khớp series thực tế: hoặc vẽ đủ Input/Cache/Output, hoặc chỉ còn một series Tổng.
- Tách `quotaSeverity` khỏi `availabilityStatus`; nút lọc và count không được trộn hai khái niệm.
- Test từng scope độc lập và test đổi scope liên tục; chỉ commit response nếu request còn là request mới nhất.
- Chuẩn hóa định nghĩa Input/Cache/Output giữa summary, chart và từng row; trả trạng thái thật thay cho text `Thành công` hardcode.

### P1 — Model panel và hiệu năng History

- Dùng `/api/v1/quota/models` cho account đang chọn; hiển thị `Detected`, `Available`, `Unavailable`, nguồn account và thời điểm kiểm tra.
- Chỉ hiển thị “Gemini Pro/Ultra” khi backend có entitlement/tier được xác minh; nếu chưa có thì ghi rõ “Capability quota detected — subscription tier chưa được xác minh”.
- Load scope đang xem trước; các scope còn lại lấy khi người dùng chọn hoặc dùng một aggregate response. Không gọi 5 History scope mỗi 30 giây.
- Giữ single-flight; bổ sung cache/index theo file hoặc theo ngày để không parse toàn bộ JSONL cho mỗi cold load.
- Không nuốt lỗi preload: lưu trạng thái lỗi theo scope và cho phép retry đúng scope.
- Đặt SLA kiểm thử: core hiển thị trước; History không bị spinner vô hạn; lần load lại không quét trùng.

### P1/P2 — Table, modal, responsive và accessibility

- Desktop: table có min/max width rõ, ưu tiên cột account/model; cho phép wrap có kiểm soát ở metadata/reset time.
- Mobile: chuyển bảng sang row/card đọc được hoặc horizontal scroll có sticky cột đầu; không dùng ellipsis cho dữ liệu quan trọng.
- Quick Check: giảm modal width/chiều cao cảm nhận, cho reset time xuống 2 dòng, thêm scroll ngang có chủ đích nếu cần.
- Giảm container lồng nhau, giữ section title và khoảng cách nhất quán.
- Filter tabs ở mobile dùng horizontal scroll thay vì wrap khó quét.
- Bổ sung empty/loading/error state rõ ràng; thêm focus management và khóa body scroll khi modal mở.

## Tệp và hợp đồng phải cập nhật khi triển khai

- `server.mjs`: scope labels, trend bucket contract, filter/status fields, model catalog, history cache/index.
- `honpi-quota-dashboard-SKE.html`: label/filter/chart/model panel/table/modal/responsive states.
- `test-session-actions.mjs`: API scope, concurrency và history behavior.
- `test-mock-api.js`: đổi assertion đang khóa `hourlyTrend.length === 12` theo contract mới.
- Bổ sung browser smoke test cho filter, chart labels, model panel, table/modal và các viewport 320/768/1024/1440.
- Kiểm tra parity với `product-release/` trước khi phát hành; hiện source root và product-release có dấu hiệu drift.

## Tiêu chí nghiệm thu

- Chọn `30 ngày qua` không còn chữ `Tháng này`; chart có ngày-tháng đúng timezone và thứ tự tăng dần.
- Mỗi series trong legend có dữ liệu tương ứng; không còn chart “có đường nhưng sai ý nghĩa”.
- Filter count, danh sách và nhãn cùng một semantic; không đưa lỗi auth vào nhóm quota nếu chưa đổi tên rõ ràng.
- Model panel hiển thị đúng catalog account-specific và không khẳng định Pro/Ultra khi thiếu evidence.
- Không có cột quan trọng bị đè/cắt ở desktop; mobile đọc được reset time/account/model.
- History lỗi hiển thị error state và có retry; không spinner vô hạn.
- Kiểm thử API + browser smoke pass trước deploy; không log email/token thật trong fixture hoặc báo cáo.

## Ngoài phạm vi và rủi ro

- Không thêm date picker, billing/subscription expiry, model probing thủ công hoặc migration database lớn ở lượt đầu.
- Thay đổi trend contract có thể làm hỏng mock/frontend cũ; phải cập nhật caller và test cùng commit.
- Tier Pro/Ultra có thể không tồn tại trong nguồn dữ liệu hiện tại; khi đó chỉ được cải thiện cách giải thích, không được suy đoán.
- Dữ liệu History chứa thông tin tài khoản; fixture và log kiểm thử phải được ẩn danh.

## Kết quả triển khai 2026-10-24

- Đã sửa toàn bộ scope `1h`, `24h`, `7d`, `30d`, `all`: nhãn đúng rolling window, timezone cố định `Asia/Ho_Chi_Minh`, trend có ngày/giờ và thứ tự tăng dần.
- Đã chặn response cũ ghi đè scope mới, bỏ preload 5 request History mỗi chu kỳ, thêm lỗi theo từng scope và retry khi bấm lại.
- Đã làm History tải theo phạm vi file: scope ngắn không còn quét toàn bộ 2.707 JSONL; live đo được initial 24h khoảng 0,76 giây, 30d khoảng 6,39 giây, all khoảng 8,26 giây.
- Đã đồng bộ Input/Cache/Output giữa summary, chart và row; trạng thái row không còn hardcode `Thành công`.
- Đã dùng `/api/v1/quota/models`, thêm panel Detected/Available/Unavailable và chỉ ghi “Pro/Ultra chưa được backend xác minh”.
- Đã nới bảng, cho phép wrap, tăng modal Quick Check và thêm 5 thẻ breakdown.
- Kiểm thử: `node test-session-actions.mjs` pass 124 scenarios; inline JS parse pass; `/healthz` pass sau deploy.
- Deploy code-only đã tạo backup: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20261024-082052-66534`.

## Xác minh cuối sau sửa regression 2026-10-24

- `node test-session-actions.mjs`: pass 124 scenarios; bổ sung bằng chứng model từ catalog `get_available_models` để panel Available không bị rỗng giả.
- `./test-runtime-security.sh`: pass, gồm cwd `/`, `/tmp`, file, workspace hợp lệ và symlink escape qua `/api/console/start`.
- Browser smoke live `/quota`: cả 5 nút `1g`, `24g`, `7n`, `30n`, `Tổng` đều active đúng; số luôn hiển thị; chart đổi đúng nhãn theo scope và không chồng nhãn.
- API live: 12 model detected, 12 available, 0 unavailable; tier Pro/Ultra vẫn hiển thị “chưa xác minh” vì OMP chưa trả metadata tier.
- Observability: request quota, history scope, model load, slow request và client warn/error ghi vào `dashboard-events.jsonl`; client log whitelist, không nhận prompt/token/email.
- Deploy cuối: `/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20261024-205019-6941`.
