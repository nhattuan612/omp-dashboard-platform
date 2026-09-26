# HÒN π · TÀI LIỆU BÀN GIAO KỸ THUẬT CHO ĐỘI NGŨ BACKEND
> **Hệ sinh thái Sản phẩm Hòn π · Phiên bản 1.0.0**  
> *Bảng Điều Khiển Quản Lý Quota OMP & Bảng Điều Khiển Trò Chuyện Trợ Lý AI*  
> *Tài liệu cập nhật: 2026-09-22 | Đội ngũ Kiến trúc Hệ thống Hòn π*
>
> **Trạng thái production hiện tại:** `/chat` và `/quota` phục vụ lần lượt bởi
> `honpi-chat-dashboard-SKE.html` và `honpi-quota-dashboard-SKE.html` qua OMP
> runtime tại `127.0.0.1:4177`. Các file HTML legacy bên dưới chỉ là tài liệu/
> prototype; `mock-server.js` và `mock-db.json` chỉ dùng cho contract test, không
> phải nguồn dữ liệu production.

---

## I. TỔNG QUAN HỆ THỐNG & KIẾN TRÚC TỔNG THỂ

Hệ sinh thái giao diện **Hòn π** được thiết kế phục vụ hai nghiệp vụ cốt lõi:
1. **Bảng Điều Khiển Quản Lý Quota OMP (`honpi-quota-dashboard-SKE.html`):** Giám sát quota live từ OMP, 4 cửa sổ hạn mức, Google Protect Safety Guard, chuyển đổi tài khoản active và lịch sử tiêu thụ token.
2. **Bảng Điều Khiển Trò Chuyện Trợ Lý AI (`honpi-chat-dashboard-SKE.html`):** Giao diện hội thoại streaming AI thời gian thực, quản lý session, tools, approval, model và browser capability theo OMP runtime.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HỆ SINH THÁI GIAO DIỆN HÒN π                    │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
     ┌─────────────────────────────┐  ┌─────────────────────────────┐
     │ honpi-quota-dashboard-SKE │  │ honpi-chat-dashboard-SKE   │
     │  (Bảng Quản Lý Quota OMP)   │  │   (Bảng Trò Chuyện Chat AI) │
     └──────────────┬──────────────┘  └──────────────┬──────────────┘
                    │                                │
                    │    REST APIs & SSE Streams     │
                    └────────────────┬───────────────┘
                                     ▼
     ┌──────────────────────────────────────────────────────────────┐
     │                  BACKEND API SERVICES (PORT 4177)            │
     │   • Quota Management: /api/v1/quota/*                        │
     │   • Token Telemetry:  /api/v1/quota/history?scope=*          │
     │   • Chat & Sessions:  /api/v1/sessions/*                     │
     │   • Chat Streaming:   /api/v1/chat/stream (SSE)              │
     └──────────────────────────────────────────────────────────────┘
```

---

## II. DANH MỤC CÁC TỆP TRONG GÓI BÀN GIAO (DELIVERABLES MANIFEST)

| Tên Tệp | Định Dạng | Dung Lượng | Mô Tả & Vai Trò Trong Gói Bàn Giao |
| :--- | :---: | :---: | :--- |
| **`BACKEND_HANDOFF.md`** | Markdown | ~25 KB | **Tài liệu hướng dẫn bàn giao chính thức** (Tài liệu này). |
| **`api-schema.json`** | JSON | 54 KB | **Đặc tả kỹ thuật OpenAPI 3.1.0 chuẩn quốc tế** gồm 12 Endpoints, 18 Data Schemas chi tiết, mã lỗi HTTP và ví dụ payload. |
| **`mock-server.js`** | JavaScript | 14 KB | **Máy chủ API giả lập cho contract test** (không dùng làm production runtime). |
| **`mock-db.json`** | JSON | 16 KB | **Cơ sở dữ liệu mẫu** tương thích 100% với JSON Server và `mock-server.js`. |
| **`test-mock-api.js`** | JavaScript | 13 KB | **Kịch bản kiểm thử API tự động** gồm 11 bộ kịch bản và 257 assertions (Đạt 100% pass). |
| **`package.json`** | JSON | 0.5 KB | Cấu hình scripts thực thi nhanh (`npm start`, `npm test`, `npm run json-server`). |
| **`honpi-quota-dashboard-SKE.html`** | HTML | — | **Giao diện Quota production**: lấy dữ liệu live từ OMP runtime. |
| **`honpi-chat-dashboard-SKE.html`** | HTML | — | **Giao diện Chat production**: streaming/session/tools qua OMP runtime. |
| **`quota-dashboard.html`** | HTML | 81.7 KB | Bản Quota Dashboard xem trước kèm dữ liệu mẫu offline để kiểm tra visual. |
| **`neuratalk-chat-dashboard.html`** | HTML | 86.6 KB | Bản Chat Dashboard xem trước có Dev Banner hỗ trợ nạp dữ liệu mẫu 1-chạm. |
| **`tokens.css`** | CSS | 5.5 KB | Bảng mã token CSS chuẩn Hòn π 1.0.0 (OKLch Deep Tech Dark Theme). |
| **`design-tokens.json`** | JSON | 4.8 KB | Bộ Design Tokens JSON phục vụ tích hợp hệ thống design tokens tự động. |
| **`logohonpi.png` & Favicon Suite** | PNG/ICO | — | Bộ ảnh biểu trưng chính thức (16px, 32px, 48px, 180px, ICO) của Hòn π. |

---

## III. HƯỚNG DẪN KHỞI CHẠY NHANH MÁY CHỦ GIẢ LẬP (QUICK START)

Đội ngũ Backend có thể chạy thử nghiệm và kiểm tra toàn bộ luồng tích hợp ngay trên máy cục bộ mà **không cần cài đặt thêm bất kỳ thư viện ngoài nào**:

### 1. Khởi động Máy Chủ Giả Lập Mock Server
```bash
# Khởi động mock contract server (dùng cổng test riêng, không dùng thay production)
npm start

# Hoặc chạy trực tiếp bằng Node.js / Bun
node mock-server.js
# hoặc chỉ định cổng tùy ý
node mock-server.js --port=4177
```
* **Quota Dashboard:** [http://localhost:4177/honpi-quota-dashboard.html](http://localhost:4177/honpi-quota-dashboard.html)
* **Chat Dashboard:** [http://localhost:4177/honpi-chat-dashboard.html](http://localhost:4177/honpi-chat-dashboard.html)
* **Tài liệu OpenAPI Schema:** [http://localhost:4177/api-schema.json](http://localhost:4177/api-schema.json)

### 2. Chạy Bộ Kiểm Thử API Tự Động (API Test Suite)
```bash
npm test
# hoặc
node test-mock-api.js
```
Kết quả kiểm thử tự động kiểm tra 11 kịch bản toàn diện (257 assertions đạt 100%).

### 3. Tùy Chọn: Sử Dụng Thư Viện JSON-Server Chuẩn
Nếu nhóm backend muốn dùng tiện ích `json-server` phổ biến:
```bash
npx json-server mock-db.json --port 4177
```

---

## IV. ĐẶC TẢ CHI TIẾT CÁC API ENDPOINTS (API SPECIFICATION)

Base URL: `http://localhost:4177` (hoặc cấu hình tại biến môi trường)

### 1. Phân Hệ Quản Lý Quota OMP (Quota Management)

#### 1.1. Lấy danh sách tài khoản OMP
* **Giao thức & Đường dẫn:** `GET /api/v1/quota/accounts`
* **Mô tả:** Trả về danh sách các tài khoản OMP liên kết; số lượng phụ thuộc dữ liệu live từ OMP, không cố định.
* **Quy tắc Frontend:** 
  * Tài khoản có `isActive: true` **luôn được tự động đưa lên vị trí số thứ tự #01 đầu tiên bên trái**.
  * Tài khoản có `isGoogleProtect: true` sẽ tự động hiển thị huy hiệu khiên bảo vệ `🛡️ Google Protect`.
* **Phản hồi mẫu (`200 OK`):**
```json
{
  "accounts": [
    {
      "id": "acc-2",
      "email": "gemini-prod-core@company.ai",
      "monogram": "GP",
      "colorKey": "cyan",
      "provider": "Gemini Advanced",
      "isGoogleProtect": true,
      "isActive": true,
      "sessionDuration": "1g 45p",
      "usage5hPct": 92,
      "usageWeekPct": 84,
      "resetIn5h": "28p",
      "resetInWeek": "1n 04g",
      "tokenLoginTime": "13:05",
      "tokenLoginAgo": "1g 45p",
      "tokenLoginTimestamp": "2026-09-21T13:05:10Z"
    },
    {
      "id": "acc-4",
      "email": "gemini-flash-runner@enterprise.vn",
      "monogram": "GF",
      "colorKey": "orange",
      "provider": "Google Gemini",
      "isGoogleProtect": true,
      "isActive": false,
      "usage5hPct": 100,
      "usageWeekPct": 76,
      "resetIn5h": "42p",
      "resetInWeek": "2n 16g",
      "tokenLoginTime": "14:15",
      "tokenLoginAgo": "35p",
      "tokenLoginTimestamp": "2026-09-21T14:15:20Z"
    }
  ],
  "totalAccounts": 5,
  "activeAccountId": "acc-2",
  "syncedAt": "2026-09-21T14:50:00Z"
}
```

#### 1.2. Lấy thông tin tổng quan & 4 Cửa sổ Hạn mức Thực tế
* **Giao thức & Đường dẫn:** `GET /api/v1/quota/overview`
* **Mô tả:** Trả về dải điều hành tổng thể và 4 cửa sổ quota không cộng dồn.
* **Phản hồi mẫu (`200 OK`):**
```json
{
  "totalAccounts": 5,
  "health": {
    "okCount": 2,
    "warnCount": 1,
    "dangerCount": 1,
    "exhaustedCount": 1
  },
  "earliestReset": {
    "duration": "28p",
    "accountShort": "gemini-prod",
    "accountId": "acc-2"
  },
  "windows": {
    "gemini5h": {
      "name": "Gemini 5g",
      "type": "TRƯỢT",
      "usagePct": 48.5,
      "peakUsagePct": 100.0,
      "peakNote": "Hết",
      "resetIn": "28p",
      "status": "danger"
    },
    "geminiWeek": {
      "name": "Gemini Tuần",
      "type": "TUẦN",
      "usagePct": 76.0,
      "peakUsagePct": 84.0,
      "resetIn": "1n 04g",
      "status": "warn"
    },
    "claude5h": {
      "name": "Claude/GPT 5g",
      "type": "TRƯỢT",
      "usagePct": 32.3,
      "peakUsagePct": 78.0,
      "peakNote": "Shared",
      "resetIn": "1g 14p",
      "status": "warn"
    },
    "claudeWeek": {
      "name": "Claude/GPT Tuần",
      "type": "TUẦN",
      "usagePct": 38.5,
      "hasMissingMetric": true,
      "missingNote": "1 acc thiếu data",
      "resetIn": "2n 16g",
      "status": "ok"
    }
  }
}
```

#### 1.3. Lấy trạng thái Bảng Điều Khiển Google Protect (Safety Guard)
* **Giao thức & Đường dẫn:** `GET /api/v1/quota/protect-status`
* **Mô tả:** Giám sát cơ chế chống mã lỗi 429, request đang chạy, khoảng cách dispatch và cooldown; order mới luôn được nhận rồi xếp FIFO theo từng session.
* **Phản hồi mẫu (`200 OK`):**
```json
{
  "status": "active",
  "label": "Đang bảo vệ 429",
  "activeRequests": 0,
  "maxConcurrent": null,
  "cooldownSec": 0,
  "cooldownStatus": "Sẵn sàng",
  "errorsLast10Min": 0,
  "nextRequestAllowed": true,
  "autoRefreshSec": 30,
  "protectedAccountIds": ["acc-2", "acc-4"]
}
```

#### 1.4. Chuyển đổi tài khoản OMP đang sử dụng
* **Giao thức & Đường dẫn:** `POST /api/v1/quota/switch`
* **Request Header:** `Content-Type: application/json`
* **Request Body:**
```json
{
  "accountId": "acc-1"
}
```
* **Phản hồi mẫu (`200 OK`):**
```json
{
  "success": true,
  "activeAccountId": "acc-1",
  "message": "Đã chuyển sang tài khoản workspace-dev-alpha@example.com",
  "switchedAt": "2026-09-21T14:55:00Z"
}
```

#### 1.5. Yêu cầu đồng bộ tức thì
* **Giao thức & Đường dẫn:** `POST /api/v1/quota/sync`
* **Mô tả:** Yêu cầu backend kích hoạt quét telemetry tức thì từ các provider API mà không cần chờ chu kỳ 30s.
* **Phản hồi mẫu (`200 OK`):**
```json
{
  "success": true,
  "message": "Đã kích hoạt đồng bộ 5 tài khoản OMP thành công",
  "syncedAt": "2026-09-21T14:55:05Z"
}
```

---

### 2. Phân Hệ Phân Tích Lưu Lượng & Lịch Sử Token (Token Analytics)

#### 2.1. Lấy lịch sử token và biểu đồ nhịp tải theo phạm vi thời gian
* **Giao thức & Đường dẫn:** `GET /api/v1/quota/history?scope={1h|24h|7d|30d|all}`
* **Query Parameters:**
  * `scope`: `1h` (1 giờ qua), `24h` (1 ngày qua - mặc định), `7d` (7 ngày qua), `30d` (tháng này), `all` (tổng thời gian).
* **Phản hồi mẫu (`200 OK`):**
```json
{
  "scope": "24h",
  "totalRequests": 146,
  "tokens": {
    "total": "418.2k",
    "totalRaw": 418200,
    "inputCache": "294.0k",
    "inputCacheRaw": 294000,
    "output": "124.2k",
    "outputRaw": 124200
  },
  "hourlyTrend": [
    { "label": "00:00", "input": 12000, "output": 4500, "isPeak": false },
    { "label": "14:00", "input": 34200, "output": 14000, "isPeak": true, "note": "Đỉnh tải 48.2k" },
    { "label": "22:00", "input": 8200, "output": 2800, "isPeak": false }
  ],
  "logs": [
    {
      "id": "log-1",
      "time": "14:45",
      "relativeTime": "5p",
      "accountId": "acc-2",
      "accountEmail": "gemini-prod-core@company.ai",
      "accountMonogram": "GP",
      "accountColor": "cyan",
      "model": "neural-flash-3.8",
      "inputTokens": 2450,
      "outputTokens": 820,
      "totalTokens": 3270,
      "latencyMs": 420
    }
  ]
}
```

---

### 3. Phân Hệ Trò Chuyện & Phiên Làm Việc (Chat & AI Streaming)

#### 3.1. Lấy danh sách các phiên trò chuyện
* **Giao thức & Đường dẫn:** `GET /api/v1/sessions`
* **Phản hồi mẫu (`200 OK`):**
```json
{
  "sessions": [
    {
      "id": "s_gem1",
      "title": "Cài đặt Hòn π CLI & Hàng đợi lệnh",
      "isPinned": true,
      "isUnread": false,
      "isAiRunning": true,
      "relativeTime": "1p",
      "timestamp": "2026-09-21T14:52:00Z"
    },
    {
      "id": "s_2s_1",
      "title": "Tối ưu hóa Codebase & Xem xét Diff",
      "folderId": "f_dual",
      "folderName": "Dual Engine",
      "isPinned": false,
      "isUnread": false,
      "isAiRunning": false,
      "relativeTime": "1n",
      "timestamp": "2026-09-20T11:20:00Z"
    }
  ]
}
```

#### 3.2. Lấy lịch sử tin nhắn của một phiên
* **Giao thức & Đường dẫn:** `GET /api/v1/sessions/:id/messages`
* **Phản hồi mẫu (`200 OK`):**
```json
{
  "sessionId": "s_2s_1",
  "title": "Tối ưu hóa Codebase & Xem xét Diff",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "content": "Tối ưu hóa lại toàn bộ codebase, xử lý crash loop của api-service...",
      "timestamp": "2026-09-20T11:20:00Z"
    },
    {
      "id": "msg-2",
      "role": "assistant",
      "content": "Tôi đã phân tích codebase và thực hiện các điều chỉnh tối ưu...",
      "fileChanges": {
        "summary": "Đã chỉnh sửa 5 tệp (+71 -8)",
        "files": ["dashboard-live.js", "server.mjs", "quota-logic-smoke.mjs"]
      },
      "timestamp": "2026-09-20T11:20:28Z"
    }
  ]
}
```

#### 3.3. Gửi câu lệnh và nhận phản hồi tức thì
* **Giao thức & Đường dẫn:** `POST /api/v1/chat/send`
* **Request Body:**
```json
{
  "sessionId": "s_gem1",
  "prompt": "Tối ưu animation cho drawer công cụ để mượt hơn trên 120Hz",
  "model": "neural-flash-3.8"
}
```
* **Phản hồi mẫu (`200 OK`):**
```json
{
  "id": "msg-new-1",
  "sessionId": "s_gem1",
  "role": "assistant",
  "content": "Đã tối ưu hóa thuộc tính transition và will-change trên drawer công cụ...",
  "duration": "4s",
  "tokens": { "input": 320, "output": 84, "total": 404 }
}
```

#### 3.4. Luồng Phản hồi Trực tiếp Server-Sent Events (SSE Streaming)
* **Giao thức & Đường dẫn:** `GET /api/v1/chat/stream?sessionId={id}&prompt={text}`
* **Response Header:** `Content-Type: text/event-stream; charset=utf-8`
* **Luồng dữ liệu mẫu (SSE Protocol):**
```text
event: start
data: {"sessionId":"s_gem1","model":"neural-flash-3.8"}

event: chunk
data: {"content":"Đang "}

event: chunk
data: {"content":"phân tích "}

event: chunk
data: {"content":"yêu cầu của bạn..."}

event: done
data: {"totalDuration":"4s","totalTokens":404}
```

---

## V. CÁC QUY CHUẨN DỮ LIỆU NGHIỆP VỤ BẮT BUỘC (BUSINESS LOGIC CONTRACTS)

Đội ngũ backend khi hiện thực logic xử lý dữ liệu cần tuân thủ nghiêm ngặt 5 quy tắc sau:

### 1. Quy chuẩn Nhãn Thời gian Ngắn gọn (Verified Rule)
* **Quy tắc:** Mọi trường thời gian tương đối hiển thị trên giao diện (relative times, time ago, countdown reset) **bắt buộc phải trả về định dạng viết tắt ngắn gọn**:
  * `1p`, `2p`, `5p` (Phút - Không dùng "phút", "vừa xong")
  * `1g`, `2g`, `5g`, `1g 45p` (Giờ - Không dùng "giờ", "tiếng")
  * `1n`, `2n`, `5n`, `1n 04g`, `2n 16g` (Ngày - Không dùng "ngày", "hôm qua")
  * `4p 11s`, `28s`, `4s` (Thời lượng thực thi - Giây dùng `s`)
* **Timestamp chi tiết:** Luôn trả kèm trường timestamp chuẩn ISO 8601 (ví dụ: `tokenLoginTimestamp: "2026-09-21T13:05:10Z"`) để frontend hiển thị tooltip chi tiết khi người dùng rê chuột.

### 2. Thuật toán Ưu tiên Tài khoản Active Vị trí #01
* **Quy tắc:** Trường `isActive: true` xác định tài khoản đang được chọn sử dụng.
* Backend trả về danh sách accounts; frontend sẽ tự động ghim tài khoản `isActive: true` tại **chỉ mục 0 (index 0) - góc trên bên trái của CSS Grid** và gán huy hiệu số thứ tự **`#01`**. Các tài khoản còn lại lần lượt nhận **`#02`** đến **`#05`**.
* Khi người dùng nhấp chọn chuyển tài khoản (`POST /api/v1/quota/switch`), backend cập nhật cờ `isActive = true` cho tài khoản đích và hạ các tài khoản khác về `false`.

### 3. Cơ chế Bảo vệ Google Protect (Safety Guard)
* Áp dụng riêng cho các tài khoản Google Gemini (`isGoogleProtect: true`).
* Backend không đặt trần đồng thời toàn cục (`maxConcurrent: null`): mỗi conversation/session có FIFO riêng; các session khác nhau có thể dispatch đồng thời.
* Nếu Safety Guard đang cooldown hoặc chưa đến khoảng cách dispatch tối thiểu, order vẫn được nhận và giữ trong queue; chỉ thời điểm gửi lên OMP bị trì hoãn.
* Nếu nhận mã lỗi `429 Too Many Requests` từ Google API, backend kích hoạt `cooldownSec` và báo cờ `nextRequestAllowed = false` cho frontend.

### 4. Hệ thống Màu Nhận diện Tài khoản (Account Color Engine)
Frontend phân bổ 5 tone màu Deep Tech cho 5 tài khoản:
* `gemini-prod-core`: **Cyan** (`#38bdf8`) · Monogram `[GP]`
* `gemini-flash-runner`: **Cam (Orange)** (`#fb923c`) · Monogram `[GF]`
* `workspace-dev-alpha`: **Ngọc Lục (Emerald)** (`#34d399`) · Monogram `[WA]`
* `research-anthropic`: **Tím (Purple)** (`#c084fc`) · Monogram `[RA]`
* `ops-multi-backup`: **Hồng (Pink)** (`#f472b6`) · Monogram `[OM]`

---

## VI. HƯỚNG DẪN CẤU HÌNH KẾT NỐI FRONTEND - BACKEND

> Phần cấu hình và URL mock bên dưới giữ lại để tham chiếu contract cũ. Khi
> chạy production, dùng hai route `/chat` và `/quota`, hai file SKE và OMP
> runtime; không dùng các HTML legacy hoặc dữ liệu trong `mock-db.json`.

Cả hai tệp HTML giao diện (`honpi-quota-dashboard.html` và `honpi-chat-dashboard.html`) đều cung cấp sẵn đối tượng cấu hình toàn cục ở đầu trang, lập trình viên backend chỉ cần trỏ đường dẫn API endpoint:

### 1. Cấu hình Quota Dashboard (`honpi-quota-dashboard.html`)
Mở tệp và điều chỉnh khối `window.HONPI_QUOTA_CONFIG`:
```javascript
window.HONPI_QUOTA_CONFIG = {
  apiBaseUrl: 'https://api.yourdomain.com', // Để rỗng nếu cùng domain
  endpoints: {
    accounts: '/api/v1/quota/accounts',
    overview: '/api/v1/quota/overview',
    protect: '/api/v1/quota/protect-status',
    history: '/api/v1/quota/history',
    switchAccount: '/api/v1/quota/switch',
    sync: '/api/v1/quota/sync'
  },
  autoRefreshSec: 30 // Chu kỳ tự động thăm dò
};
```

### 2. Cấu hình Chat Dashboard (`honpi-chat-dashboard.html` / `neuratalk-chat-dashboard.html`)
Điều chỉnh khối `window.HONPI_CHAT_CONFIG`:
```javascript
window.HONPI_CHAT_CONFIG = {
  apiBaseUrl: 'https://api.yourdomain.com',
  endpoints: {
    sessions: '/api/v1/sessions',
    sessionMessages: (id) => `/api/v1/sessions/${id}/messages`,
    sendMessage: '/api/v1/chat/send',
    stream: '/api/v1/chat/stream',
    models: '/api/v1/models'
  },
  activeModel: 'neural-flash-3.8'
};
```

---

## VII. DANH MỤC KIỂM THỬ CHẤP NHẬN BÀN GIAO (ACCEPTANCE CHECKLIST)

Đội ngũ Backend và QA có thể nghiệm thu theo danh sách kiểm tra chuẩn:

- [x] **OpenAPI Schema:** `api-schema.json` vượt qua trình phân tích cú pháp OpenAPI 3.1.0 chuẩn không có lỗi.
- [x] **Tương thích Mock Server:** `mock-server.js` khởi chạy thành công trên Node.js/Bun với 0 external dependencies.
- [x] **Bộ kiểm thử API tự động:** `npm test` vượt qua **11/11 kịch bản** và **257/257 kiểm tra** (100% pass).
- [x] **CORS:** Mọi phản hồi API đều mang `Access-Control-Allow-Origin: *` và hỗ trợ preflight `OPTIONS`.
- [x] **Skeleton Shimmer:** Cả 2 giao diện hiển thị hiệu ứng skeleton mượt mà trong thời gian chờ dữ liệu API, 0% layout shift (CLS = 0).
- [x] **Ưu tiên #01:** Tài khoản active luôn được ghim ở vị trí đầu tiên bên trái và mang badge #01.
- [x] **Google Protect:** Huy hiệu `🛡️ Google Protect` hiển thị đúng cho các tài khoản Gemini và bảng điều khiển Safety Guard phản ánh chính xác số request/cooldown.
- [x] **Nhãn thời gian ngắn gọn:** 100% trường thời gian tương đối hiển thị dạng ngắn gọn (`1p`, `1g`, `2n`, `28p`, `42p`).
- [x] **Responsive:** 0px tràn ngang trên toàn bộ các kích thước màn hình từ 360px đến 1920px.
- [x] **Anti-Slop Linter:** Đạt **0 lỗi P0, 0 lỗi P1, 0 lỗi P2** qua công cụ lint của hệ sinh thái OpenDesign.

---
*Gói tài liệu bàn giao được biên soạn bởi Đội ngũ Kiến trúc Hệ thống Hòn π.*
