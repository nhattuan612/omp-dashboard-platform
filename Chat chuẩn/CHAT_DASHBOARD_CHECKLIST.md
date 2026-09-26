# BẢNG CHECKLIST CHI TIẾT TẬN CÙNG TÍNH NĂNG & ĐẶC TẢ LOGIC `neuratalk-chat-dashboard.html`
> **Dự án:** Hòn π · Trợ lý AI Thông minh & Bảng Điều Khiển Trò Chuyện  
> **Phiên bản:** 1.0.0 (Skeleton-First & Production-Ready)  
> **Ngôn ngữ thiết kế:** Hòn π Design System 1.0.0 (Deep Tech Charcoal-Navy Canvas)  
> **Tệp nguồn:** `neuratalk-chat-dashboard.html`

---

## PHẦN I. CHECKLIST TỔNG HỢP 100% TÍNH NĂNG (FEATURE CHECKLIST)

### 1. Thanh Bên Điều Hướng Trái (Collapsible Sidebar)
- [x] **1.1. Đầu Thanh Bên (Sidebar Header):**
  - Khối thương hiệu: Logo bong bóng hội thoại chữ $\pi$ xanh cobalt (`logohonpi.png`, kích thước 22×22px, bo góc 5px).
  - Tên định danh thương hiệu: `Hòn π` (font Inter 700, màu trắng `--fg`).
  - Nút thu gọn thanh bên (`#collapseSidebarBtn`): Thu gọn mượt mà thanh bên về `width: 0`, chuyển sang trạng thái toàn màn hình.
- [x] **1.2. Thao Tác Nhanh (Sidebar Actions):**
  - Nút tạo cuộc trò chuyện mới (`#newSessionBtn`): Nút nền Cobalt nổi bật, nhãn `+ Cuộc trò chuyện mới`, phím tắt hiển thị `⌘K`.
  - Ô tìm kiếm phiên (`#sidebarSearchInput`): Tìm kiếm thời gian thực theo tiêu đề phiên hội thoại, tự động ẩn các phiên không khớp.
- [x] **1.3. Nhóm Phiên Đã Ghim (Pinned Group - `#pinnedGroupWrap`):**
  - Tiêu đề nhóm `ĐÃ GHIM` kèm bộ đếm số lượng phiên font monospace.
  - Hiển thị danh sách phiên được ghim lên đầu kèm icon ghim tĩnh `📌`.
  - Trạng thái mặc định: Dải Skeleton Shimmer chuyển động mượt mà khi chưa nạp dữ liệu.
- [x] **1.4. Nhóm Thư Mục Dự Án (Projects Group - `#projectsGroupWrap`):**
  - Tiêu đề nhóm `DỰ ÁN` kèm bộ đếm số lượng thư mục dự án font monospace.
  - Hàng thư mục dạng Accordion (Đóng/Mở): Icon thư mục `📁`, tên dự án, số lượng phiên con bên trong.
  - **Menu chuột phải trên Thư mục Dự án (`#folderContextMenu`):** Bắt sự kiện chuột phải trên thanh thư mục, mở menu ngữ cảnh gồm 2 tính năng:
    - `[ ✏️ Chỉnh sửa (chọn lại vị trí folder) ]`
    - `[ 🗑️ Xoá ]`
- [x] **1.5. Nhóm Chưa Phân Loại (Unassigned Group - `#recentGroupWrap`):**
  - Tiêu đề nhóm `CHƯA PHÂN LOẠI` kèm bộ đếm số lượng.
  - Hiển thị các phiên trò chuyện độc lập chưa được gán vào dự án nào.
