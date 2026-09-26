/**
 * Hòn π · Kịch Bản Kiểm Thử API Giả Lập Tự Động (Mock API Test Suite)
 * 
 * Chạy kiểm thử: node test-mock-api.js
 * Tự động kiểm định 12 kịch bản toàn diện theo hợp đồng api-schema.json
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const TEST_HOST = '127.0.0.1';
const TEST_PORT = 4178; // Dùng port 4178 để tránh xung đột
let serverProcess = null;

// Helper thực thi HTTP Request
function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const defaultOptions = {
      hostname: TEST_HOST,
      port: TEST_PORT,
      timeout: 5000,
      headers: {}
    };
    const reqOpts = { ...defaultOptions, ...options };

    if (postData) {
      if (typeof postData === 'object') {
        postData = JSON.stringify(postData);
        reqOpts.headers['Content-Type'] = 'application/json';
      }
      reqOpts.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json: json
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout sau 5s khi gọi: ${reqOpts.method || 'GET'} ${reqOpts.path}`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// Báo cáo kiểm thử
const report = {
  total: 0,
  passed: 0,
  failed: 0,
  scenarios: []
};

function assert(condition, message) {
  report.total++;
  if (condition) {
    report.passed++;
    console.log(`    \x1b[32m✓\x1b[0m ${message}`);
  } else {
    report.failed++;
    console.log(`    \x1b[31m✗ THẤT BẠI:\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertFields(value, fields, label) {
  assert(value && typeof value === 'object', `${label} là object`);
  fields.forEach(field => {
    assert(Object.prototype.hasOwnProperty.call(value, field), `${label} có trường ${field}`);
  });
}

async function runScenario(name, testFn) {
  console.log(`\n\x1b[1m\x1b[36m▶ KỊCH BẢN ${report.scenarios.length + 1}:\x1b[0m \x1b[1m${name}\x1b[0m`);
  const start = Date.now();
  try {
    await testFn();
    const duration = Date.now() - start;
    report.scenarios.push({ name, status: 'PASS', duration });
    console.log(`  \x1b[32m✔ Kịch bản hoàn thành xuất sắc (${duration}ms)\x1b[0m`);
  } catch (err) {
    const duration = Date.now() - start;
    report.scenarios.push({ name, status: 'FAIL', duration, error: err.message });
    console.log(`  \x1b[31m✘ Kịch bản gặp sự cố: ${err.message} (${duration}ms)\x1b[0m`);
  }
}

async function startTestServer() {
  return new Promise((resolve, reject) => {
    // Thử kết nối nếu server đã chạy
    const probe = http.get(`http://${TEST_HOST}:${TEST_PORT}/api/v1/quota/protect-status`, (res) => {
      console.log(`\x1b[90mMáy chủ mock server đã chạy sẵn trên cổng ${TEST_PORT}.\x1b[0m`);
      resolve(null);
    });

    probe.on('error', () => {
      // Khởi động server trong child process
      console.log(`\x1b[90mĐang khởi động máy chủ mock server trên cổng ${TEST_PORT}...\x1b[0m`);
      serverProcess = spawn(process.execPath, [path.join(__dirname, 'mock-server.js'), `--port=${TEST_PORT}`], {
        stdio: 'pipe'
      });

      serverProcess.stdout.on('data', (d) => {
        if (d.toString().includes('Local Mock API Server')) {
          setTimeout(resolve, 200);
        }
      });

      serverProcess.on('error', reject);
      setTimeout(resolve, 1000);
    });
  });
}

function stopTestServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
}

async function runTestSuite() {
  console.log('\x1b[34m════════════════════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m\x1b[35m  ✦ HÒN π · BỘ KIỂM THỬ API GIẢ LẬP TỰ ĐỘNG (API TEST SUITE)\x1b[0m');
  console.log('  \x1b[90mĐặc tả theo chuẩn OpenAPI 3.1.0 (api-schema.json)\x1b[0m');
  console.log('\x1b[34m════════════════════════════════════════════════════════════════════════\x1b[0m');

  await startTestServer();

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 1: Phục vụ Tệp Tĩnh & Đặc Tả Schema
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm tra Phục vụ Tệp Tĩnh & Hợp đồng API Schema', async () => {
    const resSchema = await request({ path: '/api-schema.json' });
    assert(resSchema.statusCode === 200, 'Endpoint /api-schema.json phản hồi HTTP 200');
    assert(resSchema.json && resSchema.json.openapi === '3.1.0', 'Tệp api-schema.json là chuẩn OpenAPI 3.1.0 hợp lệ');
    assert(resSchema.json.paths['/api/v1/quota/accounts'] !== undefined, 'Đặc tả chứa đường dẫn /api/v1/quota/accounts');

    const resQuotaHtml = await request({ path: '/honpi-quota-dashboard.html' });
    assert(resQuotaHtml.statusCode === 200, 'Tệp honpi-quota-dashboard.html phục vụ HTTP 200');
    assert(resQuotaHtml.body.includes('HONPI_QUOTA_CONFIG'), 'HTML chứa đối tượng cấu hình HONPI_QUOTA_CONFIG');

    const resChatHtml = await request({ path: '/honpi-chat-dashboard.html' });
    assert(resChatHtml.statusCode === 200, 'Tệp honpi-chat-dashboard.html phục vụ HTTP 200');
    assert(resChatHtml.body.includes('HONPI_CHAT_CONFIG'), 'HTML chứa đối tượng cấu hình HONPI_CHAT_CONFIG');

    const resQuotaRoute = await request({ path: '/quota' });
    assert(resQuotaRoute.statusCode === 200, 'Route /quota phục vụ HTTP 200');
    assert(resQuotaRoute.body.includes('HONPI_QUOTA_CONFIG'), 'Route /quota trỏ đúng Quota SKE');

    const resChatRoute = await request({ path: '/chat' });
    assert(resChatRoute.statusCode === 200, 'Route /chat phục vụ HTTP 200');
    assert(resChatRoute.body.includes('HONPI_CHAT_CONFIG'), 'Route /chat trỏ đúng Chat SKE');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 2: Lấy Danh Sách Tài Khoản OMP
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Quản lý Tài khoản OMP (GET /api/v1/quota/accounts)', async () => {
    const res = await request({ path: '/api/v1/quota/accounts' });
    assert(res.statusCode === 200, 'Endpoint trả về HTTP 200 OK');
    assert(Array.isArray(res.json), 'Dữ liệu trả về là mảng tài khoản');
    assert(res.json.length === 5, 'Fixture mock có 5 tài khoản OMP kết nối (không phải live count)');

    const activeAcc = res.json[0];
    assert(activeAcc.isActive === true, 'Tài khoản ở chỉ mục 0 (đầu tiên bên trái) luôn có isActive: true (Vị trí #01)');
    assert(activeAcc.email.length > 0, 'Tài khoản active có email hợp lệ');

    // Kiểm tra định dạng trường thông tin
    res.json.forEach(acc => {
      assertFields(acc, ['id', 'email', 'provider', 'isGoogleProtect', 'usage5hPct', 'resetIn5h', 'tokenLoginTime', 'tokenLoginAgo', 'sessionDuration'], `Tài khoản ${acc.email}`);
      assert(typeof acc.id === 'string', `Tài khoản ${acc.email} có ID hợp lệ (${acc.id})`);
      assert(typeof acc.usage5hPct === 'number', `Tài khoản ${acc.email} có usage5hPct là số (${acc.usage5hPct}%)`);
      assert(typeof acc.resetIn5h === 'string', `Tài khoản ${acc.email} có resetIn5h định dạng chuỗi (${acc.resetIn5h})`);
      // Quy tắc nhãn thời gian ngắn gọn: chứa p, g, hoặc n
      const hasCompactTime = /[0-9]+[pgn]/.test(acc.resetIn5h);
      assert(hasCompactTime, `Nhãn thời gian resetIn5h (${acc.resetIn5h}) tuân thủ quy tắc ngắn gọn (p, g, n)`);
    });

    // Kiểm tra cờ Google Protect cho 2 tài khoản Gemini
    const geminiAccs = res.json.filter(a => a.email.includes('gemini-'));
    assert(geminiAccs.length === 2, 'Tìm thấy 2 tài khoản Google Gemini');
    geminiAccs.forEach(g => {
      assert(g.isGoogleProtect === true, `Tài khoản ${g.email} được gắn cờ isGoogleProtect: true (hiển thị khiên 🛡️)`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 3: Tổng Quan & 4 Cửa Sổ Hạn Mức
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Tổng quan & 4 Cửa sổ Hạn mức (GET /api/v1/quota/overview)', async () => {
    const res = await request({ path: '/api/v1/quota/overview' });
    assert(res.statusCode === 200, 'Endpoint trả về HTTP 200 OK');
    assert(res.json.totalAccounts === 5, 'Tổng số tài khoản là 5');
    assert(typeof res.json.earliestReset === 'string', `Cảnh báo mốc reset sớm nhất tồn tại: ${res.json.earliestReset}`);

    const windows = res.json.windows;
    assert(windows !== undefined, 'Đối tượng windows tồn tại');
    assertFields(res.json, ['totalAccounts', 'activeAccountId', 'earliestReset', 'windows'], 'Overview');
    assertFields(windows, ['gemini5h', 'geminiWeek', 'claude5h', 'claudeWeek'], 'Overview.windows');
    assert(windows.gemini5h && windows.gemini5h.usedPct === 48.5, 'Cửa sổ Gemini 5g trượt có usedPct: 48.5%');
    assert(windows.geminiWeek && windows.geminiWeek.usedPct === 76.0, 'Cửa sổ Gemini Tuần có usedPct: 76.0%');
    assert(windows.claude5h && windows.claude5h.usedPct === 32.3, 'Cửa sổ Claude/GPT 5g trượt có usedPct: 32.3%');
    assert(windows.claudeWeek && windows.claudeWeek.usedPct === 38.5, 'Cửa sổ Claude/GPT Tuần có usedPct: 38.5%');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 4: Trạng Thái Google Protect (Safety Guard)
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Google Protect 429 Safety Guard (GET /api/v1/quota/protect-status)', async () => {
    const res = await request({ path: '/api/v1/quota/protect-status' });
    assert(res.statusCode === 200, 'Endpoint trả về HTTP 200 OK');
    assert(res.json.appliedAccountsCount === 2, 'Áp dụng bảo vệ cho đúng 2 tài khoản Gemini');
    assert(res.json.maxConcurrent === 1, 'Giới hạn tối đa 1 yêu cầu đồng thời (maxConcurrent: 1)');
    assert(res.json.cooldownSec === 0, 'Thời gian cooldown ban đầu là 0s (Sẵn sàng)');
    assert(res.json.nextRequestAllowed === true, 'Quyền thực thi lệnh gọi: Được phép');
    assertFields(res.json, ['status', 'appliedAccountsCount', 'activeRequests', 'maxConcurrent', 'cooldownSec', 'errors429Count', 'nextRequestAllowed'], 'Protect status');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 5: Lịch Sử Tiêu Thụ Token & Bộ Lọc Thời Gian
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Lịch sử Token theo Scopes (GET /api/v1/quota/history?scope=)', async () => {
    // Mặc định 24h
    const res24h = await request({ path: '/api/v1/quota/history?scope=24h' });
    assert(res24h.statusCode === 200, 'Scope 24h trả về HTTP 200');
    assert(res24h.json.totalRequests === 146, 'Tổng 146 requests trong 24h');
    assert(res24h.json.totalTokensFormatted === '418.2k', 'Tổng token formatted là 418.2k');
    assert(Array.isArray(res24h.json.hourlyTrend), 'Có mảng biểu đồ 12 cột hourlyTrend');
    assert(res24h.json.hourlyTrend.length === 12, 'Đủ 12 mốc cột theo giờ');

    const peak = res24h.json.hourlyTrend.find(h => h.isPeak);
    assert(peak !== undefined, 'Xác định được cột đỉnh tải (Peak Hour)');
    assert(peak.hour === '14:00', 'Đỉnh tải nằm ở khung giờ 14:00 (58,000 token)');

    // Scope 1h
    const res1h = await request({ path: '/api/v1/quota/history?scope=1h' });
    assert(res1h.statusCode === 200, 'Scope 1h trả về HTTP 200');
    assert(res1h.json.totalRequests === 12, 'Tổng 12 requests trong 1h');

    // Scope 7d
    const res7d = await request({ path: '/api/v1/quota/history?scope=7d' });
    assert(res7d.statusCode === 200, 'Scope 7d trả về HTTP 200');
    assert(res7d.json.totalTokensFormatted === '2.84M', 'Tổng 2.84M token trong 7 ngày');

    for (const scope of ['30d', 'all']) {
      const scoped = await request({ path: `/api/v1/quota/history?scope=${scope}` });
      assert(scoped.statusCode === 200, `Scope ${scope} trả về HTTP 200`);
      assert(scoped.json.scope === scope, `Response giữ đúng scope ${scope}`);
      assertFields(scoped.json, ['scope', 'totalRequests', 'totalTokensFormatted', 'inputTokensFormatted', 'outputTokensFormatted', 'items'], `History ${scope}`);
    }
    const invalidScope = await request({ path: '/api/v1/quota/history?scope=invalid' });
    assert(invalidScope.statusCode === 400, 'Scope không hợp lệ trả về HTTP 400');
    assert(invalidScope.json.error.code === 'BAD_REQUEST', 'Scope sai dùng mã lỗi BAD_REQUEST');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 6: Chuyển Đổi Tài Khoản Hoạt Động (Account Switcher)
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Chuyển đổi Tài khoản Active (POST /api/v1/quota/switch)', async () => {
    // Chuyển sang acc-1 (workspace-dev-alpha@example.com)
    const switchRes = await request(
      { method: 'POST', path: '/api/v1/quota/switch' },
      { accountId: 'acc-1' }
    );
    assert(switchRes.statusCode === 200, 'POST /api/v1/quota/switch trả về HTTP 200 OK');
    assert(switchRes.json.success === true, 'Phản hồi chuyển đổi success: true');
    assert(switchRes.json.activeAccountId === 'acc-1', 'activeAccountId chuyển thành acc-1');
    assertFields(switchRes.json, ['success', 'activeAccountId', 'message'], 'Switch response');

    // Kiểm tra lại danh sách accounts
    const accListRes = await request({ path: '/api/v1/quota/accounts' });
    assert(accListRes.json[0].id === 'acc-1', 'Tài khoản acc-1 lập tức được đưa lên vị trí #01 đầu tiên bên trái');
    assert(accListRes.json[0].isActive === true, 'acc-1 có cờ isActive: true');

    // Trả lại trạng thái ban đầu acc-2
    await request({ method: 'POST', path: '/api/v1/quota/switch' }, { accountId: 'acc-2' });
    const restoreRes = await request({ path: '/api/v1/quota/accounts' });
    assert(restoreRes.json[0].id === 'acc-2', 'Khôi phục thành công acc-2 về vị trí #01');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 7: Kích Hoạt Đồng Bộ Tức Thì (POST /api/v1/quota/sync)
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Đồng bộ Tức thì (POST /api/v1/quota/sync)', async () => {
    const res = await request({ method: 'POST', path: '/api/v1/quota/sync' });
    assert(res.statusCode === 200, 'POST /api/v1/quota/sync trả về HTTP 200');
    assert(res.json.success === true, 'Đồng bộ thành công (success: true)');
    assert(typeof res.json.syncedAt === 'string', 'Có thời gian timestamp syncedAt');
    assert(res.json.accountsCount === 5, 'Fixture sync báo cáo đủ 5 tài khoản mẫu');
    assertFields(res.json, ['success', 'syncedAt', 'accountsCount', 'message'], 'Sync response');

    const quick = await request({ path: '/api/v1/quota/quick-check' });
    assert(quick.statusCode === 200, 'GET /api/v1/quota/quick-check trả về HTTP 200');
    assertFields(quick.json, ['activeAccount', 'earliestReset', 'windows'], 'Quick-check response');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 8: Quản Lý Phiên Trò Chuyện & Tin Nhắn
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Phiên Trò chuyện & Tin nhắn (Chat Sessions & Messages)', async () => {
    // GET /api/v1/sessions
    const sessionsRes = await request({ path: '/api/v1/sessions' });
    assert(sessionsRes.statusCode === 200, 'GET /api/v1/sessions trả về HTTP 200');
    assert(Array.isArray(sessionsRes.json), 'Danh sách phiên là mảng');
    assert(sessionsRes.json.length >= 4, 'Ít nhất 4 phiên trò chuyện mẫu');
    sessionsRes.json.forEach(session => assertFields(session, ['id', 'title', 'isPinned', 'updatedAgo'], `Session ${session.id}`));

    const pinned = sessionsRes.json.filter(s => s.isPinned);
    assert(pinned.length >= 2, 'Có ít nhất 2 phiên được ghim (📌 ĐÃ GHIM)');

    // POST /api/v1/sessions (Tạo phiên mới)
    const newSessionRes = await request(
      { method: 'POST', path: '/api/v1/sessions' },
      { title: 'Kiểm thử tạo phiên tự động' }
    );
    assert(newSessionRes.statusCode === 201, 'POST /api/v1/sessions trả về HTTP 201 Created');
    assert(newSessionRes.json.title === 'Kiểm thử tạo phiên tự động', 'Phiên mới được đặt tên chính xác');

    // GET /api/v1/sessions/:id/messages
    const msgsRes = await request({ path: '/api/v1/sessions/s-1/messages' });
    assert(msgsRes.statusCode === 200, 'GET messages phiên s-1 trả về HTTP 200');
    assert(Array.isArray(msgsRes.json), 'Dữ liệu tin nhắn là mảng');
    assert(msgsRes.json.length >= 2, 'Phiên s-1 có ít nhất 2 tin nhắn (User & Assistant)');
    msgsRes.json.forEach(message => assertFields(message, ['id', 'sessionId', 'role', 'content'], `Message ${message.id}`));

    const missingMessages = await request({ path: '/api/v1/sessions/missing-session/messages' });
    assert(missingMessages.statusCode === 404, 'Session không tồn tại trả về HTTP 404 khi lấy messages');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 9: Gửi Tin Nhắn Prompt AI (POST /api/v1/chat/send)
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Gửi Prompt Trợ lý AI (POST /api/v1/chat/send)', async () => {
    const sendRes = await request(
      { method: 'POST', path: '/api/v1/chat/send' },
      {
        sessionId: 's-1',
        prompt: 'Hãy kiểm tra tình trạng tài khoản OMP số #01',
        model: 'neural-flash-3.8'
      }
    );
    assert(sendRes.statusCode === 200, 'POST /api/v1/chat/send trả về HTTP 200 OK');
    assert(typeof sendRes.json.reply === 'string', 'Phản hồi từ AI là chuỗi văn bản');
    assert(sendRes.json.reply.includes('Tài khoản OMP'), 'Nội dung phản hồi nhắc đến Tài khoản OMP');
    assert(sendRes.json.model === 'neural-flash-3.8', 'Mô hình xử lý đúng là neural-flash-3.8');
    assert(typeof sendRes.json.totalTokens === 'number', 'Có thông số tổng token');
    assertFields(sendRes.json, ['sessionId', 'messageId', 'reply', 'model'], 'Chat send response');

    const missingSessionSend = await request(
      { method: 'POST', path: '/api/v1/chat/send' },
      { sessionId: 'missing-session', prompt: 'test' }
    );
    assert(missingSessionSend.statusCode === 404, 'Gửi prompt vào session không tồn tại trả về HTTP 404');

    const invalidModelSend = await request(
      { method: 'POST', path: '/api/v1/chat/send' },
      { sessionId: 's-1', prompt: 'test', model: 'unknown-model' }
    );
    assert(invalidModelSend.statusCode === 400, 'Gửi model không hợp lệ trả về HTTP 400');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 10: Luồng Server-Sent Events (GET /api/v1/chat/stream)
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Luồng Phản hồi SSE (GET /api/v1/chat/stream)', async () => {
    const ssePromise = new Promise((resolve, reject) => {
      const chunks = [];
      const req = http.request(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/api/v1/chat/stream?sessionId=s-1&prompt=stream-test',
          headers: { 'Accept': 'text/event-stream' }
        },
        (res) => {
          assert(res.statusCode === 200, 'SSE endpoint trả về HTTP 200 OK');
          assert(res.headers['content-type'].includes('text/event-stream'), 'Content-Type là text/event-stream');

          res.on('data', chunk => {
            chunks.push(chunk.toString());
          });

          res.on('end', () => {
            const allText = chunks.join('');
            assert(allText.includes('data:'), 'Luồng SSE chứa các event data: chunk');
            assert(allText.includes('event: message'), 'Luồng SSE có event name theo contract');
            assert(allText.includes('"done":true'), 'Luồng kết thúc thành công với done: true');
            resolve();
          });
        }
      );

      req.on('error', reject);
      req.end();
    });

    await ssePromise;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 11: Xử Lý Ngoại Lệ & Mã Lỗi HTTP (Error Handling)
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Xử lý Ngoại lệ & Mã lỗi HTTP (400, 404)', async () => {
    // 404 cho route không tồn tại
    const res404 = await request({ path: '/api/v1/quota/invalid-path' });
    assert(res404.statusCode === 404, 'Đường dẫn sai trả về HTTP 404');
    assert(res404.json.error.code === 'ROUTE_NOT_FOUND', 'Mã lỗi đúng là ROUTE_NOT_FOUND');

    // 400 khi thiếu accountId
    const res400 = await request({ method: 'POST', path: '/api/v1/quota/switch' }, {});
    assert(res400.statusCode === 400, 'Thiếu accountId trả về HTTP 400 Bad Request');
    assert(res400.json.error.code === 'MISSING_ACCOUNT_ID', 'Mã lỗi đúng là MISSING_ACCOUNT_ID');

    // 404 khi không tìm thấy accountId
    const resAcc404 = await request(
      { method: 'POST', path: '/api/v1/quota/switch' },
      { accountId: 'non-existent-acc-999' }
    );
    assert(resAcc404.statusCode === 404, 'Tài khoản không tồn tại trả về HTTP 404');
    assert(resAcc404.json.error.code === 'ACCOUNT_NOT_FOUND', 'Mã lỗi đúng là ACCOUNT_NOT_FOUND');

    const malformedJson = await request({ method: 'POST', path: '/api/v1/quota/switch' }, '{');
    assert(malformedJson.statusCode === 400, 'JSON lỗi cú pháp trả về HTTP 400');
    assert(malformedJson.json.error.code === 'BAD_REQUEST', 'JSON lỗi cú pháp dùng mã BAD_REQUEST');

    const models = await request({ path: '/api/v1/models' });
    assert(models.statusCode === 200, 'GET /api/v1/models trả về HTTP 200');
    assert(Array.isArray(models.json) && models.json.length > 0, 'Danh mục model là mảng không rỗng');
    models.json.forEach(model => assertFields(model, ['id', 'name', 'provider', 'contextWindow'], `Model ${model.id}`));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Kịch bản 12: Kiểm Thử Ranh Giới CORS & An Toàn Loopback (Security Regression)
  // ───────────────────────────────────────────────────────────────────────────
  await runScenario('Kiểm thử Ranh giới CORS & Bảo mật Loopback (Không cho phép Wildcard ACAO)', async () => {
    // 1. Preflight OPTIONS: không trả về Access-Control-Allow-Origin: *
    const preflightRes = await request({
      method: 'OPTIONS',
      path: '/api/v1/quota/overview',
      headers: {
        'Origin': 'https://malicious.example.com',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert(preflightRes.statusCode === 204, 'Preflight OPTIONS phản hồi HTTP 204');
    assert(
      preflightRes.headers['access-control-allow-origin'] === undefined,
      'Preflight OPTIONS không chứa header Access-Control-Allow-Origin: *'
    );
    assert(
      preflightRes.headers['access-control-allow-methods'] !== undefined,
      'Preflight OPTIONS vẫn giữ các phương thức được hỗ trợ (Access-Control-Allow-Methods)'
    );

    // 2. GET API với Origin: ordinary local path succeeds nhưng không có wildcard ACAO
    const apiGetRes = await request({
      method: 'GET',
      path: '/api/v1/quota/overview',
      headers: {
        'Origin': 'https://untrusted.example.com'
      }
    });
    assert(apiGetRes.statusCode === 200, 'GET API phản hồi HTTP 200 OK');
    assert(
      apiGetRes.headers['access-control-allow-origin'] === undefined,
      'GET API response không chứa header Access-Control-Allow-Origin: *'
    );
    assert(apiGetRes.json && apiGetRes.json.totalAccounts === 5, 'Dữ liệu API cục bộ vẫn hoạt động chính xác');

    // 3. POST API với Origin: không có wildcard ACAO
    const apiPostRes = await request(
      {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: {
          'Origin': 'https://attacker.example.com'
        }
      },
      { title: 'Phiên kiểm thử CORS loopback' }
    );
    assert(apiPostRes.statusCode === 201, 'POST API phản hồi HTTP 201 Created');
    assert(
      apiPostRes.headers['access-control-allow-origin'] === undefined,
      'POST API response không chứa header Access-Control-Allow-Origin: *'
    );

    // 4. Static asset với Origin: không có wildcard ACAO
    const staticRes = await request({
      method: 'GET',
      path: '/api-schema.json',
      headers: {
        'Origin': 'https://untrusted.example.com'
      }
    });
    assert(staticRes.statusCode === 200, 'Tệp tĩnh /api-schema.json phục vụ HTTP 200');
    assert(
      staticRes.headers['access-control-allow-origin'] === undefined,
      'Static asset response không chứa header Access-Control-Allow-Origin: *'
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Tổng Kết Báo Cáo
  // ───────────────────────────────────────────────────────────────────────────
  stopTestServer();

  console.log('\n\x1b[34m════════════════════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m\x1b[32m  ✦ KẾT QUẢ TỔNG HỢP KIỂM THỬ API GIẢ LẬP (TEST REPORT)\x1b[0m');
  console.log('\x1b[34m════════════════════════════════════════════════════════════════════════\x1b[0m\n');

  console.log(`  • Tổng số Kịch bản:    \x1b[1m${report.scenarios.length}\x1b[0m`);
  console.log(`  • Tổng số Kiểm tra:    \x1b[1m${report.total}\x1b[0m`);
  console.log(`  • Đạt chuẩn (Pass):    \x1b[32m\x1b[1m${report.passed}\x1b[0m`);
  console.log(`  • Thất bại (Fail):     \x1b[${report.failed > 0 ? '31' : '90'}m\x1b[1m${report.failed}\x1b[0m`);

  const passRate = ((report.passed / report.total) * 100).toFixed(1);
  console.log(`  • Tỷ lệ Thành công:    \x1b[1m\x1b[32m${passRate}%\x1b[0m\n`);

  if (report.failed === 0) {
    console.log('  \x1b[32m✔ TẤT CẢ 12 KỊCH BẢN ĐÃ VƯỢT QUA KIỂM ĐỊNH HOÀN HẢO!\x1b[0m');
    console.log('  \x1b[90mBackend API sẵn sàng kết nối trực tiếp với 2 file HTML.\x1b[0m\n');
    process.exit(0);
  } else {
    console.log('  \x1b[31m✘ CÓ LỖI XẢY RA TRONG QUÁ TRÌNH KIỂM THỬ!\x1b[0m\n');
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  stopTestServer();
  console.error('\x1b[31mLỗi nghiêm trọng trong runner:\x1b[0m', err);
  process.exit(1);
});
