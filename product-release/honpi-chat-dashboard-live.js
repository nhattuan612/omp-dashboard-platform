/* Live adapter for the full prototype UI.  The prototype remains presentation only; all mutable data below comes from the loopback API. */
(() => {
  'use strict';
  window.HONPI_CHAT_CONFIG = { endpoints: { sessions: '/api/v1/sessions', stream: '/api/v1/chat/stream', models: '/api/v1/quota/models' } };
  const API = '/api/v1';
  const TOOL_STORAGE_KEY = 'omp.tools.v2';
  const BROWSER_MODE_PREFERENCE_VERSION = 'manual-v1';
  const initialBrowserMode = localStorage.getItem('omp.browserModePreferenceVersion') === BROWSER_MODE_PREFERENCE_VERSION ? localStorage.getItem('omp.browserMode') : 'none';
  const state = { sessions: [], nextCursor: null, activeId: null, generation: 0, messages: [], models: [], activeModel: null, controller: null, requestId: null, activeRequest: null, createPromise: null, menu: null, folderMenu: null, quota: null, accounts: [], attachments: [], workspaceFiles: [], workspaceMention: '@', capabilities: null, selectedTools: [], toolsUpdating: false, advisor: false, advisorConfig: null, advisorConfigLoading: false, advisorConfigSaving: false, folderExpanded: new Set(), folderCollapsed: new Set(), thinking: localStorage.getItem('omp.thinking') || 'max', browserMode: initialBrowserMode === 'ego-browser' ? 'ego-browser' : 'none', planYolo: false, planYoloModel: localStorage.getItem('omp.planYoloModel') || '', shareMode: localStorage.getItem('omp.shareMode') || 'encrypted', approvalMode: localStorage.getItem('omp.approvalMode') || 'always-ask', enterBehavior: localStorage.getItem('omp.enterBehavior') || 'queue', conversationDisplay: localStorage.getItem('omp.conversationDisplay') || 'compact', pendingPrompts: [], queuePausedSessions: new Map(), editingQueueId: null, draftPromptPreview: null, browserAction: null, browserStatus: null, media: { screenCapture: { status: 'unavailable', reason: 'Native screen capture is not provided by OMP dashboard.' }, camera: { status: 'unavailable' }, microphone: { status: 'unavailable' }, video: { status: 'unavailable' } } };
  let voiceRecognition = null;
  let voiceStopResolve = null;
  let voiceDisclosureShown = false;
  let terminalSessionId = null;
  let terminalSocket = null;
  let terminalWidget = null;
  let terminalFitAddon = null;
  let terminalOpenPromise = null;
  let terminalOpenCancelled = false;
  let terminalDisclosureShown = false;
  state.enterBehavior = 'send';
  state.modelAccess = null;
  state.modelAccessInitialized = false;
  state.quotaRequestId = 0;
  state.modelSource = localStorage.getItem('omp.chatModelSource') === 'omp' ? 'omp' : 'quota';
  state.activeModelProvider = null;
  state.loadedModelSource = null;
  state.loadedModelProvider = null;
  state.modelAccessRequestId = 0;
  state.folderLoadRequestId = 0;
  state.sessionLoadRequestId = 0;
  let retryPromptText = '';
  let retryContext = null;
  let retryQueued = false;
  let firstPromptPromise = null;
  let bound = false;
  state.folders = [];
  state.projectWorkspace = null;
  state.projectWorkspacePickerOpen = false;
  state.projectWorkspaceChoosing = false;
  state.projectSelectedCwd = '';
  state.pendingProjectFolderResolve = null;
  state.projectFolderEditingId = '';
  state.draftWorkspaceCwd = '';
  state.projectFolderPurpose = 'folder';
  state.nativeState = null;
  state.startedSessions = new Set();
  state.sessionViews = new Map();
  state.requests = new Map();
  state.queueDrainingSessions = new Set();
  state.retryBySession = new Map();
  function rememberRetry(sessionId = retryContext?.sessionId) {
    if (!sessionId || !retryPromptText || !retryContext) return;
    state.retryBySession.set(sessionId, { prompt: retryPromptText, context: cloneSnapshot(retryContext) });
  }
  function restoreRetry(sessionId) {
    const retry = sessionId ? state.retryBySession.get(sessionId) : null;
    retryPromptText = retry?.prompt || '';
    retryContext = retry?.context || null;
  }
  function clearRetry(sessionId) {
    if (sessionId) state.retryBySession.delete(sessionId);
    if (!sessionId || retryContext?.sessionId === sessionId) {
      retryPromptText = '';
      retryContext = null;
    }
  }
  state.optimisticTitles = new Map();
  const DEFAULT_SESSION_TITLE = 'Phiên làm việc mới';
  const MAX_WEB_PENDING_PROMPTS = 32;
  const queueKey = (sessionId) => sessionId || '__draft__';
  const queueIsPaused = (sessionId) => state.queuePausedSessions.has(queueKey(sessionId));
  const pauseQueue = (sessionId, reason = 'previous_turn_failed') => { state.queuePausedSessions.set(queueKey(sessionId), reason); renderQueueTray(); };
  const resumeQueue = (sessionId) => { state.queuePausedSessions.delete(queueKey(sessionId)); renderQueueTray(); };
  const sessionHasQueuedPrompt = (sessionId) => state.pendingPrompts.some((item) => item.sessionId === sessionId);
  const setGreetingVisible = (visible) => {
    const greeting = $('greetingSection');
    if (greeting) greeting.style.display = visible ? 'flex' : 'none';
  };
  const hideGreeting = () => setGreetingVisible(false);
  const syncGreeting = () => {
    const hasConversation = state.messages.length > 0 || activeRequest() || state.startedSessions.has(state.activeId) || sessionHasQueuedPrompt(state.activeId) || (!state.activeId && state.pendingPrompts.some((item) => !item.sessionId));
    setGreetingVisible(!hasConversation);
  };
  const deriveSessionTitle = (content) => {
    const lines = text(content).split(/\r?\n/).map((line) => line.replace(/^\s*#+\s*/, '').trim()).filter(Boolean);
    const title = (lines.find((line) => !/^instructions?\b/i.test(line)) || lines[0] || '').replace(/\s+/g, ' ').trim();
    return title.length > 72 ? `${title.slice(0, 69).trim()}…` : title;
  };
  function autoTitleSession(sessionId, prompt) {
    const session = state.sessions.find((item) => item.id === sessionId);
    const title = deriveSessionTitle(prompt);
    if (!session || !title || session.title !== DEFAULT_SESSION_TITLE) return;
    session.title = title;
    state.optimisticTitles.set(sessionId, title);
    renderSessions();
    if (state.activeId === sessionId && $('headerSessionTitle')) $('headerSessionTitle').textContent = title;
    void readJson(`${API}/sessions/${encodeURIComponent(sessionId)}/action`, { method: 'POST', body: JSON.stringify({ action: 'rename', title }) })
      .then(() => state.optimisticTitles.delete(sessionId))
      .catch(() => {
        if (state.optimisticTitles.get(sessionId) !== title) return;
        state.optimisticTitles.delete(sessionId);
        session.title = DEFAULT_SESSION_TITLE;
        renderSessions();
        if (state.activeId === sessionId && $('headerSessionTitle')) $('headerSessionTitle').textContent = DEFAULT_SESSION_TITLE;
      });
  }
  const $ = (id) => document.getElementById(id);
  const text = (value) => String(value ?? '');
  const selectableTools = () => (state.capabilities?.tools || []).filter((item) => item.canToggle).map((item) => item.id);
  const saveSelectedTools = () => {
    const tools = [...new Set(state.selectedTools)];
    localStorage.setItem(TOOL_STORAGE_KEY, JSON.stringify({ fingerprint: state.capabilities?.catalog?.fingerprint || '', tools }));
    localStorage.setItem('omp.tools', JSON.stringify(tools));
  };
  const restoreSelectedTools = (fallback) => {
    let stored; try { stored = JSON.parse(localStorage.getItem(TOOL_STORAGE_KEY) || 'null'); } catch {}
    if (!Array.isArray(stored?.tools)) { try { stored = { tools: JSON.parse(localStorage.getItem('omp.tools') || '[]') }; } catch { stored = null; } }
    const valid = Array.isArray(stored?.tools) && stored.tools.length && stored.tools.every((id) => fallback.includes(id));
    return valid ? stored.tools : fallback;
  };
  const workspacePathLabel = (value) => text(value).replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
  const looksLikeImageGenerationPrompt = (value) => {
    const prompt = text(value).trim();
    if (!prompt) return false;
    return /(?:tạo|vẽ|sinh|generate|create|draw|make|redesign|transform|biến đổi)/i.test(prompt)
      && /(?:ảnh|hình|image|picture|photo|png|jpe?g|svg|illustration|logo|poster)/i.test(prompt);
  };
  const supportsImageGeneration = (model) => Boolean(model?.imageGeneration);
  const imageGenerationModels = () => state.models.filter((model) => supportsImageGeneration(model));
  const imageGenerationModelError = (prompt, modelId, modelProvider = state.activeModelProvider) => {
    if (!looksLikeImageGenerationPrompt(prompt)) return '';
    const imageGeneration = state.media?.imageGeneration;
    if (imageGeneration?.status !== 'unavailable') return '';
    const model = state.models.find((item) => item.id === modelId && (!modelProvider || item.provider === modelProvider));
    if (supportsImageGeneration(model)) return '';
    const candidate = imageGenerationModels()[0];
    return candidate
      ? `Model "${modelId}" chỉ đọc/phân tích ảnh. Chọn "${candidate.name || candidate.id}" (Tạo ảnh) để nhận ảnh đầu ra.`
      : (imageGeneration?.reason || 'OMP chưa cung cấp tool tạo ảnh trong runtime này.');
  };
  const modelAccessError = (modelId, modelSource = state.modelSource, modelProvider = state.activeModelProvider) => {
    if (modelSource !== state.modelSource) return '';
    if (modelSource === 'omp') {
      if (!state.models.length) return 'OMP chưa công bố model khả dụng.';
      if (!modelId || !state.models.some((model) => model.id === modelId && (!modelProvider || model.provider === modelProvider))) return 'Hãy chọn model trong danh mục OMP khả dụng.';
      return '';
    }
    const account = state.modelAccess?.account;
    if (!account) return state.modelAccessErrorCode === 'ACCOUNT_SELECTION_REQUIRED'
      ? 'Chat này chưa có account Gemini quota; hãy chọn account trong Quota.'
      : 'Chưa xác minh model theo quota account đang hoạt động.';
    if (!account.canUse) return `Quota account không khả dụng: ${account.availabilityReason || account.availabilityLabel || 'hãy chọn account khác'}.`;
    if (!state.models.length) return `Quota ${account.provider} không có model khả dụng trong OMP.`;
    if (!modelId || !state.models.some((model) => model.id === modelId && (!modelProvider || model.provider === modelProvider))) return 'Hãy chọn model thuộc danh mục của quota account đang hoạt động.';
    return '';
  };
  const cloneSnapshot = (value) => {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value ?? null)); }
  };
  const sessionGuard = (sessionId = state.activeId, generation = state.generation) => ({ sessionId, generation });
  const isCurrentSession = (guard) => Boolean(guard && state.activeId === guard.sessionId && state.generation === guard.generation);
  const OMP_MEMORY_ACTION_LABELS = {
    view: 'Xem nội dung Memory', stats: 'Thống kê', diagnose: 'Chẩn đoán', queue: 'Hàng đợi',
    sync: 'Đồng bộ', enqueue: 'Xếp vào hàng đợi', rebuild: 'Dựng lại', clear: 'Xóa Memory', reset: 'Đặt lại Memory',
  };
  const OMP_MEMORY_CONFIRM_ACTIONS = new Set(['sync', 'enqueue', 'rebuild', 'clear', 'reset']);
  let memoryPanel = { request: 0, snapshot: null, loading: false, busy: false, confirmAction: null, error: '', output: null };
  const requestIsLive = (request) => Boolean(request && ['running', 'stopping'].includes(request.status));
  const requestsForSession = (sessionId) => [...state.requests.values()].filter((request) => request.sessionId === sessionId && requestIsLive(request));
  const activeRequest = () => requestsForSession(state.activeId)[0] || null;
  const anyActiveRequest = () => [...state.requests.values()].find(requestIsLive) || null;
  const syncRequestAliases = () => {
    const request = activeRequest();
    state.activeRequest = request;
    state.controller = request?.controller || null;
    state.requestId = request?.requestId || null;
  };
  function cacheSessionView(sessionId) {
    if (!sessionId) return;
    const active = requestsForSession(sessionId);
    const previous = state.sessionViews.get(sessionId);
    state.sessionViews.set(sessionId, {
      messages: cloneSnapshot(state.messages),
      transientNodes: previous?.transientNodes || [],
      volatile: Boolean(active.length || state.startedSessions.has(sessionId) || sessionHasQueuedPrompt(sessionId) || previous?.transientNodes?.length),
      scrollTop: $('chatScrollArea')?.scrollTop || 0,
    });
  }
  function restoreSessionView(sessionId) {
    const view = state.sessionViews.get(sessionId);
    if (!view) return false;
    state.messages = cloneSnapshot(view.messages || []);
    const area = $('chatScrollArea');
    if (area) area.scrollTop = view.scrollTop || 0;
    return true;
  }
  function renderSessionRequests(sessionId) {
    if (state.activeId !== sessionId) return;
    const stream = $('chatStream');
    if (!stream) return;
    const view = state.sessionViews.get(sessionId);
    const insertNode = (node, requestId, anchor = null) => {
      if (!node) return anchor;
      if (node.parentNode !== stream) {
        if (anchor?.parentNode === stream) anchor.after(node);
        else {
          const user = [...stream.children].find((candidate) => candidate.dataset.requestId === requestId);
          if (user) user.after(node);
          else stream.append(node);
        }
      }
      node._resumeCountdown?.();
      return node;
    };
    (view?.transientNodes || []).forEach((node) => insertNode(node, node.dataset.requestId || null));
    requestsForSession(sessionId).filter((request) => request.mounted).forEach((request) => {
      let anchor = insertNode(request.dom?.wrap, request.requestId);
      (request.dom?.approvals || []).forEach((node) => { anchor = insertNode(node, request.requestId, anchor); });
    });
  }
  const visibleRequest = () => activeRequest();
  const nextRequestId = (prefix = 'chat') => globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  function setNeutralSelection(options = {}) {
    const previousId = state.activeId;
    if (previousId) rememberRetry(previousId);
    if (options.preserveActiveView !== false && previousId) cacheSessionView(previousId);
    const draftPreview = options.preserveDraftPreview ? state.draftPromptPreview : null;
    state.activeId = null;
    state.nativeState = null;
    state.generation += 1;
    state.messages = draftPreview ? [draftPreview] : [];
    state.workspaceFiles = [];
    state.workspaceMention = '@';
    state.attachments = [];
    renderAttachmentStrip();
    retryPromptText = '';
    retryContext = null;
    clearPrototypeData();
    if (draftPreview) { $('chatStream')?.append(messageNode(draftPreview)); hideGreeting(); }
    renderSessions();
    renderWorkspaceFiles();
    setSendState();
    if ($('ompMemoryStatus')) void loadOmpMemory(sessionGuard());
  }
  function beginLocalDraft() {
    state.draftPromptPreview = null;
    state.draftWorkspaceCwd = '';
    prewarmDraftWorker();
    setNeutralSelection();
    const title = $('headerSessionTitle');
    if (title) title.textContent = 'Cuộc trò chuyện mới';
    const pill = $('headerSessionPill');
    if (pill) {
      pill.title = 'Bản nháp local · session OMP sẽ tạo khi gửi prompt';
      pill.setAttribute('aria-label', 'Cuộc trò chuyện mới · bản nháp local');
    }
  }
  function prewarmDraftWorker() {
    const settings = snapshotSettings();
    void fetch(`${API}/omp/prewarm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(state.draftWorkspaceCwd ? { cwd: state.draftWorkspaceCwd } : {}),
        approvalMode: settings.approvalMode,
        browserMode: settings.browserMode, planYolo: settings.planYolo, ...(settings.planYolo ? { planYoloModel: settings.planYoloModel } : {}), advisor: settings.advisor,
        tools: settings.tools,
      }),
      keepalive: true,
    }).catch(() => {});
  }
  function snapshotSettings() {
    return { model: state.activeModel || null, modelProvider: state.activeModelProvider, modelSource: state.modelSource, thinking: state.thinking, browserMode: state.browserMode, planYolo: state.planYolo, planYoloModel: state.planYoloModel || state.activeModel || null, advisor: state.advisor, approvalMode: state.approvalMode, tools: [...state.selectedTools] };
  }
  function setBrowserMode(value) {
    state.browserMode = value === 'ego-browser' ? 'ego-browser' : 'none';
    localStorage.setItem('omp.browserMode', state.browserMode);
    localStorage.setItem('omp.browserModePreferenceVersion', BROWSER_MODE_PREFERENCE_VERSION);
  }
  const setConnectionStatus = (label, stateName = 'connected') => {
    const pill = $('connectionStatusPill');
    const status = $('connectionStatusLabel') || $('dev-chat-status');
    if (status) { status.textContent = label; status.dataset.state = stateName; }
    if (pill) pill.className = `status-pill status-${stateName}`;
    const address = $('ompGatewayAddress');
    if (address) {
      address.className = `gateway-status-badge is-${stateName}`;
      address.textContent = stateName === 'connected' ? 'Đã kết nối qua dashboard' : label;
    }
  };
  const notify = (message, error = false) => {
    const toast = $('toastNotice');
    const msg = $('toastMsg');
    if (typeof window.showToast === 'function' && !error) window.showToast(message);
    else if (toast && msg) { msg.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }
  };
  const readJson = async (url, options = {}) => {
    const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) sessionStorage.removeItem('omp.dashboard.session-recovery');
    if (response.status === 401 && !sessionStorage.getItem('omp.dashboard.session-recovery')) { sessionStorage.setItem('omp.dashboard.session-recovery', '1'); location.reload(); return new Promise(() => {}); }
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.error?.code || payload?.code || '';
      throw error;
    }
    return { payload, response };
  };
  const dataOf = (payload, key) => payload && payload[key] !== undefined ? payload[key] : payload;
  const safeTime = (value) => value || '--';
  const relativeMinutes = (value) => { const parsed = Date.parse(value || ''); if (Number.isFinite(parsed)) return -parsed / 60000; const match = text(value).toLowerCase().match(/(\d+)\s*(g|giờ|h|n|ngày|p|phút|m)/g) || []; return match.reduce((sum, token) => { const item = token.match(/(\d+)\s*(g|giờ|h|n|ngày|p|phút|m)/); if (!item) return sum; const unit = item[2]; return sum + Number(item[1]) * (/n|ngày/.test(unit) ? 1440 : /g|giờ|h/.test(unit) ? 60 : 1); }, 0); };
  const sortSessions = (items) => { const mode = localStorage.getItem('omp.sessionSort') || 'newest'; return items.sort((a, b) => mode === 'alpha' ? text(a.title).localeCompare(text(b.title), 'vi') : mode === 'oldest' ? relativeMinutes(b.updatedAt || b.createdAt || b.updatedAgo) - relativeMinutes(a.updatedAt || a.createdAt || a.updatedAgo) : relativeMinutes(a.updatedAt || a.createdAt || a.updatedAgo) - relativeMinutes(b.updatedAt || b.createdAt || b.updatedAgo)); };

  function makeSessionRow(session) {
    const row = document.createElement('div');
    const active = state.activeId === session.id;
    const requests = requestsForSession(session.id);
    const request = requests[0];
    const running = requests.length > 0;
    row.className = 'session-item' + (session.isPinned ? ' pinned' : '') + (session.isUnread ? ' unread has-unread' : '') + (active ? ' active' : '') + (running ? ' running' : '');
    row.dataset.sessionId = session.id;
    if (session.folderId) row.dataset.folderId = session.folderId;
    row.tabIndex = 0;
    row.setAttribute('aria-current', active ? 'true' : 'false');
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `${session.title || 'Phiên làm việc mới'}${active ? ' · đang chọn' : ''}${running ? ` · ${requests.length} lượt đang chạy` : ''}`);
    const left = document.createElement('div'); left.className = 'session-item-left';
    const dot = document.createElement('span'); dot.className = `session-dot${running ? ' running' : ''}`; dot.title = running ? (request?.status === 'stopping' ? 'Đang dừng lượt hiện tại' : `${requests.length} lượt đang chạy`) : 'Không có lượt chạy trong tab này'; left.append(dot);
    if (session.isPinned) left.append(svgIcon('pin'));
    const title = document.createElement('span'); title.className = 'session-title'; title.textContent = session.title || 'Phiên làm việc mới'; left.append(title);
    if (session.folderName && session.isPinned) { const badge = document.createElement('span'); badge.className = 'session-badge-tag'; badge.textContent = session.folderName; left.append(badge); }
    const right = document.createElement('div'); right.className = 'session-item-right';
    if (session.isUnread) { const unread = document.createElement('span'); unread.className = 'unread-indicator'; unread.title = 'Chưa đọc'; right.append(unread); }
    const time = document.createElement('span'); time.className = 'session-time'; time.textContent = safeTime(session.updatedAgo); right.append(time);
    const pinButton = document.createElement('button'); pinButton.type = 'button'; pinButton.className = 'session-pin-btn'; pinButton.title = session.isPinned ? 'Bỏ ghim' : 'Ghim lên trên'; pinButton.setAttribute('aria-label', pinButton.title); pinButton.textContent = session.isPinned ? '📌' : '☆';
    pinButton.addEventListener('click', (event) => { event.stopPropagation(); runAction(session.id, session.isPinned ? 'unpin' : 'pin'); }); right.append(pinButton);
    const more = document.createElement('button'); more.type = 'button'; more.className = 'session-more-btn'; more.title = 'Tùy chọn cuộc trò chuyện'; more.setAttribute('aria-label', more.title); more.textContent = '•••';
    more.addEventListener('click', (event) => { event.stopPropagation(); showMenu(session, event.clientX, event.clientY); }); right.append(more);
    row.append(left, right);
    row.addEventListener('click', () => selectSession(session.id));
    row.addEventListener('dblclick', (event) => { event.preventDefault(); event.stopPropagation(); runAction(session.id, 'rename'); });
    row.addEventListener('contextmenu', (event) => { event.preventDefault(); showMenu(session, event.clientX, event.clientY); });
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectSession(session.id); } });
    return row;
  }

  function emptyNode(label) { const node = document.createElement('div'); node.className = 'sidebar-empty'; node.textContent = label; return node; }
  function bindFolderHeader(header) {
    if (!header || header.dataset.folderBound === 'true') return;
    header.dataset.folderBound = 'true';
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    const folder = header.parentElement;
    const sync = () => header.setAttribute('aria-expanded', String(!folder.classList.contains('collapsed')));
    const toggle = (event) => {
      if (event?.target?.closest?.('button,a')) return;
      const name = folder?.dataset.folder || '';
      if (folderMode(name) !== 'manual') return;
      folder.classList.toggle('collapsed');
      if (folder.classList.contains('collapsed')) state.folderCollapsed.add(name); else state.folderCollapsed.delete(name);
      sync();
    };
    header.addEventListener('click', toggle);
    header.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); showFolderMenu(folder?.dataset.folder || '', event.clientX, event.clientY); });
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(event); }
    });
    sync();
  }
  const folderModeKey = 'omp.folderExpansionModes';
  function readFolderModes() { try { const value = JSON.parse(localStorage.getItem(folderModeKey) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } }
  function folderMode(name) { return readFolderModes()[name] || 'manual'; }
  function setFolderMode(name, mode) { const modes = readFolderModes(); if (mode === 'manual') delete modes[name]; else modes[name] = mode; localStorage.setItem(folderModeKey, JSON.stringify(modes)); }
  function applyFolderMode(folder, name) {
    const mode = folderMode(name);
    if (mode === 'always-collapsed') folder.classList.add('collapsed');
    if (mode === 'always-expanded') folder.classList.remove('collapsed');
    if (mode === 'manual' && state.folderCollapsed.has(name)) folder.classList.add('collapsed');
  }

  function closeLiveContextMenus() { state.menu?.remove(); state.folderMenu?.remove(); state.menu = null; state.folderMenu = null; }
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeLiveContextMenus(); });

  function bindMenuArrowNavigation(menu, selector) {
    menu.addEventListener('keydown', (event) => {
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      const items = [...menu.querySelectorAll(selector)].filter((item) => !item.disabled && item.getClientRects().length && item.getAttribute('aria-disabled') !== 'true');
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : current < 0 ? (event.key === 'ArrowUp' ? items.length - 1 : 0) : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault();
      items[next].focus({ preventScroll: true });
    });
  }

  function showFolderMenu(name, x, y) {
    if (!name) return;
    closeLiveContextMenus();
    const menu = document.createElement('div'); menu.className = 'neuratalk-context-menu open'; menu.id = 'liveFolderActionMenu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', `Tùy chọn folder ${name}`); menu.style.minWidth = '250px'; menu.style.width = '250px'; menu.style.maxWidth = '250px'; menu.style.zIndex = '3000'; menu.style.maxHeight = 'calc(100vh - 16px)'; menu.style.overflowY = 'auto';
    const icon = (path) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true'); const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path'); shape.setAttribute('d', path); svg.append(shape); return svg; };
    const divider = () => { const line = document.createElement('div'); line.className = 'context-divider'; line.setAttribute('role', 'separator'); menu.append(line); };

    const projectRecord = (state.folders || []).find((folder) => folder?.name === name);
    const close = () => { menu.remove(); document.removeEventListener('pointerdown', dismissOutside); if (state.folderMenu === menu) state.folderMenu = null; };
    const dismissOutside = (event) => { if (!menu.contains(event.target)) close(); };
    const addItem = (label, path, handler, { danger = false, checked = false } = {}) => {
      const item = document.createElement('button'); item.type = 'button'; item.className = `context-item${danger ? ' danger' : ''}`; item.setAttribute('role', checked === null ? 'menuitem' : 'menuitemcheckbox');
      if (checked !== null) item.setAttribute('aria-checked', String(checked));
      item.append(icon(path)); const textNode = document.createElement('span'); textNode.textContent = label; item.append(textNode);
      if (checked !== null) { const mark = document.createElement('span'); mark.className = 'ctx-check-mark'; mark.textContent = '✓'; mark.hidden = !checked; item.append(mark); }
      item.addEventListener('click', async (event) => { event.preventDefault(); event.stopPropagation(); close(); await handler(); }); menu.append(item);
      return item;
    };
    addItem('Chỉnh sửa (chọn lại vị trí folder)', 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z', async () => { if (!projectRecord) return notify('Không tìm thấy metadata dự án.', true); if (await requestProjectFolder({ folder: projectRecord })) await loadFolders({ silent: true }); }, { checked: null });
    divider();
    const currentMode = folderMode(name);

    [
      ['always-expanded', 'Luôn mở rộng', 'M7 13l5 5 5-5 M7 6l5 5 5-5'],
      ['always-collapsed', 'Luôn thu gọn', 'M17 11l-5-5-5 5 M17 18l-5-5-5 5'],
      ['manual', 'Cho phép thu gọn / mở rộng', 'M8 9l4-4 4 4 M16 15l-4 4-4-4'],
    ].forEach(([mode, label, path]) => addItem(label, path, () => { setFolderMode(name, mode); state.folderCollapsed.delete(name); renderSessions(); notify(`Folder “${name}”: ${label}`); }, { checked: currentMode === mode }));
    bindMenuArrowNavigation(menu, '.context-item');
    menu.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } });

    document.body.append(menu); state.folderMenu = menu;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x || 24, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y || 80, innerHeight - Math.min(rect.height, innerHeight - 16) - 8))}px`;
    document.addEventListener('pointerdown', dismissOutside);
    menu.querySelector('.context-item')?.focus({ preventScroll: true });
  }
  function svgIcon(kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const isPin = kind === 'pin';
    const attrs = isPin
      ? { width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
      : { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' };
    Object.entries(attrs).forEach(([key, value]) => svg.setAttribute(key, value));
    if (isPin) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '12'); line.setAttribute('y1', '17'); line.setAttribute('x2', '12'); line.setAttribute('y2', '22');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M5 17h14v-1.76a2 2 0 0 1-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z');
      svg.append(line, path);
    } else {
      const child = document.createElementNS(ns, 'path');
      child.setAttribute('d', 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z');
      svg.append(child);
    }
    svg.classList.add(isPin ? 'session-pin-icon' : 'folder-icon');
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  }
  function renderSessions() {
    const query = text($('sidebarSearchInput')?.value || $('sessionSearchInput')?.value).trim().toLowerCase();
    const filterMode = localStorage.getItem('omp.sessionFilter') || 'all';
    const sessions = sortSessions(state.sessions.filter((item) => {
      if (query && !`${item.title || ''} ${item.id || ''} ${item.folderName || ''}`.toLowerCase().includes(query)) return false;
      if (filterMode === 'pinned') return !!item.isPinned;
      if (filterMode === 'unread') return !!item.isUnread;
      if (filterMode === 'running') return requestsForSession(item.id).length > 0;
      return true;
    }));
    const pinnedList = $('pinnedSessionsList'); const tree = $('projectFoldersTree'); const unassigned = $('unassignedSessionsList');
    if (!pinnedList || !tree || !unassigned) return;
    pinnedList.replaceChildren(); tree.replaceChildren(); unassigned.replaceChildren();
    const pinned = sessions.filter((item) => item.isPinned);
    const folderGroups = new Map();
    const addFolderGroup = (id, name, sessionCount = 0) => {
      const key = id ? `id:${id}` : `name:${name}`;
      if (!folderGroups.has(key)) folderGroups.set(key, { id: id || '', name, sessionCount: 0, items: [] });
      folderGroups.get(key).sessionCount = Math.max(folderGroups.get(key).sessionCount, Number(sessionCount) || 0);
      return folderGroups.get(key);
    };
    const addFolderItem = (group, item) => {
      const index = group.items.findIndex((candidate) => candidate.id === item.id);
      if (index < 0) group.items.push(item);
      else group.items[index] = { ...group.items[index], ...item };
    };
    (state.folders || []).forEach((folder) => {
      if (!folder?.id || !folder?.name) return;
      const group = addFolderGroup(folder.id, folder.name, folder.sessionCount);
      (Array.isArray(folder.sessions) ? folder.sessions : []).forEach((item) => addFolderItem(group, item));
    });
    sessions.filter((item) => item.folderName).forEach((item) => {
      addFolderItem(addFolderGroup(item.folderId, item.folderName), item);
    });
    const visibleFolders = [...folderGroups.values()].filter((folder) => !query || folder.items.length || folder.name.toLowerCase().includes(query));
    const loose = sessions.filter((item) => !item.isPinned && !item.folderName);
    pinned.forEach((item) => pinnedList.append(makeSessionRow(item)));
    if (!pinned.length) pinnedList.append(emptyNode('Chưa có phiên ghim'));
    visibleFolders.forEach(({ id, name, items, sessionCount }) => {
      const folder = document.createElement('div'); folder.className = 'project-folder'; folder.dataset.folder = name; if (id) folder.dataset.folderId = id;
      applyFolderMode(folder, name);
      const header = document.createElement('div'); header.className = 'folder-header-row'; header.title = 'Nhấp để mở rộng / thu gọn · Kích phải để tùy chọn'; header.setAttribute('aria-haspopup', 'menu');
      const left = document.createElement('div'); left.className = 'folder-header-left';
      const icon = svgIcon('folder');
      const label = document.createElement('span'); label.className = 'folder-name'; label.textContent = name;
      const count = document.createElement('span'); count.className = 'folder-count-badge'; count.textContent = String(Math.max(items.length, sessionCount || 0));
      left.append(icon, label, count);
      const actions = document.createElement('div'); actions.className = 'folder-header-actions';
      const projectRecord = (state.folders || []).find((item) => item?.id === id);
      if (id) {
        const newChat = document.createElement('button'); newChat.type = 'button'; newChat.className = 'tool-icon-btn folder-new-chat-btn';
        newChat.textContent = projectRecord?.cwd ? '+' : '⚙';
        newChat.title = projectRecord?.cwd ? `Tạo chat mới tại ${projectRecord.cwd}` : 'Chọn thư mục workspace cho dự án';
        newChat.setAttribute('aria-label', projectRecord?.cwd ? `Tạo chat mới trong ${name}` : `Chọn thư mục workspace cho ${name}`);
        newChat.addEventListener('click', async (event) => {
          event.preventDefault(); event.stopPropagation();
          let current = (state.folders || []).find((item) => item?.id === id);
          if (!current?.cwd) {
            if (!current) { await loadFolders({ silent: true }); current = (state.folders || []).find((item) => item?.id === id); }
            if (!current) return notify(`Không tìm thấy metadata dự án “${name}”.`, true);
            const configured = await requestProjectFolder({ folder: current });
            if (!configured) return;
            await loadFolders({ silent: true });
          }
          await createSession({ folderId: id });
        });
        actions.append(newChat);
      }
      header.append(left, actions);
      const list = document.createElement('div'); list.className = 'folder-sessions-container project-folder-sessions'; list.dataset.folder = name; if (id) list.dataset.folderId = id;
      const hasActiveOverflow = items.slice(5).some((item) => item.id === state.activeId);
      const isExpanded = state.folderExpanded.has(name) || hasActiveOverflow;
      (isExpanded ? items : items.slice(0, 5)).forEach((item) => list.append(makeSessionRow(item)));
      if (!items.length) list.append(emptyNode(sessionCount ? 'Đang tải cuộc trò chuyện trong folder…' : 'Chưa có phiên trong folder'));
      if (items.length > 5) {
        const more = document.createElement('button'); more.type = 'button'; more.className = 'folder-load-more-btn'; more.textContent = isExpanded ? 'Thu gọn' : 'Tải thêm'; more.title = isExpanded ? 'Thu gọn danh sách cuộc trò chuyện' : 'Hiển thị thêm cuộc trò chuyện'; more.setAttribute('aria-label', isExpanded ? `Thu gọn danh sách cuộc trò chuyện trong ${name}` : `Tải thêm cuộc trò chuyện trong ${name}`); more.setAttribute('aria-expanded', String(isExpanded));
        more.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); if (state.folderExpanded.has(name)) state.folderExpanded.delete(name); else state.folderExpanded.add(name); renderSessions(); }); list.append(more);
      }
      folder.append(header, list); tree.append(folder); bindFolderHeader(header);
    });
    if (!visibleFolders.length) tree.append(emptyNode('Chưa có dự án'));
    loose.forEach((item) => unassigned.append(makeSessionRow(item)));
    if (!loose.length) unassigned.append(emptyNode('Chưa có phiên chưa phân loại'));
    $('pinnedCountBadge') && ($('pinnedCountBadge').textContent = String(pinned.length));
    $('projectsCountBadge') && ($('projectsCountBadge').textContent = String(visibleFolders.length));
    $('unassignedCountBadge') && ($('unassignedCountBadge').textContent = String(loose.length));
    let more = $('liveSessionsMore');
    if (!more) { more = document.createElement('button'); more.id = 'liveSessionsMore'; more.type = 'button'; more.className = 'session-load-more-btn'; unassigned.after(more); }
    more.hidden = !state.nextCursor; more.textContent = state.nextCursor ? 'Tải thêm phiên' : '';
    more.onclick = () => loadSessions(state.nextCursor);
  }

  function showMenu(session, x, y) {

    closeLiveContextMenus();
    const template = $('sessionContextMenu');
    if (!template) return;
    const menu = template.cloneNode(true);
    menu.id = 'liveSessionActionMenu';
    menu.hidden = false;
    menu.removeAttribute('aria-hidden');
    menu.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    menu.classList.add('open');
    menu.setAttribute('aria-label', `Tùy chọn cuộc trò chuyện ${session.title || session.id}`);
    menu.style.removeProperty('display');
    menu.style.zIndex = '3000';
    menu.style.maxHeight = 'calc(100vh - 16px)';
    menu.style.overflowY = 'auto';
    menu.querySelector('.context-menu-item[data-action="section"]')?.remove();
    menu.querySelectorAll('.context-menu-divider + .context-menu-divider').forEach((divider) => divider.remove());
    const pinLabel = menu.querySelector('[data-action="pin"] .menu-label');
    if (pinLabel) { pinLabel.textContent = session.isPinned ? 'Bỏ ghim' : 'Ghim'; menu.querySelector('[data-action="pin"]').dataset.action = session.isPinned ? 'unpin' : 'pin'; }
    const unreadLabel = menu.querySelector('[data-action="unread"] .menu-label');
    if (unreadLabel) { unreadLabel.textContent = session.isUnread ? 'Đánh dấu là đã đọc' : 'Đánh dấu là chưa đọc'; menu.querySelector('[data-action="unread"]').dataset.action = session.isUnread ? 'read' : 'unread'; }
    const running = requestsForSession(session.id).length > 0;
    const runningLabel = menu.querySelector('[data-action="toggle-running"] .menu-label');
    if (runningLabel) runningLabel.textContent = running ? 'Dừng tiến trình chạy' : 'Bật tiến trình chạy';

    const projectSubmenu = menu.querySelector('[data-action="project"] .context-submenu');
    if (projectSubmenu) {
      const prototype = projectSubmenu.querySelector('[data-project]');
      const createProjectItem = projectSubmenu.querySelector('.new-project-item');
      projectSubmenu.replaceChildren();
      (state.folders || []).filter((folder) => folder?.id && folder?.name).forEach((folder) => {
        const item = prototype.cloneNode(true);
        item.dataset.folderId = folder.id;
        item.querySelector('span').textContent = folder.name;
        item.classList.toggle('active-item', session.folderId === folder.id);
        projectSubmenu.append(item);

      });
      const divider = document.createElement('div'); divider.className = 'context-menu-divider'; projectSubmenu.append(divider);
      const unassigned = prototype.cloneNode(true); unassigned.dataset.folderId = ''; unassigned.classList.toggle('active-item', !session.folderId); unassigned.querySelector('span').textContent = 'Không thuộc dự án (Chưa phân loại)'; projectSubmenu.append(unassigned);
      if (createProjectItem) projectSubmenu.append(createProjectItem);
    }

    const positionSubmenu = (item) => {
      const submenu = item.querySelector('.context-submenu');
      if (!submenu) return;
      const row = item.getBoundingClientRect();
      const oldDisplay = submenu.style.display;
      const oldVisibility = submenu.style.visibility;
      submenu.style.display = 'flex';
      submenu.style.visibility = 'hidden';
      const box = submenu.getBoundingClientRect();
      submenu.style.display = oldDisplay;
      submenu.style.visibility = oldVisibility;
      const width = box.width || submenu.offsetWidth;
      const height = box.height || submenu.scrollHeight;
      const left = row.right + width <= innerWidth - 8 ? row.right - 2 : Math.max(8, row.left - width + 2);
      submenu.style.left = `${left}px`;
      submenu.style.right = 'auto';
      submenu.style.top = `${Math.max(8, Math.min(row.top - 5, innerHeight - height - 8))}px`;
    };
    menu.querySelectorAll('.context-menu-item.has-submenu').forEach((item) => {
      item.addEventListener('mouseenter', () => positionSubmenu(item));
      item.addEventListener('focusin', () => positionSubmenu(item));
    });
    menu.addEventListener('scroll', () => {
      const active = menu.querySelector('.context-menu-item.has-submenu:hover, .context-menu-item.has-submenu:focus-within');
      if (active) positionSubmenu(active);
    }, { passive: true });

    const dismissOutside = (event) => { if (!menu.contains(event.target)) close(); };
    const close = () => { menu.remove(); document.removeEventListener('pointerdown', dismissOutside); if (state.menu === menu) state.menu = null; };
    bindMenuArrowNavigation(menu, '.context-menu-item, .context-submenu-item');
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Enter' || event.key === ' ') { const item = event.target.closest('.context-menu-item, .context-submenu-item'); if (item) { event.preventDefault(); item.click(); } }
    });
    menu.addEventListener('click', async (event) => {
      const item = event.target.closest('.context-submenu-item, .context-menu-item');
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      if (item.classList.contains('has-submenu')) return;
      const action = item.dataset.action;
      if (item.dataset.folderId !== undefined) {
        close();
        void runAction(session.id, item.dataset.folderId ? 'assign_folder' : 'unassign_folder', { folderId: item.dataset.folderId });
      } else if (action === 'create-new-project') {
        close();
        const created = await requestProjectFolder();
        if (created?.id) { await loadFolders({ silent: true }); await runAction(session.id, 'assign_folder', { folderId: created.id }); }
      } else if (item.dataset.copyType === 'link') {
        close(); void runAction(session.id, 'share');
      } else if (item.dataset.copyType === 'content') {
        close();
        try {
          const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(session.id)}/messages`);
          const messages = dataOf(payload, 'messages') || [];
          const transcript = messages.map((message) => `${message.role || 'message'}: ${message.text || message.content || ''}`).join('\n\n');
          await navigator.clipboard.writeText(transcript);
          notify('Đã sao chép nội dung hội thoại');
        } catch (error) { notify(`Không thể sao chép hội thoại: ${error.message}`, true); }
      } else if (item.dataset.copyType === 'duplicate' || item.dataset.forkType) {
        close(); void runAction(session.id, 'fork');
      } else if (action === 'toggle-running') {
        close();
        const request = requestsForSession(session.id).find((candidate) => candidate.status === 'running');
        if (!request) { notify('Cuộc trò chuyện này không có tiến trình đang chạy.', true); return; }
        request.status = 'stopping'; request.controller.abort();
        void fetch(`${API}/chat/abort`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: request.requestId, sessionId: request.sessionId }) });
        setSendState();
      } else if (action === 'open-window') {
        close(); window.open(`${location.origin}/chat?session=${encodeURIComponent(session.id)}`, '_blank', 'noopener');
      } else if (item.dataset.section !== undefined) {
        notify('Tính năng Mục chưa được nối với dữ liệu trong runtime này.', true);
      } else if (action) {
        close(); void runAction(session.id, action);
      }
    });
    document.body.append(menu);
    state.menu = menu;
    const rect = menu.getBoundingClientRect();
    const menuWidth = rect.width || 230;
    const menuHeight = rect.height || 430;
    menu.style.left = `${Math.max(8, Math.min(x || 24, innerWidth - menuWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y || 80, innerHeight - Math.min(menuHeight, innerHeight - 16) - 8))}px`;
    document.addEventListener('pointerdown', dismissOutside);
    menu.querySelector('.context-menu-item')?.focus({ preventScroll: true });
  }
  function showFolderAssignmentMenu(session, x, y) {
    if (!session?.id) return;
    closeLiveContextMenus();
    const menu = document.createElement('div');
    menu.className = 'neuratalk-context-menu open';
    menu.id = 'liveFolderAssignmentMenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Phân loại dự án cho ${session.title || session.id}`);
    menu.style.left = `${Math.max(8, Math.min(x || 24, innerWidth - 260))}px`;
    menu.style.top = `${Math.max(8, Math.min(y || 80, innerHeight - 320))}px`;
    menu.style.zIndex = '3000';
    menu.style.pointerEvents = 'auto';
    const close = () => {
      menu.remove();
      if (state.folderMenu === menu) state.folderMenu = null;
    };
    const addItem = (label, handler, options = {}) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `context-menu-item${options.danger ? ' danger' : ''}${options.selected ? ' active' : ''}`;
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      if (options.selected) item.setAttribute('aria-current', 'true');
      item.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        item.disabled = true;
        try {
          await handler();
          close();
        } catch (error) {
          item.disabled = false;
          notify(`Không thể cập nhật dự án: ${error.message}`, true);
        }
      });
      menu.append(item);
    };
    if (session.folderId || session.folderName) {
      addItem('Bỏ phân loại dự án', () => runAction(session.id, 'unassign_folder'), { danger: true });
    }
    addItem('Tạo dự án mới…', async () => {
      const created = await requestProjectFolder();
      if (!created?.id) return;
      await loadFolders({ silent: true });
      await runAction(session.id, 'assign_folder', { folderId: created.id });
    });
    const folders = (state.folders || []).filter((folder) => folder?.id && folder?.name);
    if (folders.length) {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      separator.setAttribute('role', 'separator');
      menu.append(separator);
      folders.forEach((folder) => addItem(
        folder.name,
        () => runAction(session.id, 'assign_folder', { folderId: folder.id }),
        { selected: session.folderId === folder.id },
      ));
    } else {
      const empty = document.createElement('div');
      empty.className = 'context-menu-label';
      empty.textContent = 'Chưa có dự án đã lưu';
      menu.append(empty);
    }
    document.body.append(menu);
    state.folderMenu = menu;
    setTimeout(() => document.addEventListener('click', (event) => {
      if (!menu.contains(event.target)) close();
    }, { once: true }), 0);
  }


  function requestTextInput(title, defaultValue = '', options = {}) {
    return new Promise((resolve) => {
      const modal = $('customInputModal'); const field = $('customInputField');
      if (!modal || !field) return resolve('');
      state.pendingTextResolve = resolve;
      $('customInputModalTitle') && ($('customInputModalTitle').textContent = title);
      $('customInputModalDesc') && ($('customInputModalDesc').textContent = options.description || 'Nhập tên mới cho cuộc trò chuyện.');
      field.value = defaultValue;
      field.placeholder = options.placeholder || 'Nhập tên…';
      modal.classList.add('open');
      modal.removeAttribute('aria-hidden');
      modal.inert = false;
      setTimeout(() => { field.focus(); field.select(); }, 30);
    });
  }

  function renderProjectWorkspacePicker() {
    const workspace = state.projectWorkspace || {};
    const roots = $('projectWorkspaceRoots');
    const directories = $('projectWorkspaceDirs');
    const current = $('projectWorkspaceCurrent');
    const parent = $('projectWorkspaceParentBtn');
    const use = $('projectWorkspaceUseBtn');
    const selection = $('projectWorkspaceSelection');
    const browser = $('projectWorkspaceBrowser');
    const openButton = $('projectWorkspaceOpenBtn');
    const selectedSummary = $('projectWorkspaceSelected');
    const changeButton = $('projectWorkspaceChangeBtn');
    const clearButton = $('projectWorkspaceClearBtn');
    const loading = Boolean(workspace.loading);
    const currentPath = text(workspace.currentPath).trim();
    const selectedPath = text(state.projectSelectedCwd).trim();
    const chatWorkspace = state.projectFolderPurpose === 'chat';
    if (browser) {
      browser.hidden = !state.projectWorkspacePickerOpen;
      browser.classList.toggle('open', Boolean(state.projectWorkspacePickerOpen));
      const modal = $('projectFolderModal');
      if (modal) modal.inert = Boolean(state.projectWorkspacePickerOpen);
    }
    if (openButton) {
      openButton.setAttribute('aria-expanded', String(Boolean(state.projectWorkspacePickerOpen)));
      openButton.hidden = Boolean(selectedPath);
      openButton.disabled = Boolean(state.projectWorkspaceChoosing);
      const label = $('projectWorkspaceOpenLabel');
      if (label) label.textContent = state.projectWorkspaceChoosing ? 'Đang mở Finder…' : chatWorkspace ? 'Chọn workspace trên máy tính này' : 'Thêm thư mục trên máy tính này';
    }
    if (selectedSummary) selectedSummary.hidden = !selectedPath;
    if (changeButton) changeButton.onclick = () => {
      if (!chatWorkspace) { void chooseNativeProjectWorkspace(); return; }
      state.projectWorkspacePickerOpen = true;
      renderProjectWorkspacePicker();
      requestAnimationFrame(() => { if (state.projectWorkspacePickerOpen) $('closeProjectWorkspaceExplorer')?.focus(); });
    };
    if (clearButton) clearButton.onclick = () => {
      state.projectSelectedCwd = '';
      state.projectWorkspacePickerOpen = false;
      setProjectFolderFormError();
      renderProjectWorkspacePicker();
    };
    if (openButton) openButton.onclick = () => {
      if (!chatWorkspace) { void chooseNativeProjectWorkspace(); return; }
      state.projectWorkspacePickerOpen = !state.projectWorkspacePickerOpen;
      renderProjectWorkspacePicker();
      if (state.projectWorkspacePickerOpen) requestAnimationFrame(() => { if (state.projectWorkspacePickerOpen) $('closeProjectWorkspaceExplorer')?.focus(); });
    };
    roots?.replaceChildren();
    directories?.replaceChildren();
    if (current) {
      current.replaceChildren();
      const label = document.createElement('span');
      label.className = 'workspace-current-label';
      label.textContent = loading ? 'Đang mở workspace' : 'Vị trí hiện tại';
      const path = document.createElement('code');
      path.className = 'workspace-current-path';
      path.textContent = currentPath ? workspacePathLabel(currentPath) : 'Chọn một workspace root để bắt đầu.';
      path.title = currentPath;
      current.append(label, path);
    }
    if (parent) {
      parent.hidden = !workspace.parentPath;
      parent.disabled = loading;
      parent.textContent = '← Lên một cấp';
      parent.onclick = () => { void loadProjectWorkspace(workspace.parentPath); };
    }
    if (use) {
      use.textContent = chatWorkspace ? 'Chọn workspace này' : 'Chọn thư mục này';
      use.disabled = !currentPath || loading;
      use.onclick = () => {
        state.projectSelectedCwd = currentPath;
        state.projectWorkspacePickerOpen = false;
        setProjectFolderFormError();
        if (chatWorkspace) closeProjectFolderModal({ cwd: state.projectSelectedCwd });
        else renderProjectWorkspacePicker();
      };
    }
    if (selection) {
      selection.replaceChildren();
      selection.classList.toggle('is-empty', !selectedPath);
      const label = document.createElement('span');
      label.className = 'workspace-selection-label';
      label.textContent = selectedPath ? (chatWorkspace ? 'Chat mới sẽ chạy tại' : 'Dự án sẽ dùng') : 'Chưa chọn thư mục';
      const path = document.createElement('code');
      path.className = 'workspace-selection-path';
      path.textContent = selectedPath ? workspacePathLabel(selectedPath) : 'Chọn “Chọn thư mục này” để tiếp tục.';
      path.title = selectedPath;
      selection.append(label, path);
    }
    (workspace.roots || []).forEach((root) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'workspace-root-chip';
      const name = document.createElement('span'); name.className = 'workspace-root-name'; name.textContent = root.name;
      const path = document.createElement('span'); path.className = 'workspace-root-path'; path.textContent = workspacePathLabel(root.path);
      button.append(name, path);
      button.title = `Mở workspace root ${root.path}`;
      button.setAttribute('aria-label', `Mở workspace ${root.name}`);
      button.addEventListener('click', () => { void loadProjectWorkspace(root.path); });
      roots?.append(button);
    });
    (workspace.directories || []).forEach((directory) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'workspace-directory-row';
      const icon = svgIcon('folder');
      const copy = document.createElement('span'); copy.className = 'workspace-directory-copy';
      const name = document.createElement('span'); name.className = 'workspace-directory-name'; name.textContent = directory.name;
      const detail = document.createElement('span'); detail.className = 'workspace-directory-detail'; detail.textContent = 'Mở thư mục';
      const chevron = document.createElement('span'); chevron.className = 'workspace-directory-chevron'; chevron.textContent = '›'; chevron.setAttribute('aria-hidden', 'true');
      copy.append(name, detail); button.append(icon, copy, chevron);
      button.title = directory.path;
      button.setAttribute('aria-label', `Mở thư mục ${directory.name}`);
      button.addEventListener('click', () => { void loadProjectWorkspace(directory.path); });
      directories?.append(button);
    });
    if (loading) {
      const node = document.createElement('div'); node.className = 'workspace-picker-empty'; node.textContent = 'Đang tải thư mục…'; directories?.append(node);
    } else if (currentPath && !(workspace.directories || []).length) {
      const node = document.createElement('div'); node.className = 'workspace-picker-empty'; node.textContent = 'Không có thư mục con an toàn.'; directories?.append(node);
    }
    if (state.projectWorkspacePickerOpen) {
      positionProjectWorkspaceExplorer();
      requestAnimationFrame(() => {
        if (state.projectWorkspacePickerOpen && (document.activeElement === document.body || document.activeElement === openButton)) $('closeProjectWorkspaceExplorer')?.focus();
      });
    }
  }

  async function chooseNativeProjectWorkspace() {
    if (state.projectWorkspaceChoosing) return;
    state.projectWorkspaceChoosing = true;
    renderProjectWorkspacePicker();
    try {
      const { payload } = await readJson(`${API}/workspaces`, { method: 'POST', body: JSON.stringify({}) });
      if (payload?.cwd) {
        state.projectSelectedCwd = payload.cwd;
        setProjectFolderFormError();
        if (state.projectFolderPurpose === 'chat') closeProjectFolderModal({ cwd: payload.cwd });
      }
    } catch (error) {
      setProjectFolderFormError(`Không mở được Finder: ${error.message}`);
    } finally {
      state.projectWorkspaceChoosing = false;
      renderProjectWorkspacePicker();
    }
  }

  function positionProjectWorkspaceExplorer() {
    const anchor = document.querySelector('.workspace-picker-trigger')?.getBoundingClientRect();
    const popup = document.querySelector('.workspace-explorer-popup');
    if (!anchor || !popup) return;
    const width = Math.min(anchor.width, innerWidth - 24);
    const left = Math.min(Math.max(12, anchor.left), innerWidth - width - 12);
    const desired = Math.min(popup.scrollHeight || 360, 480, innerHeight - 24);
    let top = anchor.bottom + 8;
    let room = innerHeight - top - 12;
    if (room < Math.min(desired, 220)) {
      room = Math.max(160, anchor.top - 20);
      top = Math.max(12, anchor.top - Math.min(desired, room) - 8);
    }
    const maxHeight = Math.max(160, Math.min(desired, innerHeight - top - 12));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.width = `${width}px`;
    popup.style.setProperty('--workspace-explorer-max-height', `${maxHeight}px`);
  }

  async function loadProjectWorkspace(path = null) {
    try {
      const browserContent = document.querySelector('.workspace-picker-browser');
      if (browserContent) browserContent.scrollTop = 0;
      state.projectWorkspace = { currentPath: path || state.projectWorkspace?.currentPath || '', loading: true };
      renderProjectWorkspacePicker();
      const query = path ? `?path=${encodeURIComponent(path)}` : '';
      const { payload } = await readJson(`${API}/workspaces${query}`);
      state.projectWorkspace = payload;
      renderProjectWorkspacePicker();
    } catch (error) {
      notify(`Không tải được workspace: ${error.message}`, true);
    }
  }

  function closeProjectFolderModal(result = null) {
    const modal = $('projectFolderModal');
    state.projectWorkspacePickerOpen = false;
    $('projectWorkspaceBrowser')?.classList.remove('open');
    $('projectWorkspaceBrowser')?.setAttribute('hidden', '');
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    if (modal) modal.inert = true;
    const resolve = state.pendingProjectFolderResolve;
    state.pendingProjectFolderResolve = null;
    state.projectFolderEditingId = '';
    state.projectFolderPurpose = 'folder';
    resolve?.(result);
  }
  function closeMobileNavigation() {
    $('appSidebar')?.classList.remove('mobile-open');
    $('mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
    $('mobileMenuBtn')?.setAttribute('aria-label', 'Mở thanh điều hướng');
  }

  function setProjectFolderNameVisible(visible) {
    const name = $('projectFolderNameInput');
    const field = $('projectFolderNameField');
    if (field) field.hidden = !visible;
    if (name) name.hidden = !visible;
  }
  function setProjectFolderFormError(message = '') {
    const error = $('projectFolderFormError');
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  }
  function setProjectFolderModalDescription(value) {
    const description = $('projectFolderModalDescription');
    if (description) { description.textContent = value; description.hidden = !value; }
  }
  function requestProjectFolder({ folder = null } = {}) {
    const modal = $('projectFolderModal');
    const name = $('projectFolderNameInput');
    if (!modal || !name) return Promise.resolve(null);
    closeMobileNavigation();
    closeProjectFolderModal();
    state.projectFolderPurpose = 'folder';
    state.projectWorkspacePickerOpen = false;
    setProjectFolderNameVisible(true);
    $('projectWorkspaceHeading') && ($('projectWorkspaceHeading').textContent = 'Thư mục nguồn');
    setProjectFolderModalDescription('');
    $('projectFolderSaveBtn') && ($('projectFolderSaveBtn').hidden = false);
    $('projectWorkspaceUseBtn') && ($('projectWorkspaceUseBtn').textContent = 'Dùng thư mục này');
    state.projectFolderEditingId = folder?.id || '';
    state.projectSelectedCwd = folder?.cwd || '';
    setProjectFolderFormError();
    $('projectFolderModalTitle') && ($('projectFolderModalTitle').textContent = folder?.id ? 'Chọn thư mục workspace' : 'Tạo dự án');
    name.value = folder?.name || 'Dự án mới';
    name.disabled = Boolean(folder?.id);
    $('projectFolderSaveBtn') && ($('projectFolderSaveBtn').textContent = folder?.id ? 'Lưu thư mục' : 'Tạo dự án');
    modal.classList.add('open');
    modal.removeAttribute('aria-hidden');
    modal.inert = false;
    void loadProjectWorkspace(folder?.cwd || null);
    setTimeout(() => { if (!state.projectWorkspacePickerOpen) name.focus(); }, 30);
    return new Promise((resolve) => { state.pendingProjectFolderResolve = resolve; });
  }
  function requestChatWorkspace() {
    const modal = $('projectFolderModal');
    const name = $('projectFolderNameInput');
    if (!modal || !name) return Promise.resolve(null);
    closeMobileNavigation();
    closeProjectFolderModal();
    state.projectFolderPurpose = 'chat';
    state.projectWorkspacePickerOpen = false;
    state.projectFolderEditingId = '';
    state.projectSelectedCwd = state.draftWorkspaceCwd || '';
    setProjectFolderFormError();
    $('projectFolderModalTitle') && ($('projectFolderModalTitle').textContent = 'Chọn workspace cho chat mới');
    setProjectFolderModalDescription('Chọn thư mục workspace cho cuộc trò chuyện mới.');
    setProjectFolderNameVisible(false);
    $('projectWorkspaceHeading') && ($('projectWorkspaceHeading').textContent = 'Workspace cho chat mới');
    name.value = '';
    name.disabled = true;
    const save = $('projectFolderSaveBtn');
    if (save) { save.textContent = 'Dùng General'; save.hidden = false; save.disabled = false; }
    $('projectWorkspaceUseBtn') && ($('projectWorkspaceUseBtn').textContent = 'Dùng workspace này');
    modal.classList.add('open');
    modal.removeAttribute('aria-hidden');
    modal.inert = false;
    void loadProjectWorkspace(state.projectSelectedCwd || null);
    setTimeout(() => { if (!state.projectWorkspacePickerOpen) $('projectFolderCancelBtn')?.focus(); }, 30);
    return new Promise((resolve) => { state.pendingProjectFolderResolve = resolve; });
  }

  function bindProjectFolderModal() {
    const cancel = () => closeProjectFolderModal();
    $('projectFolderCancelBtn')?.addEventListener('click', cancel);
    $('projectFolderCancelActionBtn')?.addEventListener('click', cancel);
    $('projectFolderModal')?.addEventListener('click', (event) => { if (event.target === $('projectFolderModal')) cancel(); });
    document.querySelector('.workspace-picker-trigger')?.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      (state.projectSelectedCwd ? $('projectWorkspaceChangeBtn') : $('projectWorkspaceOpenBtn'))?.click();
    });
    const explorer = $('projectWorkspaceBrowser');
    const closeExplorer = () => {
      state.projectWorkspacePickerOpen = false;
      renderProjectWorkspacePicker();
      (state.projectSelectedCwd ? $('projectWorkspaceChangeBtn') : $('projectWorkspaceOpenBtn'))?.focus();
    };
    $('closeProjectWorkspaceExplorer')?.addEventListener('click', closeExplorer);
    explorer?.addEventListener('click', (event) => { if (event.target === explorer) closeExplorer(); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.projectWorkspacePickerOpen) { event.preventDefault(); event.stopPropagation(); closeExplorer(); }
    });
    window.addEventListener('resize', positionProjectWorkspaceExplorer);
    $('projectFolderNameInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') cancel();
      if (event.key === 'Enter') { event.preventDefault(); $('projectFolderSaveBtn')?.click(); }
    });
    $('projectFolderNameInput')?.addEventListener('input', () => setProjectFolderFormError());
    $('projectFolderSaveBtn')?.addEventListener('click', async () => {
      const button = $('projectFolderSaveBtn');
      const name = text($('projectFolderNameInput')?.value).trim();
      const cwd = state.projectSelectedCwd;
      const editingId = state.projectFolderEditingId;
      if (state.projectFolderPurpose === 'chat') {
        closeProjectFolderModal({ cwd: '' });
        return;
      }
      if (!editingId && !name) { setProjectFolderFormError('Nhập tên dự án để tiếp tục.'); $('projectFolderNameInput')?.focus(); return; }
      if (!cwd) {
        setProjectFolderFormError('Chọn một thư mục nguồn để tiếp tục.');
        state.projectWorkspacePickerOpen = true;
        renderProjectWorkspacePicker();
        $('closeProjectWorkspaceExplorer')?.focus();
        return;
      }
      if (button) button.disabled = true;
      try {
        const url = editingId ? `${API}/folders/${encodeURIComponent(editingId)}` : `${API}/folders`;
        const method = editingId ? 'PATCH' : 'POST';
        const body = editingId ? { cwd } : { name, cwd };
        const { payload } = await readJson(url, { method, body: JSON.stringify(body) });
        closeProjectFolderModal(payload);
      } catch (error) {
        setProjectFolderFormError(`Không thể lưu dự án: ${error.message}`);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  function requestDeleteConfirm(session) {
    return new Promise((resolve) => {
      const modal = $('deleteConfirmModal');
      if (!modal) return resolve(false);
      state.pendingDeleteResolve = resolve;
      const preview = $('deleteSessionNamePreview');
      if (preview) preview.textContent = session.title || 'Cuộc trò chuyện';
      modal.classList.add('open');
      modal.removeAttribute('aria-hidden');
      modal.inert = false;
    });
  }

  async function exportSessionMarkdown(session) {
    if (!session?.id) return;
    let messages = state.activeId === session.id ? state.messages : null;
    if (!Array.isArray(messages)) {
      try {
        const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(session.id)}/messages`);
        messages = dataOf(payload, 'messages') || [];
      } catch (error) {
        notify(`Không thể xuất cuộc trò chuyện: ${error.message}`, true);
        return;
      }
    }
    if (!messages.length) return notify('Cuộc trò chuyện chưa có nội dung để xuất.', true);
    const lines = [`# ${text(session.title || 'Cuộc trò chuyện').trim()}`, ''];
    messages.forEach((message) => {
      const role = message?.role === 'user' ? 'Síp' : message?.role === 'toolResult' ? 'Tool' : 'OMP';
      const content = text(message?.content || '').trim();
      const attachments = Array.isArray(message?.attachments) ? message.attachments.map((item) => item?.name || 'tệp đính kèm').filter(Boolean) : [];
      if (content || attachments.length) lines.push(`## ${role}`, content || '_[Không có nội dung văn bản]_', attachments.length ? `\nTệp đính kèm: ${attachments.join(', ')}` : '', '');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${text(session.title || 'cuoc-tro-chuyen').trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'cuoc-tro-chuyen'}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    notify('Đã xuất lịch sử cuộc trò chuyện thành tệp Markdown.');
  }

  async function runAction(id, action, actionData = {}) {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    const actionGuard = sessionGuard(id, state.generation);
    if (action === 'export') return exportSessionMarkdown(session);
    let renameTitle = '';
    if (action === 'rename') { renameTitle = (await requestTextInput('Đặt lại tên cuộc trò chuyện', session.title || 'Phiên làm việc mới')).trim(); if (!renameTitle) return; }
    if (action === 'delete' && !(await requestDeleteConfirm(session))) return;
    const body = { action };
    if (action === 'rename') body.title = renameTitle;
    if (action === 'assign_folder') body.folderId = actionData.folderId;
    if (action === 'share') body.shareMode = state.shareMode;
    const actionLabel = { assign_folder: 'phân loại folder', unassign_folder: 'bỏ phân loại folder' }[action] || action;
    try {
      const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify(body) });
      if (action === 'share') {
        const shareUrl = String(payload?.shareUrl || '');
        const shareMode = String(payload?.shareMode || 'encrypted');
        const validShareUrl = shareMode === 'local'
          ? /^http:\/\/127\.0\.0\.1(?::\d+)?\/chat\?session=[A-Za-z0-9._:%-]+$/i.test(shareUrl)
          : /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>]*)?$/i.test(shareUrl);
        if (!validShareUrl) throw new Error('OMP chưa trả URL share hợp lệ');
        await navigator.clipboard?.writeText(shareUrl).catch(() => {});
        notify(shareMode === 'local' ? 'Đã tạo URL session local và chép vào clipboard' : 'Đã tạo URL share encrypted và chép vào clipboard');
      } else if (action !== 'rename') {
        const labels = {
          pin: 'Đã ghim cuộc trò chuyện',
          unpin: 'Đã bỏ ghim cuộc trò chuyện',
          unread: 'Đã đánh dấu chưa đọc',
          read: 'Đã đánh dấu đã đọc',
          assign_folder: 'Đã phân loại folder',
          unassign_folder: 'Đã bỏ phân loại folder',
          archive: 'Đã lưu trữ cuộc trò chuyện',
          delete: 'Đã xoá cuộc trò chuyện',
          fork: 'Đã tạo nhánh cuộc trò chuyện',
          duplicate: 'Đã nhân bản cuộc trò chuyện',
          reconnect: 'Đã kết nối lại session',
          tools: 'Đã cập nhật công cụ OMP',
        };
        notify(labels[action] || `Đã thực hiện: ${action}`);
      }
      if (action === 'rename') {
        state.optimisticTitles.delete(id);
        session.title = renameTitle;
        renderSessions();
        if (state.activeId === id && $('headerSessionTitle')) $('headerSessionTitle').textContent = renameTitle;
        notify(`Đã đổi tên “${renameTitle}”`);
        return;
      }
      if (action === 'assign_folder' && payload?.session) {
        session.folderId = payload.session.folderId;
        session.folderName = payload.session.folderName;
      }
      if (action === 'unassign_folder') {
        delete session.folderId;
        delete session.folderName;
      }
      if (['fork', 'duplicate'].includes(action) && payload?.forkSession?.id) state.activeId = payload.forkSession.id;
      await loadSessions();
      if (['assign_folder', 'unassign_folder'].includes(action)) await loadFolders({ silent: true });
      if (['fork', 'duplicate'].includes(action) && payload?.forkSession?.id) await selectSession(payload.forkSession.id);
      else if (['archive', 'delete'].includes(action) && state.activeId === id) setNeutralSelection({ preserveActiveView: false });
      else if (state.activeId === id && isCurrentSession(actionGuard)) await selectSession(id, true);
    } catch (error) { notify(`Không thể ${actionLabel}: ${error.message}`, true); }
  }
  async function loadFolders(options = {}) {
    const requestId = ++state.folderLoadRequestId;
    try {
      const { payload } = await readJson(`${API}/folders`);
      if (requestId !== state.folderLoadRequestId) return state.folders;
      state.folders = Array.isArray(payload) ? payload : dataOf(payload, 'folders') || [];
      renderSessions();
      return state.folders;
    } catch (error) {
      if (requestId !== state.folderLoadRequestId) return state.folders;
      if (!options.silent) notify(`Không tải được folder: ${error.message}`, true);
      renderSessions();
      return state.folders;
    }
  }
  async function loadSessions(cursor = null, options = {}) {
    const loadGeneration = state.generation;
    const requestId = ++state.sessionLoadRequestId;
    const url = `${API}/sessions?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    try {
      const { payload, response } = await readJson(url);
      if (requestId !== state.sessionLoadRequestId) return;
      const page = (Array.isArray(payload) ? payload : dataOf(payload, 'sessions') || [])
        .filter((item) => !String(item?.id || '').startsWith('models-') && item?.id)
        .map((item) => state.optimisticTitles.has(item.id) ? { ...item, title: state.optimisticTitles.get(item.id) } : item);
      state.sessions = cursor ? state.sessions.concat(page) : page;
      state.nextCursor = response.headers.get('x-next-cursor');
      renderSessions();
      const requested = new URLSearchParams(location.search).get('session');
      if (state.generation === loadGeneration && !state.activeId && requested) {
        const selected = state.sessions.find((item) => item.id === requested);
        if (selected) await selectSession(selected.id);
      }
      setConnectionStatus('Đã kết nối', 'connected');
      if (!options.silent) notify(`Đã kết nối backend chat · ${state.sessions.length} phiên`);
    } catch (error) {
      if (requestId !== state.sessionLoadRequestId) return;
      setConnectionStatus('Đã ngắt kết nối', 'disconnected'); notify(`Không tải được session: ${error.message}`, true);
    }
  }
  async function loadAllSessions() { while (state.nextCursor) await loadSessions(state.nextCursor, { silent: true }); renderSessions(); }

  function inlineBadgeType(value) {
    const token = text(value).trim();
    const port = /^(?:(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):|(?:--port|port)(?:[=:]\s*|\s+))(\d{1,5})$/i.exec(token);
    if (port && Number(port[1]) >= 1 && Number(port[1]) <= 65535) return 'port';
    if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(token)) return 'env';
    if (/^\.[A-Za-z0-9_-]+$/.test(token) || /(?:^|[\\/])[^\\/]+\.[A-Za-z0-9]{1,10}$/.test(token)) return 'file';
    if (/^@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(token) || /^[a-z0-9][a-z0-9._-]*-(?:service|api|server|worker)$/i.test(token)) return 'service';
    return '';
  }
  function ensureInlineBadgeColorStyles() {
    if (document.getElementById('inlineBadgeColorStyles')) return;
    const style = document.createElement('style');
    style.id = 'inlineBadgeColorStyles';
    style.textContent = 'html[data-colorful-badges="true"] .ai-message-card code.inline-code-badge:not([data-type]) { background: color-mix(in oklab, var(--accent), transparent 84%); border-color: color-mix(in oklab, var(--accent), transparent 65%); color: color-mix(in oklab, var(--accent), white 22%); }';
    document.head.append(style);
  }
  ensureInlineBadgeColorStyles();
  function appendInlineMarkdown(parent, value) {
    const source = text(value);
    const token = /\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|https?:\/\/[^\s<]+/g;
    let cursor = 0;
    source.replace(token, (match, offset) => {
      if (offset > cursor) parent.append(document.createTextNode(source.slice(cursor, offset)));
      if (match.startsWith('**')) { const node = document.createElement('strong'); node.textContent = match.slice(2, -2); parent.append(node); }
      else if (match.startsWith('*')) { const node = document.createElement('em'); node.textContent = match.slice(1, -1); parent.append(node); }
      else if (match.startsWith('`')) { const value = match.slice(1, -1); const type = inlineBadgeType(value); const node = document.createElement('code'); node.className = 'inline-code-badge'; if (type) { node.classList.add(`badge-${type}`); node.dataset.type = type; } node.textContent = value; parent.append(node); }
      else { try { const url = new URL(match); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported'); const node = document.createElement('a'); node.className = 'chat-rich-link'; node.href = url.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.textContent = match; parent.append(node); } catch { parent.append(document.createTextNode(match)); } }
      cursor = offset + match.length;
      return match;
    });
    if (cursor < source.length) parent.append(document.createTextNode(source.slice(cursor)));
  }
  function renderSafeMarkdown(container, source) {
    container.replaceChildren();
    const lines = text(source).replace(/\r/g, '').split('\n');
    let list = null; let listType = '';
    let code = null;
    let codeLanguage = '';
    let table = null;
    const flushList = () => { if (list) container.append(list); list = null; listType = ''; };
    const tableCells = (line) => {
      const value = text(line).trim();
      if (!/^\|.*\|$/.test(value)) return null;
      return value.slice(1, -1).split('|').map((cell) => cell.trim());
    };
    const tableDivider = (cells) => Array.isArray(cells) && cells.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
    const appendTableRow = (cells, tag) => { const row = document.createElement('tr'); cells.forEach((value) => { const cell = document.createElement(tag); appendInlineMarkdown(cell, value); row.append(cell); }); return row; };
    const flushTable = () => { if (table) container.append(table.wrap); table = null; };
    const appendCode = () => {
      const box = document.createElement('div'); box.className = 'code-box';
      const header = document.createElement('div'); header.className = 'code-header';
      const label = document.createElement('span'); label.textContent = codeLanguage || 'code';
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'code-copy-btn'; copy.textContent = 'Sao chép'; copy.title = 'Sao chép code'; copy.setAttribute('aria-label', 'Sao chép code');
      const value = code.join('\n');
      copy.addEventListener('click', () => void copyText(value, 'code'));
      const pre = document.createElement('pre'); pre.className = 'code-pre'; const node = document.createElement('code'); node.textContent = value; pre.append(node);
      header.append(label, copy); box.append(header, pre); container.append(box);
    };
    lines.forEach((line, index) => {
      const fence = line.match(/^\s*```(.*)$/);
      if (fence) { if (code) { appendCode(); code = null; codeLanguage = ''; } else { flushList(); code = []; codeLanguage = text(fence[1]).trim().slice(0, 40); } return; }
      if (code) { code.push(line); return; }
      const cells = tableCells(line);
      if (table) {
        if (tableDivider(cells)) return;
        if (cells) { table.body.append(appendTableRow(cells, 'td')); return; }
        flushTable();
      }
      if (cells && tableDivider(tableCells(lines[index + 1]))) {
        flushList();
        const wrap = document.createElement('div'); wrap.className = 'ai-data-table-wrap'; const node = document.createElement('table'); node.className = 'ai-data-table';
        const head = document.createElement('thead'); head.append(appendTableRow(cells, 'th')); const body = document.createElement('tbody'); node.append(head, body); wrap.append(node); table = { wrap, body }; return;
      }
      if (!line.trim()) { flushList(); return; }
      const heading = line.match(/^\s*#{1,3}\s+(.+?)\s*#*$/);
      if (heading) { flushList(); const node = document.createElement('h3'); node.className = 'chat-heading'; appendInlineMarkdown(node, heading[1]); container.append(node); return; }
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (bullet || ordered) { const type = bullet ? 'ul' : 'ol'; if (!list || listType !== type) { flushList(); listType = type; list = document.createElement(type); } const item = document.createElement('li'); appendInlineMarkdown(item, (bullet || ordered)[1]); list.append(item); return; }
      flushList();
      const quote = line.match(/^\s*>\s?(.*)$/);
      const node = document.createElement(quote ? 'blockquote' : 'p');
      if (!quote) node.className = 'chat-lead-text';
      appendInlineMarkdown(node, quote ? quote[1] : line); container.append(node);
    });
    if (code) appendCode();
    flushTable();
    flushList();
  }
  async function copyText(value, label = 'nội dung') {
    const content = text(value);
    if (!content) return notify(`Không có ${label} để sao chép.`, true);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(content);
      else {
        const field = document.createElement('textarea'); field.value = content; field.style.cssText = 'position:fixed;opacity:0;pointer-events:none;'; document.body.append(field); field.select();
        try { if (!document.execCommand('copy')) throw new Error('copy unavailable'); } finally { field.remove(); }
      }
      notify(`Đã sao chép ${label}`);
    } catch { notify(`Không thể sao chép ${label}.`, true); }
  }
  function attachmentImageSource(item) {
    const source = text(item?.data || item?.url || '').trim();
    const dataUrl = source.match(/^data:(image\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=\s]+$/i);
    if (dataUrl) return source;
    try { const url = new URL(source); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
  }
  function formatAttachmentSize(value) {
    const size = Number(value) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.max(1, Math.ceil(size / 1024))} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  function mergeAttachmentItems(...lists) {
    const merged = []; const seen = new Set();
    lists.flatMap((list) => Array.isArray(list) ? list : []).forEach((item) => {
      const key = `${text(item?.name)}\0${text(item?.type)}\0${text(item?.data || item?.text)}`;
      if (!item || seen.has(key)) return;
      seen.add(key); merged.push(item);
    });
    return merged.slice(0, 4);
  }
  function ensureAttachmentViewerStyles() {
    if (document.getElementById('productionAttachmentViewerStyles')) return;
    const style = document.createElement('style');
    style.id = 'productionAttachmentViewerStyles';
    style.textContent = `
      .production-attachment-button { cursor: pointer; font: inherit; }
      .production-message-images { display: flex; flex-wrap: wrap; gap: 6px; width: auto; max-width: 100%; margin: 6px 0 10px; }
      .production-message-images .production-attachment-button { display: block; flex: 0 0 112px; width: 112px; height: 84px; padding: 0; box-sizing: border-box; }
      .production-message-image { display: block; width: 100%; height: 100%; max-width: none; max-height: none; object-fit: contain; background: var(--bg); }
      @media (max-width: 560px) {
        .production-message-images .production-attachment-button { flex-basis: 96px; width: 96px; height: 72px; }
      }
      .production-media-viewer { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgb(0 0 0 / 78%); }
      .production-media-viewer-panel { position: relative; max-width: min(92vw, 1000px); max-height: 92vh; overflow: auto; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--fg); box-shadow: 0 20px 80px rgb(0 0 0 / 35%); }
      .production-media-viewer-image { display: block; max-width: min(88vw, 940px); max-height: 78vh; object-fit: contain; }
      .production-media-viewer-text { max-width: min(88vw, 940px); max-height: 78vh; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 12px/1.55 var(--font-mono); }
      .production-media-viewer-close { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); color: var(--fg); cursor: pointer; }
      .production-media-viewer-title { margin: 0 36px 12px 0; color: var(--muted); font-size: 12px; }
    `;
    document.head.append(style);
  }
  function openAttachmentViewer(item) {
    ensureAttachmentViewerStyles();
    document.getElementById('productionMediaViewer')?.remove();
    const viewer = document.createElement('div'); viewer.id = 'productionMediaViewer'; viewer.className = 'production-media-viewer show'; viewer.setAttribute('role', 'dialog'); viewer.setAttribute('aria-modal', 'true'); viewer.tabIndex = -1;
    const panel = document.createElement('div'); panel.className = 'production-media-viewer-panel';
    const title = document.createElement('h2'); title.className = 'production-media-viewer-title'; title.textContent = item?.name || 'Tệp đính kèm';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'production-media-viewer-close'; close.setAttribute('aria-label', 'Đóng trình xem tệp'); close.textContent = '×';
    const closeViewer = () => { viewer.remove(); document.removeEventListener('keydown', onKeyDown); };
    const onKeyDown = (event) => { if (event.key === 'Escape') closeViewer(); };
    close.addEventListener('click', closeViewer);
    viewer.addEventListener('click', (event) => { if (event.target === viewer) closeViewer(); });
    const imageSource = attachmentImageSource(item);
    if (imageSource) { const image = document.createElement('img'); image.className = 'production-media-viewer-image'; image.src = imageSource; image.alt = item?.name || 'Ảnh đính kèm'; panel.append(title, close, image); }
    else if (typeof item?.text === 'string') { const pre = document.createElement('pre'); pre.className = 'production-media-viewer-text'; pre.textContent = item.text; panel.append(title, close, pre); }
    else { const empty = document.createElement('div'); empty.textContent = 'Không có dữ liệu xem trước an toàn cho tệp này.'; panel.append(title, close, empty); }
    viewer.removeAttribute('aria-hidden'); viewer.inert = false; viewer.append(panel); document.body.append(viewer); document.addEventListener('keydown', onKeyDown); close.focus();
  }
  function renderMessageAttachments(parent, attachments) {
    const items = Array.isArray(attachments) ? attachments.filter((item) => item && typeof item === 'object') : [];
    if (!items.length) return;
    ensureAttachmentViewerStyles();
    const images = items.filter((item) => attachmentImageSource(item));
    const files = items.filter((item) => !attachmentImageSource(item));
    if (images.length) {
      const gallery = document.createElement('div'); gallery.className = 'user-msg-images production-message-images';
      images.forEach((item) => {
        const card = document.createElement('button'); card.type = 'button'; card.className = 'attached-img-card production-attachment-button'; card.title = `Xem ${item.name || 'ảnh'}`; card.setAttribute('aria-label', `Xem ảnh ${item.name || 'đính kèm'}`);
        const image = document.createElement('img'); image.className = 'production-message-image'; image.src = attachmentImageSource(item); image.alt = item.name || 'Ảnh đính kèm'; image.loading = 'lazy'; card.append(image); card.addEventListener('click', () => openAttachmentViewer(item)); gallery.append(card);
      });
      parent.append(gallery);
    }
    if (files.length) {
      const list = document.createElement('div'); list.className = 'user-msg-attachments production-message-attachments';
      files.forEach((item) => {
        const canPreview = typeof item.text === 'string';
        const chip = document.createElement(canPreview ? 'button' : 'div'); if (canPreview) chip.type = 'button';
        chip.className = 'attached-file-chip' + (canPreview ? ' production-attachment-button' : '');
        chip.title = canPreview ? `Xem ${item.name || 'tệp'}` : item.name || 'Tệp đính kèm';
        const icon = document.createElement('span'); icon.className = 'attached-file-icon'; icon.textContent = (item.name || 'FILE').split('.').pop().slice(0, 5).toUpperCase();
        const info = document.createElement('span'); info.className = 'attached-file-info';
        const name = document.createElement('span'); name.className = 'attached-file-name'; name.textContent = item.name || 'Tệp đính kèm';
        const meta = document.createElement('span'); meta.className = 'attached-file-meta'; meta.textContent = `${item.type || 'tệp'} · ${formatAttachmentSize(item.size)}`;
        info.append(name, meta); chip.append(icon, info); if (canPreview) chip.addEventListener('click', () => openAttachmentViewer(item)); list.append(chip);
      });
      parent.append(list);
    }
  }
  function ensureBodyToggleStyles() {
    if (document.getElementById('chatBodyToggleStyles')) return;
    const style = document.createElement('style');
    style.id = 'chatBodyToggleStyles';
    style.textContent = `
      .chat-body-toggles { width: 100%; margin: 1px 0 0; }
      .chat-body-toggle { border: 0; border-radius: 0; background: transparent; overflow: visible; }
      .chat-body-toggle-summary { display: flex; align-items: center; gap: 4px; min-height: 18px; padding: 1px 0; color: var(--meta); cursor: pointer; list-style: none; user-select: none; font: 10px/1.25 var(--font-body); }
      .chat-body-toggle-summary::-webkit-details-marker { display: none; }
      .chat-body-toggle-summary:hover { color: var(--fg); background: transparent; }
      .chat-body-toggle-summary:focus-visible { outline: 1px solid var(--focus-ring, var(--accent)); outline-offset: 1px; }
      .chat-body-toggle-marker { display: inline-block; width: 9px; color: var(--meta); font: 14px/9px var(--font-body); transform: rotate(0deg); transition: transform .16s ease; }
      .chat-body-toggle[open] .chat-body-toggle-marker { transform: rotate(90deg); }
      .chat-body-toggle-label { flex: 0 0 auto; color: var(--meta); font-weight: 500; }
      .chat-body-toggle-meta { margin-left: auto; color: var(--meta); font: 9px/1.1 var(--font-mono); white-space: nowrap; }
      .chat-body-activity-content { display: flex; flex-direction: column; gap: 0; padding: 2px 0 3px 13px; border-top: 0; color: var(--meta); }
      .chat-body-activity-row { padding: 2px 0; border-bottom: 0; }
      .chat-body-activity-row:last-child { border-bottom: 0; }
      .chat-body-activity-row-header { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
      .chat-body-activity-row-marker { flex: 0 0 9px; color: var(--meta); font: 10px/1 var(--font-mono); text-align: center; }
      .chat-body-activity-row-label { min-width: 0; overflow: hidden; color: var(--meta); font-size: 10px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
      .chat-body-activity-row-meta { margin-left: auto; color: var(--meta); font: 9px/1.1 var(--font-mono); white-space: nowrap; }
      .chat-body-activity-row-content { display: flex; flex-direction: column; gap: 3px; margin: 2px 0 0 13px; }
      .chat-body-toggle-text, .chat-body-toggle-code { max-height: 220px; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 10px/1.4 var(--font-mono); }
      .chat-body-toggle-code { padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--meta); }
      .chat-body-toggle-empty { font-size: 10px; color: var(--meta); }
      .chat-body-todo-list { display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 0; list-style: none; }
      .chat-body-todo-item { display: flex; align-items: flex-start; gap: 4px; font-size: 10px; line-height: 1.35; color: var(--meta); }
      .chat-body-todo-state { width: 10px; flex: 0 0 10px; color: var(--meta); font-family: var(--font-mono); text-align: center; }
      .chat-body-todo-item.is-completed .chat-body-todo-state { color: var(--success); }
      .chat-body-todo-item.is-blocked .chat-body-todo-state { color: var(--warn); }
      .chat-body-activity-row-status-running .chat-body-activity-row-meta { color: var(--accent); }
      .chat-body-activity-row-status-error .chat-body-activity-row-label, .chat-body-activity-row-status-error .chat-body-activity-row-meta { color: var(--danger); }
      .chat-body-activity-status-running { color: var(--accent); }
      .chat-body-activity-status-waiting { color: var(--warn); }
      .chat-body-activity-status-error { color: var(--danger); }
      .chat-loading-status { color: var(--accent); font-size: 11.5px; font-weight: 500; }
      .chat-loading-status[data-status="waiting"] { color: var(--warn); }
      .chat-loading-status[data-status="error"] { color: var(--danger); }
      .chat-loading-status[data-status="done"] { color: var(--muted); }
      .chat-loading-status.is-loading::after { content: '…'; display: inline-block; width: 10px; margin-left: 2px; color: currentColor; animation: chatLoadingPulse 900ms var(--ease-standard, ease-in-out) infinite; }
      @keyframes chatLoadingPulse { 0%, 100% { opacity: .35; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-1px); } }
      @media (prefers-reduced-motion: reduce) { .chat-loading-status.is-loading::after { animation: none; opacity: .7; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .chat-body-toggle-marker { transition: none; } }
    `;
    document.head.append(style);
  }
  ensureBodyToggleStyles();
  const bodyKindLabels = { thinking: 'Suy luận', todo: 'Todo', tool: 'Tool', tool_result: 'Kết quả tool', command: 'Command output', approval: 'Xác nhận OMP', status: 'Trạng thái OMP', goal: 'Mục tiêu', notice: 'Thông báo OMP', compaction: 'Compact context', retry: 'Retry' };
  const bodyStatusLabels = { running: 'đang chạy', waiting: 'chờ xác nhận', done: 'đã xong', error: 'lỗi', info: 'thông tin', warning: 'cảnh báo' };
  function bodyValueText(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return text(value); }
  }
  function bodyBlockTitle(block) {
    const kind = text(block?.kind);
    if (kind === 'tool' && block.toolName) return `Tool · ${text(block.toolName)}`;
    if (kind === 'tool_result' && block.toolName) return `Kết quả · ${text(block.toolName)}`;
    if (kind === 'command' && block.command) return `Command output · ${text(block.command)}`;
    return bodyKindLabels[kind] || text(block?.title) || 'Chi tiết OMP';
  }
  function bodyActivityStatus(blocks) {
    const hasError = blocks.some((block) => text(block?.status) === 'error' || text(block?.kind) === 'error');
    const hasTerminal = blocks.some((block) => text(block?.kind) === 'status' && text(block?.status) === 'done' && /kết thúc lượt|đã kết thúc/i.test(text(block?.text)));
    const hasWaitingApproval = blocks.some((block) => text(block?.kind) === 'approval' && text(block?.status) === 'running');
    const hasRunning = blocks.some((block) => text(block?.status) === 'running');
    if (hasError) return { key: 'error', label: bodyStatusLabels.error };
    if (hasWaitingApproval && !hasTerminal) return { key: 'waiting', label: bodyStatusLabels.waiting };
    if (hasRunning && !hasTerminal) return { key: 'running', label: bodyStatusLabels.running };
    return { key: 'done', label: bodyStatusLabels.done };
  }
  function appendBodyBlockContent(content, block) {
    let appended = false;
    if (Array.isArray(block?.items) && block.items.length) {
      const list = document.createElement('ul'); list.className = 'chat-body-todo-list';
      block.items.forEach((item) => {
        const row = document.createElement('li'); row.className = `chat-body-todo-item is-${text(item.status || 'pending')}`;
        const stateNode = document.createElement('span'); stateNode.className = 'chat-body-todo-state'; stateNode.textContent = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '◐' : item.status === 'blocked' ? '!' : '·'; stateNode.setAttribute('aria-hidden', 'true');
        const itemText = document.createElement('span'); itemText.textContent = `${item.phase ? `${item.phase} · ` : ''}${item.content || ''}${item.blocker ? ` — ${item.blocker}` : ''}`;
        row.append(stateNode, itemText); list.append(row);
      });
      content.append(list); appended = true;
    }
    const textContent = bodyValueText(block?.text);
    if (textContent) { const bodyText = document.createElement('pre'); bodyText.className = 'chat-body-toggle-text'; bodyText.textContent = textContent; content.append(bodyText); appended = true; }
    const resultText = bodyValueText(block?.resultText);
    if (resultText) { const pre = document.createElement('pre'); pre.className = 'chat-body-toggle-code'; pre.dataset.bodyField = 'result'; pre.textContent = `Result\n${resultText}`; content.append(pre); appended = true; }
    for (const [key, title] of [['args', 'Arguments'], ['result', 'Result'], ['goal', 'Goal']]) {
      const value = bodyValueText(block?.[key]);
      if (!value) continue;
      const pre = document.createElement('pre'); pre.className = 'chat-body-toggle-code'; pre.dataset.bodyField = key; pre.textContent = `${title}\n${value}`; content.append(pre); appended = true;
    }
    return appended;
  }
  function groupedBodyBlocks(blocks) {
    const copies = blocks.map((block) => ({ ...block }));
    const tools = new Map();
    copies.forEach((block) => {
      if (text(block.kind) !== 'tool') return;
      const key = text(block.toolCallId || block.id);
      if (key) tools.set(key, block);
    });
    const rows = [];
    let statusRow = null;
    copies.forEach((block) => {
      const kind = text(block.kind);
      if (kind === 'tool_result') {
        const target = tools.get(text(block.toolCallId || block.id));
        if (target) {
          if (block.result != null) target.result = block.result;
          if (block.text) target.resultText = block.text;
          target.status = block.status || target.status || 'done';
          return;
        }
      }
      if (kind === 'status') {
        if (!statusRow) { statusRow = { ...block }; rows.push(statusRow); }
        else Object.assign(statusRow, block, { id: statusRow.id, kind: 'status' });
        return;
      }
      rows.push(block);
    });
    return rows;
  }
  function bodyActivityRowNode(block) {
    const kind = text(block?.kind).replace(/[^a-z0-9_-]/gi, '-') || 'status';
    const statusKey = text(block?.status).replace(/[^a-z0-9_-]/gi, '-') || 'info';
    const row = document.createElement('div');
    row.className = `chat-body-activity-row chat-body-kind-${kind} chat-body-activity-row-status-${statusKey}`;
    row.dataset.bodyId = text(block?.id || '');
    row.setAttribute('role', 'listitem');
    const header = document.createElement('div'); header.className = 'chat-body-activity-row-header';
    const marker = document.createElement('span'); marker.className = 'chat-body-activity-row-marker'; marker.setAttribute('aria-hidden', 'true'); marker.textContent = kind === 'approval' ? '!' : kind === 'tool' ? '◆' : '·';
    const label = document.createElement('span'); label.className = 'chat-body-activity-row-label'; label.textContent = bodyBlockTitle(block);
    const status = bodyStatusLabels[text(block?.status)] || text(block?.status);
    const meta = document.createElement('span'); meta.className = 'chat-body-activity-row-meta'; meta.textContent = status ? `· ${status}` : '';
    header.append(marker, label, meta);
    const content = document.createElement('div'); content.className = 'chat-body-activity-row-content';
    if (!appendBodyBlockContent(content, block)) { const empty = document.createElement('span'); empty.className = 'chat-body-toggle-empty'; empty.textContent = 'OMP không trả thêm chi tiết.'; content.append(empty); }
    row.append(header, content);
    return row;
  }
  function bodyActivityNode(blocks) {
    const details = document.createElement('details');
    details.className = 'chat-body-toggle chat-body-activity';
    details.dataset.bodyId = 'omp-activity';
    const status = bodyActivityStatus(blocks);
    const summary = document.createElement('summary');
    summary.className = 'chat-body-toggle-summary';
    summary.setAttribute('aria-label', `Hoạt động OMP · ${blocks.length} sự kiện · ${status.label}`);
    const marker = document.createElement('span'); marker.className = 'chat-body-toggle-marker'; marker.setAttribute('aria-hidden', 'true'); marker.textContent = '›';
    const label = document.createElement('span'); label.className = 'chat-body-toggle-label'; label.textContent = 'OMP';
    const meta = document.createElement('span'); meta.className = `chat-body-toggle-meta chat-body-activity-status-${status.key}`; meta.textContent = `${blocks.length} sự kiện · ${status.label}`;
    summary.append(marker, label, meta);
    const content = document.createElement('div'); content.className = 'chat-body-activity-content'; content.setAttribute('role', 'list');
    groupedBodyBlocks(blocks).forEach((block) => content.append(bodyActivityRowNode(block)));
    details.append(summary, content);
    return details;
  }
  function renderBodyBlocks(parent, blocks) {
    if (!parent) return;
    const items = Array.isArray(blocks) ? blocks.filter((block) => block && typeof block === 'object') : [];
    if (!items.length) { parent.replaceChildren(); parent.hidden = true; return; }
    const previous = [...parent.children].find((node) => node.dataset.bodyId === 'omp-activity');
    const next = bodyActivityNode(items);
    if (previous) next.open = previous.open;
    parent.hidden = false;
    parent.replaceChildren(next);
  }
  function upsertBodyBlock(blocks, block) {
    if (!block || typeof block !== 'object') return Array.isArray(blocks) ? blocks : [];
    const next = Array.isArray(blocks) ? [...blocks] : [];
    const id = text(block.id || `${block.kind || 'body'}-${next.length}`);
    const index = next.findIndex((item) => text(item?.id) === id);
    if (index < 0) next.push({ ...block, id });
    else next[index] = { ...next[index], ...block, id };
    return next.slice(-256);
  }
  function renderMessageBody(parent, blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return null;
    const body = document.createElement('div'); body.className = 'chat-body-toggles'; body.setAttribute('aria-label', 'Hoạt động Terminal OMP'); renderBodyBlocks(body, blocks); parent.append(body); return body;
  }
  const fileEditAction = /\b(?:apply[_ -]?patch|write(?:[_ -]?file)?|edit(?:[_ -]?file)?|replace|create(?:[_ -]?file)?|delete(?:[_ -]?file)?|rename|move)\b/i;
  const filePathPattern = /(?:~?\/|\.{1,2}\/)?(?:[\w@%+.,=-]+\/)*[\w@%+.,=-]+\.(?:[a-z0-9]{1,12})\b/gi;
  function fileChangeRows(blocks) {
    const rows = []; const seen = new Set();
    groupedBodyBlocks(Array.isArray(blocks) ? blocks : []).forEach((block) => {
      if (text(block?.kind) !== 'tool' || !fileEditAction.test([block.toolName, block.intent, bodyValueText(block.args), block.text, block.resultText].map(text).join('\n'))) return;
      const sources = [block.args, block.result, block.text, block.resultText, block.intent].map(bodyValueText).join('\n');
      for (const match of sources.matchAll(filePathPattern)) {
        const path = text(match[0]).replace(/[),.;:]+$/, '');
        if (!path || seen.has(path)) continue;
        seen.add(path); rows.push({ path, status: text(block.status) || 'done', toolName: text(block.toolName) || 'OMP' });
      }
    });
    return rows.slice(0, 12);
  }
  function ensureFileChangeReviewStyles() {
    if ($('runtimeFileChangeReviewStyles')) return;
    const style = document.createElement('style'); style.id = 'runtimeFileChangeReviewStyles';
    style.textContent = '.runtime-file-change-modal{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px;background:color-mix(in oklab,#000,transparent 34%)}.runtime-file-change-panel{display:flex;flex-direction:column;gap:14px;width:min(960px,100%);max-height:min(88vh,820px);overflow:hidden;background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:0 24px 80px rgba(0,0,0,.36);color:var(--fg)}.runtime-file-change-head,.runtime-file-change-foot{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--border)}.runtime-file-change-foot{border-top:1px solid var(--border);border-bottom:0;justify-content:flex-end}.runtime-file-change-title{font-size:16px;font-weight:700;flex:1}.runtime-file-change-close,.runtime-file-change-action{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-raised);color:var(--fg);padding:7px 11px;cursor:pointer}.runtime-file-change-action.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-on)}.runtime-file-change-action.danger{color:var(--danger);border-color:color-mix(in oklab,var(--danger),var(--border) 55%)}.runtime-file-change-body{overflow:auto;padding:0 18px 18px;display:grid;gap:12px}.runtime-file-change-file{border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden}.runtime-file-change-file>summary{cursor:pointer;list-style:none;padding:10px 12px;font-weight:650;background:var(--surface-raised)}.runtime-file-change-file>summary::-webkit-details-marker{display:none}.runtime-file-change-path{font-family:var(--font-mono);font-size:12px;overflow-wrap:anywhere}.runtime-file-change-status{float:right;color:var(--muted);font-size:11px}.runtime-file-change-diff{margin:0;padding:10px 12px;overflow:auto;background:var(--canvas);font:12px/1.55 var(--font-mono)}.runtime-file-change-line{display:block;white-space:pre-wrap;overflow-wrap:anywhere}.runtime-file-change-line.add{color:var(--success);background:color-mix(in oklab,var(--success),transparent 90%)}.runtime-file-change-line.del{color:var(--danger);background:color-mix(in oklab,var(--danger),transparent 90%)}.runtime-file-change-line.meta{color:var(--muted);font-style:italic}.runtime-file-change-note{color:var(--muted);font-size:12px}@media(max-width:600px){.runtime-file-change-modal{padding:8px}.runtime-file-change-panel{max-height:94vh}.runtime-file-change-head,.runtime-file-change-foot{padding:12px}.runtime-file-change-body{padding:0 12px 12px}}';
    document.head.append(style);
  }
  function renderFileChangeDiff(parent, before, after) {
    const oldLines = text(before || '').split('\n'); const newLines = text(after || '').split('\n');
    if (!text(before) && !text(after)) { const empty = document.createElement('span'); empty.className = 'runtime-file-change-line meta'; empty.textContent = '(tệp rỗng)'; parent.append(empty); return; }
    let prefix = 0; while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
    let suffix = 0; while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
    const add = (value, kind) => { const line = document.createElement('span'); line.className = `runtime-file-change-line ${kind}`; line.textContent = `${kind === 'add' ? '+ ' : kind === 'del' ? '- ' : '  '}${value}`; parent.append(line); };
    oldLines.slice(0, prefix).forEach((line) => add(line, 'same'));
    oldLines.slice(prefix, oldLines.length - suffix || undefined).forEach((line) => add(line, 'del'));
    newLines.slice(prefix, newLines.length - suffix || undefined).forEach((line) => add(line, 'add'));
    oldLines.slice(oldLines.length - suffix).forEach((line) => add(line, 'same'));
  }
  async function actOnFileChanges(snapshot, action) {
    if (!snapshot?.id || !['apply', 'revert'].includes(action)) return;
    if (!window.confirm(action === 'revert' ? 'Hoàn tác các thay đổi này trên workspace?' : 'Xác nhận giữ các thay đổi này?')) return;
    try {
      const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(snapshot.sessionId || state.activeId)}/file-changes/action`, { method: 'POST', body: JSON.stringify({ action, snapshotId: snapshot.id, confirmed: true }) });
      const next = payload?.snapshot || payload;
      state.messages = state.messages.map((message) => message.fileChanges?.id === snapshot.id ? { ...message, fileChanges: next } : message);
      renderMessages(state.messages);
      notify(action === 'revert' ? 'Đã hoàn tác file-change bằng snapshot runtime.' : 'Đã xác nhận file-change runtime.');
      $('runtimeFileChangeModal')?.remove();
    } catch (error) { notify(`Không thể ${action === 'revert' ? 'hoàn tác' : 'xác nhận'} file-change: ${error.message}`, true); }
  }
  async function openFileChangeReview(snapshot) {
    let current = snapshot;
    const sessionId = current?.sessionId || state.activeId;
    if (!sessionId) return notify('Chưa chọn cuộc trò chuyện.', true);
    try {
      const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(sessionId)}/file-changes`);
      if (payload?.snapshot) current = payload.snapshot;
    } catch (error) {
      if (!current?.id) return notify(`Không tải được snapshot file-change: ${error.message}`, true);
    }
    if (!current?.files?.length) return notify(current?.reason || 'Phiên này chưa có snapshot file-change để xem.', true);
    ensureFileChangeReviewStyles();
    $('runtimeFileChangeModal')?.remove();
    const modal = document.createElement('div'); modal.id = 'runtimeFileChangeModal'; modal.className = 'runtime-file-change-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'runtimeFileChangeTitle');
    const panel = document.createElement('div'); panel.className = 'runtime-file-change-panel';
    const head = document.createElement('div'); head.className = 'runtime-file-change-head';
    const title = document.createElement('strong'); title.id = 'runtimeFileChangeTitle'; title.className = 'runtime-file-change-title'; title.textContent = `${current.files.length} tệp thay đổi`;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'runtime-file-change-close'; close.textContent = 'Đóng'; close.addEventListener('click', () => modal.remove()); head.append(title, close);
    const body = document.createElement('div'); body.className = 'runtime-file-change-body';
    current.files.forEach((file) => {
      const details = document.createElement('details'); details.className = 'runtime-file-change-file'; details.open = true;
      const summary = document.createElement('summary'); const path = document.createElement('span'); path.className = 'runtime-file-change-path'; path.textContent = file.path; const status = document.createElement('span'); status.className = 'runtime-file-change-status'; status.textContent = file.status || 'changed'; summary.append(path, status);
      const diff = document.createElement('pre'); diff.className = 'runtime-file-change-diff'; renderFileChangeDiff(diff, file.before?.text, file.after?.text); details.append(summary, diff); body.append(details);
      if (file.before?.truncated || file.after?.truncated) { const note = document.createElement('div'); note.className = 'runtime-file-change-note'; note.textContent = 'Nội dung hiển thị đã rút gọn; hash đầy đủ vẫn được kiểm tra ở backend.'; details.append(note); }
    });
    const foot = document.createElement('div'); foot.className = 'runtime-file-change-foot';
    const note = document.createElement('span'); note.className = 'runtime-file-change-note'; note.textContent = current.complete === true && current.status === 'ready' ? 'Backend sẽ kiểm tra hash trước khi thao tác.' : (current.reason || 'Chỉ xem được snapshot này.'); note.style.marginRight = 'auto'; foot.append(note);
    const revert = document.createElement('button'); revert.type = 'button'; revert.className = 'runtime-file-change-action danger'; revert.textContent = 'Hoàn tác'; revert.disabled = !(current.complete === true && current.status === 'ready'); revert.addEventListener('click', () => void actOnFileChanges(current, 'revert'));
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'runtime-file-change-action primary'; apply.textContent = 'Giữ thay đổi'; apply.disabled = !(current.complete === true && current.status === 'ready'); apply.addEventListener('click', () => void actOnFileChanges(current, 'apply'));
    foot.append(revert, apply); panel.append(head, body, foot); modal.append(panel); modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); }); modal.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); modal.remove(); } }); document.body.append(modal); close.focus();
  }
  function renderFileChangeCard(host, blocks, fileChanges = null) {
    if (!host) return [];
    const rows = fileChangeRows(blocks);
    if (!rows.length && Array.isArray(fileChanges?.files)) fileChanges.files.forEach((file) => rows.push({ path: text(file.path), status: text(file.status || 'changed'), toolName: 'OMP' }));
    host.replaceChildren(); host.hidden = !rows.length;
    if (!rows.length) return rows;
    const running = rows.some((row) => row.status === 'running');
    const failed = rows.every((row) => row.status === 'error');
    const card = document.createElement('div'); card.className = 'file-change-card'; card.dataset.fileChangeCard = 'true';
    const header = document.createElement('div'); header.className = 'file-change-card-header';
    const left = document.createElement('div'); left.className = 'file-change-card-left';
    const icon = document.createElement('span'); icon.className = 'file-change-icon-box'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '±';
    const meta = document.createElement('div'); meta.className = 'file-change-meta';
    const title = document.createElement('strong'); title.className = 'file-change-title'; title.textContent = failed ? 'Chỉnh sửa tệp chưa hoàn tất' : running ? `Đang chỉnh sửa ${rows.length} tệp` : `Đã chỉnh sửa ${rows.length} tệp`;
    const detail = document.createElement('span'); detail.className = 'file-change-stats'; detail.textContent = fileChanges?.id ? 'Nguồn: snapshot runtime' : 'Nguồn: hoạt động OMP';
    meta.append(title, detail); left.append(icon, meta);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'btn-diff-review'; toggle.textContent = fileChanges?.id ? 'Xem diff' : 'Xem hoạt động'; toggle.setAttribute('aria-expanded', 'false');
    const list = document.createElement('div'); list.className = 'file-change-list'; list.hidden = true;
    rows.forEach((row) => {
      const item = document.createElement('div'); item.className = 'file-change-row';
      const path = document.createElement('span'); path.className = 'file-path-wrap'; path.textContent = row.path; path.title = row.path;
      const status = document.createElement('span'); status.className = 'file-diff-stats'; status.textContent = row.status === 'error' ? 'lỗi' : row.status === 'running' ? 'đang xử lý' : 'đã xong';
      item.append(path, status); list.append(item);
    });
    toggle.addEventListener('click', () => { if (fileChanges?.id) { void openFileChangeReview(fileChanges); return; } list.hidden = !list.hidden; toggle.setAttribute('aria-expanded', String(!list.hidden)); toggle.textContent = list.hidden ? 'Xem hoạt động' : 'Thu gọn'; });
    header.append(left, toggle); card.append(header, list); host.append(card);
    return rows;
  }
  function syncFileChangeFloatingBar(messages = state.messages) {
    const bar = $('fileChangeFloatingBar'); const pill = $('fileChangeFloatingPill');
    if (!bar || !pill) return;
    const latestMessage = [...(Array.isArray(messages) ? messages : [])].reverse().find((message) => fileChangeRows(message?.role === 'user' ? [] : message?.body).length || message?.fileChanges?.files?.length);
    const latest = latestMessage ? fileChangeRows(latestMessage.role === 'user' ? [] : latestMessage.body) : [];
    const visible = Boolean(latest?.length);
    bar.hidden = !visible; bar.classList.toggle('is-visible', visible); bar.style.removeProperty('display');
    if (!visible) return;
    pill.hidden = false; pill.disabled = false; pill.removeAttribute('aria-hidden'); pill.removeAttribute('onclick');
    pill.replaceChildren(Object.assign(document.createElement('span'), { className: 'file-change-pill-text', textContent: `${latest.length} tệp đã thay đổi` }));
    pill.title = 'Nhấp để xem hoạt động chỉnh sửa tệp'; pill.setAttribute('aria-label', pill.title);
    pill.onclick = () => latestMessage?.fileChanges?.id ? void openFileChangeReview(latestMessage.fileChanges) : document.querySelector('[data-file-change-card="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function editUserPrompt(message) {
    const input = $('chatInput');
    if (!input) return notify('Không tìm thấy ô nhập prompt.', true);
    if (text(input.value).trim() || state.attachments.length) { input.focus(); return notify('Ô nhập đang có bản nháp; hãy gửi hoặc xoá bản nháp trước khi chỉnh prompt.', true); }
    input.value = text(message.content);
    state.attachments = cloneSnapshot(Array.isArray(message.attachments) ? message.attachments : []);
    renderAttachmentStrip(); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
    notify('Đã nạp prompt vào ô nhập; gửi sẽ tạo lượt mới.');
  }

  function replaceQueuedUserMessage(messages, queueId, user, draftId = null) {
    const next = Array.isArray(messages) ? [...messages] : [];
    const index = queueId ? next.findIndex((message) => message.queueId === queueId) : draftId ? next.findIndex((message) => message.draftId === draftId) : -1;
    if (index >= 0) next[index] = user;
    else if (!next.some((message) => message.requestId === user.requestId)) {
      const firstQueued = next.findIndex((message) => message.queueId && !message.requestId);
      if (firstQueued >= 0) next.splice(firstQueued, 0, user); else next.push(user);
    }
    return next;
  }
  function upsertAssistantMessage(messages, requestId, assistant) {
    const next = Array.isArray(messages) ? [...messages] : [];
    const existing = next.findIndex((message) => message.requestId === requestId && message.role !== 'user');
    if (existing >= 0) { next[existing] = assistant; return next; }
    const userIndex = next.findIndex((message) => message.requestId === requestId && message.role === 'user');
    next.splice(userIndex >= 0 ? userIndex + 1 : next.length, 0, assistant);
    return next;
  }
  const messageClock = (message) => {
    const timestamp = text(message.timestamp).trim();
    if (timestamp) return timestamp;
    const date = new Date(message.createdAt || Date.now());
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };
  function messageActionsNode(message) {
    const actions = document.createElement('div'); actions.className = 'msg-actions';
    const left = document.createElement('div'); left.className = 'msg-actions-left';
    if (text(message.content).trim()) { const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'msg-act-btn'; copy.title = 'Sao chép Markdown'; copy.setAttribute('aria-label', copy.title); copy.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'; copy.addEventListener('click', () => void copyText(message.content, 'Markdown')); left.append(copy); }
    const fork = document.createElement('button'); fork.type = 'button'; fork.className = 'msg-act-btn'; fork.title = 'Tạo nhánh chat từ phản hồi này'; fork.setAttribute('aria-label', fork.title); fork.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"></path><path d="M12 12v3"></path></svg>'; fork.addEventListener('click', () => { if (!state.activeId) return notify('Chưa chọn cuộc trò chuyện.', true); void runAction(state.activeId, 'fork'); });
    left.append(fork);
    const right = document.createElement('div'); right.className = 'msg-actions-right';
    const time = document.createElement('span'); time.className = 'msg-timestamp'; time.textContent = messageClock(message); time.title = `Thời điểm phản hồi: ${time.textContent}`;
    right.append(time);
    actions.append(left, right);
    return actions;
  }
  function messageNode(message) {
    const role = message.role === 'user' ? 'user' : 'assistant';
    if (role === 'user') {
      const wrap = document.createElement('div'); wrap.className = 'user-msg-wrap';
      if (message.requestId) wrap.dataset.requestId = message.requestId;
      if (message.queueId && !message.requestId) wrap.dataset.queuePreviewId = message.queueId;
      if (message.draftId) wrap.dataset.draftPreviewId = message.draftId;
      renderMessageAttachments(wrap, message.attachments);
      if (text(message.content).trim()) { const bubble = document.createElement('div'); bubble.className = 'user-msg-bubble'; bubble.textContent = text(message.content); wrap.append(bubble); }
      const footer = document.createElement('div'); footer.className = 'user-msg-footer'; const time = document.createElement('span'); time.className = 'user-msg-time'; time.textContent = messageClock(message);
      if (message.queueId && !message.requestId) { const queueStatus = document.createElement('span'); queueStatus.className = 'user-msg-queue-status'; queueStatus.textContent = 'Đang chờ web gửi'; queueStatus.setAttribute('aria-label', 'Đang chờ web gửi'); footer.append(queueStatus); }
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'user-msg-act-btn btn-copy-user-msg'; copy.title = 'Sao chép câu hỏi'; copy.setAttribute('aria-label', copy.title); copy.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'; copy.addEventListener('click', () => void copyText(message.content, 'prompt'));
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'user-msg-act-btn btn-edit-user-msg'; edit.title = 'Chỉnh prompt trong ô nhập'; edit.setAttribute('aria-label', edit.title); edit.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>'; edit.addEventListener('click', () => editUserPrompt(message));
      footer.append(time, copy, edit); wrap.append(footer); return wrap;
    }
    const wrap = document.createElement('div');
    wrap.className = 'ai-response-wrap';
    const status = document.createElement('div');
    status.className = 'chat-status-row';
    const statusText = document.createElement('div');
    statusText.className = 'chat-status-text';
    statusText.textContent = message.totalDuration ? `Đã hoàn tất · ${message.totalDuration}` : 'Đã hoàn tất';
    const line = document.createElement('div');
    line.className = 'chat-status-line';
    status.append(statusText, line);
    const card = document.createElement('div');
    card.className = 'ai-message-card';
    renderMessageBody(card, message.body);
    const fileChanges = document.createElement('div'); fileChanges.className = 'message-file-changes'; renderFileChangeCard(fileChanges, message.body, message.fileChanges); card.append(fileChanges);
    if (text(message.content).trim()) {
      const content = document.createElement('div');
      content.className = 'chat-markdown';
      renderSafeMarkdown(content, message.content);
      card.append(content);
    }
    renderMessageAttachments(card, message.attachments);
    if (text(message.content).trim() || (Array.isArray(message.attachments) && message.attachments.length) || (Array.isArray(message.body) && message.body.length)) card.append(messageActionsNode(message));
    wrap.append(status, card);
    return wrap;
  }
  function clearPrototypeData() {
    ['pinnedSessionsList', 'projectFoldersTree', 'unassignedSessionsList'].forEach((id) => $(id)?.replaceChildren());
    $('chatStream')?.replaceChildren();

    // Keep the six production quick actions; they are wired to the real composer by legacy.js.

    setGreetingVisible(!state.activeId && !state.pendingPrompts.length);
    const title = $('headerSessionTitle'); if (title) title.textContent = 'Chưa chọn cuộc trò chuyện';
    const pill = $('headerSessionPill'); if (pill) { pill.title = 'Chưa chọn cuộc trò chuyện'; pill.setAttribute('aria-label', 'Chưa chọn cuộc trò chuyện'); }
    syncWorkspaceMeta(null);
  }
  function workspaceName(cwd) {
    return String(cwd || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'General';
  }
  function syncWorkspaceMeta(session) {
    const isDraft = !session && !state.activeId;
    const cwd = session?.cwd || (isDraft ? state.draftWorkspaceCwd : '');
    const projectName = session?.folderName?.trim() || '';
    const name = projectName || (isDraft ? (cwd ? workspaceName(cwd) : 'General') : 'Workspace chung');
    const label = $('promptCurrentWsLabel'); if (label) label.textContent = name;
    const wrapper = $('promptWsWrapper'); const trigger = $('promptWorkspaceTrigger'); const dropdown = $('promptWsDropdown'); const chevron = $('promptWsChevron');
    if (wrapper) { wrapper.classList.toggle('is-picker', isDraft); wrapper.classList.toggle('is-info-only', !isDraft); }
    if (trigger) {
      trigger.disabled = !isDraft;
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', 'projectFolderModal');
      trigger.title = isDraft ? `Workspace chat mới: ${cwd || 'General'}` : projectName ? `Folder dự án: ${projectName}` : `Workspace chung: ${cwd || 'General'}`;
      trigger.setAttribute('aria-label', isDraft ? `Chọn workspace cho chat mới. Hiện tại: ${name}` : projectName ? `Folder dự án: ${projectName}` : `Workspace chung: ${name}`);
      if (isDraft) trigger.removeAttribute('aria-disabled'); else trigger.setAttribute('aria-disabled', 'true');
    }
    if (dropdown) { dropdown.hidden = true; dropdown.classList.remove('show'); }
    if (chevron) chevron.hidden = !isDraft;
  }
  function sanitizeProductionSurface() {
    const hide = (id) => { const node = $(id); if (node) { node.hidden = true; node.disabled = true; node.setAttribute('aria-hidden', 'true'); } };
    ['screenCaptureBtn', 'cameraCaptureBtn', 'microphoneCaptureBtn', 'videoCaptureBtn'].forEach(hide);
    const tools = $('toolsContentArea');
    if (tools) { tools.replaceChildren(emptyNode('Chưa có công cụ backend')); tools.setAttribute('aria-live', 'polite'); }
    const toolsTab = $('drawerTabToolsBtn');
    const badge = toolsTab?.querySelector('.drawer-tab-badge');
    if (badge) badge.textContent = '0';
    if (toolsTab) toolsTab.setAttribute('aria-label', 'Công cụ chưa kết nối');
  }
  function renderMessages(messages) {
    const stream = $('chatStream'); if (!stream) return;
    stream.replaceChildren();
    state.messages = messages;
    messages.forEach((message) => stream.append(messageNode(message)));
    syncFileChangeFloatingBar(messages);
    syncGreeting();
    const area = $('chatScrollArea'); if (area) area.scrollTop = area.scrollHeight;
  }
  async function selectSession(id, quiet = false, options = {}) {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) { if (!quiet) notify('Không tìm thấy cuộc trò chuyện được chọn.', true); return false; }
    if (state.editingQueueId && state.activeId !== id) cancelQueueEdit(true);
    const previousId = state.activeId;
    if (previousId !== id && voiceRecognition) await stopVoiceInput();
    if (previousId !== id && terminalSessionId) void closeEmbeddedTerminal();
    if (previousId && previousId !== id) {
      rememberRetry(previousId);
      cacheSessionView(previousId);
      $('chatStream')?.replaceChildren();
    }
    const guard = sessionGuard(id, state.generation + 1);
    state.generation = guard.generation;
    state.activeId = id;
    if (previousId !== id) { void loadQuota(); await loadModels(); }
    syncRequestAliases();
    if ($('ompMemoryStatus')) void loadOmpMemory(guard);
    if (!options.deferMessages) state.messages = [];
    requestsForSession(id).forEach((request) => { if (request.guard) request.guard.generation = guard.generation; });
    const canRestore = Boolean(state.sessionViews.get(id)?.volatile);
    const restoredView = canRestore ? restoreSessionView(id) : false;
    if (previousId !== id) {
      state.nativeState = null;
      state.attachments = [];
      renderAttachmentStrip();
      restoreRetry(id);
    }
    if (Array.isArray(session.tools)) {
      const selectable = new Set(selectableTools());
      state.selectedTools = session.tools.filter((id) => selectable.has(id));
      if (!state.selectedTools.length) state.selectedTools = selectableTools();
      saveSelectedTools();
      renderOmpTools();
    }
    renderSessions();
    setSendState();
    const title = $('headerSessionTitle'); if (title) title.textContent = session.title || DEFAULT_SESSION_TITLE;
    const pill = $('headerSessionPill'); if (pill) { pill.title = session.folderName ? `Thư mục: ${session.folderName}` : 'Cuộc trò chuyện hiện tại'; pill.setAttribute('aria-label', `Cuộc trò chuyện hiện tại: ${session.title || id}`); }
    syncWorkspaceMeta(session);
    if (options.deferMessages) {
      hideGreeting();
      if (!quiet) notify(`Đã chọn: ${session.title || id}`);
      return;
    }
    try {
      const messagesRequest = readJson(`${API}/sessions/${encodeURIComponent(id)}/messages`);
      const nativeStateRequest = readJson(`${API}/sessions/${encodeURIComponent(id)}/state`).catch(() => null);
      const [{ payload }, nativeStateResult] = await Promise.all([messagesRequest, nativeStateRequest]);
      if (!isCurrentSession(guard)) return;
      if (nativeStateResult) state.nativeState = dataOf(nativeStateResult.payload, 'nativeState');
      const liveSession = requestsForSession(id).length > 0 || state.startedSessions.has(id) || sessionHasQueuedPrompt(id) || Boolean(state.sessionViews.get(id)?.volatile);
      if (liveSession && (restoredView || previousId === id)) {
        renderMessages(state.messages || []);
        renderSessionRequests(id);
        renderSessionQueuePreviews(id);
        syncGreeting();
        return;
      }
      state.sessionViews.delete(id);
      renderMessages(dataOf(payload, 'messages') || []);
      renderSessionRequests(id);
      renderSessionQueuePreviews(id);
      if (session.isUnread) {
        await readJson(`${API}/sessions/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'read' }) });
        if (!isCurrentSession(guard)) return;
      }
      if (!quiet) notify(`Đã chọn: ${session.title || id}`);
    } catch (error) {
      if (isCurrentSession(guard)) {
        const missingSession = error.status === 404 && (error.code === 'NOT_FOUND' || /session OMP/i.test(error.message));
        if (missingSession) {
          state.sessions = state.sessions.filter((item) => item.id !== id);
          setNeutralSelection({ preserveActiveView: false });
          notify('Cuộc trò chuyện này không còn dữ liệu OMP.', true);
          return;
        }
        renderMessages([]);
        notify(`Không tải được nội dung phiên: ${error.message}`, true);
      }
    } finally {
      if (isCurrentSession(guard)) void loadAgentHub(guard);
    }
  }
  async function createSession(options = {}) {
    if (state.createPromise) return state.createPromise;
    const title = options.title || DEFAULT_SESSION_TITLE;
    const cwd = options.cwd || (!options.folderId ? state.draftWorkspaceCwd : '');
    setNeutralSelection({ preserveDraftPreview: Boolean(state.draftPromptPreview) });
    state.createPromise = (async () => {
      try {
        const { payload } = await readJson(`${API}/sessions`, { method: 'POST', body: JSON.stringify({ title, ...(options.folderId ? { folderId: options.folderId } : {}), ...(cwd ? { cwd } : {}), browserMode: state.browserMode, planYolo: state.planYolo, ...(state.planYolo ? { planYoloModel: state.planYoloModel || state.activeModel } : {}), advisor: state.advisor, approvalMode: state.approvalMode, ...(state.selectedTools.length ? { tools: state.selectedTools } : {}) }) });
        const created = payload?.session || payload;
        if (!created?.id) throw new Error('Backend không trả id session hợp lệ');
        state.sessionLoadRequestId += 1;
        state.sessions = [created, ...state.sessions.filter((item) => item.id !== created.id)];
        renderSessions();
        await loadFolders({ silent: true });
        await selectSession(created.id, true, { deferMessages: true });
        return created;
      } catch (error) {
        notify(`Không tạo được session: ${error.message}`, true);
        return null;
      } finally { state.createPromise = null; }
    })();
    return state.createPromise;
  }
  function setSendState() {
    const button = $('sendBtn'); if (!button) return;
    const request = visibleRequest();
    const running = Boolean(request);
    const stopping = request?.status === 'stopping';
    button.classList.toggle('is-running', running);
    button.textContent = '↑';
    button.title = running ? (stopping ? 'Đang dừng phản hồi' : 'Gửi thêm order · Alt+click để dừng') : 'Gửi order';
    button.setAttribute('aria-label', button.title);
    button.disabled = false;
    renderSessions();
    renderQueueTray();
  }
  async function stopStream() {
    const request = visibleRequest();
    if (!request || request.status === 'stopping') return;
    request.status = 'stopping';
    request.controller.abort();
    setSendState();
    const abortPromise = fetch(`${API}/chat/abort`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: request.requestId, sessionId: request.sessionId }) });
    abortPromise.then((response) => { if (response.status === 202) notify('Đang dừng phản hồi…'); else if (!response.ok) notify(`Không xác nhận được yêu cầu dừng (HTTP ${response.status}).`, true); }).catch(() => notify('Đã gửi yêu cầu dừng; đang chờ stream kết thúc…'));
  }
  async function recoverStreamSession(sessionId, guard) {
    try { await readJson(`${API}/sessions/${encodeURIComponent(sessionId)}/action`, { method: 'POST', body: JSON.stringify({ action: 'reconnect' }) }); if (isCurrentSession(guard)) notify('Đã kết nối lại session sau lỗi stream'); }
    catch { if (isCurrentSession(guard)) notify('Stream đã ngắt; dùng “Kết nối lại session” trong menu nếu cần.', true); }
  }
  async function retryLastPrompt() {
    if (!retryPromptText || !retryContext) return;
    if (activeRequest()) { retryQueued = true; return; }
    if (state.activeId !== retryContext.sessionId) { notify('Không thử lại vào session khác; hãy chọn đúng session lỗi trước.', true); return; }
    const prompt = retryPromptText; const context = retryContext;
    clearRetry(context.sessionId);
    let item = context.queueId ? state.pendingPrompts.find((candidate) => candidate.id === context.queueId) : null;
    if (!item) {
      item = enqueuePrompt(prompt, context.sessionId, { settings: context.settings, attachments: context.attachments });
    }
    if (!item) return;
    item.prompt = prompt;
    item.settings = cloneSnapshot(context.settings);
    item.attachments = cloneSnapshot(context.attachments);
    item.status = 'priority';
    state.pendingPrompts = [item, ...state.pendingPrompts.filter((candidate) => candidate.id !== item.id)];
    resumeQueue(context.sessionId);
    renderQueueTray();
    void drainQueue(context.sessionId);
  }
  function approvalNode(approval, guard, request = null) {
    const card = document.createElement('div');
    card.className = 'approval-card';
    card.dataset.sessionId = guard.sessionId;
    if (request?.requestId) card.dataset.requestId = request.requestId;
    card.dataset.approvalId = approval.id;
    card.dataset.state = 'awaiting';
    const rawTitle = String(approval.title || 'OMP cần xác nhận').trim();
    const parsedTitle = rawTitle.match(/^Allow tool:\s*([^\s]+)(?:\s+Command:\s*([\s\S]*))?$/i);
    const toolName = parsedTitle?.[1] || String(approval.tool || '').trim();
    const commandText = String(approval.command || parsedTitle?.[2] || '').trim();
    const header = document.createElement('div');
    header.className = 'approval-card-header';
    const cardIcon = document.createElement('span');
    cardIcon.className = 'approval-card-icon';
    cardIcon.setAttribute('aria-hidden', 'true');
    const shield = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    shield.setAttribute('viewBox', '0 0 24 24');
    shield.setAttribute('width', '18');
    shield.setAttribute('height', '18');
    shield.setAttribute('fill', 'none');
    shield.setAttribute('stroke', 'currentColor');
    shield.setAttribute('stroke-width', '1.8');
    shield.setAttribute('stroke-linecap', 'round');
    shield.setAttribute('stroke-linejoin', 'round');
    const shieldPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shieldPath.setAttribute('d', 'M12 3 20 6v5c0 4.7-3.4 8.2-8 10-4.6-1.8-8-5.3-8-10V6l8-3Z');
    shield.append(shieldPath);
    cardIcon.append(shield);
    const titleGroup = document.createElement('span');
    titleGroup.className = 'approval-card-title-group';
    const title = document.createElement('strong');
    title.className = 'approval-card-title';
    title.textContent = parsedTitle || approval.tool ? 'Cho phép công cụ' : rawTitle;
    titleGroup.append(title);
    if (toolName) {
      const tool = document.createElement('span');
      tool.className = 'approval-card-tool';
      tool.textContent = toolName;
      titleGroup.append(tool);
    }
    header.append(cardIcon, titleGroup);
    let command = null;
    if (commandText) {
      command = document.createElement('code');
      command.className = 'approval-command';
      command.textContent = commandText;
      command.title = 'Lệnh thực thi';
    }
    const message = document.createElement('div');
    message.className = 'approval-card-message';
    message.setAttribute('aria-live', 'polite');
    message.textContent = approval.message || 'Cho phép OMP tiếp tục?';
    const inputMethod = approval.method === 'input' || approval.method === 'editor';
    const selectMethod = approval.method === 'select';
    let inputControl = null;
    let selectControl = null;
    if (inputMethod) {
      inputControl = approval.method === 'editor' ? document.createElement('textarea') : document.createElement('input');
      inputControl.className = 'approval-input';
      inputControl.value = text(approval.defaultValue);
      inputControl.placeholder = text(approval.placeholder);
      inputControl.setAttribute('aria-label', approval.method === 'editor' ? 'Nội dung cần nhập' : 'Giá trị cần nhập');
      inputControl.rows = approval.method === 'editor' ? 6 : 1;
      inputControl.style.cssText = 'width:100%;margin:10px 0;padding:9px 11px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--fg);font:12px/1.5 var(--font-mono);resize:vertical;';
    } else if (selectMethod) {
      selectControl = document.createElement('select');
      selectControl.className = 'approval-input';
      selectControl.setAttribute('aria-label', 'Lựa chọn cho OMP');
      selectControl.style.cssText = 'width:100%;margin:10px 0;padding:9px 11px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--fg);font:12px/1.5 var(--font-mono);';
      (Array.isArray(approval.options) ? approval.options : []).forEach((option) => {
        const node = document.createElement('option');
        node.value = text(option);
        node.textContent = text(option);
        selectControl.append(node);
      });
    }
    const actions = document.createElement('div');
    actions.className = 'approval-actions';
    const actionIcon = (decision) => {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('width', '16');
      icon.setAttribute('height', '16');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '2');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      const firstPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      firstPath.setAttribute('d', decision === 'approve' ? 'm5 12 4 4L19 6' : 'M6 6l12 12');
      icon.append(firstPath);
      if (decision === 'deny') {
        const secondPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        secondPath.setAttribute('d', 'M18 6 6 18');
        icon.append(secondPath);
      }
      return icon;
    };
    const rawExpiresAt = Number(approval.expiresAt);
    const rawTimeoutMs = Number(approval.timeoutMs);
    const expiresAt = Number.isFinite(rawExpiresAt) && rawExpiresAt > 0
      ? rawExpiresAt
      : Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0 ? Date.now() + rawTimeoutMs : null;
    const countdown = document.createElement('span');
    countdown.className = 'approval-card-countdown';
    countdown.setAttribute('role', 'timer');
    countdown.setAttribute('aria-label', 'Thời gian còn lại để phê duyệt');
    countdown.title = 'Thời gian còn lại để phê duyệt';
    countdown.style.cssText = 'margin-left:auto;padding:4px 8px;border:1px solid var(--border);border-radius:999px;color:var(--accent);background:var(--accent-soft);font-family:var(--font-mono);font-size:11px;font-weight:650;line-height:1.2;white-space:nowrap;';
    let countdownTimer = null;
    const stopCountdown = () => {
      if (countdownTimer === null) return;
      clearInterval(countdownTimer);
      countdownTimer = null;
    };
    const formatCountdown = (remainingMs) => {
      const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
    };
    const markExpired = () => {
      if (card.dataset.state === 'expired') return;
      stopCountdown();
      card.dataset.state = 'expired';
      card.hidden = false;
      card.removeAttribute('aria-hidden');
      card.removeAttribute('aria-busy');
      card.setAttribute('aria-disabled', 'true');
      countdown.dataset.state = 'expired';
      countdown.style.color = 'var(--danger)';
      countdown.style.borderColor = 'var(--danger)';
      countdown.style.background = 'color-mix(in oklab, var(--danger), transparent 90%)';
      countdown.textContent = 'Đã hết thời gian';
      countdown.setAttribute('aria-label', 'Yêu cầu phê duyệt đã hết thời gian');
      inputControl?.setAttribute('disabled', 'true');
      selectControl?.setAttribute('disabled', 'true');
      actions.querySelectorAll('button').forEach((node) => { node.disabled = true; node.setAttribute('aria-disabled', 'true'); });
    };
    const updateCountdown = () => {
      if (expiresAt === null) return;
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        markExpired();
        return;
      }
      const totalSeconds = Math.ceil(remainingMs / 1000);
      const urgent = totalSeconds <= 30;
      countdown.dataset.state = urgent ? 'urgent' : 'active';
      countdown.style.color = urgent ? 'var(--danger)' : 'var(--accent)';
      countdown.style.borderColor = urgent ? 'color-mix(in oklab, var(--danger), var(--border) 35%)' : 'var(--border)';
      countdown.textContent = `Còn ${formatCountdown(remainingMs)}`;
      countdown.setAttribute('aria-label', `Còn ${formatCountdown(remainingMs)} để phê duyệt`);
    };
    const startCountdown = () => {
      if (expiresAt === null || card.dataset.state === 'expired') return;
      stopCountdown();
      updateCountdown();
      if (card.dataset.state !== 'expired') {
        countdownTimer = setInterval(() => {
          if (!card.isConnected) {
            stopCountdown();
            return;
          }
          updateCountdown();
        }, 1000);
      }
    };
    const restoreCard = (errorMessage) => {
      if (/không còn hiệu lực|hết thời gian/i.test(errorMessage)) {
        markExpired();
        return;
      }
      card.hidden = false;
      card.removeAttribute('aria-hidden');
      card.dataset.state = 'error';
      card.removeAttribute('aria-busy');
      card.removeAttribute('aria-disabled');
      inputControl?.removeAttribute('disabled');
      selectControl?.removeAttribute('disabled');
      actions.querySelectorAll('button').forEach((node) => { node.disabled = false; node.removeAttribute('aria-disabled'); });
      startCountdown();
    };
    const submitApproval = async (payload, notice) => {
      if (card.dataset.state === 'pending' || card.dataset.state === 'expired') return;
      stopCountdown();
      inputControl?.setAttribute('disabled', 'true');
      selectControl?.setAttribute('disabled', 'true');
      actions.querySelectorAll('button').forEach((node) => { node.disabled = true; node.setAttribute('aria-disabled', 'true'); });
      card.dataset.state = 'pending';
      card.setAttribute('aria-busy', 'true');
      card.hidden = true;
      card.setAttribute('aria-hidden', 'true');
      notify(notice);
      const scrollArea = $('chatScrollArea');
      if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
      try {
        await readJson(`${API}/sessions/${encodeURIComponent(guard.sessionId)}/approval`, { method: 'POST', body: JSON.stringify({ id: approval.id, ...payload }) });
        if (request?.dom?.approvals) request.dom.approvals = request.dom.approvals.filter((node) => node !== card);
        card.remove();
      } catch (error) {
        const errorMessage = `Không gửi được phản hồi: ${error.message}`;
        if (/không còn hiệu lực|hết thời gian/i.test(error.message)) {
          markExpired();
          notify('Yêu cầu phê duyệt đã hết thời gian.', true);
        } else {
          restoreCard(errorMessage);
          notify(errorMessage, true);
        }
      }
    };
    if (inputMethod) {
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'approval-btn approval-btn-approve';
      submit.textContent = approval.method === 'editor' ? 'Gửi nội dung' : 'Gửi giá trị';
      submit.addEventListener('click', () => void submitApproval({ value: inputControl.value }, 'Đã gửi dữ liệu cho OMP.'));
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'approval-btn approval-btn-deny';
      cancel.textContent = 'Hủy';
      cancel.addEventListener('click', () => void submitApproval({ cancelled: true }, 'Đã hủy yêu cầu nhập.'));
      actions.append(submit, cancel);
    } else if (selectMethod) {
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'approval-btn approval-btn-approve';
      submit.textContent = 'Gửi lựa chọn';
      submit.addEventListener('click', () => void submitApproval({ value: selectControl.value }, 'Đã gửi lựa chọn cho OMP.'));
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'approval-btn approval-btn-deny';
      cancel.textContent = 'Hủy';
      cancel.addEventListener('click', () => void submitApproval({ cancelled: true }, 'Đã hủy yêu cầu lựa chọn.'));
      actions.append(submit, cancel);
    } else {
      ['deny', 'approve'].forEach((decision) => {
        const label = decision === 'approve' ? 'Cho phép' : 'Từ chối';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `approval-btn ${decision === 'approve' ? 'approval-btn-approve' : 'approval-btn-deny'}`;
        button.dataset.decision = decision;
        button.setAttribute('aria-label', label);
        button.append(actionIcon(decision), document.createTextNode(label));
        button.addEventListener('click', () => void submitApproval({ decision }, decision === 'approve' ? 'Đã cho phép OMP tiếp tục.' : 'Đã từ chối yêu cầu.'));
        actions.append(button);
      });
    }
    card.append(header);
    if (expiresAt !== null) {
      card.dataset.expiresAt = String(expiresAt);
      header.append(countdown);
    }
    if (command) card.append(command);
    card.append(message);
    if (inputControl) card.append(inputControl);
    if (selectControl) card.append(selectControl);
    card.append(actions);
    card._resumeCountdown = startCountdown;
    if (expiresAt !== null) startCountdown();
    return card;
  }
  function queueAttachmentSummary(attachments) {
    const names = (attachments || []).map((item) => item.name || item.path || 'tệp').slice(0, 3);
    return names.length ? `${names.join(', ')}${attachments.length > names.length ? ` +${attachments.length - names.length}` : ''}` : 'Không có tệp';
  }
  function queueStatusLabel(queue = {}) {
    if (queue.phase === 'paused') return 'Hàng chờ tạm dừng sau lỗi/lượt bị dừng';
    if (queue.phase === 'safety_cooldown') return `Safety Guard cooldown · còn ${Math.max(0, Number(queue.retryAfterSeconds) || 0)}s`;
    if (queue.phase === 'safety_gap') return `Đang chờ Safety Guard · còn ${Math.max(0, Number(queue.retryAfterSeconds) || 0)}s`;
    if (queue.phase === 'fifo' && Number(queue.queueAhead) > 0) return `Đang chờ lượt trước · còn ${Number(queue.queueAhead)} order phía trước`;
    return 'Đang xử lý';
  }
  const isServerQueuedTurn = (queue) => queue?.phase === 'paused' || (queue?.phase === 'fifo' && Number(queue.queueAhead) > 0);
  const serverQueueItems = (sessionId = state.activeId) => requestsForSession(sessionId).filter((request) => isServerQueuedTurn(request.queueState));
  async function discardServerQueuedRequest(request) {
    if (!request || request.status === 'stopping') return;
    request.status = 'stopping'; renderQueueTray();
    try {
      const response = await fetch(`${API}/chat/abort`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: request.requestId, sessionId: request.sessionId }) });
      if (response.status !== 202) throw new Error(`HTTP ${response.status}`);
      request.controller.abort();
      notify('Đã bỏ order khỏi hàng chờ.');
    } catch (error) {
      request.status = 'running';
      notify(`Không bỏ được order: ${error.message}`, true);
    }
    renderQueueTray();
  }
  async function resumeServerQueue(sessionId) {
    try {
      const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(sessionId)}/action`, { method: 'POST', body: JSON.stringify({ action: 'resume_queue' }) });
      notify(`Đã tiếp tục hàng chờ (${payload?.queuedTurns ?? 0} order).`);
    } catch (error) { notify(`Không thể tiếp tục hàng chờ: ${error.message}`, true); }
    renderQueueTray();
  }
  function reorderLocalQueue(sourceId, targetId, before) {
    const source = state.pendingPrompts.find((item) => item.id === sourceId);
    const target = state.pendingPrompts.find((item) => item.id === targetId);
    if (!source || !target || source.id === target.id || source.sessionId !== target.sessionId) return;
    const group = state.pendingPrompts.filter((item) => item.sessionId === source.sessionId);
    const sourceIndex = group.indexOf(source);
    const targetIndex = group.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0) return;
    group.splice(sourceIndex, 1);
    group.splice(Math.max(0, targetIndex - (sourceIndex < targetIndex ? 1 : 0) + (before ? 0 : 1)), 0, source);
    let index = 0;
    state.pendingPrompts = state.pendingPrompts.map((item) => item.sessionId === source.sessionId ? group[index++] : item);
    renderQueueTray();
    notify('Đã đổi thứ tự hàng chờ web.');
  }
  function renderQueueTray() {
    const tray = $('promptQueueTray'); const list = $('queueItemsList'); if (!tray || !list) return;
    const serverItems = serverQueueItems();
    const localItems = state.pendingPrompts.filter((item) => item.sessionId === state.activeId || (!state.activeId && !item.sessionId));
    const serverPaused = serverItems.some((request) => request.queueState?.phase === 'paused');
    const localPaused = queueIsPaused(state.activeId) || localItems.some((item) => item.status === 'paused');
    const localRequest = activeRequest();
    const visible = serverItems.length > 0 || localItems.length > 0 || localPaused;
    tray.hidden = !visible; tray.style.display = visible ? '' : 'none'; list.replaceChildren();
    const banner = $('queueStatusBanner');
    if (banner) {
      const bannerText = document.createElement('span');
      bannerText.className = 'queue-status-banner-text';
      bannerText.textContent = serverPaused ? 'Hàng chờ server tạm dừng sau lỗi/lượt bị dừng' : localPaused ? 'Hàng chờ web tạm dừng sau lỗi/lượt bị dừng' : localRequest && localItems.length ? `Đang gửi lên OMP · ${localItems.length} lượt đang chờ web` : localItems.length ? 'Hàng chờ web' : 'Hàng chờ server FIFO của chat này';
      const bannerLeft = document.createElement('div');
      bannerLeft.className = 'queue-status-banner-left';
      bannerLeft.append(bannerText);
      const bannerCount = document.createElement('span');
      bannerCount.className = 'queue-count-tag';
      bannerCount.textContent = `${serverItems.length + localItems.length} order`;
      const bannerRight = document.createElement('div');
      bannerRight.className = 'queue-status-banner-right';
      bannerRight.append(bannerCount);
      if (serverPaused && state.activeId) {
        const resume = document.createElement('button'); resume.type = 'button'; resume.className = 'btn-queue-steer'; resume.textContent = 'Tiếp tục hàng chờ'; resume.setAttribute('aria-label', 'Tiếp tục hàng chờ'); resume.addEventListener('click', () => void resumeServerQueue(state.activeId)); bannerRight.append(resume);
      }
      banner.replaceChildren(bannerLeft, bannerRight);
    }
    const count = $('queueCountBadge'); if (count) count.textContent = `${serverItems.length + localItems.length} order đang chờ`;
    serverItems.forEach((request, index) => {
      const queue = request.queueState || {};
      const row = document.createElement('div'); row.className = 'queue-turn-row'; row.dataset.queueId = request.requestId; row.dataset.queueStatus = queue.phase || 'queued'; row.setAttribute('aria-label', `Order ${index + 1}: ${request.prompt}. ${queueStatusLabel(queue)}`);
      const content = document.createElement('div'); content.className = 'queue-turn-content';
      const prompt = document.createElement('div'); prompt.className = 'queue-turn-text'; prompt.textContent = request.prompt; prompt.title = request.prompt;
      const meta = document.createElement('div'); meta.className = 'queue-turn-meta'; meta.textContent = queueStatusLabel(queue); meta.title = `${queueStatusLabel(queue)} · ${queue.queuedTurns || serverItems.length} order đang chờ`;
      content.append(prompt, meta);
      const actions = document.createElement('div'); actions.className = 'queue-turn-actions';
      const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'btn-queue-inline-cancel'; discard.textContent = 'Bỏ'; discard.setAttribute('aria-label', `Bỏ order ${index + 1}`); discard.addEventListener('click', () => void discardServerQueuedRequest(request));
      actions.append(discard); row.append(content, actions); list.append(row);
    });
    localItems.forEach((item, index) => {
      const settings = item.settings || {};
      const attachments = item.attachments || [];
      const statusLabel = { queued: 'Đang chờ web', priority: 'Đang được ưu tiên', paused: 'Tạm dừng sau lỗi', editing: 'Đang chỉnh sửa', running: 'Đang gửi lên OMP' }[item.status] || item.status || 'Đang chờ web';
      const sessionLabel = item.sessionId || 'đang tạo session…';
      const technicalMeta = `Session ${sessionLabel} · ${item.status || 'queued'} · ${settings.model || 'model mặc định'} · ${settings.thinking || 'mặc định'} · browser ${settings.browserMode || 'mặc định'} · plan-yolo ${settings.planYolo ? 'on' : 'off'} · approval ${settings.approvalMode || 'mặc định'} · tools ${(settings.tools || []).length} · tệp: ${queueAttachmentSummary(attachments)}`;
      const row = document.createElement('div');
      row.className = 'queue-turn-row';
      row.dataset.queueId = item.id;
      row.dataset.queueStatus = item.status || 'queued';
      row.setAttribute('aria-label', `Order ${index + 1}: ${item.prompt}. ${technicalMeta}`);
      const content = document.createElement('div'); content.className = 'queue-turn-content';
      const prompt = document.createElement('div'); prompt.className = 'queue-turn-text'; prompt.textContent = item.prompt; prompt.title = item.prompt;
      const meta = document.createElement('div'); meta.className = 'queue-turn-meta'; meta.textContent = `${statusLabel}${attachments.length ? ` · ${attachments.length} tệp` : ''}`; meta.title = technicalMeta;
      const previews = document.createElement('div'); previews.className = 'queue-attachment-previews';
      attachments.forEach((attachment) => {
        const label = document.createElement('span'); label.className = 'queue-attachment-label'; label.textContent = attachment.name || attachment.path || 'tệp'; label.title = `${attachment.name || attachment.path || 'tệp'} · ${Math.ceil((attachment.size || 0) / 1024)} KB`; previews.append(label);
        if (text(attachment.type).startsWith('image/') && attachment.data) { const img = document.createElement('img'); img.src = attachment.data; img.alt = attachment.name || 'Xem trước ảnh'; img.className = 'queue-attachment-thumb'; previews.append(img); }
      });
      content.append(prompt, meta); if (attachments.length) content.append(previews);
      const actions = document.createElement('div'); actions.className = 'queue-turn-actions';
      const order = serverItems.length + index + 1;
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn-queue-inline-save'; edit.textContent = 'Sửa'; edit.setAttribute('aria-label', `Sửa order ${order}`); edit.addEventListener('click', () => editQueuedPrompt(item));
      const send = document.createElement('button'); send.type = 'button'; send.className = 'btn-queue-steer'; send.textContent = item.status === 'priority' ? 'Đã ưu tiên' : 'Gửi ngay'; send.disabled = item.status === 'editing' || item.status === 'priority'; send.addEventListener('click', () => void sendQueuedPrompt(item));
      const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'btn-queue-icon-action btn-queue-trash'; discard.textContent = '×'; discard.title = 'Bỏ order'; discard.setAttribute('aria-label', `Bỏ order ${order}`); discard.addEventListener('click', () => discardQueuedPrompt(item.id));
      actions.append(edit, send, discard); row.append(content, actions); list.append(row);
      const draggable = ['queued', 'paused'].includes(item.status);
      row.draggable = draggable;
      if (draggable) {
        row.addEventListener('dragstart', (event) => { row.classList.add('is-dragging'); event.dataTransfer?.setData('text/plain', item.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; });
        row.addEventListener('dragend', () => { row.classList.remove('is-dragging'); list.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach((node) => node.classList.remove('drag-over-top', 'drag-over-bottom')); });
        row.addEventListener('dragover', (event) => { if (item.sessionId !== state.pendingPrompts.find((candidate) => candidate.id === item.id)?.sessionId) return; event.preventDefault(); const rect = row.getBoundingClientRect(); row.classList.toggle('drag-over-top', event.clientY < rect.top + rect.height / 2); row.classList.toggle('drag-over-bottom', event.clientY >= rect.top + rect.height / 2); });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over-top', 'drag-over-bottom'));
        row.addEventListener('drop', (event) => { event.preventDefault(); const sourceId = event.dataTransfer?.getData('text/plain'); const before = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2; row.classList.remove('drag-over-top', 'drag-over-bottom'); reorderLocalQueue(sourceId, item.id, before); });
      }
    });
  }
  function renderQueuedPreview(item) {
    if (!item?.sessionId) return;
    const message = { role: 'user', content: item.prompt, createdAt: item.createdAt, attachments: cloneSnapshot(item.attachments), queueId: item.id };
    const append = (messages) => (messages || []).some((candidate) => candidate.queueId === item.id) ? messages : [...(messages || []), message];
    if (state.activeId === item.sessionId) {
      if (!state.messages.some((candidate) => candidate.queueId === item.id)) state.messages = append(state.messages);
      const stream = $('chatStream');
      if (stream && ![...(stream.children || [])].some((node) => node.dataset.queuePreviewId === item.id)) stream.append(messageNode(message));
    } else {
      const view = state.sessionViews.get(item.sessionId) || { messages: [], transientNodes: [], volatile: true, scrollTop: 0 };
      view.messages = append(view.messages);
      view.volatile = true;
      state.sessionViews.set(item.sessionId, view);
    }
    item.previewRendered = true;
    syncGreeting();
  }
  function updateQueuedPreview(item) {
    const message = { role: 'user', content: item.prompt, createdAt: item.createdAt, attachments: cloneSnapshot(item.attachments), queueId: item.id };
    if (state.activeId === item.sessionId) {
      state.messages = state.messages.map((candidate) => candidate.queueId === item.id ? message : candidate);
      const stream = $('chatStream');
      const node = [...(stream?.children || [])].find((candidate) => candidate.dataset.queuePreviewId === item.id);
      if (node) node.replaceWith(messageNode(message));
      else renderQueuedPreview(item);
    } else if (item.sessionId) {
      const view = state.sessionViews.get(item.sessionId) || { messages: [], transientNodes: [], volatile: true, scrollTop: 0 };
      view.messages = (view.messages || []).map((candidate) => candidate.queueId === item.id ? message : candidate);
      view.volatile = true;
      state.sessionViews.set(item.sessionId, view);
    }
    item.previewRendered = true;
    syncGreeting();
  }
  function renderDraftPromptPreview(prompt, attachments, draftId) {
    const message = { role: 'user', content: prompt, createdAt: new Date().toISOString(), attachments: cloneSnapshot(attachments), draftId };
    state.draftPromptPreview = message;
    state.messages = [message];
    const stream = $('chatStream');
    stream?.replaceChildren(messageNode(message));
    hideGreeting();
    syncGreeting();
  }
  function removeDraftPromptPreview() {
    const draftId = state.draftPromptPreview?.draftId;
    if (!draftId) return;
    [...($('chatStream')?.children || [])].filter((node) => node.dataset.draftPreviewId === draftId).forEach((node) => node.remove());
    state.messages = state.messages.filter((message) => message.draftId !== draftId);
    state.draftPromptPreview = null;
    syncGreeting();
  }
  function renderSessionQueuePreviews(sessionId) {
    if (state.activeId !== sessionId) return;
    state.pendingPrompts.filter((item) => item.sessionId === sessionId).forEach(renderQueuedPreview);
  }
  function removeQueuedPreview(item) {
    const clearCachedPreview = () => {
      if (!item.sessionId) return;
      const view = state.sessionViews.get(item.sessionId);
      if (!view) return;
      view.messages = (view.messages || []).filter((message) => message.queueId !== item.id && message.requestId !== item.lastRequestId);
      view.volatile = Boolean(
        requestsForSession(item.sessionId).length
        || state.startedSessions.has(item.sessionId)
        || state.pendingPrompts.some((candidate) => candidate.id !== item.id && candidate.sessionId === item.sessionId)
        || view.transientNodes?.length,
      );
      state.sessionViews.set(item.sessionId, view);
    };
    if (item.sessionId && item.sessionId !== state.activeId) {
      clearCachedPreview();
      item.previewRendered = false;
      return;
    }
    const stream = $('chatStream');
    [...(stream?.children || [])].filter((node) => node.dataset.queuePreviewId === item.id || node.dataset.requestId === item.lastRequestId).forEach((node) => node.remove());
    state.messages = state.messages.filter((message) => message.queueId !== item.id && message.requestId !== item.lastRequestId);
    clearCachedPreview();
    item.previewRendered = false;
    syncGreeting();
  }
  function enqueuePrompt(prompt, sessionId = null, options = {}) {
    if (state.pendingPrompts.filter((item) => item.sessionId === sessionId).length >= MAX_WEB_PENDING_PROMPTS) { notify(`Hàng chờ tối đa ${MAX_WEB_PENDING_PROMPTS} order cho chat này.`, true); return null; }
    const item = { id: nextRequestId('queue'), prompt, sessionId, status: 'queued', createdAt: new Date().toISOString(), attachments: cloneSnapshot(options.attachments ?? state.attachments), settings: cloneSnapshot(options.settings ?? snapshotSettings()), previewRendered: false };
    state.pendingPrompts.push(item);
    if (!options.deferPreview) renderQueuedPreview(item);
    renderQueueTray();
    notify(`Đã nhận lượt thứ ${state.pendingPrompts.filter((candidate) => candidate.sessionId === sessionId).length} vào hàng chờ web`);
    return item;
  }
  function discardQueuedPrompt(id) {
    const item = state.pendingPrompts.find((candidate) => candidate.id === id);
    if (item) removeQueuedPreview(item);
    state.pendingPrompts = state.pendingPrompts.filter((candidate) => candidate.id !== id);
    renderQueueTray();
  }
  function editQueuedPrompt(item) {
    if (item.sessionId && state.activeId !== item.sessionId) { notify('Không sửa order sang session khác; hãy chọn đúng session trước.', true); return; }
    const input = $('chatInput'); if (!input) return;
    state.editingQueueId = item.id;
    item.status = 'editing';
    input.value = item.prompt;
    state.attachments = cloneSnapshot(item.attachments || []);
    renderAttachmentStrip();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    renderQueueTray(); notify('Đang sửa order; gửi lại sẽ giữ nguyên vị trí. Nhấn Esc để hủy.');
  }
  function cancelQueueEdit(silent = false) {
    if (!state.editingQueueId) return false;
    const item = state.pendingPrompts.find((candidate) => candidate.id === state.editingQueueId);
    if (item) item.status = 'queued';
    state.editingQueueId = null;
    const input = $('chatInput');
    if (input) input.value = '';
    state.attachments = [];
    renderAttachmentStrip();
    renderQueueTray();
    if (!silent) notify('Đã hủy sửa order.');
    return true;
  }
  function attachUnboundPrompts(sessionId) {
    const items = state.pendingPrompts.filter((candidate) => !candidate.sessionId);
    items.forEach((item) => {
      item.sessionId = sessionId;
      item.status = 'queued';
      item.previewRendered = false;
    });
    return items;
  }
  async function ensureQueuedSession(item) {
    if (item.sessionId) { void drainQueue(item.sessionId); return true; }
    const created = await createSession({ title: deriveSessionTitle(item.prompt) || DEFAULT_SESSION_TITLE });
    if (!created?.id) return false;
    attachUnboundPrompts(created.id);
    resumeQueue(created.id);
    state.pendingPrompts.filter((candidate) => candidate.sessionId === created.id).forEach(renderQueuedPreview);
    renderQueueTray();
    void drainQueue(created.id);
    return true;
  }
  async function startInitialPrompt(prompt, settings, attachments, draftId) {
    const created = await createSession({ title: deriveSessionTitle(prompt) || DEFAULT_SESSION_TITLE });
    if (!created?.id) {
      removeDraftPromptPreview();
      state.pendingPrompts.forEach((item) => { if (!item.sessionId) item.status = 'paused'; });
      if (state.pendingPrompts.some((item) => !item.sessionId)) pauseQueue(null, 'session_create_failed');
      renderQueueTray();
      const input = $('chatInput');
      if (input && !input.value) { input.value = prompt; input.focus(); }
      return false;
    }
    const queued = attachUnboundPrompts(created.id);
    resumeQueue(created.id);
    renderQueueTray();
    void startPrompt(prompt, created.id, settings, attachments, { draftId });
    queued.forEach(renderQueuedPreview);
    return true;
  }
  async function sendQueuedPrompt(item) {
    if (!item.sessionId) { void ensureQueuedSession(item); return; }
    const sessionItems = state.pendingPrompts.filter((candidate) => candidate.sessionId === item.sessionId);
    const itemIndex = state.pendingPrompts.indexOf(item);
    const sessionFirstIndex = state.pendingPrompts.findIndex((candidate) => candidate.sessionId === item.sessionId);
    if (itemIndex >= 0 && itemIndex !== sessionFirstIndex) {
      state.pendingPrompts.splice(itemIndex, 1);
      state.pendingPrompts.splice(sessionFirstIndex < 0 ? state.pendingPrompts.length : sessionFirstIndex, 0, item);
    }
    item.status = 'priority';
    resumeQueue(item.sessionId);
    renderQueueTray();
    notify(sessionItems.length > 1 ? 'Đã ưu tiên order; sẽ gửi ngay sau lượt đang chạy.' : 'Đã ưu tiên order.');
    void drainQueue(item.sessionId);
  }
  async function drainQueue(sessionId) {
    if (state.queueDrainingSessions.has(sessionId) || queueIsPaused(sessionId) || requestsForSession(sessionId).length) return;
    const item = state.pendingPrompts.find((candidate) => candidate.sessionId === sessionId);
    if (!item) { renderQueueTray(); return; }
    state.queueDrainingSessions.add(sessionId);
    const originalIndex = state.pendingPrompts.indexOf(item);
    item.status = 'running';
    state.pendingPrompts = state.pendingPrompts.filter((candidate) => candidate.id !== item.id);
    renderQueueTray();
    const normal = await startPrompt(item.prompt, item.sessionId, item.settings, item.attachments, { fromQueue: true, item });
    state.queueDrainingSessions.delete(sessionId);
    if (!normal) {
      item.status = 'paused';
      if (!state.pendingPrompts.some((candidate) => candidate.id === item.id)) state.pendingPrompts.splice(Math.min(originalIndex, state.pendingPrompts.length), 0, item);
      pauseQueue(sessionId, 'previous_turn_failed');
    }
    if (normal && !queueIsPaused(sessionId)) void drainQueue(sessionId);
    else renderQueueTray();
  }
  async function startPrompt(prompt, sessionId, settings = snapshotSettings(), attachments = [], options = {}) {
    const model = settings.model || state.activeModel;
    const modelSource = settings.modelSource || state.modelSource;
    const modelProvider = settings.modelProvider || (model === state.activeModel ? state.activeModelProvider : null);
    const accessError = modelAccessError(model, modelSource, modelProvider);
    if (accessError) { if (options.draftId) removeDraftPromptPreview(); notify(accessError, true); return false; }
    const capabilityError = imageGenerationModelError(prompt, model, modelProvider);
    if (capabilityError) { if (options.draftId) removeDraftPromptPreview(); notify(capabilityError, true); return false; }
    const guard = sessionGuard(sessionId, state.generation);
    const request = { sessionId, requestId: nextRequestId(), controller: new AbortController(), status: 'running', guard, settings: cloneSnapshot({ ...settings, model, modelProvider, modelSource }), prompt, attachments: cloneSnapshot(attachments), createdAt: new Date().toISOString(), mounted: false, queueState: { phase: 'fifo', queueAhead: 0, queuedTurns: 0, retryAfterSeconds: 0 }, queueStateReceived: false, dom: null };
    if (options.item) options.item.lastRequestId = request.requestId;
    const visibleStream = () => isCurrentSession(guard) ? $('chatStream') : null;
    state.requests.set(request.requestId, request);
    syncRequestAliases();
    setSendState();
    if (isCurrentSession(guard)) hideGreeting();
    state.startedSessions.add(sessionId);
    autoTitleSession(sessionId, prompt);
    const queueItem = options.item;
    const wrap = document.createElement('div');
    wrap.className = 'ai-response-wrap';
    wrap.dataset.requestId = request.requestId;
    const status = document.createElement('div');
    status.className = 'chat-status-row';
    const label = document.createElement('div');
    label.className = 'chat-status-text chat-loading-status';
    label.setAttribute('role', 'status');
    label.setAttribute('aria-live', 'polite');
    const setStreamStatus = (message, phase = 'done') => {
      label.textContent = text(message);
      label.dataset.status = phase;
      label.classList.toggle('is-loading', ['thinking', 'writing', 'tool', 'waiting', 'finalizing'].includes(phase));
    };
    setStreamStatus('Đang suy nghĩ', 'thinking');
    const line = document.createElement('div');
    line.className = 'chat-status-line';
    status.append(label, line);
    const card = document.createElement('div');
    card.className = 'ai-message-card';
    const bodyNode = document.createElement('div');
    bodyNode.className = 'chat-body-toggles';
    bodyNode.hidden = true;
    bodyNode.setAttribute('aria-label', 'Hoạt động Terminal OMP');
    const fileChangesNode = document.createElement('div'); fileChangesNode.className = 'message-file-changes'; fileChangesNode.hidden = true;
    const replyNode = document.createElement('div');
    replyNode.className = 'chat-markdown';
    replyNode.dataset.streaming = 'true';
    const mediaNode = document.createElement('div');
    mediaNode.className = 'production-stream-attachments';
    let streamedText = '';
    let streamedAttachments = [];
    let streamedBody = [];
    let completionPayload = null;
    const pushBodyBlock = (block) => {
      streamedBody = upsertBodyBlock(streamedBody, block);
      renderBodyBlocks(bodyNode, streamedBody);
      renderFileChangeCard(fileChangesNode, streamedBody);
      syncFileChangeFloatingBar([...state.messages, { role: 'assistant', body: streamedBody }]);
    };
    card.append(bodyNode, fileChangesNode, replyNode, mediaNode);
    wrap.append(status, card);
    request.dom = { wrap, bodyNode, replyNode, mediaNode, card, label, approvals: [] };
    const mountChatTurn = () => {
      if (request.mounted) return;
      request.mounted = true;
      const stream = visibleStream();
      const preview = queueItem
        ? [...(stream?.children || [])].find((node) => node.dataset.queuePreviewId === queueItem.id)
        : options.draftId ? [...(stream?.children || [])].find((node) => node.dataset.draftPreviewId === options.draftId) : null;
      const user = { role: 'user', content: prompt, requestId: request.requestId, createdAt: request.createdAt, attachments: cloneSnapshot(attachments), ...(queueItem ? { queueId: queueItem.id } : {}) };
      if (isCurrentSession(guard)) {
        state.messages = replaceQueuedUserMessage(state.messages, queueItem?.id, user, options.draftId);
        if (options.draftId && state.draftPromptPreview?.draftId === options.draftId) state.draftPromptPreview = null;
        const userNode = messageNode(user);
        if (preview) {
          preview.replaceWith(userNode);
        } else {
          const firstQueuedPreview = [...(stream?.children || [])].find((node) => node.dataset.queuePreviewId);
          if (firstQueuedPreview) firstQueuedPreview.before(userNode); else stream?.append(userNode);
        }
        userNode.after(wrap);
      } else {
        const view = state.sessionViews.get(sessionId) || { messages: [], transientNodes: [], volatile: true, scrollTop: 0 };
        view.messages = replaceQueuedUserMessage(view.messages, queueItem?.id, user, options.draftId);
        view.volatile = true;
        state.sessionViews.set(sessionId, view);
      }
    };
    mountChatTurn();
    setStreamStatus('Đang gửi lên OMP…', 'waiting');
    let normalEnd = false;
    try {
      const response = await fetch(`${API}/chat/stream`, { method: 'POST', headers: { Accept: 'text/event-stream', 'content-type': 'application/json' }, signal: request.controller.signal, body: JSON.stringify({ sessionId, prompt, model, modelProvider, modelSource, requestId: request.requestId, thinking: settings.thinking, browserMode: settings.browserMode, approvalMode: settings.approvalMode, tools: settings.tools?.length ? settings.tools : undefined, attachments }) });
      if (!response.ok || !response.body) {
        let payload;
        try { payload = await response.json(); } catch {}
        throw new Error(payload?.error?.message || payload?.message || `Stream HTTP ${response.status}`);
      }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let done = false;
      const setBodyLoadingStatus = (block) => {
        if (text(block?.status) !== 'running') return;
        const kind = text(block?.kind);
        if (kind === 'approval') return setStreamStatus('Đang chờ Síp xác nhận', 'waiting');
        if (kind === 'thinking') return setStreamStatus('Đang suy nghĩ', 'thinking');
        if (kind === 'tool') return setStreamStatus(`Đang dùng ${text(block.toolName || 'công cụ')}`, 'tool');
        if (kind === 'compaction') return setStreamStatus('Đang tối ưu ngữ cảnh', 'tool');
        if (kind === 'retry') return setStreamStatus('Đang thử lại', 'thinking');
        if (kind === 'todo') return setStreamStatus('Đang cập nhật công việc', 'thinking');
        setStreamStatus('Đang xử lý', 'thinking');
      };
      const consume = (block) => {
        let event = 'message'; const parts = [];
        block.split(/\r?\n/).forEach((line) => { if (line.startsWith('event:')) event = line.slice(6).trim(); if (line.startsWith('data:')) parts.push(line.slice(5).trimStart()); });
        if (!parts.length) return;
        let payload; try { payload = JSON.parse(parts.join('\n')); } catch { payload = { content: parts.join('\n') }; }
        if (isServerQueuedTurn(request.queueState) && !['waiting', 'end', 'done', 'error'].includes(event)) return;
        if (event === 'error') throw new Error(payload.message || 'Backend stream báo lỗi');
        if (event === 'start' && (payload.longRunning || payload.imageModelAutoSelected)) {
          const timeout = Number(payload.activityTimeoutSeconds) || 300;
          const imageModel = payload.imageModelAutoSelected ? `Đang tạo ảnh bằng ${text(payload.model)} · ` : '';
          setStreamStatus(`${imageModel}tác vụ dài · tự gia hạn khi OMP hoạt động (${timeout}s)`, 'thinking');
          return;
        }
        if (event === 'end' || event === 'done') {
          done = true;
          normalEnd = true;
          completionPayload = payload;
          if (!payload.aborted) mountChatTurn();
          if (Array.isArray(payload.body)) payload.body.forEach(pushBodyBlock);
          renderFileChangeCard(fileChangesNode, streamedBody, payload.fileChanges);
          setStreamStatus(payload.totalDuration ? `Đã hoàn tất · ${payload.totalDuration}` : 'Đã hoàn tất', 'done');
        }
        if (event === 'body' && payload.block) {
          mountChatTurn();
          setBodyLoadingStatus(payload.block);
          pushBodyBlock(payload.block);
          if (isCurrentSession(guard) && $('chatScrollArea')) $('chatScrollArea').scrollTop = $('chatScrollArea').scrollHeight;
          return;
        }
        if (event === 'waiting') {
          request.queueState = { phase: payload.phase || 'fifo', queueAhead: Number(payload.queueAhead) || 0, queuedTurns: Number(payload.queuedTurns) || 0, retryAfterSeconds: Number(payload.retryAfterSeconds) || 0, reason: payload.reason || null };
          request.queueStateReceived = true;
          if (isServerQueuedTurn(request.queueState)) {
            renderQueueTray();
            return;
          }
          mountChatTurn();
          setStreamStatus(queueStatusLabel(request.queueState), request.queueState.phase === 'paused' ? 'paused' : 'waiting');
          renderQueueTray();
          return;
        }
        if (event === 'approval') {
          mountChatTurn();
          setStreamStatus('Đang chờ Síp xác nhận', 'waiting');
          const approval = approvalNode(payload, guard, request);
          request.dom.approvals.push(approval);
          visibleStream()?.append(approval);
          if (isCurrentSession(guard) && $('chatScrollArea')) $('chatScrollArea').scrollTop = $('chatScrollArea').scrollHeight;
          return;
        }
        if (event === 'command_output') {
          mountChatTurn();
          if (payload.bodyBlockId && streamedBody.some((block) => block.id === payload.bodyBlockId)) return;
          pushBodyBlock({ id: payload.bodyBlockId || `command:${streamedBody.length}`, kind: 'command', title: 'Command output', status: 'done', command: payload.command, text: `${payload.command ? `$ ${payload.command}\n` : ''}${text(payload.text)}` });
          if (isCurrentSession(guard) && $('chatScrollArea')) $('chatScrollArea').scrollTop = $('chatScrollArea').scrollHeight;
          return;
        }
        if (event === 'prompt_result') {
          setStreamStatus(payload.agentInvoked === false ? 'Lệnh OMP đã hoàn tất' : 'Đang xếp lượt tiếp theo', payload.agentInvoked === false ? 'done' : 'finalizing');
          return;
        }
        if (event === 'lifecycle' && ['turn_start', 'agent_start'].includes(payload.type)) {
          mountChatTurn();
          request.queueState = null;
          setStreamStatus('Đang xử lý', 'thinking');
          renderQueueTray();
          return;
        }
        if (event === 'lifecycle' && payload.type === 'agent_end' && payload.isTerminal === false) {
          setStreamStatus('Đang hoàn tất tác vụ nền', 'finalizing');
          return;
        }
        if (event === 'media' || Array.isArray(payload.attachments)) {
          streamedAttachments = mergeAttachmentItems(streamedAttachments, payload.attachments);
          mediaNode.replaceChildren();
          renderMessageAttachments(mediaNode, streamedAttachments);
        }
        const delta = payload.content || payload.delta || payload.chunk || '';
        if (delta) { mountChatTurn(); request.queueState = null; setStreamStatus('Đang viết phản hồi', 'writing'); renderQueueTray(); streamedText += text(delta); renderSafeMarkdown(replyNode, streamedText); if (isCurrentSession(guard) && $('chatScrollArea')) $('chatScrollArea').scrollTop = $('chatScrollArea').scrollHeight; }
      };
      while (true) {
        const part = await reader.read();
        buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
        let boundary;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
          consume(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
        }
        if (part.done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (!done) throw new Error('Kết nối stream đóng trước khi hoàn tất');
      const completedAssistant = {
        role: 'assistant',
        requestId: request.requestId,
        content: streamedText,
        createdAt: new Date().toISOString(),
        model: completionPayload?.model || model,
        ...(completionPayload?.totalDuration ? { totalDuration: completionPayload.totalDuration } : {}),
        ...(completionPayload?.totalTokens ? { totalTokens: completionPayload.totalTokens } : {}),
        ...(streamedBody.length ? { body: cloneSnapshot(streamedBody) } : {}),
        ...(streamedAttachments.length ? { attachments: cloneSnapshot(streamedAttachments) } : {}),
        ...(completionPayload?.fileChanges ? { fileChanges: cloneSnapshot(completionPayload.fileChanges) } : {}),
      };
      if (streamedText || streamedBody.length || streamedAttachments.length || completedAssistant.fileChanges) {
        if (isCurrentSession(guard)) state.messages = upsertAssistantMessage(state.messages, request.requestId, completedAssistant);
        else {
          const view = state.sessionViews.get(sessionId) || { messages: [], transientNodes: [], volatile: true, scrollTop: 0 };
          view.messages = upsertAssistantMessage(view.messages, request.requestId, completedAssistant);
          view.volatile = true;
          state.sessionViews.set(sessionId, view);
        }
        if (request.dom?.card && !request.dom.card.querySelector('.msg-actions')) request.dom.card.append(messageActionsNode(completedAssistant));
        if (isCurrentSession(guard)) syncFileChangeFloatingBar(state.messages);
      }
      await loadSessions(null, { silent: true }); if (isCurrentSession(guard)) notify('Đã nhận xong phản hồi');
    } catch (error) {
      if (request.controller.signal.aborted) {
        if (isCurrentSession(guard)) setStreamStatus('Đã dừng phản hồi', 'done');
      } else {
        if (!request.queueStateReceived || !isServerQueuedTurn(request.queueState)) mountChatTurn();
        request.status = 'error';
        const errorText = String(error.message || error);
        const timedOut = /thời gian cho phép|timeout|timed out/i.test(errorText);
        request.errorText = errorText;
        const nextRetryContext = { sessionId, generation: guard.generation, settings: cloneSnapshot(request.settings), attachments: cloneSnapshot(attachments), queueId: options.item?.id || null };
        state.retryBySession.set(sessionId, { prompt, context: nextRetryContext });
        if (isCurrentSession(guard)) {
          retryPromptText = prompt;
          retryContext = nextRetryContext;
        }
        renderSafeMarkdown(replyNode, `Không nhận được phản hồi: ${errorText}`);
        setStreamStatus(timedOut ? 'Hết thời gian phản hồi' : 'Stream lỗi', 'error');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'chat-retry-btn';
        retry.textContent = timedOut ? 'Gửi lại' : 'Thử lại';
        retry.setAttribute('aria-label', timedOut ? 'Gửi lại lượt chat' : 'Thử lại lượt chat');
        retry.addEventListener('click', () => { retry.disabled = true; retry.textContent = 'Đang gửi lại…'; void retryLastPrompt(); });
        card.append(retry);
        visibleStream()?.querySelectorAll('.approval-card').forEach((node) => { if (node.dataset.sessionId === sessionId) node.remove(); });
        const errorView = state.sessionViews.get(sessionId) || { messages: isCurrentSession(guard) ? cloneSnapshot(state.messages) : [] };
        errorView.transientNodes = [...new Set([...(errorView.transientNodes || []), request.dom?.wrap, ...(request.dom?.approvals || [])].filter(Boolean))];
        errorView.volatile = true;
        state.sessionViews.set(sessionId, errorView);
        if (isCurrentSession(guard)) {
          notify(timedOut ? 'Lượt chat hết thời gian; bạn có thể gửi lại.' : `Stream lỗi: ${errorText}`, true);
          const scrollArea = $('chatScrollArea');
          if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
        }
        void recoverStreamSession(sessionId, guard);
      }
    } finally {
      request.status = normalEnd ? 'done' : (request.controller.signal.aborted ? 'stopped' : 'error');
      state.requests.delete(request.requestId);
      syncRequestAliases();
      if (!requestsForSession(sessionId).length) {
        state.startedSessions.delete(sessionId);
        if (normalEnd && !sessionHasQueuedPrompt(sessionId)) state.sessionViews.delete(sessionId);
      }
      if (normalEnd && retryQueued && retryPromptText && retryContext && !activeRequest()) { retryQueued = false; setTimeout(() => void retryLastPrompt(), 0); }
      if (!normalEnd && sessionHasQueuedPrompt(sessionId)) pauseQueue(sessionId, request.controller.signal.aborted ? 'previous_turn_stopped' : 'previous_turn_failed');
      renderQueueTray();
      setSendState();
      if (normalEnd && !state.queueDrainingSessions.has(sessionId)) queueMicrotask(() => void drainQueue(sessionId));
    }
    return normalEnd;
  }
  async function sendPrompt() {
    if (voiceRecognition) await stopVoiceInput();
    const input = $('chatInput'); const prompt = text(input?.value).trim();
    if (!prompt) { notify('Vui lòng nhập nội dung trước khi gửi.', true); return; }
    if (state.activeId) {
      const promptSettings = snapshotSettings();
      const accessError = modelAccessError(promptSettings.model, promptSettings.modelSource, promptSettings.modelProvider);
      if (accessError) { notify(accessError, true); return; }
      const capabilityError = imageGenerationModelError(prompt, promptSettings.model, promptSettings.modelProvider);
      if (capabilityError) { notify(capabilityError, true); return; }
    }
    const editingQueueId = state.editingQueueId;
    clearRetry(state.activeId);
    const attachments = state.attachments.splice(0);
    const settings = snapshotSettings();
    input.value = '';
    renderAttachmentStrip();
    if (editingQueueId) {
      const item = state.pendingPrompts.find((candidate) => candidate.id === editingQueueId);
      state.editingQueueId = null;
      if (item) {
        item.prompt = prompt;
        item.attachments = cloneSnapshot(attachments);
        item.settings = cloneSnapshot(settings);
        item.status = 'queued';
        updateQueuedPreview(item);
        renderQueueTray();
        notify('Đã cập nhật order trong hàng chờ.');
        if (item.sessionId && !requestsForSession(item.sessionId).length && !queueIsPaused(item.sessionId)) void drainQueue(item.sessionId);
        return;
      }
    }
    if (!state.activeId) {
      if (firstPromptPromise) {
        enqueuePrompt(prompt, null, { settings, attachments });
        return;
      }
      const draftId = nextRequestId('draft');
      renderDraftPromptPreview(prompt, attachments, draftId);
      firstPromptPromise = startInitialPrompt(prompt, settings, attachments, draftId).finally(() => { firstPromptPromise = null; });
      return;
    }
    const sessionId = state.activeId;
    if (requestsForSession(sessionId).length || state.queueDrainingSessions.has(sessionId) || sessionHasQueuedPrompt(sessionId) || queueIsPaused(sessionId)) {
      const item = enqueuePrompt(prompt, sessionId, { settings, attachments });
      if (item && !requestsForSession(sessionId).length && !queueIsPaused(sessionId)) void drainQueue(sessionId);
      return;
    }
    void startPrompt(prompt, sessionId, settings, attachments);
  }

  function insertVoiceTranscript(value) {
    const input = $('chatInput'); const transcript = String(value || '').trim();
    if (!input || !transcript) return;
    const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? start;
    const left = input.value.slice(0, start); const right = input.value.slice(end);
    const prefix = left && !/\s$/.test(left) && !/^[,.;:!?)]/.test(transcript) ? ' ' : '';
    const suffix = right && !/^\s|^[,.;:!?)]/.test(right) ? ' ' : '';
    const inserted = `${prefix}${transcript}${suffix}`;
    input.setRangeText(inserted, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  function setVoiceListening(listening) {
    const button = $('voiceRecordBtn'); const language = $('voiceLanguageSelect');
    if (button) { button.classList.toggle('recording', listening); button.setAttribute('aria-pressed', String(listening)); button.setAttribute('aria-label', listening ? 'Dừng nhập liệu bằng giọng nói' : 'Bắt đầu nhập liệu bằng giọng nói'); }
    if (language) language.disabled = listening;
  }

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { notify('Trình duyệt này chưa hỗ trợ nhận dạng giọng nói.', true); return; }
    const recognition = new Recognition(); const language = $('voiceLanguageSelect'); const processedFinals = new Set();
    recognition.lang = language?.value === 'en-US' ? 'en-US' : 'vi-VN';
    recognition.continuous = true; recognition.interimResults = false; recognition.maxAlternatives = 1;
    voiceRecognition = recognition; setVoiceListening(true);
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result.isFinal || processedFinals.has(index)) continue;
        processedFinals.add(index); insertVoiceTranscript(result[0]?.transcript);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      const messages = { 'not-allowed': 'Hãy cho phép trình duyệt dùng microphone cho dashboard.', 'service-not-allowed': 'Dịch vụ nhận dạng giọng nói của trình duyệt không khả dụng.', 'no-speech': 'Chưa nghe thấy giọng nói.', network: 'Nhận dạng giọng nói cần mạng nhưng kết nối bị lỗi.', 'language-not-supported': 'Trình duyệt không hỗ trợ ngôn ngữ đã chọn.' };
      notify(messages[event.error] || `Không nhận dạng được giọng nói (${event.error || 'lỗi trình duyệt'}).`, true);
    };
    recognition.onend = () => {
      if (voiceRecognition === recognition) { voiceRecognition = null; setVoiceListening(false); }
      voiceStopResolve?.();
    };
    try {
      recognition.start();
      if (!voiceDisclosureShown) { voiceDisclosureShown = true; notify('Trình duyệt có thể xử lý audio qua dịch vụ nhận dạng của họ; dashboard không nhận audio.'); }
    } catch (error) {
      if (voiceRecognition === recognition) voiceRecognition = null;
      setVoiceListening(false); notify(`Không thể bật microphone: ${error.message}`, true);
    }
  }

  function stopVoiceInput() {
    const recognition = voiceRecognition;
    if (!recognition) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(timer); if (voiceStopResolve === finish) voiceStopResolve = null; resolve(); };
      const timer = setTimeout(() => { if (voiceRecognition === recognition) { voiceRecognition = null; setVoiceListening(false); try { recognition.abort(); } catch {} } finish(); }, 1500);
      voiceStopResolve = finish;
      try { recognition.stop(); } catch { try { recognition.abort(); } catch {} finish(); }
    });
  }

  function toggleVoiceInput() { if (voiceRecognition) void stopVoiceInput(); else startVoiceInput(); }

  function setTerminalStatus(label, connected = false) {
    const status = document.querySelector('#bottomPanelStatusLabel');
    const dot = document.querySelector('.bottom-panel-status .bottom-status-dot');
    if (status) status.textContent = label;
    if (dot) dot.style.background = connected ? 'var(--success)' : 'var(--muted)';
  }
  function fitTerminal() { if (terminalWidget && $('bottomPanel')?.classList.contains('open')) { terminalFitAddon?.fit(); terminalWidget.focus(); } }
  async function closeEmbeddedTerminal(hidePanel = true) {
    if (terminalOpenPromise) terminalOpenCancelled = true;
    const id = terminalSessionId;
    const socket = terminalSocket;
    terminalSessionId = null;
    terminalSocket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'closed');
    if (id) void readJson(`${API}/terminal/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    terminalWidget?.dispose();
    terminalWidget = null;
    terminalFitAddon = null;
    $('terminalHost')?.replaceChildren();
    if (hidePanel) {
      $('bottomPanel')?.classList.remove('open');
      document.querySelector('.app-main')?.classList.remove('has-bottom-panel');
      $('toggleBottomPanelBtn')?.classList.remove('active');
    }
    setTerminalStatus('Terminal đã đóng');
  }
  async function openEmbeddedTerminal() {
    if (terminalOpenPromise) return terminalOpenPromise;
    const panel = $('bottomPanel');
    const button = $('toggleBottomPanelBtn');
    panel?.classList.add('open');
    document.querySelector('.app-main')?.classList.add('has-bottom-panel');
    button?.classList.add('active');
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    terminalOpenPromise = (async () => {
      terminalOpenCancelled = false;
      try {
        if (!window.Terminal || !window.FitAddon?.FitAddon) throw new Error('Không tải được terminal emulator.');
        const ownerId = state.activeId;
        const body = ownerId ? { sessionId: ownerId } : state.draftWorkspaceCwd ? { cwd: state.draftWorkspaceCwd } : {};
        const { payload } = await readJson(`${API}/terminal/open`, { method: 'POST', body: JSON.stringify(body) });
        if (terminalOpenCancelled || state.activeId !== ownerId) { void readJson(`${API}/terminal/sessions/${encodeURIComponent(payload.terminalId)}`, { method: 'DELETE' }); if (!terminalOpenCancelled) throw new Error('Chat đã thay đổi trong lúc mở terminal.'); return; }
        terminalSessionId = payload.terminalId;
        const host = $('terminalHost');
        host?.replaceChildren();
        terminalWidget = new window.Terminal({ cursorBlink: true, convertEol: true, fontFamily: 'var(--font-mono)', fontSize: 12, theme: { background: '#080b10', foreground: '#e4e7eb', cursor: '#42a5ff' }, scrollback: 3000 });
        terminalFitAddon = new window.FitAddon.FitAddon();
        terminalWidget.loadAddon(terminalFitAddon);
        terminalWidget.open(host);
        terminalFitAddon.fit();
        terminalWidget.onData((data) => { if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(JSON.stringify({ type: 'input', data })); });
        terminalWidget.onResize(({ cols, rows }) => { if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(JSON.stringify({ type: 'resize', cols, rows })); });
        setTerminalStatus(`Đang kết nối · ${payload.workspace || 'General'}`);
        const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${scheme}//${location.host}/api/v1/terminal/stream?terminalId=${encodeURIComponent(terminalSessionId)}`);
        terminalSocket = socket;
        socket.addEventListener('open', () => {
          if (terminalSocket !== socket) return;
          fitTerminal(); setTerminalStatus(`Quyền tài khoản OS · ${payload.workspace || 'General'}`, true);
          if (!terminalDisclosureShown) { terminalDisclosureShown = true; notify('Terminal dùng quyền OS của tài khoản đang chạy dashboard; workspace chỉ là thư mục bắt đầu.'); }
        });
        socket.addEventListener('message', (event) => {
          if (terminalSocket !== socket) return;
          let message; try { message = JSON.parse(event.data); } catch { return; }
          if (message.type === 'output' && typeof message.data === 'string') terminalWidget?.write(message.data);
          else if (message.type === 'exit') setTerminalStatus(`Shell đã dừng · mã ${message.exitCode ?? message.signal ?? '?'}`);
          else if (message.type === 'closed') setTerminalStatus('Terminal đã đóng');
        });
        socket.addEventListener('close', () => {
          if (terminalSocket !== socket) return;
          terminalSocket = null; terminalSessionId = null;
          setTerminalStatus('Kết nối terminal đã đóng');
        });
        socket.addEventListener('error', () => { setTerminalStatus('Không kết nối được terminal'); notify('Không kết nối được terminal trên máy.', true); });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Kết nối terminal quá thời gian.')), 8000);
          socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
          socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket terminal bị lỗi.')); }, { once: true });
        });
      } catch (error) {
        const cancelled = terminalOpenCancelled;
        await closeEmbeddedTerminal(false);
        setTerminalStatus('Terminal chưa sẵn sàng');
        if (!cancelled) notify(`Không mở được terminal: ${error.message}`, true);
      } finally { terminalOpenPromise = null; if (button) { button.disabled = false; button.removeAttribute('aria-busy'); } }
    })();
    return terminalOpenPromise;
  }
  function toggleEmbeddedTerminal() {
    if ($('bottomPanel')?.classList.contains('open')) void closeEmbeddedTerminal();
    else void openEmbeddedTerminal();
  }

  function updateHeaderQuota(overview, accounts) {
    const win = overview?.windows?.gemini5h;
    const used = typeof win?.usedPct === 'number' && Number.isFinite(win.usedPct) ? win.usedPct : null;
    const available = used === null ? null : Math.max(0, Math.min(100, 100 - used));
    const widget = $('headerQuotaWidget');
    const meter = widget?.querySelector('.quota-meter-fill');
    const value = widget?.querySelector('.quota-meter-val');
    if (meter) meter.style.width = `${available ?? 0}%`;
    if (value) value.textContent = available === null ? '--' : `${available.toFixed(1)}%`;

    const active = accounts?.find((item) => item.isActive);
    const email = active?.email || '--';
    const hasActive = Boolean(active && email !== '--');
    const shortName = hasActive ? email.split('@')[0] : '--';
    const duration = hasActive ? active.sessionDuration || '--' : '--';
    const accountTitle = hasActive ? `Tài khoản OMP đang sử dụng: ${email}` : 'Chưa có tài khoản OMP đang dùng';
    const pill = $('headerActiveAccountPill');
    const headerEmail = $('headerActiveAccountEmailShort');
    const headerDuration = $('headerActiveAccountDuration');
    if (headerEmail) headerEmail.textContent = shortName;
    if (headerDuration) headerDuration.textContent = duration;
    if (pill) {
      pill.title = accountTitle;
      pill.setAttribute('aria-label', accountTitle);
      const dot = pill.firstElementChild;
      if (dot) {
        dot.style.backgroundColor = hasActive ? 'var(--success)' : 'var(--muted)';
        dot.style.boxShadow = hasActive ? '0 0 5px var(--success)' : 'none';
      }
    }

    const modalEmail = $('chatModalActiveEmail');
    const modalBadge = $('chatModalActiveBadge');
    const modalProvider = $('chatModalActiveProviderBadge');
    const modalDuration = $('chatModalActiveDuration');
    const tokenLogin = $('chatModalActiveTokenLogin');
    const banner = $('chatQuotaModalActiveAccountBanner');
    if (modalEmail) modalEmail.textContent = hasActive ? email : '--';
    if (modalBadge) modalBadge.textContent = hasActive ? email.split('@')[0].slice(0, 2).toUpperCase() : '--';
    if (modalProvider) modalProvider.textContent = hasActive ? active.provider || '--' : '--';
    if (modalDuration) modalDuration.textContent = duration;
    if (tokenLogin) {
      tokenLogin.textContent = hasActive ? active.tokenLoginTime || '--' : '--';
      const tokenRow = tokenLogin.parentElement;
      tokenRow?.removeAttribute('title');
      tokenRow?.querySelector('span')?.remove();
    }
    const activeLabel = [...(banner?.querySelectorAll('span') || [])].find((node) => ['Active', 'Đang dùng', 'Chưa có tài khoản'].includes(node.textContent.trim()));
    if (activeLabel) activeLabel.textContent = hasActive ? 'Đang dùng' : 'Chưa có tài khoản';
    const modalDot = banner?.querySelector('.pulse-dot');
    if (modalDot) modalDot.style.backgroundColor = hasActive ? 'var(--success)' : 'var(--muted)';
    widget?.setAttribute('title', `Hạn mức Gemini 5g khả dụng: ${available === null ? '--' : `${available.toFixed(1)}%`}`);
  }
  function updateQuotaModal(overview, accounts, protect) {
    const modal = $('quotaDashboardModal');
    if (!modal) return;
    const hasData = Boolean(overview && Object.keys(overview).length);
    const totalAccounts = hasData
      ? (typeof overview.totalAccounts === 'number' && Number.isFinite(overview.totalAccounts) ? overview.totalAccounts : accounts.length)
      : '--';
    const countLabel = totalAccounts === '--'
      ? '-- Accounts'
      : `${totalAccounts} ${totalAccounts === 1 ? 'Account' : 'Accounts'}`;

    modal.querySelectorAll('*').forEach((node) => {
      if (node.children.length) return;
      const content = node.textContent.trim();
      if (/^Giám sát thời gian thực (?:\d+|--) tài khoản OMP liên kết theo 4 cửa sổ quota$/i.test(content)) {
        node.textContent = `Giám sát thời gian thực ${totalAccounts} tài khoản OMP liên kết theo 4 cửa sổ quota`;
      } else if (/^Danh sách (?:\d+|--) Tài khoản OMP Kết Nối$/i.test(content)) {
        node.textContent = `Danh sách ${totalAccounts} Tài khoản OMP Kết Nối`;
      }
    });
    modal.querySelectorAll('span').forEach((node) => {
      if (/^(?:\d+|--) Accounts?$/.test(node.textContent.trim())) node.textContent = countLabel;
    });

    const kpis = modal.querySelectorAll('.modal-kpi-grid > div');
    if (kpis[0]) {
      const values = kpis[0].querySelectorAll('div');
      if (values[1]) values[1].textContent = countLabel;
      if (values[2]) {
        values[2].textContent = hasData
          ? `${overview.statusCounts?.ok ?? '--'} OK · ${overview.statusCounts?.warn ?? '--'} Cảnh báo · ${overview.statusCounts?.danger ?? '--'} Alert`
          : '-- OK · -- Cảnh báo · -- Alert';
      }
    }
    if (kpis[1]) {
      const values = kpis[1].querySelectorAll('div');
      if (values[1]) values[1].textContent = hasData ? overview.earliestReset?.split(' (')[0] || '--' : '--';
      if (values[2]) values[2].textContent = hasData ? overview.earliestReset?.match(/\((.*?)\)/)?.[1] || '--' : '--';
    }
    if (kpis[2]) {
      const values = kpis[2].querySelectorAll('div');
      if (values[1]) values[1].textContent = protect?.status || '--';
      if (values[2]) values[2].textContent = `Cooldown 429: ${protect?.cooldownSec ?? '--'}s`;
    }
    if (kpis[3]) {
      const values = kpis[3].querySelectorAll('div');
      if (values[1]) values[1].textContent = '30s';
    }

    const syncTime = $('modalLastSyncTime');
    if (syncTime) syncTime.textContent = hasData ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';
    const windows = [overview?.windows?.gemini5h, overview?.windows?.geminiWeek, overview?.windows?.claude5h, overview?.windows?.claudeWeek];
    modal.querySelectorAll('.modal-quota-windows > div').forEach((card, index) => {
      const item = windows[index];
      const used = typeof item?.usedPct === 'number' && Number.isFinite(item.usedPct) ? item.usedPct : null;
      const spans = card.querySelectorAll('span');
      if (spans[2]) spans[2].textContent = used === null ? '--' : `${used}%`;
      if (spans[spans.length - 2]) spans[spans.length - 2].textContent = item?.peak ? `Đỉnh: ${item.peak}` : 'Đỉnh: --';
      if (spans[spans.length - 1]) spans[spans.length - 1].textContent = item?.resetIn ? `Reset: ${item.resetIn}` : 'Reset: --';
      const bar = card.querySelector('div[style*="height: 5px"] > div');
      if (bar) bar.style.width = `${used ?? 0}%`;
    });
  }
  function renderAccountRows(accounts, emptyMessage = 'Chưa có tài khoản OMP.') {
    const holder = $('chatModalAccountsRows');
    if (!holder) return;
    holder.replaceChildren();
    if (!accounts.length) {
      holder.append(emptyNode(emptyMessage));
      return;
    }
    accounts.forEach((account, index) => {
      const row = document.createElement('div');
      row.className = `quick-acc-row${account.isActive ? ' is-active-row' : ''}`;
      row.dataset.id = account.id;
      row.style.cssText = 'display:grid;grid-template-columns:34px minmax(200px,1fr) 64px 64px 70px 88px 96px;gap:8px;padding:9px 12px;border-bottom:1px solid color-mix(in oklab,var(--border),transparent 50%);font-size:11.5px;align-items:center;';
      const no = document.createElement('div');
      no.textContent = `#${String(index + 1).padStart(2, '0')}`;
      const info = document.createElement('div');
      const email = document.createElement('div');
      email.textContent = account.email || '--';
      email.style.cssText = 'font-family:var(--font-mono);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      const provider = document.createElement('div');
      provider.textContent = `${account.provider || '--'} · ${account.authStatus || '--'}`;
      provider.style.color = 'var(--muted)';
      info.append(email, provider);
      const used = document.createElement('div');
      used.textContent = account.usage5hPct == null ? '--' : `${account.usage5hPct}%`;
      const week = document.createElement('div');
      week.textContent = account.usageWeekPct == null ? '--' : `${account.usageWeekPct}%`;
      const reset = document.createElement('div');
      reset.textContent = account.resetIn5h || '--';
      const status = document.createElement('div');
      status.textContent = account.isActive ? 'Đang dùng' : (account.authStatus || '--');
      const action = document.createElement('div');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = account.isActive ? 'btn-account-active' : 'btn-switch-account';
      button.disabled = !!account.isActive;
      button.textContent = account.isActive ? '✓ Đang dùng' : 'Chuyển';
      button.addEventListener('click', () => switchAccount(account.id));
      action.append(button);
      row.append(no, info, used, week, reset, status, action);
      holder.append(row);
    });
  }
  const quotaSessionQuery = () => state.activeId ? `?sessionId=${encodeURIComponent(state.activeId)}` : '';
  async function loadQuota() {
    const requestId = ++state.quotaRequestId;
    try {
      const [{ payload: overview }, { payload: accounts }, { payload: protect }] = await Promise.all([
        readJson(`${API}/quota/overview`),
        readJson(`${API}/quota/accounts${quotaSessionQuery()}`),
        readJson(`${API}/quota/protect-status`),
      ]);
      if (requestId !== state.quotaRequestId) return;
      state.quota = overview;
      state.accounts = accounts || [];
      updateHeaderQuota(overview, state.accounts);
      updateQuotaModal(overview, state.accounts, protect);
      renderAccountRows(state.accounts);
    } catch (error) {
      if (requestId !== state.quotaRequestId) return;
      state.quota = null;
      state.accounts = [];
      updateHeaderQuota({}, []);
      updateQuotaModal({}, [], {});
      renderAccountRows([], 'Không thể tải dữ liệu quota Gemini.');
      notify(`Quota Gemini API lỗi: ${error.message}`, true);
    }
  }
  async function switchAccount(accountId) { try { const { payload } = await readJson(`${API}/quota/switch`, { method: 'POST', body: JSON.stringify({ accountId, ...(state.activeId ? { sessionId: state.activeId } : {}) }) }); await Promise.all([loadQuota(), loadModels()]); notify(payload?.scope === 'session' ? 'Đã ghim account Gemini cho chat này' : 'Đã đặt account Gemini mặc định'); } catch (error) { notify(`Không thể chọn tài khoản Gemini: ${error.message}`, true); } }
  async function syncQuota() { const button = $('forceSyncAllOmpBtn'); if (button) button.disabled = true; try { await readJson(`${API}/quota/sync`, { method: 'POST', body: JSON.stringify({}) }); await Promise.all([loadQuota(), loadModels()]); notify('Đã đồng bộ quota'); } catch (error) { notify(`Đồng bộ quota lỗi: ${error.message}`, true); } finally { if (button) button.disabled = false; } }
  const modelOptionValue = (model) => JSON.stringify([model.provider || '', model.id]);
  const ompModels = () => [...new Map((state.models.length ? state.models : state.capabilities?.models || []).filter((item) => item?.id).map((item) => [item.id, item])).values()];
  function closeModelListboxes(focus = false) {
    document.querySelectorAll('.omp-model-dropdown-menu.open').forEach((menu) => {
      menu.classList.remove('open'); const button = menu.closest('.omp-model-dropdown-wrap')?.querySelector('.omp-model-select-btn');
      if (button) { button.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); if (focus) button.focus(); }
    });
  }
  let modelListboxEventsBound = false;
  function bindModelListboxEvents() {
    if (modelListboxEventsBound) return; modelListboxEventsBound = true;
    document.addEventListener('click', (event) => { if (!event.target.closest('.omp-model-dropdown-wrap')) closeModelListboxes(); });
    document.addEventListener('keydown', (event) => {
      const wrap = event.target.closest('.omp-model-dropdown-wrap');
      if (event.key === 'Escape' && document.querySelector('.omp-model-dropdown-menu.open')) { event.preventDefault(); closeModelListboxes(true); return; }
      if (!wrap) return;
      const button = wrap.querySelector('.omp-model-select-btn'); const menu = wrap.querySelector('.omp-model-dropdown-menu');
      if (event.target === button && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); button.click(); menu.querySelector('.omp-listbox-option')?.focus();
      } else if (event.target.matches('.omp-listbox-option')) {
        const options = [...menu.querySelectorAll('.omp-listbox-option')]; const index = options.indexOf(event.target);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus(); }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.target.click(); }
      }
    });
  }
  function updateModelListbox(button, models, selectedValue, onSelect, disabled = false, mono = false) {
    const wrap = button.closest('.omp-model-dropdown-wrap'); const menu = wrap.querySelector('.omp-model-dropdown-menu');
    const selected = models.find((model) => model.id === selectedValue) || models[0];
    button.disabled = disabled || !selected; button.setAttribute('aria-expanded', String(menu.classList.contains('open')));
    wrap.querySelector('.omp-selected-model-name').textContent = selected?.name || selected?.id || 'Chưa có model khả dụng';
    wrap.querySelector('.omp-selected-model-name').classList.toggle('font-mono', mono);
    wrap.querySelector('.listbox-model-badge').hidden = !selected;
    menu.replaceChildren(...models.map((model) => {
      const active = model.id === selected?.id; const option = document.createElement('div'); option.className = `omp-listbox-option${active ? ' active' : ''}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(active)); option.tabIndex = active ? 0 : -1; option.dataset.value = model.id;
      const main = document.createElement('div'); main.className = 'listbox-option-main'; const icon = document.createElement('span'); icon.className = 'listbox-model-icon'; icon.textContent = '✦';
      const name = document.createElement('span'); name.className = `listbox-model-name${mono ? ' font-mono' : ''}`; name.textContent = model.name || model.id; main.append(icon, name);
      if (active) { const badge = document.createElement('span'); badge.className = 'listbox-model-badge'; badge.textContent = 'Mặc định'; main.append(badge); }
      const check = document.createElement('span'); check.className = 'listbox-check-icon'; check.setAttribute('aria-hidden', 'true'); check.textContent = '✓'; option.append(main, check);
      option.addEventListener('click', (event) => { event.stopPropagation(); onSelect(model.id); updateModelListbox(button, models, model.id, onSelect, disabled, mono); closeModelListboxes(true); });
      return option;
    }));
  }
  function createModelListbox(id, labelId, models, selectedValue, onSelect, disabled = false, mono = false) {
    bindModelListboxEvents(); const wrap = document.createElement('div'); wrap.className = 'omp-model-dropdown-wrap';
    const button = document.createElement('button'); button.id = id; button.type = 'button'; button.className = 'omp-model-select-btn'; button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-labelledby', labelId);
    const main = document.createElement('span'); main.className = 'omp-select-btn-main'; const icon = document.createElement('span'); icon.className = 'listbox-model-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '✦';
    const name = document.createElement('span'); name.className = `omp-selected-model-name${mono ? ' font-mono' : ''}`; const badge = document.createElement('span'); badge.className = 'listbox-model-badge'; badge.textContent = 'Mặc định'; main.append(icon, name, badge);
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); chevron.classList.add('omp-select-chevron'); chevron.setAttribute('width', '12'); chevron.setAttribute('height', '12'); chevron.setAttribute('viewBox', '0 0 24 24'); chevron.setAttribute('fill', 'none'); chevron.setAttribute('stroke', 'currentColor'); chevron.setAttribute('stroke-width', '2.2'); chevron.setAttribute('stroke-linecap', 'round'); chevron.setAttribute('stroke-linejoin', 'round'); chevron.setAttribute('aria-hidden', 'true'); const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); chevronPath.setAttribute('points', '6 9 12 15 18 9'); chevron.append(chevronPath); button.append(main, chevron);
    const menu = document.createElement('div'); menu.className = 'omp-model-dropdown-menu omp-model-listbox'; menu.id = `${id}Listbox`; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-labelledby', labelId);
    button.setAttribute('aria-controls', menu.id); button.addEventListener('click', (event) => { event.stopPropagation(); const open = menu.classList.contains('open'); closeModelListboxes(); if (!open) { menu.classList.add('open'); button.classList.add('is-open'); button.setAttribute('aria-expanded', 'true'); } });
    wrap.append(button, menu); updateModelListbox(button, models, selectedValue, onSelect, disabled, mono); return wrap;
  }
  function syncPlanYoloModelControl() {
    const select = $('modesPlanYoloModelSelect'); if (!select) return;
    const models = ompModels();
    const selected = models.find((item) => item.id === state.planYoloModel) || models.find((item) => item.id === state.activeModel) || models[0];

    if (!selected) { updateModelListbox(select, [], '', setPlanYoloModel, true); return; }
    if (state.planYoloModel !== selected.id) { state.planYoloModel = selected.id; localStorage.setItem('omp.planYoloModel', selected.id); }
    updateModelListbox(select, models, selected.id, setPlanYoloModel);

  }
  function setPlanYoloModel(value, notifyUser = true) {
    if (!value) return;
    state.planYoloModel = value; localStorage.setItem('omp.planYoloModel', value); syncPlanYoloPill();
    if (notifyUser) notify(`Plan YOLO sẽ dùng ${value}.`);
  }
  function syncModelControls(selected) {
    const model = selected && state.models.find((item) => item.id === selected.id && item.provider === selected.provider);
    const account = state.modelSource === 'quota' ? state.modelAccess?.account : null;
    state.activeModel = model?.id || null;
    state.activeModelProvider = model?.provider || null;
    const visibleName = model ? `${model.id}${supportsImageGeneration(model) ? ' · Tạo ảnh' : ''}` : 'Chưa chọn model';
    const sourceStatus = state.modelSource === 'omp'
      ? 'Toàn bộ danh mục model OMP; model ngoài account đã nhập không được tính vào Quota.'
      : !account
        ? state.modelAccessErrorCode === 'ACCOUNT_SELECTION_REQUIRED' ? 'Chọn thủ công một tài khoản Gemini để tải model.' : 'Chưa xác minh model theo quota account đang hoạt động.'
        : account.canUse
          ? `Danh mục model theo quota ${account.provider}.`
          : `Không thể dùng model: ${account.availabilityReason || account.availabilityLabel || 'account quota hiện không khả dụng'}.`;
    const modelTitle = model ? `${model.id} · ${model.name || model.id}` : 'Chưa chọn model';
    const title = `${modelTitle}. ${sourceStatus}`;
    const label = $('headerModelNameText'); if (label) label.textContent = visibleName;
    $('headerModelPill')?.setAttribute('title', title);
    $('headerModelPill')?.setAttribute('aria-label', title);
    const active = $('modelActiveName'); if (active) active.textContent = visibleName;
    ['promptModelSelect', 'settingsDefaultModelSelect'].forEach((id) => {
      const select = $(id); if (!select) return;
      const options = state.models.map((item) => {
        const option = document.createElement('option');
        option.value = modelOptionValue(item);
        const duplicateId = state.models.some((candidate) => candidate.id === item.id && candidate.provider !== item.provider);
        option.textContent = `${item.name || item.id}${duplicateId ? ` · ${item.provider}` : ''}${supportsImageGeneration(item) ? ' · Tạo ảnh' : ''}`;
        option.title = `${item.provider || 'OMP'} · ${supportsImageGeneration(item) ? 'Model có thể tạo và trả ảnh đầu ra' : 'Model đọc/phân tích ảnh; không tạo ảnh đầu ra'}`;
        return option;
      });
      if (!model) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = state.models.length
          ? (state.modelSource === 'omp' ? 'Chọn model OMP khả dụng' : 'Chọn model được quota cho phép')
          : (state.modelSource === 'omp' ? 'OMP chưa có model khả dụng' : state.modelAccessErrorCode === 'ACCOUNT_SELECTION_REQUIRED' ? 'Chọn tài khoản Gemini trước' : 'Quota chưa có model khả dụng');
        placeholder.disabled = true;
        options.unshift(placeholder);
      }
      select.replaceChildren(...options);
      select.value = model ? modelOptionValue(model) : '';
      select.disabled = !state.models.length || (state.modelSource === 'quota' && !account?.canUse);
      select.title = sourceStatus;
    });
    syncPlanYoloModelControl();
  }
  async function loadModels() {
    const source = state.modelSource;
    const previousSource = state.loadedModelSource;
    const previousProvider = state.loadedModelProvider;
    const previousModel = state.activeModel;
    const previousModelProvider = state.activeModelProvider;
    const firstLoad = !state.modelAccessInitialized;
    const requestId = ++state.modelAccessRequestId;
    try {
      const modelUrl = source === 'omp' ? `${API}/models` : `${API}/quota/models${quotaSessionQuery()}`;
      const { payload } = await readJson(modelUrl);
      if (requestId !== state.modelAccessRequestId || source !== state.modelSource) return;
      let account = null;
      let models;
      if (source === 'quota') {
        if (!payload?.account || !Array.isArray(payload.models)) throw new Error('Quota API không trả danh mục model theo account.');
        account = payload.account;
        models = payload.models;
      } else {
        models = Array.isArray(payload) ? payload : dataOf(payload, 'models');
        if (!Array.isArray(models)) throw new Error('OMP API không trả danh mục model.');
      }
      state.modelAccessErrorCode = '';
      state.modelAccess = source === 'quota' ? payload : null;
      state.models = models;
      const sourceChanged = previousSource !== source;
      const providerChanged = !sourceChanged && source === 'quota' && previousProvider !== account.providerKey;
      let selected = !sourceChanged && !providerChanged
        ? state.models.find((item) => item.id === previousModel && item.provider === previousModelProvider)
        : null;
      if ((firstLoad || sourceChanged) && source === 'omp') selected = state.models.find((item) => item.isDefault) || state.models[0] || null;
      else if ((firstLoad || sourceChanged || providerChanged) && source === 'quota' && account.canUse) {
        selected = state.models.find((item) => item.isDefault) || state.models[0] || null;
      }
      state.loadedModelSource = source;
      state.loadedModelProvider = source === 'quota' ? account.providerKey : null;
      state.modelAccessInitialized = true;
      syncModelControls(selected);
      if (previousModel && !selected && !sourceChanged) notify(`Model ${previousModel} không còn trong danh mục ${source === 'quota' ? 'quota account đang hoạt động' : 'OMP'}; hãy chọn lại.`, true);
    } catch (error) {
      if (requestId !== state.modelAccessRequestId || source !== state.modelSource) return;
      state.modelAccess = null;
      state.modelAccessErrorCode = error.code || '';
      state.models = [];
      state.activeModel = null;
      state.activeModelProvider = null;
      syncModelControls(null);
      if (error.code !== 'ACCOUNT_SELECTION_REQUIRED') notify(`Không tải được model ${source === 'quota' ? 'theo quota' : 'từ OMP'}: ${error.message}`, true);
    }
  }

  function renderWorkspaceFiles() {
    const list = $('drawerFilesList'); if (!list) return;
    list.replaceChildren();
    state.attachments.forEach((item, index) => { const row = document.createElement('div'); row.className = 'production-file-row'; row.textContent = `${item.name} · ${Math.ceil((item.size || 0) / 1024)} KB`; const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', `Bỏ tệp ${item.name}`); remove.textContent = '×'; remove.addEventListener('click', () => { state.attachments.splice(index, 1); renderAttachmentStrip(); }); row.append(remove); list.append(row); });
    if (!state.activeId) { if (!state.attachments.length) list.append(emptyNode('Chọn session để duyệt tệp workspace.')); return; }
    state.workspaceFiles.forEach((item) => { const row = document.createElement('button'); row.type = 'button'; row.className = 'production-file-row'; row.textContent = `${item.kind === 'folder' ? '📁' : '📄'} ${item.label}`; row.addEventListener('click', () => item.kind === 'folder' ? loadWorkspaceFiles(item.value) : attachWorkspaceFile(item.value)); list.append(row); });
    if (!state.workspaceFiles.length) list.append(emptyNode('Không có tệp phù hợp trong workspace này.'));
  }
  async function loadWorkspaceFiles(mention = '@') {
    if (!state.activeId) return;
    const guard = sessionGuard();
    try {
      const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(guard.sessionId)}/files?mention=${encodeURIComponent(mention)}`);
      if (!isCurrentSession(guard)) return;
      state.workspaceMention = mention; state.workspaceFiles = dataOf(payload, 'items') || []; renderWorkspaceFiles();
    } catch (error) { if (isCurrentSession(guard)) notify(`Không tải được tệp workspace: ${error.message}`, true); }
  }
  async function attachWorkspaceFile(path) {
    if (!state.activeId) return;
    const guard = sessionGuard();
    try {
      const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(guard.sessionId)}/files/reference`, { method: 'POST', body: JSON.stringify({ path }) });
      if (!isCurrentSession(guard)) return;
      const attachment = payload?.attachment; if (!attachment?.text) throw new Error('Backend không trả nội dung tệp an toàn');
      if (state.attachments.length >= 4) throw new Error('Mỗi lượt chat chỉ được đính kèm tối đa 4 tệp.');
      state.attachments.push(attachment); renderAttachmentStrip(); notify(`Đã đính kèm ${attachment.path}${attachment.truncated ? ' (đã rút gọn)' : ''}`);
    } catch (error) { if (isCurrentSession(guard)) notify(`Không thể đính kèm tệp: ${error.message}`, true); }
  }
  function renderAttachmentStrip() {
    const host = $('productionAttachmentStrip'); if (!host) return;
    host.replaceChildren(); host.hidden = !state.attachments.length;
    const fileBadge = $('drawerTabFilesBtn')?.querySelector('.drawer-tab-badge'); if (fileBadge) fileBadge.textContent = String(state.attachments.length);
    state.attachments.forEach((item, index) => {
      const chip = document.createElement('span'); chip.className = 'attached-file-chip'; chip.title = item.name || item.path || 'tệp';
      const imageSource = attachmentImageSource(item);
      if (imageSource) { const img = document.createElement('img'); img.src = imageSource; img.alt = item.name || 'Xem trước ảnh'; img.style.cssText = 'width:24px;height:24px;object-fit:cover;border-radius:3px;vertical-align:middle;cursor:pointer;'; img.addEventListener('click', () => openAttachmentViewer(item)); chip.append(img); }
      chip.append(document.createTextNode(` ${item.name || item.path || 'tệp'} · ${formatAttachmentSize(item.size)}`));
      const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', `Bỏ tệp ${item.name || item.path || 'tệp'}`); remove.textContent = '×'; remove.addEventListener('click', () => { state.attachments.splice(index, 1); renderAttachmentStrip(); }); chip.append(remove); host.append(chip);
    });
    renderWorkspaceFiles();
  }
  function attachmentFileSupported(file) {
    const type = text(file?.type).toLowerCase();
    if (/^image\/(?:png|jpeg|gif|webp|avif|bmp)$/.test(type) || /\.(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(text(file?.name))) return true;
    if (type.startsWith('image/')) return false;
    if (type.startsWith('text/')) return true;
    return /\.(?:txt|md|json|js|ts|tsx|jsx|css|html?|csv|xml|ya?ml|py|sql)$/i.test(text(file?.name));
  }
  function readAttachment(file) {
    return new Promise((resolve, reject) => {
      if (!file || typeof file !== 'object') return reject(new Error('Tệp không hợp lệ'));
      if (file.size > 512 * 1024) return reject(new Error(`${file.name} vượt giới hạn 512 KB`));
      if (!attachmentFileSupported(file)) return reject(new Error(`${file.name || 'Tệp'} không được hỗ trợ; chỉ nhận ảnh PNG/JPEG/GIF/WebP/AVIF/BMP và tệp văn bản/code`));
      const imageExtension = text(file.name).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
      const inferredType = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' }[imageExtension] || 'text/plain';
      const type = text(file.type || (/^image\//.test(inferredType) ? inferredType : /\.json$/i.test(text(file.name)) ? 'application/json' : inferredType)).toLowerCase();
      const isImage = /^image\//.test(type);
      const reader = new FileReader(); reader.onerror = () => reject(new Error(`Không đọc được ${file.name}`));
      reader.onload = () => resolve({ name: text(file.name || 'attachment').slice(0, 180), type, size: file.size, ...(isImage ? { data: reader.result } : { text: String(reader.result || '').slice(0, 200000), ...(String(reader.result || '').length > 200000 ? { truncated: true } : {}) }) });
      if (isImage) reader.readAsDataURL(file); else reader.readAsText(file);
    });
  }
  function bindPromptPlusMenu() {
    const button = $('promptPlusBtn');
    const menu = $('promptPlusMenu');
    const attachItem = $('plusAttachFile');
    if (!button || !menu || !attachItem || button.dataset.productionBound === 'true') return;
    button.dataset.productionBound = 'true';
    button.hidden = false;
    button.disabled = false;
    button.removeAttribute('aria-hidden');
    button.setAttribute('aria-label', 'Mở menu đính kèm tệp hoặc ảnh');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    const firstSection = attachItem.closest('.plus-menu-section');
    menu.querySelectorAll('.plus-menu-section').forEach((section) => {
      const keep = section === firstSection;
      section.hidden = !keep;
      section.style.display = keep ? '' : 'none';
      if (!keep) section.setAttribute('aria-hidden', 'true');
    });
    firstSection?.querySelectorAll('.prompt-menu-item').forEach((item) => {
      const keep = item === attachItem;
      item.hidden = !keep;
      item.style.display = keep ? 'flex' : 'none';
      if (!keep) item.setAttribute('aria-hidden', 'true');
    });
    const title = attachItem.querySelector('.plus-item-title');
    if (title) title.textContent = 'Đính kèm tệp hoặc ảnh';
    let description = attachItem.querySelector('.plus-item-desc');
    if (!description) { description = document.createElement('span'); description.className = 'plus-item-desc'; attachItem.querySelector('.plus-item-text')?.append(description); }
    if (description) description.textContent = 'Chọn ảnh hoặc tệp văn bản/code từ máy';
    const close = () => { menu.classList.remove('show'); button.setAttribute('aria-expanded', 'false'); };
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const open = !menu.classList.contains('show');
      menu.classList.toggle('show', open);
      button.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('.plus-menu-search-input')?.focus();
    }, true);
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target) && event.target !== button) close();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && menu.classList.contains('show')) { close(); button.focus(); } });
  }

  function bindFileAttachment() {
    if ($('productionFileInput')) return;
    const input = document.createElement('input'); input.id = 'productionFileInput'; input.type = 'file'; input.multiple = true; input.accept = '.txt,.md,.json,.js,.ts,.tsx,.jsx,.css,.html,.htm,.csv,.xml,.yaml,.yml,.py,.sql,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp'; input.hidden = true; document.body.append(input);
    const composer = $('chatInput')?.closest('.prompt-card, .prompt-composer, .prompt-box, .composer-wrap');
    if (composer && !$('productionAttachmentStrip')) { const strip = document.createElement('div'); strip.id = 'productionAttachmentStrip'; strip.className = 'production-attachment-strip'; strip.hidden = true; strip.setAttribute('aria-live', 'polite'); composer.prepend(strip); }
    bindPromptPlusMenu();
    const choose = (event) => { event.preventDefault(); event.stopImmediatePropagation(); input.click(); };
    $('attachBtn')?.addEventListener('click', choose, true);
    $('plusAttachFile')?.addEventListener('click', choose, true);
    $('drawerUploadFileBtn')?.addEventListener('click', choose, true);
    $('drawerTabFilesBtn')?.addEventListener('click', () => loadWorkspaceFiles(state.workspaceMention), true);
    const addFiles = async (fileList) => {
      const files = [...(fileList || [])];
      if (state.attachments.length >= 4) { notify('Mỗi lượt chat chỉ được đính kèm tối đa 4 tệp.', true); return; }
      if (files.length > 4 - state.attachments.length) notify('Chỉ nhận 4 tệp đầu tiên trong một lượt chat.', true);
      for (const file of files.slice(0, 4 - state.attachments.length)) {
        try { state.attachments.push(await readAttachment(file)); } catch (error) { notify(error.message, true); }
      }
      renderAttachmentStrip();
    };
    input.addEventListener('change', () => { void addFiles(input.files); input.value = ''; });
    if (composer) {
      composer.addEventListener('dragover', (event) => { if (event.dataTransfer?.files?.length) { event.preventDefault(); composer.classList.add('production-file-dragover'); } });
      composer.addEventListener('dragleave', (event) => { if (!composer.contains(event.relatedTarget)) composer.classList.remove('production-file-dragover'); });
      composer.addEventListener('drop', (event) => { if (!event.dataTransfer?.files?.length) return; event.preventDefault(); composer.classList.remove('production-file-dragover'); void addFiles(event.dataTransfer.files); });
    }
    $('chatInput')?.addEventListener('paste', (event) => {
      const images = [...(event.clipboardData?.files || [])].filter((file) => /^image\//i.test(text(file.type)));
      if (!images.length) return;
      event.preventDefault(); void addFiles(images);
    });
  }
  function renderOmpTools() {
    const tools = $('toolsContentArea'); const allTools = state.capabilities?.tools || []; const catalog = allTools.filter((item) => item.status === 'supported' && item.canToggle); if (!tools) return; tools.replaceChildren();
    const metadata = state.capabilities?.catalog || {}; const statuses = { supported: 'Tắt' };
    const version = $('ompToolsVersion'); if (version) version.textContent = `OMP ${text(metadata.audit?.ompVersion || 'chưa kiểm tra').replace(/^omp\//i, '')}`;
    const count = $('ompToolsCountLabel'); if (count) count.textContent = `${metadata.counts?.supported || 0} TOOL DÙNG ĐƯỢC`;
    const sync = $('btnSyncOmpTools');
    if (sync) {
      sync.disabled = state.toolsUpdating; sync.classList.toggle('spinning', state.toolsUpdating); sync.setAttribute('aria-label', state.toolsUpdating ? 'Đang đồng bộ OMP' : 'Đồng bộ OMP');
      const label = $('btnSyncOmpToolsLabel'); if (label) label.textContent = state.toolsUpdating ? 'Đang đồng bộ OMP…' : 'Đồng bộ OMP';
      if (sync.dataset.bound !== 'true') { sync.dataset.bound = 'true'; sync.addEventListener('click', () => void syncOmpCatalog()); }
    }
    if (!allTools.length) { tools.append(emptyNode('OMP chưa công bố capability')); return; }
    tools.setAttribute('aria-label', 'Công cụ OMP. Gửi thêm order giữ nguyên trạng thái; chat mới dùng lựa chọn hiện tại; đổi toggle áp dụng từ lượt kế tiếp.');
    const available = catalog.length; const toolsTab = $('drawerTabToolsBtn'); const badge = toolsTab?.querySelector('.drawer-tab-badge'); if (badge) badge.textContent = String(available); if (toolsTab) toolsTab.setAttribute('aria-label', `Công cụ OMP: ${available} tool khả dụng`);
    if (!catalog.length) { tools.append(emptyNode('Không có công cụ OMP dùng được; hãy đồng bộ lại.')); return; }
    const listedGroups = metadata.groups || []; const groupIds = new Set(listedGroups.map((item) => item.id)); const groups = listedGroups.map((group) => [group.label, catalog.filter((item) => item.group === group.id)]);
    const leftovers = catalog.filter((item) => !groupIds.has(item.group)); if (leftovers.length) groups.push(['KHÁC', leftovers]);
    const renderRow = (item) => {
      const checked = item.canToggle && state.selectedTools.includes(item.id);
      const row = document.createElement('div'); row.className = 'tool-item-row production-tool-row'; row.dataset.toolId = item.id;
      const left = document.createElement('div'); left.className = 'tool-item-left';
      const icon = document.createElement('div'); icon.className = 'tool-icon-avatar'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = item.icon || '•';
      const info = document.createElement('div'); info.className = 'tool-item-info';
      const nameWrap = document.createElement('div'); nameWrap.className = 'tool-item-name-wrap';
      const title = document.createElement('span'); title.className = 'tool-item-name'; title.textContent = item.label || item.id;
      const status = document.createElement('span'); status.className = `tool-item-status-tag${checked ? ' tag-active' : ''}`; status.textContent = checked ? 'Bật' : (statuses[item.status] || item.status || 'Chưa rõ'); status.dataset.status = item.status;
      const description = document.createElement('div'); description.className = 'tool-item-desc'; description.textContent = item.status === 'supported' ? (item.description || 'OMP chưa cung cấp mô tả.') : (item.reason || item.description || 'OMP chưa cung cấp mô tả.');
      nameWrap.append(title, status); info.append(nameWrap, description); left.append(icon, info);
      const toggle = document.createElement(item.canToggle ? 'button' : 'div'); if (item.canToggle) toggle.type = 'button'; toggle.className = 'toggle-switch omp-tool-switch'; if (checked) toggle.classList.add('on'); toggle.dataset.toolId = item.id; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(checked)); toggle.setAttribute('aria-label', `${item.label || item.id}: ${item.canToggle ? 'bật/tắt' : statuses[item.status] || 'chưa khả dụng'}`); toggle.setAttribute('title', `${item.label || item.id}: ${item.reason || statuses[item.status] || 'chưa khả dụng'}`); if (!item.canToggle || state.toolsUpdating) toggle.setAttribute('aria-disabled', 'true');
      const knob = document.createElement('div'); knob.className = 'toggle-knob'; toggle.append(knob); row.append(left, toggle);
      if (item.canToggle) toggle.addEventListener('click', () => { if (!state.toolsUpdating) void setOmpTools(item.id, !checked); });
      return row;
    };
    groups.forEach(([label, items]) => { if (!items.length) return; const group = document.createElement('div'); group.className = 'tool-section-group production-tool-group'; const heading = document.createElement('div'); heading.className = 'tool-group-label'; heading.textContent = label; group.append(heading, ...items.map(renderRow)); tools.append(group); });
  }
  function modeToggle(id, enabled, label, onClick) {
    const toggle = document.createElement('button'); toggle.id = id; toggle.type = 'button'; toggle.className = `toggle-switch${enabled ? ' on' : ''}`; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(enabled)); toggle.setAttribute('aria-label', label); toggle.title = label; const knob = document.createElement('div'); knob.className = 'toggle-knob'; toggle.append(knob); toggle.addEventListener('click', onClick); return toggle;
  }
  function modeInfo(name, description, enabled) {
    const left = document.createElement('div'); left.className = 'tool-item-left'; const icon = document.createElement('div'); icon.className = 'tool-icon-avatar'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = name === 'Advisor' ? '✦' : '◈'; const info = document.createElement('div'); info.className = 'tool-item-info'; const line = document.createElement('div'); line.className = 'tool-item-name-wrap'; const title = document.createElement('span'); title.className = 'tool-item-name'; title.textContent = name; const status = document.createElement('span'); status.className = `tool-item-status-tag${enabled ? ' tag-active' : ''}`; status.textContent = enabled ? 'Bật' : 'Tắt'; const detail = document.createElement('div'); detail.className = 'tool-item-desc'; detail.textContent = description; line.append(title, status); info.append(line, detail); left.append(icon, info); return left;
  }
  function modeField(label, control, id = control.id) { const field = document.createElement('div'); field.className = 'mode-field'; const caption = document.createElement('label'); caption.id = `${id}Label`; caption.htmlFor = id; caption.textContent = label; field.append(caption, control); return field; }
  function renderOmpModes() {
    const host = $('modesContentArea'); if (!host) return; host.replaceChildren(); const modes = state.capabilities?.sessionModes || []; const plan = modes.find((item) => item.id === 'plan-yolo'); const advisorMode = modes.find((item) => item.id === 'advisor'); const supported = [plan, advisorMode].filter((item) => item?.status === 'supported'); const badge = $('drawerTabModesBtn')?.querySelector('.drawer-tab-badge'); if (badge) badge.textContent = String(supported.length);
    if (!modes.length) { host.append(emptyNode('OMP chưa công bố chế độ runtime.')); return; }
    host.setAttribute('aria-label', 'Chế độ runtime OMP cho chat mới'); const note = document.createElement('div'); note.className = 'mode-runtime-note'; note.setAttribute('role', 'status'); note.textContent = 'OMP chỉ đọc các chế độ này khi khởi tạo runtime. Chat đang mở giữ nguyên; hãy tạo Cuộc trò chuyện mới để áp dụng.'; host.append(note);
    const section = document.createElement('section'); section.className = 'tool-section-group'; const heading = document.createElement('div'); heading.className = 'tool-group-label'; heading.textContent = 'CHẾ ĐỘ ÁP DỤNG CHO CHAT MỚI'; section.append(heading);
    if (plan?.status === 'supported') {
      const card = document.createElement('div'); card.className = 'mode-card'; const head = document.createElement('div'); head.className = 'mode-card-head'; head.append(modeInfo('Plan YOLO', 'Bắt đầu chỉ đọc, tự duyệt plan ở resolve đầu rồi chuyển sang model thực thi.', state.planYolo), modeToggle('modesPlanYoloToggle', state.planYolo, state.planYolo ? 'Tắt Plan YOLO' : 'Bật Plan YOLO', () => { togglePlanYolo(); renderOmpModes(); }));
      const models = ompModels(); const selected = models.find((item) => item.id === state.planYoloModel) || models.find((item) => item.id === state.activeModel) || models[0];
      const picker = createModelListbox('modesPlanYoloModelSelect', 'modesPlanYoloModelSelectLabel', models, selected?.id, (value) => setPlanYoloModel(value), !models.length);
      card.append(head, modeField('MODEL MẶC ĐỊNH PLAN YOLO', picker, 'modesPlanYoloModelSelect')); section.append(card);
    }
    if (advisorMode?.status === 'supported') {
      const card = document.createElement('div'); card.className = 'mode-card'; const head = document.createElement('div'); head.className = 'mode-card-head'; head.append(modeInfo('Advisor', 'Model thứ hai review thụ động mỗi lượt và chèn note khi cần; có thể tăng token/quota.', state.advisor), modeToggle('modesAdvisorToggle', state.advisor, state.advisor ? 'Tắt Advisor' : 'Bật Advisor', () => { state.advisor = !state.advisor; renderOmpModes(); notify(`Advisor ${state.advisor ? 'đã bật' : 'đã tắt'}; áp dụng cho chat mới.`); }));
      const controls = document.createElement('div'); controls.className = 'mode-card-controls'; const config = state.advisorConfig; const disabled = !state.advisor || state.advisorConfigLoading || state.advisorConfigSaving;
      if (!config) { const loading = document.createElement('div'); loading.className = 'tool-item-desc'; loading.textContent = state.advisorConfigLoading ? 'Đang đọc tuning Advisor từ OMP…' : 'Chưa đọc được tuning Advisor.'; controls.append(loading); }
      else {
        let advisorModel = config.model; const advisorModels = [...new Map([{ id: 'google-antigravity/gemini-3.8-flash:high' }, { id: 'google-antigravity/gemini-2.5-pro:high' }, { id: 'anthropic/claude-3-5-sonnet:20241022' }, { id: 'openai/gpt-4o-2024-11-20' }, { id: 'honpi/neural-flash-3.8:high' }, { id: config.model }].map((model) => [model.id, model])).values()];
        const input = createModelListbox('advisorModelInput', 'advisorModelInputLabel', advisorModels, advisorModel, (value) => { advisorModel = value; }, disabled, true);
        const tier = document.createElement('select'); tier.id = 'advisorTierSelect'; ['inherit', 'none', 'auto', 'default', 'flex', 'scale', 'priority'].forEach((value) => tier.append(new Option(value, value, false, value === config.tier))); tier.disabled = disabled;
        const backlog = document.createElement('select'); backlog.id = 'advisorBacklogSelect'; [['off', 'Tắt'], ['1', '1 lượt'], ['3', '3 lượt'], ['5', '5 lượt']].forEach(([value, label]) => backlog.append(new Option(label, value, false, value === config.syncBacklog))); backlog.disabled = disabled;
        const immune = document.createElement('select'); immune.id = 'advisorImmuneSelect'; [0, 1, 2, 3, 4, 5].forEach((value) => immune.append(new Option(`${value} lượt`, String(value), false, value === config.immuneTurns))); immune.disabled = disabled;
        const notes = document.createElement('select'); notes.id = 'advisorNotesSelect'; [1, 2, 3, 4, 5].forEach((value) => notes.append(new Option(`${value} note`, String(value), false, value === config.maxNotesPerUpdate))); notes.disabled = disabled;
        const evict = modeToggle('advisorEvictToggle', config.evictStaleResults, config.evictStaleResults ? 'Giữ dọn note cũ' : 'Tắt dọn note cũ', () => { const value = evict.dataset.value !== 'true'; evict.classList.toggle('on', value); evict.setAttribute('aria-checked', String(value)); evict.dataset.value = String(value); }); evict.disabled = disabled; evict.dataset.value = String(config.evictStaleResults);
        controls.append(modeField('MODEL ADVISOR', input, 'advisorModelInput'), modeField('SERVICE TIER', tier), modeField('ĐỒNG BỘ BACKLOG', backlog), modeField('IMMUNE TURNS', immune), modeField('MAX NOTES / UPDATE', notes), modeField('DỌN KẾT QUẢ CŨ', evict));
        const save = document.createElement('button'); save.type = 'button'; save.className = 'mode-save-button'; save.disabled = disabled; save.textContent = state.advisorConfigSaving ? 'Đang lưu vào OMP…' : 'Lưu tuning Advisor vào OMP'; save.addEventListener('click', () => saveAdvisorConfig({ model: advisorModel, tier: tier.value, syncBacklog: backlog.value, immuneTurns: Number(immune.value), maxNotesPerUpdate: Number(notes.value), evictStaleResults: evict.dataset.value === 'true' })); controls.append(save);
      }
      card.append(head, controls); section.append(card);
    }
    if (!supported.length) section.append(emptyNode('OMP chưa hỗ trợ chế độ nào trong catalog hiện tại.')); host.append(section);
  }
  async function loadAdvisorConfig() { if (state.advisorConfigLoading) return; state.advisorConfigLoading = true; renderOmpModes(); try { const { payload } = await readJson(`${API}/omp/advisor-config`); const applyModeDefaults = state.advisorConfig === null; state.advisorConfig = payload; if (applyModeDefaults) { state.advisor = payload.enabled === true; state.planYolo = payload.planYolo === true; state.planYoloModel = payload.planYoloModel || state.planYoloModel || ''; if (state.planYoloModel) localStorage.setItem('omp.planYoloModel', state.planYoloModel); syncPlanYoloPill(); } } catch (error) { notify(`Không đọc được tuning Advisor từ OMP: ${error.message}`, true); } finally { state.advisorConfigLoading = false; renderOmpModes(); } }
  async function saveAdvisorConfig(next) { state.advisorConfigSaving = true; renderOmpModes(); try { const { payload } = await readJson(`${API}/omp/advisor-config`, { method: 'POST', body: JSON.stringify(next) }); state.advisorConfig = payload; notify('Đã lưu tuning Advisor vào OMP; áp dụng khi tạo chat mới.'); } catch (error) { notify(`Không lưu được tuning Advisor: ${error.message}`, true); } finally { state.advisorConfigSaving = false; renderOmpModes(); } }
  async function setOmpTools(toolId, enabled) {
    const supported = new Set(selectableTools());
    const previous = [...state.selectedTools]; const next = previous.filter((id) => id !== toolId); if (enabled) next.push(toolId);
    if (!next.length) { notify('OMP cần ít nhất một công cụ đang bật.', true); renderOmpTools(); return; }
    if (!supported.has(toolId)) { notify('Công cụ này chưa khả dụng trong OMP.', true); renderOmpTools(); return; }
    state.selectedTools = [...new Set(next)]; saveSelectedTools(); state.toolsUpdating = true; syncCapabilityControls(); renderOmpTools();
    const guard = sessionGuard();
    if (!guard.sessionId) { state.toolsUpdating = false; syncCapabilityControls(); renderOmpTools(); prewarmDraftWorker(); notify('Đã lưu cho session mới; gửi thêm order sẽ giữ nguyên danh sách tool.'); return; }
    try {
      await readJson(`${API}/sessions/${encodeURIComponent(guard.sessionId)}/action`, { method: 'POST', body: JSON.stringify({ action: 'tools', tools: state.selectedTools }) });
      if (isCurrentSession(guard)) notify('Đã cập nhật công cụ OMP cho phiên; áp dụng từ lượt kế tiếp.');
    } catch (error) {
      if (isCurrentSession(guard)) { state.selectedTools = previous; saveSelectedTools(); syncCapabilityControls(); notify(`Không cập nhật được công cụ OMP: ${error.message}`, true); }
    } finally { state.toolsUpdating = false; syncCapabilityControls(); renderOmpTools(); }
  }
  async function syncOmpCatalog() {
    if (state.toolsUpdating) return; state.toolsUpdating = true; renderOmpTools();
    try {
      const { payload } = await readJson(`${API}/omp/capabilities/audit`, { method: 'POST', body: '{}' });
      if (payload?.catalog?.tools) state.capabilities = { ...state.capabilities, ...payload.catalog };
      await loadCapabilities();
      const drift = payload?.catalog?.catalog?.drift; const changed = [...(drift?.added || []), ...(drift?.removed || []), ...(drift?.changed || [])];
      notify(changed.length ? `Đã đồng bộ OMP: ${changed.length} thay đổi cần đối chiếu map.` : 'Đã đồng bộ catalog OMP.');
    } catch (error) { notify(`Không đồng bộ được OMP: ${error.message}`, true); }
    finally { state.toolsUpdating = false; renderOmpTools(); }
  }
  async function loadAgentHub(guard = sessionGuard()) {
    const host = $('ompAgentHubStatus'); if (!host) return;
    const hub = state.capabilities?.tools?.find((item) => item.id === 'hub');
    if (!hub?.canToggle) {
      host.hidden = false; host.replaceChildren();
      const title = document.createElement('div'); title.className = 'settings-section-title'; title.textContent = 'OMP Agent Hub';
      const note = document.createElement('div'); note.className = 'settings-help-text'; note.textContent = 'Agent Hub chưa khả dụng qua ACP; OMP không công bố dữ liệu subagent cho dashboard.';
      host.append(title, note); return;
    }
    host.hidden = false; host.replaceChildren(); const title = document.createElement('div'); title.className = 'settings-section-title'; title.textContent = 'OMP Agent Hub'; host.append(title);
    if (!guard.sessionId || !isCurrentSession(guard)) { host.append(emptyNode('Chọn session để xem task/subagent thật.')); return; }
    if (state.capabilities?.featureStatus?.['agent-hub'] === 'unavailable') { host.append(emptyNode('Agent Hub chưa khả dụng qua ACP; OMP không công bố dữ liệu subagent cho dashboard.')); return; }
    try {
      const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(guard.sessionId)}/agents`);
      if (!isCurrentSession(guard)) return;
      const agents = payload?.agents || [];
      const note = document.createElement('div'); note.className = 'settings-help-text'; note.textContent = agents.length ? `${agents.length} subagent đang được OMP theo dõi.` : 'OMP không có subagent đang chạy trong session này.'; host.append(note);
      agents.forEach((agent) => { const row = document.createElement('div'); row.className = 'production-file-row'; const label = document.createElement('span'); label.textContent = `${agent.agent} · ${agent.status}${agent.task ? ` · ${agent.task}` : ''}`; const action = document.createElement('button'); action.type = 'button'; action.disabled = true; action.title = 'Chưa có adapter điều khiển subagent'; action.textContent = 'Chưa có adapter'; row.append(label, action); host.append(row); });
      const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'btn-secondary'; refresh.textContent = 'Làm mới'; refresh.addEventListener('click', () => loadAgentHub(sessionGuard())); host.append(refresh);
    } catch (error) { if (isCurrentSession(guard)) host.append(emptyNode(`Không đọc được Agent Hub: ${error.message}`)); }
  }
  function renderOmpMemoryPanel() {
    const host = $('ompMemoryStatus'); if (!host) return;
    host.replaceChildren();
    const title = document.createElement('div'); title.className = 'settings-section-title'; title.textContent = 'Memory · OMP';
    const help = document.createElement('div'); help.className = 'settings-help-text'; help.textContent = 'OMP là nguồn dữ liệu và cấu hình. Dashboard không lưu nội dung Memory.';
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'btn-secondary'; refresh.textContent = 'Làm mới';
    refresh.setAttribute('aria-label', 'Làm mới trạng thái Memory OMP');
    refresh.disabled = memoryPanel.loading || memoryPanel.busy || Boolean(memoryPanel.snapshot?.busy) || !state.activeId;
    refresh.addEventListener('click', () => void loadOmpMemory(sessionGuard()));
    host.append(title, help, refresh);

    const note = (value, className = 'settings-help-text') => {
      const node = document.createElement('div'); node.className = className; node.textContent = value; return node;
    };
    if (!state.activeId) { host.append(note('Chọn session OMP để xem trạng thái Memory.')); return; }
    if (state.capabilities?.featureStatus?.memory !== 'supported') {
      host.append(note('OMP Memory adapter chưa khả dụng trong capability hiện tại.')); return;
    }
    if (memoryPanel.loading) host.append(note('Đang đọc backend Memory từ OMP…'));
    if (!memoryPanel.snapshot) {
      if (memoryPanel.error) host.append(note(`Không đọc được Memory: ${memoryPanel.error}`, 'settings-memory-error'));
      else if (!memoryPanel.loading) host.append(note('Chưa có trạng thái Memory. Làm mới để thử lại.'));
      return;
    }

    const snapshot = memoryPanel.snapshot;
    const status = document.createElement('div'); status.className = 'settings-memory-state'; status.setAttribute('role', 'status');
    const statusLabel = snapshot.status === 'off' ? 'Đang tắt' : snapshot.status === 'supported' ? 'Sẵn sàng' : 'Chưa khả dụng';
    status.textContent = `Backend: ${snapshot.backend} · ${statusLabel}${snapshot.busy ? ' · Session đang bận' : ''}`;
    host.append(status);
    host.append(note(typeof snapshot.scope === 'string' ? `Scope OMP: ${snapshot.scope}` : 'OMP chưa công bố scope có cấu trúc; không suy đoán phạm vi lưu trữ.'));
    if (snapshot.status === 'off') host.append(note('memory.backend đang là off. Panel không bật hoặc đổi backend.'));
    if (snapshot.status === 'unavailable') host.append(note('OMP chưa công bố lệnh Memory native khả dụng.'));
    if (memoryPanel.error) host.append(note(`Thao tác thất bại: ${memoryPanel.error}`, 'settings-memory-error'));

    const groups = [
      ['Đọc và chẩn đoán', ['view', 'stats', 'diagnose', 'queue']],
      ['Xử lý dữ liệu', ['sync', 'enqueue', 'rebuild']],
      ['Xóa dữ liệu', ['clear', 'reset']],
    ];
    const disabled = Boolean(memoryPanel.busy || snapshot.busy || memoryPanel.confirmAction);
    for (const [groupTitle, actions] of groups) {
      const available = actions.filter((action) => snapshot.operations?.includes(action));
      if (!available.length) continue;
      const group = document.createElement('div'); group.className = 'settings-memory-group';
      const label = document.createElement('div'); label.className = 'settings-row-label'; label.textContent = groupTitle;
      const buttons = document.createElement('div'); buttons.className = 'settings-memory-actions';
      for (const action of available) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-secondary';
        button.textContent = OMP_MEMORY_ACTION_LABELS[action] || action; button.disabled = disabled;
        button.addEventListener('click', () => void requestOmpMemoryAction(action, sessionGuard()));
        buttons.append(button);
      }
      group.append(label, buttons); host.append(group);
    }

    if (memoryPanel.confirmAction) {
      const { action, guard } = memoryPanel.confirmAction;
      const warningKey = ['clear', 'reset'].includes(action) ? 'clear' : 'processing';
      const confirm = document.createElement('div'); confirm.className = 'settings-memory-warning';
      const confirmTitle = document.createElement('div'); confirmTitle.className = 'settings-row-label';
      confirmTitle.textContent = `Xác nhận: ${OMP_MEMORY_ACTION_LABELS[action] || action}`;
      const warning = note(snapshot.warnings?.[warningKey] || 'Thao tác này có thể xử lý dữ liệu Memory.', 'settings-memory-warning-text');
      warning.setAttribute('role', 'alert');
      const controls = document.createElement('div'); controls.className = 'settings-memory-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-secondary'; cancel.textContent = 'Hủy';
      cancel.addEventListener('click', () => { memoryPanel.confirmAction = null; renderOmpMemoryPanel(); });
      const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'btn-secondary';
      accept.textContent = `Xác nhận ${OMP_MEMORY_ACTION_LABELS[action] || action}`;
      accept.addEventListener('click', () => void requestOmpMemoryAction(action, guard, true));
      controls.append(cancel, accept); confirm.append(confirmTitle, warning, controls); host.append(confirm);
      accept.focus();
    }

    if (memoryPanel.output) {
      const resultTitle = document.createElement('div'); resultTitle.className = 'settings-row-label';
      resultTitle.textContent = `Kết quả · ${OMP_MEMORY_ACTION_LABELS[memoryPanel.output.action] || memoryPanel.output.action}`;
      const output = document.createElement('pre'); output.className = 'settings-memory-output';
      output.textContent = memoryPanel.output.text || 'OMP hoàn tất nhưng không trả nội dung văn bản.';
      host.append(resultTitle, output);
      if (memoryPanel.output.truncated) host.append(note('Đầu ra đã được giới hạn ở 200.000 ký tự.'));
    }
  }

  async function loadOmpMemory(guard = sessionGuard(), { preserveOutput = false } = {}) {
    if (!$('ompMemoryStatus')) return;
    const request = ++memoryPanel.request;
    memoryPanel.snapshot = null; memoryPanel.loading = Boolean(guard.sessionId); memoryPanel.busy = false;
    memoryPanel.confirmAction = null; memoryPanel.error = '';
    if (!preserveOutput) memoryPanel.output = null;
    renderOmpMemoryPanel();
    if (!guard.sessionId || state.capabilities?.featureStatus?.memory !== 'supported') { memoryPanel.loading = false; renderOmpMemoryPanel(); return; }
    try {
      const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(guard.sessionId)}/memory`);
      if (request !== memoryPanel.request || !isCurrentSession(guard)) return;
      if (memoryPanel.output && memoryPanel.output.backend !== payload.backend) memoryPanel.output = null;
      memoryPanel.snapshot = payload;
    } catch (error) {
      if (request === memoryPanel.request && isCurrentSession(guard)) memoryPanel.error = error.message;
    } finally {
      if (request === memoryPanel.request && isCurrentSession(guard)) { memoryPanel.loading = false; renderOmpMemoryPanel(); }
    }
  }

  async function requestOmpMemoryAction(action, guard = sessionGuard(), confirmed = false) {
    const snapshot = memoryPanel.snapshot;
    if (!isCurrentSession(guard) || !snapshot?.operations?.includes(action) || memoryPanel.busy) return;
    if (OMP_MEMORY_CONFIRM_ACTIONS.has(action) && !confirmed) {
      memoryPanel.output = null; memoryPanel.error = ''; memoryPanel.confirmAction = { action, guard };
      renderOmpMemoryPanel(); return;
    }
    memoryPanel.busy = true; memoryPanel.confirmAction = null; memoryPanel.error = ''; memoryPanel.output = null;
    renderOmpMemoryPanel();
    try {
      const { payload } = await readJson(`${API}/sessions/${encodeURIComponent(guard.sessionId)}/memory/action`, {
        method: 'POST',
        body: JSON.stringify({ action, expectedBackend: snapshot.backend, ...(OMP_MEMORY_CONFIRM_ACTIONS.has(action) ? { confirmed: true } : {}) }),
      });
      if (!isCurrentSession(guard)) return;
      memoryPanel.output = { action, backend: payload.backend, text: String(payload.text || ''), truncated: payload.truncated === true };
      memoryPanel.busy = false;
      await loadOmpMemory(guard, { preserveOutput: true });
    } catch (error) {
      if (isCurrentSession(guard)) { memoryPanel.busy = false; memoryPanel.error = error.message; renderOmpMemoryPanel(); }
    }
  }

  function ensureOmpSettings() {
    const plugins = $('settingsTabPlugins'); const agents = $('settingsTabAgents');
    const agentsNavLabel = $('settingsNavAgents')?.querySelector('span');
    if (agentsNavLabel) agentsNavLabel.textContent = 'Tác tử OMP';
    if (plugins && !$('ompBrowserModeSelect')) {
      const card = document.createElement('div'); card.className = 'settings-section-card';
      const title = document.createElement('div'); title.className = 'settings-section-title'; title.textContent = 'Browser mode OMP';
      const help = document.createElement('div'); help.className = 'settings-help-text'; help.textContent = 'Mặc định tắt. Chỉ bật Ego Browser cho các order cần web; lựa chọn giữ nguyên đến khi tắt. Order có ảnh luôn gửi thẳng vào OMP, không qua browser skill.';
      const select = document.createElement('select'); select.id = 'ompBrowserModeSelect'; select.className = 'settings-select';
      const shareTitle = document.createElement('div'); shareTitle.className = 'settings-section-title'; shareTitle.textContent = 'Share mode OMP';
      const shareHelp = document.createElement('div'); shareHelp.className = 'settings-help-text'; shareHelp.textContent = 'Encrypted tạo liên kết OMP; Local chỉ dùng trên dashboard máy này. Collab chỉ bật khi có host adapter.';
      const shareSelect = document.createElement('select'); shareSelect.id = 'ompShareModeSelect'; shareSelect.className = 'settings-select';
      card.append(title, help, select, shareTitle, shareHelp, shareSelect); plugins.replaceChildren(card);
    }
    if (plugins && !$('ompMemoryStatus')) {
      const card = document.createElement('div'); card.id = 'ompMemoryStatus'; card.className = 'settings-section-card settings-memory-panel';
      plugins.append(card);
    }
    const select = $('ompBrowserModeSelect'); const modes = [{ id: 'none', label: 'Tắt · Chat thường', status: 'supported' }, ...(state.capabilities?.browsers || [])];
    if (select) {
      select.replaceChildren(...modes.map((mode) => { const option = document.createElement('option'); option.value = mode.id; option.textContent = `${mode.label}${mode.status === 'unavailable' ? ' · Chưa khả dụng' : mode.status === 'partial' ? ' · Một phần' : ''}`; option.disabled = mode.status === 'unavailable'; return option; }));
      const selected = modes.find((mode) => mode.id === state.browserMode && mode.status !== 'unavailable') || modes[0];
      state.browserMode = selected?.id || 'none'; localStorage.setItem('omp.browserMode', state.browserMode); select.value = state.browserMode;
      if (select.dataset.bound !== 'true') { select.dataset.bound = 'true'; select.addEventListener('change', () => { setBrowserMode(select.value); syncBrowserPill(); }); }
    }
    const shareSelect = $('ompShareModeSelect'); const shareModes = state.capabilities?.shareModes || [];
    if (shareSelect) {
      shareSelect.replaceChildren(...shareModes.map((mode) => { const option = document.createElement('option'); option.value = mode.id; option.textContent = `${mode.label}${mode.status === 'unavailable' ? ' · Chưa khả dụng' : mode.status === 'partial' ? ' · Một phần' : ''}`; option.disabled = mode.status === 'unavailable'; return option; }));
      const selected = shareModes.find((mode) => mode.id === state.shareMode && mode.status !== 'unavailable') || shareModes.find((mode) => mode.status === 'supported' || mode.status === 'partial');
      state.shareMode = selected?.id || 'encrypted'; localStorage.setItem('omp.shareMode', state.shareMode); shareSelect.value = state.shareMode;
      if (shareSelect.dataset.bound !== 'true') { shareSelect.dataset.bound = 'true'; shareSelect.addEventListener('change', () => { state.shareMode = shareSelect.value; localStorage.setItem('omp.shareMode', state.shareMode); }); }
    }
    if (agents && !$('ompAgentHubStatus')) { const card = document.createElement('div'); card.id = 'ompAgentHubStatus'; card.className = 'settings-section-card'; agents.replaceChildren(card); }
    void loadAgentHub(sessionGuard());
    if ($('ompMemoryStatus')) renderOmpMemoryPanel();
    if (state.activeId) void loadOmpMemory(sessionGuard());
  }
  function syncBrowserPill() {
    const toggle = $('egoBrowserToggle'); if (!toggle) return;
    const browser = state.capabilities?.browsers?.find((item) => item.id === 'ego-browser');
    const mode = state.capabilities?.browsers?.find((item) => item.id === state.browserMode);
    const enabled = state.browserMode === 'ego-browser' && Boolean(mode && mode.status === 'supported');
    const modeLabel = browser?.label || 'Ego Browser';
    toggle.classList.toggle('active', enabled);
    const label = toggle.querySelector('span'); if (label) label.textContent = enabled ? modeLabel : 'Ego Browser · Tắt';
    toggle.title = enabled
      ? 'Đang bật · Gõ order trong ô chat để OMP gọi /skill:ego-browser'
      : 'Bật Ego Browser khi order cần web';
    toggle.setAttribute('aria-label', toggle.title); toggle.setAttribute('aria-pressed', String(enabled)); setControlVisible(toggle, browser?.status === 'supported');
  }
  function syncPlanYoloPill() {
    const mode = state.capabilities?.sessionModes?.find((item) => item.id === 'plan-yolo');
    const enabled = state.planYolo && mode?.status === 'supported';
    const model = state.planYoloModel || state.activeModel || 'chưa chọn';
    const title = enabled ? `Plan chỉ đọc, tự duyệt rồi thực thi với ${model}; chỉ áp dụng cho chat mới.` : `Bật Plan YOLO với ${model} cho chat mới.`;
    const composerToggle = $('planYoloToggle');
    if (composerToggle) { composerToggle.hidden = mode?.status !== 'supported'; composerToggle.classList.toggle('active', enabled); const label = composerToggle.querySelector('span'); if (label) label.textContent = enabled ? 'Plan YOLO · Bật' : 'Plan YOLO · Tắt'; composerToggle.title = title; composerToggle.setAttribute('aria-label', title); composerToggle.setAttribute('aria-pressed', String(enabled)); }
    const modesToggle = $('modesPlanYoloToggle'); if (modesToggle) { modesToggle.classList.toggle('on', enabled); modesToggle.setAttribute('aria-checked', String(enabled)); modesToggle.title = enabled ? 'Tắt Plan YOLO' : 'Bật Plan YOLO'; }
  }
  function togglePlanYolo() {
    if (!state.planYolo && !(state.planYoloModel || state.activeModel)) { notify('Chọn model Plan YOLO trước khi bật.', true); return; }
    state.planYolo = !state.planYolo; syncPlanYoloPill();
    notify(`Plan YOLO ${state.planYolo ? 'đã bật' : 'đã tắt'}; chỉ áp dụng khi tạo chat mới.`);
  }
  function setControlVisible(node, visible) {
    if (!node) return;
    node.hidden = !visible;
    if (visible) { node.removeAttribute('aria-hidden'); node.style.removeProperty('display'); }
    else { node.setAttribute('aria-hidden', 'true'); node.style.setProperty('display', 'none', 'important'); }
  }
  const COMPOSER_TOOL_IDS = { 'Chạy mã Python': 'eval', 'Tìm kiếm Web': 'web_search' };
  function supportedTool(id) { return (state.capabilities?.tools || []).some((tool) => tool.id === id && tool.canToggle === true && tool.status === 'supported'); }
  function syncCapabilityControls() {
    const modes = state.capabilities?.sessionModes || [];
    const browsers = state.capabilities?.browsers || [];
    document.querySelectorAll('.quick-card').forEach((card) => {
      const action = card.dataset.action;
      const available = action === 'plan-mode'
        ? modes.some((mode) => mode.id === 'plan-yolo' && mode.status === 'supported')
        : action === 'ego-browser'
          ? browsers.some((mode) => mode.id === 'ego-browser' && mode.status === 'supported')
          : card.dataset.requiredTool ? supportedTool(card.dataset.requiredTool) : true;
      setControlVisible(card, available);
    });
    document.querySelectorAll('.plus-tool-action-item').forEach((item) => {
      const id = COMPOSER_TOOL_IDS[item.dataset.tool];
      item.dataset.ompToolId = id || '';
      setControlVisible(item, Boolean(id && supportedTool(id)));
    });
    document.querySelectorAll('.add-tag-item[data-tag-name]').forEach((item) => {
      const name = item.dataset.tagName;
      const id = COMPOSER_TOOL_IDS[name];
      const available = id ? supportedTool(id)
        : name === 'Ego Browser' ? browsers.some((mode) => mode.id === 'ego-browser' && mode.status === 'supported')
          : name === 'Toàn quyền tiếp cận';
      setControlVisible(item, available);
      const check = item.querySelector('.add-tag-check');
      if (check && id) check.textContent = state.selectedTools.includes(id) ? '✓' : '';
      if (check && name === 'Ego Browser') check.textContent = state.browserMode === 'ego-browser' ? '✓' : '';
    });
    const tagPopover = $('addTagPopover');
    if (tagPopover) {
      let heading = null;
      tagPopover.querySelectorAll(':scope > .add-tag-group-title, :scope > .add-tag-item').forEach((node) => {
        if (node.classList.contains('add-tag-group-title')) { heading = node; setControlVisible(heading, false); }
        else if (heading && !node.hidden) setControlVisible(heading, true);
      });
    }
    document.querySelectorAll('[data-production-unsupported]').forEach((node) => setControlVisible(node.closest('button, .prompt-menu-item, .settings-row') || node, false));
  }
  function bindQuickStartCards() {
    document.addEventListener('click', (event) => {
      const card = event.target.closest('.quick-card');
      if (!card || card.hidden) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const action = card.dataset.action;
      if (action === 'new-chat') { beginLocalDraft(); $('chatInput')?.focus(); return; }
      if (action === 'plan-mode') {
        if (!(state.capabilities?.sessionModes || []).some((mode) => mode.id === 'plan-yolo' && mode.status === 'supported')) return;
        if (!state.planYolo) togglePlanYolo();
        return;
      }
      if (action === 'ego-browser') {
        if (!(state.capabilities?.browsers || []).some((mode) => mode.id === 'ego-browser' && mode.status === 'supported')) return;
        setBrowserMode('ego-browser'); syncBrowserPill();
      } else if (card.dataset.requiredTool && !supportedTool(card.dataset.requiredTool)) return;
      const input = $('chatInput');
      const prompt = text(card.dataset.prompt).trim();
      if (!input || !prompt) return;
      input.value = prompt; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
      notify('Đã đưa prompt vào khung nhập; kiểm tra rồi gửi.');
    }, true);
  }
  function bindCapabilityComposerTags() {
    document.addEventListener('click', (event) => {
      const item = event.target.closest('.add-tag-item[data-tag-name],.plus-tool-action-item');
      if (!item || item.hidden) return;
      const name = item.dataset.tagName || item.dataset.tool;
      const toolId = item.dataset.ompToolId || COMPOSER_TOOL_IDS[name];
      if (toolId) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (supportedTool(toolId)) void setOmpTools(toolId, !state.selectedTools.includes(toolId));
        return;
      }
      if (name === 'Ego Browser') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!(state.capabilities?.browsers || []).some((mode) => mode.id === 'ego-browser' && mode.status === 'supported')) return;
        setBrowserMode(state.browserMode === 'ego-browser' ? 'none' : 'ego-browser');
        if (!state.activeId) prewarmDraftWorker();
        syncBrowserPill(); syncCapabilityControls();
        notify(state.browserMode === 'ego-browser' ? 'Ego Browser đã bật cho chat mới.' : 'Ego Browser đã tắt.');
        return;
      }
      if (name === 'Toàn quyền tiếp cận') {
        event.preventDefault(); event.stopImmediatePropagation();
        const permission = $('settingsPermissionSelect');
        if (permission) { permission.value = 'full_access'; permission.dispatchEvent(new Event('change', { bubbles: true })); }
      }
    }, true);
  }
  async function loadCapabilities() {
    try {
      const { payload } = await readJson('/api/v1/omp/capabilities');
      const media = payload?.media && typeof payload.media === 'object' ? payload.media : {};
      const imageGenerationModels = Array.isArray(payload?.imageGenerationModels)
        ? payload.imageGenerationModels
        : state.models.filter((model) => supportsImageGeneration(model)).map((model) => model.id);
      state.media = {
        imageGeneration: media.imageGeneration || { status: imageGenerationModels.length ? 'supported' : 'unavailable', models: imageGenerationModels },
        screenCapture: { status: media.screenCapture?.status || 'unavailable', reason: media.screenCapture?.reason || 'Native screen capture is not provided by OMP dashboard.' },
        camera: { status: media.camera?.status || 'unavailable' },
        microphone: { status: media.microphone?.status || 'unavailable' },
        video: { status: media.video?.status || 'unavailable' },
      };
      state.capabilities = { ...payload, imageGenerationModels, media: state.media };
      const supported = selectableTools();
      state.selectedTools = restoreSelectedTools(supported);
      saveSelectedTools();
      syncCapabilityControls(); renderOmpTools(); renderOmpModes(); ensureOmpSettings(); syncBrowserPill(); syncPlanYoloPill();
    } catch (error) { state.capabilities = {}; syncCapabilityControls(); renderOmpModes(); syncBrowserPill(); syncPlanYoloPill(); notify(`OMP capability lỗi: ${error.message}`, true); }
  }
  function bindDialogAccessibility() {
    const sync = (dialog) => {
      const style = getComputedStyle(dialog);
      const open = dialog.isConnected && !dialog.hidden && (dialog.classList.contains('open') || dialog.classList.contains('show')) && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && dialog.getClientRects().length > 0;
      if (open) dialog.removeAttribute('aria-hidden');
      else dialog.setAttribute('aria-hidden', 'true');
      dialog.toggleAttribute('inert', !open);
    };
    const observer = new MutationObserver((records) => {
      const dialogs = new Set();
      records.forEach((record) => {
        if (record.type === 'attributes' && record.target.matches('[role="dialog"]')) dialogs.add(record.target);
        record.addedNodes?.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches('[role="dialog"]')) dialogs.add(node);
          node.querySelectorAll('[role="dialog"]').forEach((dialog) => dialogs.add(dialog));
        });
      });
      dialogs.forEach((dialog) => {
        sync(dialog);
        observer.observe(dialog, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
      });
    });
    document.querySelectorAll('[role="dialog"]').forEach((dialog) => {
      sync(dialog);
      observer.observe(dialog, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function bindDrawerTabs() { document.querySelectorAll('.drawer-tab[data-tab]').forEach((tab) => tab.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); const name = tab.dataset.tab; document.querySelectorAll('.drawer-tab[data-tab]').forEach((node) => { const active = node === tab; node.classList.toggle('active', active); node.setAttribute('aria-selected', String(active)); }); [['tools', 'tabToolsPane'], ['modes', 'tabModesPane'], ['files', 'tabFilesPane']].forEach(([id, paneId]) => $(paneId)?.classList.toggle('active', id === name)); if (name === 'modes') void loadAdvisorConfig(); if (name === 'files') void loadWorkspaceFiles(state.workspaceMention); }, true)); }
  function bindOmpSurface() { ['egoBrowserToggle', 'planYoloToggle', 'drawerTabFilesBtn', 'drawerTabModesBtn', 'tabFilesPane', 'tabModesPane', 'settingsNavPlugins', 'settingsTabPlugins', 'settingsNavAgents', 'settingsTabAgents'].forEach((id) => { const node = $(id); if (node) { node.hidden = false; node.removeAttribute('aria-hidden'); node.style.removeProperty('display'); } }); ['fileChangeFloatingBar', 'fileChangeFloatingPill', 'shareSessionModal', 'openWindowModal', 'codeDiffReviewModal', 'upgradeModal', 'sessionContextMenu'].forEach((id) => { const node = $(id); if (node) { node.hidden = true; node.setAttribute('aria-hidden', 'true'); node.style.setProperty('display', 'none', 'important'); node.classList.remove('open'); } }); const fileList = $('drawerFilesList'); if (fileList) { fileList.replaceChildren(emptyNode('Chưa có tệp được đính kèm')); } const quotaRows = $('chatModalAccountsRows'); if (quotaRows) quotaRows.replaceChildren(emptyNode('Đang tải dữ liệu quota…')); const fileBadge = $('drawerTabFilesBtn')?.querySelector('.drawer-tab-badge'); if (fileBadge) fileBadge.textContent = '0'; $('drawerTabFilesBtn')?.setAttribute('aria-label', 'Tệp đính kèm thật'); $('drawerUploadFileBtn')?.removeAttribute('data-production-unsupported'); const permission = $('settingsPermissionSelect'); const map = { require_approval: 'always-ask', approve_for_me: 'write', full_access: 'yolo' }; if (permission) { permission.value = Object.entries(map).find(([, value]) => value === state.approvalMode)?.[0] || 'require_approval'; if (typeof setPermissionMode === 'function') setPermissionMode(permission.value, false); permission.addEventListener('change', () => { state.approvalMode = map[permission.value] || 'always-ask'; localStorage.setItem('omp.approvalMode', state.approvalMode); if (typeof setPermissionMode === 'function') setPermissionMode(permission.value, false); notify(`Đã chọn quyền OMP: ${permission.options[permission.selectedIndex]?.textContent || state.approvalMode}`); }, true); } const ego = $('egoBrowserToggle'); ego?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); state.browserMode = state.browserMode === 'ego-browser' ? 'none' : 'ego-browser'; localStorage.setItem('omp.browserMode', state.browserMode); syncBrowserPill(); }, true); $('planYoloToggle')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); togglePlanYolo(); }, true); document.addEventListener('click', (event) => { const plan = event.target.closest('[data-action="plan-mode"],#plusPlanningMode'); if (plan) { event.preventDefault(); event.stopImmediatePropagation(); togglePlanYolo(); return; } const option = event.target.closest('.approval-option-item'); if (!option) return; const mode = map[option.dataset.value] || 'always-ask'; state.approvalMode = mode; localStorage.setItem('omp.approvalMode', mode); }, true); bindDrawerTabs(); bindFileAttachment(); void loadAdvisorConfig(); }

  function ensureToolsRail() {
    const drawer = $('toolsDrawer'); if (!drawer || $('toolsDrawerRail')) return;
    const style = document.createElement('style'); style.id = 'production-tools-rail-style'; style.textContent = `.tools-drawer-rail{position:fixed;top:58px;right:0;bottom:0;width:16px;display:flex;align-items:center;justify-content:center;background:color-mix(in oklab,var(--surface),transparent 8%);border-left:1px solid var(--border);color:var(--muted);cursor:pointer;z-index:25;transition:background var(--motion-fast) var(--ease-standard),color var(--motion-fast) var(--ease-standard)}.tools-drawer-rail::before{content:"";width:3.5px;height:84px;border-radius:var(--radius-pill);background:color-mix(in oklab,var(--border),var(--fg) 42%);transition:background var(--motion-fast) var(--ease-standard),transform var(--motion-fast) var(--ease-standard)}.tools-drawer-rail:hover{background:var(--surface-hover);color:var(--fg)}.tools-drawer-rail:hover::before{background:var(--accent);transform:scaleX(1.2)}.tools-drawer-rail[hidden]{display:none}@media(max-width:920px){.tools-drawer-rail{top:58px;width:14px}.expand-sidebar-btn{display:none!important}}`;
    document.head.append(style);
    const rail = document.createElement('button'); rail.id = 'toolsDrawerRail'; rail.type = 'button'; rail.className = 'tools-drawer-rail'; rail.title = 'Mở ngăn công cụ bên phải'; rail.setAttribute('aria-label', rail.title);
    rail.addEventListener('click', () => $('toggleToolsBtn')?.click());
    document.body.append(rail);
    const sync = () => { rail.hidden = !drawer.classList.contains('collapsed'); rail.title = rail.hidden ? 'Ngăn công cụ đang mở' : 'Mở ngăn công cụ bên phải'; rail.setAttribute('aria-label', rail.title); };
    new MutationObserver(sync).observe(drawer, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  function bindActionModals() {
    const finishText = (value) => { const resolve = state.pendingTextResolve; state.pendingTextResolve = null; $('customInputModal')?.classList.remove('open'); resolve?.(text(value).trim()); };
    $('confirmCustomInputBtn')?.addEventListener('click', (event) => { if (!state.pendingTextResolve) return; event.preventDefault(); event.stopImmediatePropagation(); finishText($('customInputField')?.value); }, true);
    ['cancelCustomInputBtn', 'closeCustomInputModalBtn'].forEach((id) => $(id)?.addEventListener('click', (event) => { if (!state.pendingTextResolve) return; event.preventDefault(); event.stopImmediatePropagation(); finishText(''); }, true));
    $('customInputField')?.addEventListener('keydown', (event) => { if (event.key !== 'Enter' && event.key !== 'Escape') return; if (!state.pendingTextResolve) return; event.preventDefault(); event.stopImmediatePropagation(); finishText(event.key === 'Enter' ? event.target.value : ''); }, true);
    const finishDelete = (accepted) => { const resolve = state.pendingDeleteResolve; state.pendingDeleteResolve = null; $('deleteConfirmModal')?.classList.remove('open'); resolve?.(accepted); };
    $('confirmDeleteBtn')?.addEventListener('click', (event) => { if (!state.pendingDeleteResolve) return; event.preventDefault(); event.stopImmediatePropagation(); finishDelete(true); }, true);
    $('cancelDeleteBtn')?.addEventListener('click', (event) => { if (!state.pendingDeleteResolve) return; event.preventDefault(); event.stopImmediatePropagation(); finishDelete(false); }, true);
  }
  function bindApprovalMode() {
    const modes = {
      require_approval: { backend: 'always-ask', label: 'Yêu cầu phê duyệt', description: 'Luôn hỏi khi chỉnh sửa tệp bên ngoài và dùng internet' },
      approve_for_me: { backend: 'write', label: 'Phê duyệt giúp tôi', description: 'Chỉ hỏi khi thao tác có thể không an toàn' },
      full_access: { backend: 'yolo', label: 'Toàn quyền truy cập', description: 'Truy cập không giới hạn vào internet và mọi tệp' },
    };
    const modeTones = {
      require_approval: { color: 'var(--accent)', border: 'color-mix(in oklab, var(--accent), transparent 58%)', background: 'color-mix(in oklab, var(--accent), transparent 91%)', description: 'color-mix(in oklab, var(--accent), var(--fg) 30%)' },
      approve_for_me: { color: 'var(--success)', border: 'color-mix(in oklab, var(--success), transparent 58%)', background: 'color-mix(in oklab, var(--success), transparent 91%)', description: 'color-mix(in oklab, var(--success), var(--fg) 30%)' },
      full_access: { color: 'var(--warn)', border: 'color-mix(in oklab, var(--warn), transparent 58%)', background: 'color-mix(in oklab, var(--warn), transparent 91%)', description: 'color-mix(in oklab, var(--warn), var(--fg) 30%)' },
    };
    const backendToUi = { 'always-ask': 'require_approval', write: 'approve_for_me', yolo: 'full_access' };
    const badge = $('fullAccessBadge');
    const label = $('fullAccessLabel');
    const icon = $('fullAccessIcon');
    const popover = $('approvalPopover');
    if (!badge || !popover) return;

    const close = () => {
      popover.classList.remove('show');
      badge.classList.remove('active-popover');
      badge.setAttribute('aria-expanded', 'false');
    };
    const toggle = () => {
      const willShow = !popover.classList.contains('show');
      popover.classList.toggle('show', willShow);
      badge.classList.toggle('active-popover', willShow);
      badge.setAttribute('aria-expanded', willShow ? 'true' : 'false');
    };
    const setMode = (value, showToastMsg = true) => {
      const uiMode = modes[value] ? value : (backendToUi[value] || 'require_approval');
      const mode = modes[uiMode];
      state.approvalMode = mode.backend;
      localStorage.setItem('omp.approvalMode', mode.backend);
      if (label) label.textContent = mode.label;
      badge.title = `Chế độ phê duyệt hiện tại: ${mode.label}. Nhấp để chọn phương thức khác.`;
      badge.classList.toggle('is-active-warn', uiMode === 'full_access');
      const tone = modeTones[uiMode];
      badge.style.color = tone.color;
      badge.style.borderColor = tone.border;
      badge.style.background = tone.background;
      if (label) label.style.color = tone.color;
      if (icon) icon.style.color = tone.color;
      popover.querySelectorAll('.approval-option-item').forEach((item) => {
        const selected = item.dataset.value === uiMode;
        const optionIcon = item.querySelector('.approval-opt-icon');
        const optionTitle = item.querySelector('.approval-opt-title');
        const optionDescription = item.querySelector('.approval-opt-desc');
        const optionCheck = item.querySelector('.approval-opt-check');
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-checked', selected ? 'true' : 'false');
        item.style.background = selected ? tone.background : '';
        item.style.boxShadow = selected ? `inset 0 0 0 1px ${tone.border}` : '';
        if (optionIcon) optionIcon.style.color = selected ? tone.color : '';
        if (optionTitle) optionTitle.style.color = selected ? tone.color : '';
        if (optionDescription) optionDescription.style.color = selected ? tone.description : '';
        if (optionCheck) optionCheck.style.color = selected ? tone.color : '';
      });
      const selectedIcon = popover.querySelector(`[data-value="${uiMode}"] .approval-opt-icon`);
      if (selectedIcon && icon) icon.replaceChildren(...[...selectedIcon.childNodes].map((node) => node.cloneNode(true)));
      const settings = $('settingsPermissionSelect');
      if (settings && settings.value !== uiMode) settings.value = uiMode;
      if (showToastMsg) notify(`Chế độ phê duyệt: ${mode.label} (${mode.description})`);
    };

    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
    }, true);
    badge.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
    }, true);
    popover.querySelectorAll('.approval-option-item').forEach((item) => {
      const choose = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!modes[item.dataset.value]) return;
        setMode(item.dataset.value);
        if (!state.activeId) prewarmDraftWorker();
        close();
      };
      item.addEventListener('click', choose, true);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') choose(event);
      }, true);
    });
    $('settingsPermissionSelect')?.addEventListener('change', (event) => { setMode(event.target.value); if (!state.activeId) prewarmDraftWorker(); }, true);
    $('approvalLearnMoreLink')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      $('navSettingsBtn')?.click();
    }, true);
    document.addEventListener('click', (event) => {
      if (!popover.classList.contains('show') || popover.contains(event.target) || badge.contains(event.target)) return;
      close();
    }, true);
    setMode(state.approvalMode, false);
  }


  function bindProductionSettings() {
    if (!$('settingsGeneralResponsiveStyle')) {
      const style = document.createElement('style');
      style.id = 'settingsGeneralResponsiveStyle';
      style.textContent = '@media (max-width: 480px) { #settingsTabGeneral .settings-row-header { align-items: stretch; flex-direction: column; gap: 10px; } #settingsTabGeneral .settings-row-header > div { width: 100%; min-width: 0; } #settingsTabGeneral .settings-row-header .settings-select { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; } #settingsTabGeneral .settings-row-header .switch-label { align-self: flex-end; } }';
      document.head.append(style);
    }
  function ensureModelSourceSetting() {
    if ($('settingsModelSourceSelect')) return;
    const defaultRow = $('settingsDefaultModelSelect')?.closest('.settings-row');
    if (!defaultRow) return;
    const row = document.createElement('div');
    row.className = 'settings-row';
    if (!$('settingsModelsResponsiveStyle')) {
      const style = document.createElement('style');
      style.id = 'settingsModelsResponsiveStyle';
      style.textContent = '@media (max-width: 760px) { #settingsTabModels .settings-row-header { align-items: stretch; flex-direction: column; gap: 10px; } #settingsTabModels .settings-row-header .settings-select { width: 100%; } }';
      document.head.append(style);
    }
    const header = document.createElement('div');
    header.className = 'settings-row-header';
    const copy = document.createElement('div');
    const label = document.createElement('label');
    label.className = 'settings-row-label';
    label.htmlFor = 'settingsModelSourceSelect';
    label.textContent = 'Nguồn model Chat';
    const description = document.createElement('div');
    description.className = 'settings-row-subtext';
    description.textContent = 'Quota chỉ thống kê model cùng provider với account đã nhập; nguồn OMP cho phép chọn toàn bộ model khả dụng.';
    const select = document.createElement('select');
    select.className = 'settings-select';
    select.id = 'settingsModelSourceSelect';
    for (const [value, textValue] of [['quota', 'Account đã nhập trong Quota'], ['omp', 'Toàn bộ model khả dụng từ OMP']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = textValue;
      select.append(option);
    }
    copy.append(label, description);
    header.append(copy, select);
    row.append(header);
    defaultRow.before(row);
  }
    const thinkingValues = new Set(['max', 'high', 'medium', 'low', 'none']);
    const setThinking = (value) => {
      if (!thinkingValues.has(value)) return;
      state.thinking = value; localStorage.setItem('omp.thinking', value);
      ['promptThinkingSelect', 'settingsDefaultReasoningSelect'].forEach((id) => { const node = $(id); if (node) node.value = value; });
      const label = ({ max: 'XHigh', high: 'High', medium: 'Medium', low: 'Low', none: 'Off' })[value];
      $('reasoningActiveName') && ($('reasoningActiveName').textContent = label);
      $('headerModelReasoningBadge') && ($('headerModelReasoningBadge').textContent = label);
    };
    setThinking(state.thinking);
    $('promptThinkingSelect')?.addEventListener('change', (event) => setThinking(event.target.value), true);
    $('settingsDefaultReasoningSelect')?.addEventListener('change', (event) => setThinking(event.target.value), true);
    const conversation = $('settingsConvDisplaySelect');
    if (conversation) {
      conversation.value = state.conversationDisplay;
      document.documentElement.dataset.conversationDisplay = state.conversationDisplay;
      conversation.addEventListener('change', () => { state.conversationDisplay = conversation.value === 'expanded' ? 'expanded' : 'compact'; localStorage.setItem('omp.conversationDisplay', state.conversationDisplay); document.documentElement.dataset.conversationDisplay = state.conversationDisplay; }, true);
    }
    const enter = $('settingsEnterBehaviorSelect');
    if (enter) { enter.value = 'send'; setControlVisible(enter.closest('.settings-row'), false); }
    ['sfSortNewest', 'sfSortOldest', 'sfSortAlpha'].forEach((id) => $(id)?.addEventListener('click', () => localStorage.setItem('omp.sessionSort', id === 'sfSortAlpha' ? 'alpha' : id === 'sfSortOldest' ? 'oldest' : 'newest'), true));
    ['sfFilterRunning', 'sfFilterUnread', 'sfFilterPinned'].forEach((id) => $(id)?.addEventListener('click', () => { const mode = id === 'sfFilterRunning' ? 'running' : id === 'sfFilterUnread' ? 'unread' : 'pinned'; localStorage.setItem('omp.sessionFilter', localStorage.getItem('omp.sessionFilter') === mode ? 'all' : mode); }, true));
    $('sfActionResetAll')?.addEventListener('click', () => { localStorage.setItem('omp.sessionSort', 'newest'); localStorage.setItem('omp.sessionFilter', 'all'); }, true);
    ['settingsTempRange', 'settingsMaxTokensSelect', 'settingsLanguageSelect'].forEach((id) => setControlVisible($(id)?.closest('.settings-row'), false));
    ensureModelSourceSetting();
    const modelSourceSelect = $('settingsModelSourceSelect');
    if (modelSourceSelect) {
      modelSourceSelect.value = state.modelSource;
      modelSourceSelect.addEventListener('change', () => {
        state.modelSource = modelSourceSelect.value === 'omp' ? 'omp' : 'quota';
        localStorage.setItem('omp.chatModelSource', state.modelSource);
        void loadModels();
      }, true);
    }
  }

  function unsupported(event) { const target = event.target.closest('[data-production-unsupported],#confirmUpgradeBtn,#launchRealBrowserTabBtn,#btnModalApplyDiff,#btnModalRevertFile,#btnApplyAllDiff,#btnUndoCurrentDiff'); if (!target) return; event.preventDefault(); event.stopImmediatePropagation(); }
  function bind() {
    if (bound) return;
    bound = true;
    clearPrototypeData();
    sanitizeProductionSurface();
    bindDialogAccessibility();
    bindActionModals();
    bindProductionSettings();
    bindApprovalMode();
    bindProjectFolderModal();
    bindQuickStartCards();
    bindCapabilityComposerTags();
    syncCapabilityControls();
    ['addWorkspaceBtn', 'addProjectFolderHeaderBtn'].forEach((id) => {
      const node = $(id);
      if (!node) return;
      node.hidden = false;
      node.removeAttribute('aria-hidden');
      node.addEventListener('click', async (event) => {
        event.preventDefault(); event.stopImmediatePropagation();
        if (await requestProjectFolder()) await loadFolders({ silent: true });
      }, true);
    });
    document.addEventListener('click', unsupported, true);
    const voiceLanguage = $('voiceLanguageSelect');
    if (voiceLanguage) {
      const savedLanguage = localStorage.getItem('omp.voiceLanguage');
      voiceLanguage.value = savedLanguage === 'en-US' ? 'en-US' : 'vi-VN';
      voiceLanguage.addEventListener('change', () => localStorage.setItem('omp.voiceLanguage', voiceLanguage.value), true);
    }
    const voiceButton = $('voiceRecordBtn');
    if (voiceButton) {
      const recognitionSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
      voiceButton.disabled = !recognitionSupported;
      if (!recognitionSupported) { voiceButton.title = 'Trình duyệt này chưa hỗ trợ nhận dạng giọng nói.'; voiceButton.setAttribute('aria-label', voiceButton.title); }
      voiceButton.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); toggleVoiceInput(); }, true);
    }
    const terminalButton = $('toggleBottomPanelBtn');
    if (terminalButton) {
      terminalButton.hidden = false;
      terminalButton.disabled = false;
      terminalButton.removeAttribute('aria-hidden');
      terminalButton.title = 'Terminal máy dùng quyền OS của tài khoản đang chạy dashboard';
      terminalButton.setAttribute('aria-label', 'Bật/tắt Terminal nhúng');
      terminalButton.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); toggleEmbeddedTerminal(); }, true);
    }
    $('closeBottomPanelBtn')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); void closeEmbeddedTerminal(); }, true);
    $('clearConsoleBtn')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); terminalWidget?.clear(); terminalWidget?.focus(); }, true);
    $('copyConsoleBtn')?.addEventListener('click', async (event) => { event.preventDefault(); event.stopImmediatePropagation(); const selected = terminalWidget?.getSelection() || ''; if (!selected) { notify('Hãy chọn nội dung trong terminal để sao chép.'); return; } try { await navigator.clipboard.writeText(selected); notify('Đã sao chép nội dung terminal.'); } catch { notify('Trình duyệt không cho phép sao chép nội dung.', true); } }, true);
    document.querySelectorAll('.bottom-tab-btn').forEach((tab) => tab.addEventListener('click', (event) => {
      event.preventDefault(); event.stopImmediatePropagation();
      const key = tab.dataset.tab;
      document.querySelectorAll('.bottom-tab-btn').forEach((item) => { const active = item === tab; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
      document.querySelectorAll('.console-tab-pane').forEach((pane) => { pane.hidden = pane.id !== `pane${key[0].toUpperCase()}${key.slice(1)}`; pane.style.display = pane.hidden ? 'none' : 'flex'; });
      if (key === 'terminal') fitTerminal();
    }, true));
    window.addEventListener('resize', fitTerminal);
    $('egoBrowserToggle')?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopImmediatePropagation();
      setBrowserMode(state.browserMode === 'ego-browser' ? 'none' : 'ego-browser');
      if (!state.activeId) prewarmDraftWorker();
      syncBrowserPill();
      notify(state.browserMode === 'ego-browser' ? 'Ego Browser skill đã bật · Gõ order trong ô chat.' : 'Ego Browser skill đã tắt · Prompt gửi như chat thường.');
    }, true);
    $('newSessionBtn')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); beginLocalDraft(); }, true);
    $('promptWorkspaceTrigger')?.addEventListener('click', async (event) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (state.activeId) return;
      const selected = await requestChatWorkspace();
      if (!selected) return;
      state.draftWorkspaceCwd = selected.cwd || '';
      prewarmDraftWorker();
      syncWorkspaceMeta(null);
      notify(state.draftWorkspaceCwd ? `Workspace chat mới: ${workspaceName(state.draftWorkspaceCwd)}` : 'Chat mới dùng General workspace.');
    }, true);
    $('sendBtn')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); if (event.altKey && visibleRequest()) void stopStream(); else void sendPrompt(); }, true);
    $('chatInput')?.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.editingQueueId) { event.preventDefault(); event.stopImmediatePropagation(); cancelQueueEdit(); return; } if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopImmediatePropagation(); void sendPrompt(); } }, true);
    ['sidebarSearchInput', 'sessionSearchInput'].forEach((id) => $(id)?.addEventListener('input', renderSessions, true));
    $('connectionStatusPill')?.addEventListener('click', async (event) => {
      event.preventDefault(); event.stopImmediatePropagation(); setConnectionStatus('Đang kiểm tra…', 'syncing');
      try { const { payload } = await readJson(`${API}/models`); const models = Array.isArray(payload) ? payload : dataOf(payload, 'models') || []; if (!models.length) throw new Error('OMP không công bố model khả dụng'); setConnectionStatus('Đã kết nối', 'connected'); notify(`Kết nối OMP đang hoạt động · ${models.length} model`); }
      catch (error) { setConnectionStatus('Đã ngắt kết nối', 'disconnected'); notify(`Không thể kiểm tra kết nối OMP: ${error.message}`, true); }
    }, true);
    $('promptModelSelect')?.addEventListener('change', (event) => { const selected = state.models.find((item) => modelOptionValue(item) === event.target.value); if (selected) syncModelControls(selected); }, true);
    $('settingsDefaultModelSelect')?.addEventListener('change', (event) => { const selected = state.models.find((item) => modelOptionValue(item) === event.target.value); if (selected) syncModelControls(selected); }, true);
    $('modelCliOption')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); notify('Model Chat có thể bị giới hạn theo account Quota hoặc dùng toàn bộ catalog OMP, tùy Nguồn model Chat.', true); }, true);
    $('quotaRefreshBtn')?.addEventListener('click', async (event) => { event.preventDefault(); event.stopImmediatePropagation(); const button = $('quotaRefreshBtn'); if (button?.disabled) return; if (button) { button.disabled = true; button.classList.add('spinning'); button.setAttribute('aria-busy', 'true'); } try { await Promise.all([loadQuota(), loadModels()]); } finally { if (button) { button.disabled = false; button.classList.remove('spinning'); button.removeAttribute('aria-busy'); } } }, true);
    $('forceSyncAllOmpBtn')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); void syncQuota(); }, true);
    $('openQuotaDashboardBtn')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); $('quotaDashboardModal')?.classList.add('open'); void loadQuota(); void loadModels(); }, true);
    $('headerActiveAccountPill')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); $('quotaDashboardModal')?.classList.add('open'); void loadQuota(); void loadModels(); }, true);
    $('openFullQuotaDashboardLink')?.addEventListener('click', () => { location.href = '/quota'; });
    const activeAction = (event, action) => { event.preventDefault(); event.stopImmediatePropagation(); if (state.activeId) void runAction(state.activeId, action); else notify('Chưa chọn session', true); };
    $('headerShareBtn')?.addEventListener('click', (event) => activeAction(event, 'share'), true);
    $('headerActionDuplicate')?.addEventListener('click', (event) => activeAction(event, 'duplicate'), true);
    $('headerActionExport')?.addEventListener('click', (event) => activeAction(event, 'export'), true);
    $('headerActionFork')?.addEventListener('click', (event) => activeAction(event, 'fork'), true);
    $('headerActionPin')?.addEventListener('click', (event) => { const session = state.sessions.find((item) => item.id === state.activeId); activeAction(event, session?.isPinned ? 'unpin' : 'pin'); }, true);
    $('headerActionDelete')?.addEventListener('click', (event) => activeAction(event, 'delete'), true);
    $('headerActionRename')?.addEventListener('click', (event) => activeAction(event, 'rename'), true);
    $('headerSessionEditBtn')?.addEventListener('click', (event) => activeAction(event, 'rename'), true);
    $('settingsModal')?.style.setProperty('transition', 'none');
    ensureToolsRail();
    $('codeDiffReviewModal') && ($('codeDiffReviewModal').hidden = true);
    $('upgradeModal') && ($('upgradeModal').hidden = true);
    setInterval(() => { void loadQuota(); void loadModels(); }, 30000);
    const refreshQuotaModelAccess = () => { if (document.visibilityState !== 'hidden') { void loadQuota(); void loadModels(); } };
    window.addEventListener('focus', refreshQuotaModelAccess);
    document.addEventListener('visibilitychange', refreshQuotaModelAccess);
    $('headerParametersBtn')?.closest('.header-dropdown-wrap')?.remove();
    const pluginPane = $('settingsTabPlugins'); if (pluginPane) pluginPane.replaceChildren();
    const pluginLabel = $('settingsNavPlugins')?.querySelector('span'); if (pluginLabel) pluginLabel.textContent = 'Tích hợp';
    updateHeaderQuota({}, []); updateQuotaModal({}, [], {});
    bindOmpSurface();
    bindFileAttachment();
    renderQueueTray();
    syncModelControls(null);
    void loadCapabilities();
    void loadModels();
    void loadQuota();
    void loadFolders();
    void loadSessions();
  }
  window.HONPI_PRODUCTION_CHAT = { state, loadSessions, loadFolders, selectSession, sendPrompt, stopStream, createSession, loadQuota, loadCapabilities, renderQueueTray, enqueuePrompt, discardQueuedPrompt, sendQueuedPrompt };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else setTimeout(bind, 0);
})();