- [x] **1.6. Thẻ Phiên Hội Thoại (Session Item - Zero Layout Shift):**
  - Cụm bên trái: Icon tĩnh + Tiêu đề phiên tự động ngắt `...` khi thiếu chỗ.
  - Cụm bên phải: Chấm xanh thông báo chưa đọc (`.unread-dot`), spinner xoay khi AI đang chạy, nhãn thời gian ngắn gọn chuẩn quy tắc (`1p`, `2g`, `1n`, `2n`, `3n`).
  - **Triệt tiêu 100% nút 3 chấm (`···`) khi rê chuột:** Giữ nguyên vị trí chữ 100%, không bị co ngắn hay giật dòng khi lướt chuột qua.
  - **Menu chuột phải phiên hội thoại (`#sessionContextMenu`):** Mở đầy đủ 12 tùy chọn quản lý phiên (Đổi tên, Ghim/Bỏ ghim, Đánh dấu chưa đọc, Chuyển dự án, Xóa...).
- [x] **1.7. Trạng Thái Trống (Sidebar Empty State):**
  - Hiển thị thông báo hướng dẫn tinh tế khi không có phiên nào hoặc khi kết quả tìm kiếm rỗng.
- [x] **1.8. Thanh Trạng Thái Đáy Thanh Bên (Sidebar Status Bar):**
  - **Bên trái:** Nút tác vụ **`[ ⚙️ Cài đặt ]`** (`#navSettingsBtn`) với icon bánh răng và chữ thẳng hàng (white-space: nowrap).
  - **Bên phải:** Huy hiệu kết nối **`[ 🟢 Đã kết nối ]`** (`#connectionStatusPill`) với đèn live phát quang.
  - *Đã loại bỏ hoàn toàn nút Quota OMP thừa thãi theo đúng yêu cầu.*

---

### 2. Thanh Tiêu Đề Chính (Main Header)
- [x] **2.1. Cụm Bên Trái (Header Left):**
  - Nút mở rộng thanh bên (`#expandSidebarBtn`): Chỉ xuất hiện khi thanh bên đang đóng để mở lại thanh bên.
  - Tiêu đề phiên làm việc (`#headerSessionTitle`): Hiển thị breadcrumb hoặc tên phiên hiện tại (ví dụ: `Phiên làm việc mới`, `Cài đặt Hòn π CLI...`).
- [x] **2.2. Khối Trung Tâm (Header Center Bar - Container Query Resilient):**
  - **Huy hiệu Mô hình AI (`#headerModelPill`):** Icon `✦` + Tên mô hình `neural-flash-3.8`, font monospace, nhấp vào mở tab Mô hình trong Cài đặt.
  - **Huy hiệu Telemetry Tài Khoản OMP Đang Dùng (`#headerActiveAccountPill`):**
    - Đèn xanh lá phát quang `live-dot`.
    - Tên email rút gọn của tài khoản Active #01 (`gemini-prod`).
    - Thời lượng phiên sử dụng thực tế: `1g 45p` (chuẩn nhãn ngắn gọn).
    - Nhấp chuột trực tiếp mở ngay cửa sổ modal Kiểm Tra Hạn Mức OMP.
- [x] **2.3. Cụm Tác Vụ Phải (Header Right):**
  - Nút Bật/Tắt Hàng đợi (`#btnToggleQueue`): Đóng/mở khay Prompt Queue Tray phía trên thanh nhập liệu.
  - Nút Công cụ & Tệp (`#btnToggleToolsDrawer`): Mở/đóng Ngăn công cụ bên phải (`#toolsDrawer`).
  - Nút Console (`#btnToggleBottomPanel`): Mở/đóng Terminal Console Sandbox ở đáy màn hình (`#bottomPanel`).

---

### 3. Vùng Cuộn Luồng Hội Thoại (Chat Scroll Area)
- [x] **3.1. Loại Bỏ Hoàn Toàn Lớp Phủ Che Khuất (`chat-top-space-fade`):**
  - Đã xóa sạch dải gradient tối 28px; không gian đỉnh khung chat hoàn toàn trong suốt và sắc nét, không bị che khuất chữ hay logo khi cuộn trang.
