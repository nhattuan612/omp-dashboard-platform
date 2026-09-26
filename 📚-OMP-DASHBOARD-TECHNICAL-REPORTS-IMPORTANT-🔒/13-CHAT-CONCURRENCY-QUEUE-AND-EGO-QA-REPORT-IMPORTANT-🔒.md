# 13 — Chat concurrency, queue isolation và ego-browser QA

## Trạng thái

**Accepted — đã triển khai và xác minh**

**Thời điểm:** 2026-09-24 (Asia/Ho_Chi_Minh)  
**Phạm vi:** runtime chat tại `http://127.0.0.1:4177/chat`; backend queue; UI session isolation; kiểm thử trực tiếp bằng ego-browser.  
**Mục tiêu:** bảo đảm nhiều session có thể chạy đồng thời, không trộn transcript, queue preview không tạo ghost/duplicate và error path trả đúng HTTP status.

> Tài liệu không chứa token, cookie, prompt lịch sử hoặc nội dung session thật. Các session tạo trong QA đều là smoke session và đã archive sau kiểm thử.

## 1. Kết quả tóm tắt

| Hạng mục | Kết quả |
|---|---|
| Backend concurrency và FIFO | Pass — session khác nhau chạy đồng thời; mỗi session giữ FIFO |
| Queue abort và client disconnect | Pass — lượt queued bị hủy trước khi dispatch OMP |
| UI session isolation | Pass — không rò nội dung khi chuyển A/B |
| Queue preview lifecycle | Pass — discard inactive không để lại ghost; restore không duplicate |
| Invalid session guard | Pass — ID không tồn tại trả `false`, không throw |
| Runtime security smoke | Pass |
| Mock API contract | 11 scenario, 257/257 assertion pass |
| Isolated session action contract | 65 scenario pass |
| Live ego-browser QA | 6/6 case pass, 0 console/runtime error |

## 2. Quyết định kỹ thuật

### 2.1. Safety Guard không nằm trong global dispatch gate

`waitForRequestSlot()` chạy trước khi vào vùng gate ngắn. Sau khi chờ, backend kiểm tra lại safety state trong gate trước khi gửi lệnh native.

Lý do: một session đang chờ cooldown không được phép chặn session/provider khác. Việc kiểm tra lại trong gate giữ tính nguyên tử giữa bước kiểm tra và dispatch.

### 2.2. Queue định danh theo context và request

Mỗi lượt dùng `contextId`/session ID và `requestId`. Queue chỉ serialize các lượt trong cùng context; các context khác có thể dispatch đồng thời. Abort, disconnect và queue overflow đều settle đúng request tương ứng.

### 2.3. `requestId` và `queueId` là identity của UI message

- User message đang chạy gắn `requestId`.
- User queue preview gắn `queueId`.
- Khi queued prompt bắt đầu, preview được thay thế thay vì append user message thứ hai.
- Khi restore session, response được chèn sau đúng user request để giữ thứ tự `U1 → A1 → U2 → A2`.

### 2.4. Validate command trước context state lookup

`/api/console/command` xác thực `modelSource` và model trước khi gọi `contextHasChatWork()`. Vì vậy payload sai trả `400 BAD_REQUEST` ngay cả khi `contextId` không tồn tại, không bị biến thành `500 INTERNAL_SERVER_ERROR`.

## 3. Thay đổi chính

### `server.mjs`

- Tách thời gian chờ Safety Guard khỏi global chat dispatch gate.
- Re-check safety state trong vùng dispatch nguyên tử.
- Giữ generation health theo provider/account identity thay vì chỉ theo email.
- Đổi thứ tự validation của `/api/console/command` để error contract trả đúng status.

### `honpi-chat-dashboard-live.js`

- Dọn cached queue preview khi discard ở session inactive.
- Gắn `requestId`/`queueId` vào DOM và state message.
- Chống duplicate preview khi restore session.
- Giữ đúng thứ tự user/assistant message khi nhiều request in-flight.
- Lưu assistant completion vào active hoặc inactive session view.
- Guard `selectSession()` với ID không tồn tại.
- Khôi phục queue item về đúng vị trí ban đầu khi dispatch thất bại.
- Loại dead follow-up code không còn caller.

### `test-session-actions.mjs`

