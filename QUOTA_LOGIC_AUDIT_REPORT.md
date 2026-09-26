# Báo cáo audit logic Quota OMP

**Ngày kiểm tra:** 22/09/2026  
**Phạm vi:** backend thật trên 127.0.0.1:4177, Safety Guard, frontend Quota, API schema/tài liệu.  
**Phương pháp:** đọc code, gọi GET live, đối chiếu account/overview/protect/history, kiểm tra AX tree của trang và modal Chi tiết. Không gửi prompt, không gây 429, không đổi tài khoản.

## 1. Kết quả điều hành

| Hạng mục | Kết quả | Kết luận |
|---|---|---|
| Runtime | /healthz OK; source và runtime cùng SHA e4d226… | Đang chạy đúng bản hiện tại |
| Quota live | 7 account, 4 nhóm cửa sổ, history live | Có dữ liệu thật |
| Google Protect | enabled=true, mode=auto, activeAccountProtected=true, 7 account áp dụng, maxConcurrent=1, cooldown 0, request tiếp theo được phép | Đường bảo vệ đã nối; chưa có bằng chứng thử 429 thực tế |
| Tổng trạng thái | Overview báo ok=7, trong account có danger=1, warning=1, quota_unknown=2 | **Sai logic tổng hợp P0** |
| Chi tiết | Modal mở được, hiển thị model/quota/OAuth | Đang trùng quota, thiếu capability/tier/cache |

## 2. Google Protect / Safety Guard

### Đã hoạt động

Guard nằm trong console-bridge.mjs:

- chặn request song song, tối đa 1 turn;
- cách tối thiểu 20 giây giữa hai request;
- sau 429 cooldown tăng theo chuỗi 15 phút → 1 giờ → 6 giờ → 24 giờ;
- đếm 429 trong cửa sổ 10 phút;
- tắt auto-retry; không tự đổi model/account;
- lưu trạng thái tại ~/.omp/usage-dashboard/safety-state.json.

### Chưa thể kết luận “đã bảo vệ một request thật”

GET /api/v1/quota/protect-status chỉ chứng minh policy và runtime guard đang sẵn sàng. Chưa có telemetry kiểu requestId → accountId → guard decision → provider response, nên chưa chứng minh được một lượt chat thật đã đi qua guard. Không nên tạo 429 giả để kiểm tra trên tài khoản thật.

### Lỗi diễn giải dữ liệu

isGoogleProtect trong server.mjs:1548 chỉ được suy ra từ “có Gemini quota limit”. Đây là **loại quota**, không phải bằng chứng account đã được Safety Guard áp dụng. Hiện tất cả 7 account đều provider google-antigravity, nên panel hiển thị 7 account áp dụng. Cần tách hai trường:

    hasGoogleQuota       = có quota Gemini
    safetyGuardApplied   = account nằm trong policy đang chạy

syncSafetyPolicy() còn mặc định selectedIsGoogle=true khi không tìm thấy account active; có thể báo bảo vệ dù chưa xác định được account.

## 3. Logic từng account và khả dụng

### Logic tại thời điểm audit ban đầu (trước bản sửa)

Trong quotaAccountStatus() (server.mjs:1473):

1. OAuth lỗi → OAuth lỗi.
2. Generation blocked/error → Bị block / Không thể chat.
3. Không có quota 5 giờ → Thiếu quota 5 giờ.
4. Lấy max(quota 5 giờ, một quota tuần bất kỳ):
   - >=100 → Hết quota;
   - >=90 → Nguy hiểm >90%;
   - >=75 → Cảnh báo >75%;
   - còn lại → Bình thường.

Trong quotaAccountAvailability() (server.mjs:1495):

- không dùng nếu OAuth/generation lỗi;
- không dùng nếu thiếu quota 5 giờ;
- không dùng khi quota 5 giờ >80%;
- **bỏ qua quota tuần** khi quyết định nút Sử dụng.

### Bằng chứng lệch logic live trước bản sửa

- bancuachungta123@gmail.com: quota 5 giờ 2.6%, quota tuần 94%, trạng thái Nguy hiểm >90%, nhưng canUse=true.
- tuantuoitan004@gmail.com: quota 5 giờ 0%, tuần 88.3%, trạng thái Cảnh báo >75%, nhưng canUse=true.
- Hai account thiếu quota 5 giờ bị khóa đúng (canUse=false).
- Overview vẫn báo ok=7, không phản ánh các trạng thái account.

Đây là lỗi hợp đồng giữa “sức khỏe” và “có thể chọn”. Nếu chủ ý là quota tuần cao vẫn được dùng, UI phải ghi rõ Nguy hiểm quota tuần · vẫn dùng được; nếu không, backend phải khóa theo cùng chính sách. Hiện nhãn và hành động nói hai điều khác nhau.