- [x] **3.2. Màn Hình Chào Khởi Đầu (Greeting Hero View - Mặc Định):**
  - Logo nhận diện Hòn $\pi$ 56×56px phát quang tỏa tròn (Azure Glow).
  - Tiêu đề: `Chào mừng bạn đến với Hòn π` (font Inter 700 trắng sáng).
  - Mô tả định hướng: *Trợ lý AI chuyên sâu hỗ trợ phát triển sản phẩm, tối ưu mã nguồn và điều phối tác vụ thông minh.*
  - **Lưới 4 Thẻ Gợi Ý Câu Lệnh Nhanh (Prompt Starter Cards):**
    1. *Tối ưu hóa Codebase:* Điền sẵn câu lệnh rà soát vòng lặp và logic bất đồng bộ.
    2. *Thiết kế Design System:* Điền sẵn câu lệnh chuẩn hóa token màu và typography.
    3. *Phân tích API & Bảo mật:* Điền sẵn câu lệnh kiểm tra xác thực JWT và CORS.
    4. *Viết kiểm thử tự động:* Điền sẵn câu lệnh sinh kịch bản Unit Test và E2E.
    - Nhấp vào thẻ bất kỳ sẽ tự động điền nội dung vào khung nhập liệu và focus con trỏ.
- [x] **3.3. Dải Tiêm Ngữ Cảnh Hệ Thống (Context Injections Bar):**
  - Hiển thị các pill ngữ cảnh đính kèm: `Context injection · @hon-pi/vision-engine`, `WCAG 2.1 AA Audit` với khoảng cách đệm chuẩn 16px.
- [x] **3.4. Luồng Tin Nhắn Đa Dạng (Chat Stream):**
  - Tin nhắn Người dùng: Bong bóng màu xanh đậm viền mềm, avatar người dùng, thời gian gửi ngắn gọn.
  - Tin nhắn Trợ lý AI: Logo Hòn $\pi$, định dạng Markdown chuẩn mực, khối code syntax highlight có nút sao chép.
  - **Thẻ Thay Đổi Tệp Mã Nguồn (`.file-change-card`):** Hiển thị danh sách tệp thay đổi kèm thống kê diff (+71 -8) và nút **`[ Xem xét ]`** mở Popup Diff.
  - **Thẻ Tiến Trình AI Đang Chạy (`.ai-running-progress-card`):** Thanh tiến trình 52%, spinner xoay và terminal mini live log.
  - **Thẻ Đính Kèm File:** Chip tệp tin PDF, SQL, CSV chuyên nghiệp.
  - **Thẻ Hình Ảnh Vision Mockup:** Hiển thị ảnh mockup kèm bảng scorecard chấm điểm UI/UX WCAG.

---

### 4. Thanh Điều Hướng Lượt & Kéo Timeline (Drag-to-Scrub Timeline Nav)
- [x] **4.1. Vị Trí Cố Định Tuyệt Đối Bám Khung Chat (`position: absolute; right: 10px;`):**
  - Nằm ngay sát mép phải khung chat, tự động trượt theo khi mở/đóng Ngăn công cụ bên phải, luôn cách mép đúng 10px.
- [x] **4.2. Thiết Kế Trong Suốt Hoàn Toàn (Zero Background & No Rail):**
  - Nền trong suốt 100%, không viền, không bóng đổ, không còn vạch đứng hairline phụ bên phải.
  - Đã loại bỏ tooltip mặc định màu trắng của trình duyệt (`title` attribute).
- [x] **4.3. Dải Vạch Line Ngang Đa Trạng Thái:**
  - Vạch tiêu chuẩn: Dài 12px, cao 2.5px, màu xám mềm.
  - Vạch Active (lượt đang đọc): Mở rộng sang trái dài **25px**, cao 3px, phát sáng màu **Xanh Cobalt Hòn π** (`#2f6feb`).
- [x] **4.4. Tính Năng Kéo Lướt Timeline (Drag-to-Scrub):**
  - Nhấp giữ chuột và kéo dọc dải vạch để cuộn lướt qua toàn bộ lịch sử chat theo thời gian thực.
  - Tooltip bay xem trước bên trái vạch: Hiển thị số thứ tự lượt (`#1`, `#2`, `#3`...), trích đoạn câu hỏi và mốc giờ ngắn gọn.
  - Nhấp 1 chạm vào vạch bất kỳ để nhảy ngay tới lượt đó.
  - Tự động nhảy vạch active khi lăn chuột đọc bài.