- Bổ sung assertion nội dung delta cho concurrent/FIFO response.
- Bổ sung queued stream abort trước dispatch.
- Bổ sung client disconnect khi stream còn queued.
- Bổ sung kiểm thử queue capacity và request cancellation.

## 4. Kiểm thử tự động

### 4.1. Isolated session action contract

```text
rtk node test-session-actions.mjs
```

Kết quả cuối: **65 scenarios passed** trên isolated port. Bao gồm:

- concurrent dispatch giữa nhiều session;
- FIFO trong cùng session;
- queued non-stream abort;
- queued stream abort;
- client disconnect;
- queue capacity overflow;
- session-scoped approval;
- native RPC v2/chunk/event lifecycle;
- file path/canonical/symlink/.git/NUL/size guards;
- archive/delete/fork/reconnect/share contract.

### 4.2. Runtime security

```text
rtk sh test-runtime-security.sh
```

Kết quả cuối: **runtime security smoke: pass**.

Các guard đã xác minh gồm auth cookie, host/origin, console command/start, invalid browser mode và invalid model source.

Trong vòng đầu, probe invalid `modelSource` trả `500`. Root cause là context lookup chạy trước validation. Sau khi đổi thứ tự validation, rerun trả đúng `400` và toàn bộ smoke pass.

### 4.3. Mock API contract

```text
rtk node test-mock-api.js
```

Kết quả cuối: **11 scenario, 257/257 assertion, 100% pass**.

### 4.4. Syntax và health

Đã chạy Node syntax check cho:

- `honpi-chat-dashboard-live.js`
- `server.mjs`
- `console-bridge.mjs`
- `test-session-actions.mjs`

Runtime health cuối: `GET /healthz` trả HTTP `200` và `{"ok":true}`.

## 5. QA trực tiếp bằng ego-browser

**Agent:** `EgoBrowserRegression`  
**TaskSpace:** `58`  
**Page:** `p1`  
**URL:** `http://127.0.0.1:4177/chat`  
**Screenshot:** `/tmp/ego_browser_qa_final.png`

| Case | Kết quả | Evidence chính |
|---|---|---|
| Reload và initial health | PASS | `readyState=complete`, DOM chính đầy đủ, health/session API OK |
| Concurrent A/B isolation | PASS | 2 request cùng `running`; A chỉ thấy A, B chỉ thấy B; không cross-leak |
| Invalid `selectSession` | PASS | không throw; `activeId` được giữ nguyên |
| Queue discard inactive | PASS | quay lại session không còn state/DOM ghost |
| Queue restore | PASS | đúng 1 preview DOM và 1 state message |
| Final cleanup | PASS | console error `0`, detached stream `0`, active request `0`, pending queue `0` |

Smoke session đã archive thành công; API và DOM không còn session có title `AGENT EGO QA`.

## 6. Deploy và rollback

Bản cuối đã đồng bộ vào runtime bằng deploy script. Backup deploy:

```text
/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-185433
```

Health sau deploy pass. Rollback có kiểm soát:

```sh
rtk sh '/Users/trannhattuan/Documents/CODE/OMP GEMINI Dashboad - Chat UI/deploy-local-dashboard.sh' \
  --rollback '/Users/trannhattuan/.omp/usage-dashboard/backups/deploy/20260924-185433'
```

Chỉ rollback khi đã lưu lại state/config mới hơn và xác định lỗi thuộc bundle của đợt deploy này.

## 7. Giới hạn và lưu ý

- Live browser QA dùng prompt ngắn, vô hại và đã archive toàn bộ session smoke.
- Responsive evidence ở nhiều viewport nằm trong các báo cáo UI trước; tài liệu này tập trung vào concurrency, queue và session isolation.
- Không dùng screenshot `/tmp` làm artifact production; ảnh chỉ là bằng chứng visual của vòng QA runtime.

## 8. Kết luận

Chat runtime hiện đáp ứng các invariant chính: session khác nhau chạy đồng thời, cùng session giữ FIFO, queue có identity rõ ràng, abort/disconnect không dispatch lượt đã hủy, UI không trộn transcript và error validation trả đúng status. Regression, security smoke, mock contract và ego-browser QA đều pass ở vòng xác minh cuối.
