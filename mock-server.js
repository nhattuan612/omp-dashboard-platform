/**
 * Hòn π · Local Mock API Server
 * 
 * Máy chủ API giả lập cục bộ phục vụ kiểm thử và kết nối cho:
 * 1. honpi-quota-dashboard.html
 * 2. honpi-chat-dashboard.html
 * 
 * Zero-dependency: Chạy trực tiếp bằng Node.js (v18+) hoặc Bun mà không cần cài đặt thêm thư viện.
 * Khởi chạy: node mock-server.js [--port 4177]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const HOST = '127.0.0.1';
const PORT = parseInt(process.env.PORT || process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 4177, 10);
const DB_FILE = path.join(__dirname, 'mock-db.json');
const MAX_BODY_BYTES = 64 * 1024;
const HISTORY_SCOPES = new Set(['1h', '24h', '7d', '30d', 'all']);

// Load database state into memory
let db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

// MIME types dictionary for static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendCors(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  });
  res.end();
}

function apiError(statusCode, code, message, field) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.apiError = { code, message };
  if (field) error.apiError.field = field;
  return error;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let rejected = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES && !rejected) {
        rejected = true;
        reject(apiError(400, 'PAYLOAD_TOO_LARGE', `Payload vượt quá ${MAX_BODY_BYTES} bytes.`));
        req.resume();
        return;
      }
      if (!rejected) body += chunk;
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(apiError(400, 'BAD_REQUEST', 'Dữ liệu JSON không hợp lệ.'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // Log incoming request
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
  console.log(`\x1b[90m[${timestamp}]\x1b[0m \x1b[36m${method.padEnd(4)}\x1b[0m ${pathname}`);

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    return sendCors(res);
  }

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Quota API Endpoints
    // ─────────────────────────────────────────────────────────────────────────

    // GET /api/v1/quota/accounts
    if (method === 'GET' && pathname === '/api/v1/quota/accounts') {
      // Ensure active account is at index 0 (#01 on top-left)
      const accounts = [...db.accounts];
      accounts.sort((a, b) => (a.isActive ? -1 : b.isActive ? 1 : 0));
      return sendJson(res, 200, accounts);
    }

    // GET /api/v1/quota/overview
    if (method === 'GET' && pathname === '/api/v1/quota/overview') {
      return sendJson(res, 200, db.overview);
    }

    // GET /api/v1/quota/protect-status
    if (method === 'GET' && pathname === '/api/v1/quota/protect-status') {
      return sendJson(res, 200, db.protect);
    }

    // GET /api/v1/quota/history
    if (method === 'GET' && pathname === '/api/v1/quota/history') {
      const scope = parsedUrl.query.scope || '24h';
      if (!HISTORY_SCOPES.has(scope)) {
        return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'scope không hợp lệ.', field: 'scope' } });
      }
      const historyData = db.history[scope];
      return sendJson(res, 200, historyData);
    }

    // POST /api/v1/quota/switch
    if (method === 'POST' && pathname === '/api/v1/quota/switch') {
      const body = await readBody(req);
      const targetId = body.accountId;

      if (!targetId) {
        return sendJson(res, 400, { error: { code: 'MISSING_ACCOUNT_ID', message: 'Vui lòng cung cấp accountId.' } });
      }

      const targetAccount = db.accounts.find(a => a.id === targetId);
      if (!targetAccount) {
        return sendJson(res, 404, { error: { code: 'ACCOUNT_NOT_FOUND', message: `Không tìm thấy tài khoản với ID: ${targetId}` } });
      }

      // Update in-memory state
      db.accounts.forEach(a => {
        a.isActive = (a.id === targetId);
        if (a.isActive) {
          a.sessionDuration = '0p';
        }
      });
      db.overview.activeAccountId = targetId;

      return sendJson(res, 200, {
        success: true,
        activeAccountId: targetId,
        activeEmail: targetAccount.email,
        activatedAt: new Date().toISOString(),
        sessionDuration: '0p',
        message: `Đã chuyển tài khoản hoạt động sang: ${targetAccount.email}`
      });
    }

    // POST /api/v1/quota/sync
    if (method === 'POST' && pathname === '/api/v1/quota/sync') {
      return sendJson(res, 200, {
        success: true,
        syncedAt: new Date().toISOString(),
        accountsCount: db.accounts.length,
        latencyMs: 120,
        message: `Đã đồng bộ thành công thông số ${db.accounts.length} tài khoản OMP từ nhà cung cấp.`
      });
    }

    // GET /api/v1/quota/quick-check
    if (method === 'GET' && pathname === '/api/v1/quota/quick-check') {
      const activeAcc = db.accounts.find(a => a.isActive) || db.accounts[0];
      return sendJson(res, 200, {
        activeAccount: {
          id: activeAcc.id,
          email: activeAcc.email,
          provider: activeAcc.provider,
          sessionDuration: activeAcc.sessionDuration,
          tokenLoginAgo: activeAcc.tokenLoginAgo
        },
        earliestReset: db.overview.earliestReset,
        windows: db.overview.windows,
        accountsCount: db.accounts.length
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Chat API Endpoints
    // ─────────────────────────────────────────────────────────────────────────

    // GET /api/v1/sessions
    if (method === 'GET' && pathname === '/api/v1/sessions') {
      return sendJson(res, 200, db.sessions);
    }

    // POST /api/v1/sessions
    if (method === 'POST' && pathname === '/api/v1/sessions') {
      const body = await readBody(req);
      if (body.title !== undefined && typeof body.title !== 'string') {
        return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'title phải là chuỗi.', field: 'title' } });
      }
      if (typeof body.title === 'string' && body.title.length > 200) {
        return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'title không được vượt quá 200 ký tự.', field: 'title' } });
      }
      const newSession = {
        id: 's-' + (db.sessions.length + 1),
        title: body.title || 'Phiên làm việc mới',
        isPinned: false,
        updatedAgo: 'Vừa xong',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.sessions.unshift(newSession);
      return sendJson(res, 201, newSession);
    }

    // GET /api/v1/sessions/:id/messages
    const sessionMsgMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/messages$/);
    if (method === 'GET' && sessionMsgMatch) {
      let sessionId;
      try {
        sessionId = decodeURIComponent(sessionMsgMatch[1]);
      } catch (_) {
        return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'sessionId không hợp lệ.', field: 'id' } });
      }
      if (!db.sessions.some(session => session.id === sessionId)) {
        return sendJson(res, 404, { error: { code: 'SESSION_NOT_FOUND', message: `Không tìm thấy phiên: ${sessionId}`, field: 'id' } });
      }
      const msgs = db.messages.filter(m => m.sessionId === sessionId);
      return sendJson(res, 200, msgs);
    }

    // POST /api/v1/chat/send
    if (method === 'POST' && pathname === '/api/v1/chat/send') {
      const body = await readBody(req);
      const prompt = body.prompt;
      const sessionId = body.sessionId == null ? 's-1' : body.sessionId;
      const model = body.model == null ? 'neural-flash-3.8' : body.model;

      if (typeof prompt !== 'string' || !prompt.trim()) {
        return sendJson(res, 400, { error: { code: 'MISSING_PROMPT', message: 'Vui lòng cung cấp nội dung prompt.' } });
      }
      if (typeof sessionId !== 'string') {
        return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'sessionId phải là chuỗi hoặc null.', field: 'sessionId' } });
      }
      if (!db.sessions.some(session => session.id === sessionId)) {
        return sendJson(res, 404, { error: { code: 'SESSION_NOT_FOUND', message: `Không tìm thấy phiên: ${sessionId}`, field: 'sessionId' } });
      }
      if (typeof model !== 'string') {
        return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'model phải là chuỗi.', field: 'model' } });
      }
      if (!db.models.some(availableModel => availableModel.id === model)) {
        return sendJson(res, 400, { error: { code: 'INVALID_MODEL', message: `Mô hình không được hỗ trợ: ${model}`, field: 'model' } });
      }

      // Record user turn
      const userMsg = {
        id: 'msg-' + Date.now() + '-u',
        sessionId: sessionId,
        role: 'user',
        content: prompt,
        timeAgo: '1p',
        createdAt: new Date().toISOString()
      };
      db.messages.push(userMsg);

      // Generate intelligent mock AI reply
      const activeAccount = db.accounts.find(a => a.isActive) || db.accounts[0];
      const reply = `[Phản hồi từ ${model}] Đã nhận câu lệnh: "${prompt}".\n\nTài khoản OMP đang thực thi: ${activeAccount.email} (${activeAccount.provider}) mang vị trí #01.\nTrạng thái Quota 5g: ${activeAccount.usage5hPct}% (Reset sau: ${activeAccount.resetIn5h}).\nHệ thống Google Protect 429: ${activeAccount.isGoogleProtect ? '🛡️ Đang bảo vệ' : 'Không kích hoạt'}.`;

      const assistantMsg = {
        id: 'msg-' + Date.now() + '-a',
        sessionId: sessionId,
        role: 'assistant',
        content: reply,
        model: model,
        duration: '1.2s',
        createdAt: new Date().toISOString()
      };
      db.messages.push(assistantMsg);

      return sendJson(res, 200, {
        sessionId: sessionId,
        messageId: assistantMsg.id,
        reply: reply,
        model: model,
        totalTokens: 256,
        duration: '1.2s',
        createdAt: new Date().toISOString()
      });
    }

    // GET /api/v1/chat/stream (SSE)
    if (method === 'GET' && pathname === '/api/v1/chat/stream') {
      const sessionId = parsedUrl.query.sessionId;
      const prompt = parsedUrl.query.prompt;
      const model = parsedUrl.query.model || 'neural-flash-3.8';
      if (typeof sessionId !== 'string' || !sessionId || typeof prompt !== 'string' || !prompt.trim()) {
        return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'sessionId và prompt là bắt buộc.' } });
      }
      if (!db.sessions.some(session => session.id === sessionId)) {
        return sendJson(res, 404, { error: { code: 'SESSION_NOT_FOUND', message: `Không tìm thấy phiên: ${sessionId}`, field: 'sessionId' } });
      }
      if (!db.models.some(availableModel => availableModel.id === model)) {
        return sendJson(res, 400, { error: { code: 'INVALID_MODEL', message: `Mô hình không được hỗ trợ: ${model}`, field: 'model' } });
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const chunks = [
        'Hệ ', 'thống ', 'Hòn π ', 'đã ', 'kết nối ', 'thành công ', 'với ', 'Backend AI.\n\n',
        'Tài khoản ', 'OMP ', 'hiện tại: ', 'gemini-prod-core@company.ai.\n',
        'Trạng thái: ', 'Sẵn sàng phục vụ!'
      ];

      let i = 0;
      const interval = setInterval(() => {
        if (i < chunks.length) {
          res.write(`event: message\ndata: ${JSON.stringify({ chunk: chunks[i], done: false })}\n\n`);
          i++;
        } else {
          res.write(`event: message\ndata: ${JSON.stringify({ chunk: '', done: true })}\n\n`);
          clearInterval(interval);
          res.end();
        }
      }, 80);

      req.on('close', () => clearInterval(interval));
      return;
    }

    // GET /api/v1/models
    if (method === 'GET' && pathname === '/api/v1/models') {
      return sendJson(res, 200, db.models);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Static File Serving (HTML Dashboards & Assets)
    // ─────────────────────────────────────────────────────────────────────────
    const staticPath = {
      '/chat': 'honpi-chat-dashboard-SKE.html',
      '/quota': 'honpi-quota-dashboard-SKE.html'
    }[pathname] || (pathname === '/' ? 'honpi-chat-dashboard.html' : pathname);
    let filePath = path.join(__dirname, staticPath);

    // Prevent directory traversal
    const relativePath = path.relative(__dirname, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Truy cập bị từ chối.' } });
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // If route not matched
    sendJson(res, 404, {
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Endpoint không tồn tại: ${method} ${pathname}`,
        docs: '/api-schema.json'
      }
    });

  } catch (err) {
    console.error('Lỗi xử lý request:', err);
    const statusCode = err.statusCode || 500;
    const error = err.apiError || { code: 'INTERNAL_SERVER_ERROR', message: 'Đã xảy ra lỗi máy chủ nội bộ.' };
    sendJson(res, statusCode, { error });
  }
});

server.listen(PORT, HOST, () => {
  console.log('\n\x1b[32m════════════════════════════════════════════════════════════════════════\x1b[0m');
  console.log(`\x1b[1m\x1b[36m  ✦ Hòn π · Local Mock API Server (http://${HOST}:${PORT})\x1b[0m`);
  console.log('\x1b[32m════════════════════════════════════════════════════════════════════════\x1b[0m');
  console.log(`\n  \x1b[33m• Quota Dashboard:\x1b[0m  http://${HOST}:${PORT}/quota`);
  console.log(`  \x1b[33m• Chat Dashboard:\x1b[0m   http://${HOST}:${PORT}/chat`);
  console.log(`  \x1b[33m• API Schema JSON:\x1b[0m  http://${HOST}:${PORT}/api-schema.json`);
  console.log(`  \x1b[33m• Mock Database:\x1b[0m    http://${HOST}:${PORT}/mock-db.json\n`);
  console.log('  \x1b[32mEndpoints Khả dụng:\x1b[0m');
  console.log('    - GET  /api/v1/quota/accounts       (fixture account count, #01 active)');
  console.log('    - GET  /api/v1/quota/overview       (4 cửa sổ hạn mức thực tế)');
  console.log('    - GET  /api/v1/quota/protect-status (Google Protect 429)');
  console.log('    - GET  /api/v1/quota/history?scope= (1h, 24h, 7d, 30d, all)');
  console.log('    - POST /api/v1/quota/switch         ({ accountId })');
  console.log('    - POST /api/v1/quota/sync           (Đồng bộ tức thì)');
  console.log('    - GET  /api/v1/sessions             (Danh sách phiên chat)');
  console.log('    - GET  /api/v1/sessions/:id/messages');
  console.log('    - POST /api/v1/chat/send            ({ sessionId, prompt, model })');
  console.log('    - GET  /api/v1/chat/stream          (SSE EventStream)');
  console.log('    - GET  /api/v1/models               (Danh mục mô hình AI)\n');
  console.log('\x1b[90m  Bấm Ctrl+C để dừng máy chủ.\x1b[0m\n');
});