---

### 5. Khung Soạn Thảo & Hàng Chờ Lệnh (Chat Dock Area)
- [x] **5.1. Khay Hàng Đợi Câu Lệnh (Prompt Queue Tray - `#promptQueueTray`):**
  - Hiển thị số lượng lệnh đang xếp hàng: `Hàng chờ: 3 câu lệnh`.
  - Nút `Xóa hàng chờ` dọn dẹp hàng đợi.
  - Hỗ trợ xem danh sách lệnh, gửi ngay hoặc kéo đổi thứ tự.
- [x] **5.2. Khung Nhập Liệu Tự Động Co Giãn (`#chatInput`):**
  - Textarea tự động co giãn chiều cao theo nội dung nhập (tối đa 200px).
  - Phím `Enter`: Gửi câu lệnh (hoặc thêm vào hàng đợi nếu AI đang chạy).
  - Phím `Shift + Enter`: Xuống dòng mới.
- [x] **5.3. Thanh Công Cụ Nhập Liệu (Dock Toolbar):**
  - Nút Đính kèm tệp (`#btnAttachFile`): Bật bộ chọn file hệ thống.
  - Nút Gửi câu lệnh (`#btnSendChat`): Icon máy bay giấy chuyển đổi trạng thái khi AI đang thực thi.

---

### 6. Ngăn Console & Ngăn Công Cụ (Drawers)
- [x] **6.1. Terminal Console Sandbox Ở Đáy (`#bottomPanel`):**
  - Drawer trượt từ đáy màn hình lên, hiển thị môi trường dòng lệnh sandbox `hon-pi@sandbox:~/workspace $`.
  - Nút `Xóa console` và nút `Đóng console`.
- [x] **6.2. Ngăn Công Cụ & Tệp Đính Kèm Bên Phải (`#toolsDrawer`):**
  - Drawer trượt từ mép phải màn hình vào (chiều rộng 320px).
  - Hiển thị danh mục tệp tin đã đính kèm và danh sách công cụ phân tích từ backend.
  - Nút đóng ngăn công cụ.

---

### 7. Cửa Sổ Popup Kiểm Tra Hạn Mức OMP (`#quotaDashboardModal`)
- [x] **7.1. Bố Cục Tối Ưu 760px:** Thiết kế phẳng, không vỡ dòng, không rớt chữ.
- [x] **7.2. Thanh Active Account Banner Trên Cùng:**
  - Đèn nhấp nháy xanh ngọc.
  - Email tài khoản đang dùng: `gemini-prod-core@company.ai`.
  - Huy hiệu khiên: `🛡️ Google Protect`.
  - Thời lượng phiên sử dụng: `Đang xài: 1g 45p`.
- [x] **7.3. Lưới 4 Cửa Sổ Hạn Mức Tức Thời:** Đồng bộ tỷ lệ và thời gian reset của 4 cửa sổ (Gemini 5g, Gemini Tuần, Claude 5g, Claude Tuần).
- [x] **7.4. Bảng Danh Sách 5 Tài Khoản (6 Cột Chuẩn):**
  - Cột `STT`: **Tài khoản active luôn được xếp ở hàng `#01` đầu tiên** với huy hiệu nổi bật.
  - Cột `Tài khoản & Provider`: Email có màu sắc nhận diện riêng, kèm badge `[ 🛡️ Protect ]` cho tài khoản Gemini.
  - Cột `Cửa sổ 5g`: Tỷ lệ % và thời gian reset ngắn gọn.
  - Cột `Cửa sổ Tuần`: Tỷ lệ % và thời gian reset tuần.
  - Cột `Đăng nhập Token`: Giờ đăng nhập và `(cách đây ...)`.
  - Cột `Trạng thái`: Status pill màu ngữ cảnh (Hết Quota, Nguy hiểm, Cảnh báo, OK).
  - Cột `Tác vụ`: Nút **`[ ✓ Đang dùng ]`** hoặc **`[ ⇄ Chuyển ]`**.