### Lỗi chọn quota tuần

quotaAccountStatus() lấy quota tuần đầu tiên sau khi sort trên **mọi provider**, trong khi quotaWindowLimit() đã có bộ lọc Gemini/shared riêng. Một account Gemini có thể bị phân loại bởi quota Claude/GPT shared. Cần dùng cùng một hàm provider-aware cho account status, overview và chi tiết.

### Generation health chưa đủ mạnh

Account không có lượt sinh nội dung trong 24 giờ có generationStatus=unknown, nhưng nếu quota có số liệu vẫn bị gắn Bình thường. Đây là “chưa xác minh”, không phải “khỏe”.

## 4. Token, OAuth và phân loại tài khoản

- Thời gian token đang lấy max(auth event, authorizedAt/created_at/updated_at) từ SQLite. updated_at có thể đổi khi refresh metadata nên không chắc là thời điểm OAuth/token được cấp hoặc refresh thật.
- Không có ngưỡng token stale; token 6 ngày vẫn chỉ hiển thị tuổi, không ảnh hưởng status.
- Không có trường plan, tier, subscription, entitlement hay quyền model theo account. Vì vậy hệ thống **chưa thể kết luận account có phải Gemini Pro hay không**; /api/v1/models chỉ là danh mục model chung.
- readGenerationHealth() và readTokenHistory() gán account bằng credential pin gần nhất; nhiều pin trong một session có thể gán nhầm account.

## 5. Tổng quota và reset

quotaWindowPayload() đang tính:

- usedPct: trung bình phần trăm của các account có limit;
- peak: lớn nhất trong nhóm;
- status: dựa trên peak (>=90 danger, >=75 warn).

Giá trị live hiện tại: Gemini 5 giờ trung bình 0.5%, đỉnh 2.6%; Gemini tuần trung bình 54.3%, đỉnh 94%; Claude/GPT cả hai cửa sổ 0%. Công thức này chỉ đúng khi UI ghi rõ **trung bình** và **đỉnh**, đồng thời trả thêm sampleCount/missingCount. Hiện chưa có missing count nên 0% có thể bị hiểu là không dùng dù thực tế là thiếu dữ liệu.

earliestReset quét tất cả limit của tất cả provider, rồi earliestResetStatus chỉ xét phần trăm của limit reset sớm nhất. Nó không trả lời rõ “reset cửa sổ nào”, và có thể báo trạng thái xanh dù tuần đang nguy hiểm.

## 6. Hết quota, thiếu quota và màu trạng thái

- Trước bản sửa, Hết quota có thể được tạo bởi quota tuần 100%, nhưng canUse vẫn có thể true nếu quota 5 giờ thấp. Bản sửa đã dùng cùng ngưỡng cho status và availability.
- Account thiếu quota 5 giờ trong card đang hiển thị phần trăm 0% và thanh rộng 0, thay vì --/Chưa có dữ liệu; đây là hiển thị sai nghĩa.
- Backend threshold status là 90%, còn colorFor() frontend chỉ chuyển màu đỏ từ 95%. Ví dụ 94% có pill nguy hiểm nhưng thanh vẫn màu cảnh báo.
- Chưa có state/animation riêng cho exhausted; chỉ có màu, pill và nút disabled.

## 7. Modal Chi tiết và Token History

Modal Chi tiết mở được và có các nhóm provider, model, quota, 5 giờ, tuần, OAuth, điều phối. Nhưng:

- renderAccountLimits() gom theo label|window, dữ liệu shared trùng bị hiện ×2; payload vẫn giữ bản ghi trùng.
- Body được dựng bằng một chuỗi innerHTML rất dài; chưa có schema/module riêng cho từng nhóm quota.
- Không có phần quyền sử dụng / Pro / model entitlement, không có generationCheckedAt, decision reason chuẩn hóa, hay bằng chứng guard theo account.
- Danh sách model của account Google đang chứa cả Claude/GPT; đây là model catalog chung, chưa phải capability theo account.
- API có cacheRead, cacheWrite, reasoning, nhưng bảng History chỉ render input / output / total dù tiêu đề ghi Input / Output / Cache. Người dùng không xem được cache thật.
- totalTokens backend có thể bao gồm cache, trong khi UI không tách thành phần; cần quy ước rõ input, cacheRead, cacheWrite, reasoning, output, total.

## 8. Contract/tài liệu đang lệch runtime

- QUOTA_DASHBOARD_CHECKLIST.md và BACKEND_HANDOFF.md vẫn mô tả 5 account; runtime có 7.
- Handoff mô tả /accounts trả object {accounts,totalAccounts,...}, runtime trả array.
- Handoff mô tả overview health và earliestReset dạng object; runtime dùng statusCounts và chuỗi earliestReset.
- Handoff mô tả Protect status: active, protectedAccountIds, errorsLast10Min; runtime dùng chuỗi status, appliedAccountIds, errors429Count.
- api-schema.json/mock tests chủ yếu kiểm tra payload mẫu cũ, không phải live contract hiện tại. Bộ test mock pass không chứng minh backend OMP thật đúng.

