# DeepSeek Harness → OMP Gateway

Client host-side cho DeepSeek Harness gọi OMP đang chạy tại `127.0.0.1:4177`.

## Nguyên tắc

- Harness không đọc Google token và không tự chọn account.
- OMP vẫn sở hữu runtime, skill, tool, quota và `google-antigravity`.
- Browser/UI Harness gọi client này từ host/plugin backend; không gọi Gateway trực tiếp từ browser để tránh CORS và lộ contract nội bộ.
- Mỗi Harness `sessionId` ánh xạ vào đúng một OMP context.

## Dùng

```js
import { OmpGatewayClient } from "./client.mjs";

const omp = new OmpGatewayClient();
await omp.capabilities();
await omp.createSession({ sessionId: "harness-session-1", cwd: process.cwd() });

for await (const event of omp.streamPrompt("harness-session-1", "Mở trang local và kiểm tra tiêu đề", {
  useEgoBrowser: true,
})) {
  if (event.type === "text-delta") renderText(event.text);
  if (event.type === "tool-start" || event.type === "tool-end") renderActivity(event);
  if (event.type === "extension-request") await handleExtension(event.request);
  if (event.type === "error") renderError(event.message);
}
```

`streamPrompt()` tự mở SSE trước rồi mới gửi prompt, nên không mất event đầu lượt. `useEgoBrowser: true` được chuyển thành `/skill:ego-browser`; không cần copy skill vào Harness.

## Contract

- `GET /api/omp/v1/capabilities`
- `POST /api/omp/v1/sessions`
- `GET /api/omp/v1/sessions/:id`
- `GET /api/omp/v1/sessions/:id/events` — SSE raw OMP frames
- `POST /api/omp/v1/sessions/:id/prompt`
- `POST /api/omp/v1/sessions/:id/command`
- `POST /api/omp/v1/sessions/:id/abort`
- `DELETE /api/omp/v1/sessions/:id`

## Giới hạn có chủ ý

Bundle này có cả client host-side và `LlmAdapter` native cho DSH Web. Adapter chỉ nhận prompt/stream từ Harness; OMP sở hữu agent loop, tool, skill và lịch sử thực thi. Harness vẫn giữ session UI và không nhận Google credential.