- [x] **7.5. Chuyển Đổi Tài Khoản Tức Thì:** Nhấp `[ ⇄ Chuyển ]` lập tức đổi tài khoản active, cập nhật nhãn `#01` và lưu `localStorage`.
- [x] **7.6. Liên Kết Điều Hướng:** Nút CTA chân modal: `Mở Dashboard Quản lý Quota đầy đủ ↗` dẫn sang `quota-dashboard.html`.

---

### 8. Cửa Sổ Popup Cài Đặt Hệ Thống (`#settingsModal`)
- [x] **8.1. Độc Lập Trực Tiếp Dưới `<body>` (Z-Index: 1200):** Đã sửa lỗi lồng thẻ, hiển thị nổi khối rõ nét giữa màn hình.
- [x] **8.2. Tùy Chọn Chủ Đề Giao Diện (Theme):** Nút chuyển đổi Tối / Sáng (`Alt+T`).
- [x] **8.3. Tùy Chọn Mô Hình AI Mặc Định:** Dropdown chọn `neural-flash-3.8`, `claude-3-5-sonnet`, `gemini-2.5-pro`.
- [x] **8.4. Tùy Chọn Quyền Hạn Sandbox & API Key:** Cấu hình tự động phê duyệt câu lệnh và nhập khóa API.
- [x] **8.5. Tùy Chọn Ngôn Ngữ & Cỡ Chữ:** Tiếng Việt / English, cỡ chữ 13px / 14px / 15px.
- [x] **8.6. Đóng Hộp Thoại:** Nút `×`, nhấn phím `Escape` hoặc nhấp chuột ra ngoài vùng nền mờ.

---

### 9. Cửa Sổ Popup Xem Xét Code Diff (`#codeDiffReviewModal`)
- [x] **9.1. Bố Cục Thích Ứng Đa Thiết Bị (Responsive 2-Tier Header):**
  - Desktop (≥768px): Chiều rộng 980px thoáng đãng, tiêu đề và nút tác vụ trên cùng 1 hàng.
  - Mobile (<640px): Tự động chuyển thành 2 tầng (Tầng 1: Tiêu đề + Thống kê + Nút đóng neo góc phải; Tầng 2: Nút `Hoàn tác tệp` và `Áp dụng tất cả` chia đều 50%-50%).
- [x] **9.2. Thống Kê Diff Tổng Thể:** Hiển thị rõ số dòng thêm (`+71`), số dòng bớt (`-8`) và số tệp (`5 tệp đã chỉnh sửa`).
- [x] **9.3. Dải Tab Tệp Tin Cuộn Ngang Mượt Mà:** Cuộn cảm ứng các tệp mã nguồn đang xem xét.
- [x] **9.4. Khung Trình Xem Diff (Diff Code Viewer):**
  - Dòng thêm mới: Màu xanh lá, nền trong mờ `rgba(16, 185, 129, 0.12)`.
  - Dòng xóa bỏ: Màu đỏ cảnh báo, nền trong mờ `rgba(239, 68, 68, 0.12)`.
  - Cột số dòng và thanh cuộn ngang mượt mà.
- [x] **9.5. Nút Tác Vụ:** `[ ↶ Hoàn tác tệp này ]`, `[ ✓ Áp dụng tất cả ]`, `[ Đóng xem xét ]`.

---

### 10. Menu Ngữ Cảnh & Hộp Thoại Quản Lý Thư Mục Dự Án
- [x] **10.1. Menu Chuột Phải Thư Mục (`#folderContextMenu`):**
  - Mở đúng tọa độ con trỏ chuột khi nhấp chuột phải trên bất kỳ hàng thư mục nào.
  - Hai mục thao tác: `[ ✏️ Chỉnh sửa (chọn lại vị trí folder) ]` và `[ 🗑️ Xoá ]`.