## 9. Quy tắc trạng thái nên chốt trước khi sửa UI

Tách thành hai trục độc lập:

    healthStatus:
      data_missing | auth_error | generation_error | exhausted | danger | warning | normal | unverified

    availability:
      selectable = auth OK
                 && generation không blocked/error
                 && quota 5 giờ đã có dữ liệu
                 && max(quota 5 giờ, quota tuần liên quan) < 90%

Đề xuất mặc định:

- 5 giờ >80%: cảnh báo và vẫn cho dùng; >=90%: không cho chọn.
- tuần >=90%: gắn danger riêng; chỉ khóa chọn nếu sản phẩm quyết định quota tuần là hard limit.
- tuần/5 giờ =100%: exhausted theo đúng provider/window; availability phải dùng cùng policy, không tự mâu thuẫn.
- generationStatus=unknown: Chưa xác minh, không gắn Bình thường.
- Token: thêm tokenIssuedAt, tokenRefreshedAt, tokenAgeSec, tokenFreshness; không suy ra refresh từ updated_at.
- Account: thêm plan/tier, modelEntitlements, quotaSource, sampleCount, missingCount.

## 10. Thứ tự xử lý đề xuất

**P0 — phải chốt trước UI:**

1. Một hàm chuẩn cho status và một hàm chuẩn cho availability.
2. Tách quota theo provider/window; sửa overview status counts.
3. Tách hasGoogleQuota khỏi safetyGuardApplied; thêm telemetry guard decision.
4. Chuẩn hóa API contract live và cập nhật schema/test theo contract đó.

**P1 — cần làm ngay sau P0:**

1. Token freshness/expiry và generation unverified.
2. Entitlement/tier để xác định Gemini Pro và model thực sự dùng được.
3. Sửa missing quota hiển thị --, màu threshold, exhausted availability.
4. Modal quota theo nhóm provider/window, loại duplicate; hiển thị cache read/write/reasoning.

**P2 — hoàn thiện:**

1. Correlation ID cho mỗi request và guard decision.
2. Sửa attribution theo session/account ổn định thay vì nearest pin.
3. Test desktop/tablet/mobile và test live contract trong CI.

**Kết luận:** Safety Guard đã có code path và đang báo sẵn sàng, nhưng dashboard hiện chưa đủ bằng chứng để gọi là “đã kiểm chứng end-to-end”. Phần cần sửa trước mọi redesign tiếp theo là hợp đồng status–availability–provider quota; nếu không, UI chỉ làm đẹp một logic đang tự mâu thuẫn.

## 11. Chính sách đã chốt và bản sửa ngày 22/09/2026

Theo quyết định mới của Síp:

- quota trên 80%: cảnh báo, vẫn được dùng;
- quota từ 90%: tạm ngưng, không cho gửi chat/chuyển vào account, yêu cầu chuyển account khác;
- thiếu quota 5 giờ: không cho chọn an toàn;
- quota tuần cũng tham gia quyết định tạm ngưng, không chỉ quota 5 giờ.

Đã nối cùng quy tắc vào:

1. trạng thái account và statusCounts của overview;
2. nút chuyển account;
3. các luồng chat send/stream/gateway/console trước khi gửi prompt;
4. thông báo 409 `ACCOUNT_UNAVAILABLE` với lý do phải chuyển account;
5. UI pill, màu thanh và nút active (`⏸ Tạm ngưng`).
6. panel Safety Guard: `nextRequestAllowed=false` và trạng thái `● Tạm ngưng · chuyển account` khi active account vượt 90%.

Kiểm chứng live sau sửa: account đang dùng tuần 94.1% trả `canUse=false`; account tuần 88.3% trả `Cảnh báo >80%`, `canUse=true`; POST chat preflight trả HTTP 409 và không gửi prompt lên OMP. Runtime `/healthz` vẫn OK, source/runtime HTML đã đồng bộ.

## 12. Chuẩn hiển thị quota — 22/09/2026

- Nhãn và số liệu hiển thị phần còn lại (`X% còn`), nhưng đoạn màu của thanh biểu diễn phần đã dùng (`usedPct`) để quota cao/đỏ kéo dài đúng theo mức tiêu thụ; nền xám là phần còn lại.
- Quy tắc này áp dụng cho overview, account card, Quick Check, chi tiết account và các thanh model/hạn mức.
- `usedPct` tiếp tục là nguồn quyết định màu cảnh báo/status; `remainingPct` dùng cho nhãn và tooltip.
- Account không có quota 5 giờ hiển thị `--` và thanh rỗng; không quy đổi dữ liệu thiếu thành `100% còn`.
- Live DOM đối chiếu: account đang dùng `92.2% used / 7.8% remaining` có đoạn đỏ dài khoảng 92.2%; 7 account và toàn bộ quota limit vẫn đạt `usedPct + remainingPct = 100%`.