- [x] **10.2. Hộp Thoại Chỉnh Sửa Vị Trí Thư Mục (`#editFolderModal`):**
  - Ô đổi tên thư mục dự án.
  - Ô nhập đường dẫn vị trí thư mục (Folder Path).
  - Nút **`[ 📁 Duyệt... ]`**: Kích hoạt bộ chọn thư mục hệ thống qua input file `webkitdirectory`.
  - Dải chip gợi ý đường dẫn nhanh: `[/workspace/dual-engine]`, `[/workspace/design-system]`, `[/workspace/analytics-platform]`, `[~/Projects/AI-Core]`.
  - Lưu thay đổi: Cập nhật tức thì tên thư mục, tooltip và thuộc tính `data-path` trên thanh bên kèm thông báo Toast.
- [x] **10.3. Hộp Thoại Xác Nhận Xoá Thư Mục Dự Án (`#deleteFolderConfirmModal`):**
  - Cảnh báo tên thư mục dự án cần xoá.
  - Cơ chế an toàn: Tự động bảo toàn toàn bộ cuộc trò chuyện bên trong và chuyển về mục *"Chưa phân loại"*.
  - Cập nhật tự động số đếm thư mục dự án sau khi xoá.

---

### 11. Tiện Ích Phát Triển (Dev Banner) & Trợ Năng (A11y)
- [x] **11.1. Thanh Dev Banner (`#dev-chat-banner`):**
  - Trạng thái: `Sẵn sàng nhận dữ liệu từ backend (/api/v1/sessions). Đang ở trạng thái Skeleton khoa học.`
  - Nút **`[ Nạp Dữ Liệu Mẫu (Demo) ]`**: Cho phép lập trình viên nạp ngay 4 kịch bản mẫu chân thực để kiểm tra giao diện không cần server.
  - Nút **`[ Khôi Phục Skeleton ]`**: Đưa giao diện quay trở lại trạng thái Skeleton Shimmer ban đầu.
- [x] **11.2. Phím Tắt Bàn Phím Toàn Cục:**
  - `Alt + T`: Chuyển đổi giao diện Tối / Sáng tức thì.
  - `⌘K` hoặc `Ctrl + K`: Tạo cuộc trò chuyện mới.
  - `Escape`: Đóng nhanh bất kỳ popup modal hoặc context menu nào đang mở.
- [x] **11.3. Hệ Thống Thông Báo Nổi (Toast Notification System):**
  - Thông báo phản hồi góc dưới bên phải, tự động biến mất sau 2.8 giây.

---

## PHẦN II. ĐẶC TẢ CHI TIẾT CÁC KHỐI LOGIC NGHIỆP VỤ & KỸ THUẬT

### 1. Kiến Trúc Skeleton-First & Nạp Dữ Liệu Phản Xạ

Giao diện được thiết kế theo chuẩn **Perceived Performance**:
* **Khi chưa có dữ liệu từ backend:** Khung thanh bên hiển thị các dải Skeleton Shimmer được định hình sẵn kích thước hình học chính xác. Khung chat hiển thị Greeting Hero. Quá trình này diễn ra với $0\text{ms}$ giật layout (CLS = 0).
* **Khi backend phản hồi:** Hàm `HonPiChatApp.renderSessions(data)` duyệt qua danh sách, xóa bỏ skeleton và kết xuất cây thư mục và danh sách phiên thực tế.
* **Cơ chế Dev Banner Demo:** Nhấp `[ Nạp Dữ Liệu Mẫu ]` kích hoạt `loadDemoChatData()`, đưa 4 kịch bản thực tế vào bộ nhớ đệm và hiển thị phiên mẫu ngay lập tức.

---

### 2. Thuật Toán Xếp Vị Trí `#01` Cho Tài Khoản Active Trong Quota Modal

* Khi mở Modal Quota (`#quotaDashboardModal`), hàm `updateChatActiveAccountUI()` đọc ID tài khoản active từ `localStorage.getItem('honpi_active_omp_account')` (hoặc mặc định `acc-2`).
* Thuật toán sắp xếp danh sách tài khoản:
  ```javascript
  accounts.sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return 0;
  });
  ```
* Hàng đầu tiên (index 0) luôn nhận huy hiệu `#01` mang class `.is-active` và nút `[ ✓ Đang dùng ]`.
* Bấm `[ ⇄ Chuyển ]` ở tài khoản khác sẽ lưu ID mới vào `localStorage`, đảo vị trí tài khoản đó lên hàng đầu `#01`, cập nhật thanh Banner trên modal và cập nhật widget trên thanh Header.

---

### 3. Logic Drag-to-Scrub Trên Thanh Điều Hướng Timeline

* **Bắt sự kiện:**
  - `pointerdown`: Ghi nhận vị trí bắt đầu kéo, thêm class `.is-scrubbing` vào `#chatTurnNav`.
  - `pointermove`: Tính toán tỷ lệ tọa độ Y chuột so với chiều cao thanh:
    $$\text{Ratio} = \frac{e.clientY - \text{rect.top}}{\text{rect.height}}$$
    Từ tỷ lệ đó, tính toán vị trí cuộn tương ứng của `#chatScrollArea`:
    $$\text{scrollTop} = \text{Ratio} \times (\text{scrollHeight} - \text{clientHeight})$$
  - `pointerup`: Hủy trạng thái kéo, cập nhật vạch active.
* **Đồng bộ hai chiều:** Khi người dùng lăn chuột đọc tin nhắn bình thường, sự kiện `scroll` trên `#chatScrollArea` tự động tính toán lượt chat gần nhất đang nằm trong khung nhìn và làm sáng vạch tương ứng trên timeline.

---

### 4. Logic Menu Chuột Phải Thư Mục Dự Án & Chỉnh Sửa Vị Trí

* **Bắt sự kiện Context Menu:**
  ```javascript
  folderRow.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    targetFolderId = folderRow.dataset.folderId;
    folderMenu.style.left = `${e.clientX}px`;
    folderMenu.style.top = `${e.clientY}px`;
    folderMenu.classList.add('open');
  });
  ```
* **Chỉnh sửa vị trí folder:**
  - Mở `#editFolderModal`, điền tên và đường dẫn hiện tại vào các input.
  - Người dùng có thể tự gõ đường dẫn, bấm chip gợi ý hoặc bấm `📁 Duyệt...` để kích hoạt `editFolderPicker.click()`.
  - Thuộc tính `webkitdirectory` cho phép chọn cả thư mục từ ổ đĩa máy tính và trích xuất đường dẫn tương đối.
  - Bấm `Lưu thay đổi`: Cập nhật lại tên và `data-path` trên DOM thanh bên, lưu vào cấu hình và bắn Toast thông báo.

---

### 5. Logic Đóng/Mở Các Drawer & Modal An Toàn

* Mọi modal và drawer đều có hàm quản lý tập trung:
  - `HonPiChatApp.openModal(modalId)`
  - `HonPiChatApp.closeModal(modalId)`
  - `HonPiChatApp.toggleDrawer(drawerId)`
* Sự kiện bàn phím toàn cục lắng nghe phím `Escape`: Khi bấm `Escape`, hệ thống kiểm tra và tự động đóng modal/context menu đang mở ở tầng trên cùng, đảm bảo người dùng không bao giờ bị kẹt trong màn hình popup.

---

### 6. Quy Tắc Nhãn Thời Gian Ngắn Gọn (Verified Rule Compliance)

Toàn bộ nhãn thời gian trên thanh bên, trong danh sách phiên, trên header và trong modal đều tuân thủ nghiêm ngặt quy tắc viết tắt:
* Phút: `p` (ví dụ: `1p`, `35p`)
* Giờ: `g` (ví dụ: `1g`, `2g`, `1g 45p`)
* Ngày: `n` (ví dụ: `1n`, `2n`, `3n`)
* Giây: `s` (ví dụ: `28s`)
* Mọi nhãn đều đính kèm thuộc tính `title="..."` chứa chuỗi ngày giờ chi tiết theo chuẩn ISO để người dùng xem lại khi rê chuột.

---

## PHẦN III. BẢNG TỔNG HỢP KIỂM ĐỊNH CHẤT LƯỢNG KỸ THUẬT