## 13. Trạng thái block và bố cục account — 22/09/2026

- Bỏ STT `#01/#02`; thứ tự card hiện là: account đang dùng → account có thể dùng bình thường → account cảnh báo nhưng còn dùng được → account lỗi/quota bị giới hạn/không thể dùng.
- Badge trạng thái (`Bình thường`, `Cảnh báo`, `Tạm ngưng`, `Hết quota`, lỗi OAuth) nằm cùng hàng Provider và Google Protect. Trạng thái sử dụng (`Đang dùng`, `Có thể sử dụng`, `Tạm ngưng · chuyển account`) hiển thị thành badge riêng có hiệu ứng nhẹ và tôn trọng `prefers-reduced-motion`.
- Backend đọc tín hiệu OAuth và lần sinh nội dung gần nhất: `401/UNAUTHENTICATED` → cần đăng nhập lại; `403/PERMISSION_DENIED`, policy, API hoặc license → Google từ chối quyền; `429/RESOURCE_EXHAUSTED` → bị giới hạn quota/rate; `5xx`, timeout, network hoặc certificate/TLS → lỗi tạm thời và cho phép retry; lỗi generation không phân loại được → khóa chọn account.
- Đây là phân loại dựa trên log/runtime hiện có, chưa phải bằng chứng Safety Guard của Google đã được áp dụng ở phía Google; `isGoogleProtect` vẫn chỉ biểu thị account có nhóm Gemini quota.
- Đối chiếu nguồn Google: OAuth có thể bị vô hiệu hóa do revoke/password/policy/refresh token hết hiệu lực ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)); API phân biệt 401, 403 và 429 ([error handling](https://developers.google.com/knowledge/error-handling-and-limits)); quota theo user/project và reset theo cửa sổ ([Gemini quotas](https://docs.cloud.google.com/gemini/docs/quotas)).

## 14. Reset và tín hiệu khả dụng — 22/09/2026

- Nhãn reset trên overview, card, Quick Check và chi tiết account thống nhất `↻ Reset sau: … Ngày … Giờ … Phút … Giây`.
- Badge `⏸ Tạm ngưng · chuyển account` nhấp nháy nhẹ; badge `⚠ Không thể sử dụng` được hiển thị khi account bị khóa chọn. Chế độ `prefers-reduced-motion` tắt animation.
- Header quota của từng account tách thành hai tầng: tên và `% còn` ở hàng đầu, `↻ Reset sau` ở hàng riêng ngay trên thanh; tránh đọc nhầm reset time với phần trăm quota.

## 15. Redesign Chi tiết tài khoản — 22/09/2026

- Modal chi tiết được mở rộng thành các khối có mục đích: trạng thái live, quota theo cửa sổ, hạn mức theo nhóm, sức khoẻ OAuth/sinh nội dung và thông tin kết nối backend.
- Bổ sung các dữ liệu trước đây bị ẩn: lý do trạng thái, generation health, model kiểm tra gần nhất, session hiện tại, tín hiệu Google Protect, account ID, provider key, project ID và endpoint.
- Gộp các hạn mức shared trùng nhau thành một nhóm và hiển thị số nguồn (`×2`) kèm trạng thái, phần đã dùng, phần còn lại và thời gian reset.

## 16. Ngày hết hạn Google AI Pro — 22/09/2026

- OMP `usage --json` hiện chỉ trả metadata account, các cửa sổ quota và `resetsAt`; không có entitlement hoặc ngày kết thúc gói Pro.
- OAuth credential cục bộ chỉ có `expires` của access token, không phải ngày hết hạn subscription; không được dùng giá trị này để tạo countdown Pro.
- Muốn hiển thị chính xác cần thêm nguồn subscription/entitlement riêng với quyền Google phù hợp hoặc nhập thủ công ngày hết hạn. Hiện chưa thêm trường giả vào popup để tránh báo sai.

## 17. Recovery chat và retry tạm thời — 24/09/2026

- `generationOutcome()` nhận diện `certificate`, `unable to verify`, `TLS` và `self-signed` là `transient_error`, tránh biến lỗi CA/TLS cục bộ thành `chat_error` vĩnh viễn.
- `quotaAccountAvailability()` cho phép retry khi status là `transient_error`; OAuth/access/quota/generation error chưa phân loại vẫn bị chặn.
- EGO browser smoke trên runtime `127.0.0.1:4177` đạt SSE `200`, headers 5ms, hoàn tất 4.9s; account active chuyển từ `transient_error` sang `live`.