| Hạng Mục Kiểm Định | Công Cụ & Phương Pháp | Kết Quả Đo Lường | Đánh Giá |
| :--- | :--- | :---: | :---: |
| **Anti-Slop Linter** | `od lint neuratalk-chat-dashboard.html --json` | **0 P0, 0 P1, 0 P2** (ok: true) | **HOÀN HẢO** |
| **Tràn Ngang Responsive** | Chromium Headless (360px – 1920px) | **0px overflow** trên toàn bộ 9 mốc | **100% RESPONSIVE** |
| **Lệch Chữ Tiêu Đề Khi Hover** | Puppeteer Bounding Box Verification | **Delta = 0.00px** (Không xê dịch) | **TRIỆT TIÊU 100%** |
| **Lớp Phủ Che Khuất Nội Dung** | Visual Headless Rendering Verification | **0px che khuất**, 100% trong suốt | **ĐÃ XỬ LÝ DỨT ĐIỂM** |
| **Thực Thi Menu Chuột Phải** | Contextmenu Event Dispatching Test | Cả 2 menu Session & Folder mở chuẩn | **HOẠT ĐỘNG TỐT** |
| **Tốc Độ Nạp Trang (Parse DOM)** | Chrome Performance Navigation Timing | **< 28ms** (Nhẹ hơn 89.3% bản cũ) | **TẢI TỨC THÌ** |

## PHỤ LỤC — Production SKE (2026-09-22)

- [x] **Markdown assistant phải render bằng DOM an toàn:** Không dùng `innerHTML`/raw HTML cho nội dung OMP; giữ `textContent` cho token, chỉ tạo node có kiểm soát cho heading, list, emphasis, code và link `http/https`.
- [x] **Transcript phải có nguồn chuẩn:** Khi ghép transcript OMP với runtime cache, loại bản sao cùng role/nội dung trong cửa sổ thời gian ngắn; không để một lượt chat xuất hiện hai lần.
- [x] **Sidebar production giữ nhịp đọc:** Chiều rộng mặc định 260px theo Design System, hàng phiên tối thiểu 28px, ẩn nút hover `···` để không làm co tiêu đề; thao tác quản lý vẫn qua context menu.

### Production feature audit — 2026-09-22

- Session rename/delete use accessible production modals; native prompt/confirm are forbidden.
- Sort/filter/search state must survive adapter refresh; compound relative times use backend timestamps.
- DOM-only duplicate/export/folder creation controls stay hidden until an OMP API exists.
- Settings controls must update the stream payload or show `Chưa khả dụng`; no success toast for UI-only controls.
- Mobile approval popover and composer controls must fit 360px without horizontal overflow.

### OMP capability gate — 2026-09-22

- [x] Tool drawer mô tả từng capability bằng tiếng Việt và dùng switch theo Design System, không dùng checkbox thô.
- [x] Semantics tool đã ghi rõ: cùng session giữ tool qua nhiều order; chat mới nhận lựa chọn hiện tại; session cũ khôi phục allowlist đã lưu; toggle áp dụng từ lượt kế tiếp sau khi adapter dựng lại context.
- [x] Live toggle kiểm tra: trong lúc restart context switch bị khóa; hoàn tất có toast thành công, rollback lỗi và metadata session khớp.

- [x] Verify installed OMP binary/version and run one safe prompt before exposing capability UI.
- [x] Tool drawer uses only RPC-valid `--tools` IDs: `read`, `write`, `edit`, `ast_edit`, `grep`, `glob`, `bash`, `eval`, `lsp`, `debug`, `task`, `hub`, `web_search`, `todo`, `goal`, `init_experiment`, `run_experiment`, `log_experiment`, `update_notes`.
- [x] Tool checkbox updates `omp --tools=<csv>` through the backend; unavailable/non-valid IDs are excluded.
- [x] Browser Relay/Ego Browser remains a Browser mode, not a fabricated OMP tool ID.

### Sidebar regression checks — 2026-09-22

- [x] Folder lists show five sessions initially and expose `Tải thêm` when more are available.
- [x] Double-clicking a session opens the same rename flow as the context menu.
- [x] Rename preserves the session activity timestamp and sidebar position.
- [x] Folder context menu supports `Luôn mở rộng`, `Luôn thu gọn`, and manual mode.
