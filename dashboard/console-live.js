(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const state = { clientId: null, context: null, source: null, frameCount: 0, raw: [], activeSessionId: null, models: [], commands: [], providers: [], runtime: {}, autoRetry: true, ui: { activities: 0, activeTurn: false, assistantMessage: null } };
  const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;" }[char]));
  const text = (value) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const request = (url, options) => fetch(url, { headers: { "content-type": "application/json" }, ...options }).then(async (response) => { const body = await response.json(); if (!response.ok || body.ok === false) throw new Error(body.message || `HTTP ${response.status}`); return body; });
  const formatTime = (value) => value ? new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";

  function showStatus(label, mode = "") { $("#connection-status").innerHTML = `<span class="dot ${mode}"></span><span>${esc(label)}</span>`; }
  function setRunState(label, mode = "") { const node = $("#run-state"); node.textContent = label; node.className = `run-state ${mode}`; }
  function renderRuntime() {
    const context = state.context;
    $("#context-title").textContent = context ? `${context.status} · ${context.cwd}` : "Chưa có context";
    $("#protocol-pill").textContent = `Protocol ${context?.protocolVersion ?? "—"}`;
    $("#pid-pill").textContent = `PID ${context?.pid ?? "—"}`;
    $("#event-pill").textContent = `Events ${state.frameCount}`;
    $("#runtime-summary").innerHTML = context ? `<strong>${esc(context.status)}</strong>PID ${esc(context.pid ?? "—")}<br>cwd ${esc(context.cwd)}<br>last event ${esc(context.lastEventAt ? new Date(context.lastEventAt).toLocaleTimeString("vi-VN") : "—")}` : "Chưa có OMP process.";
    const live = context?.status === "ready" || context?.status === "starting";
    $("#start-btn").disabled = live;
    const welcomeStart = $("#welcome-start");
    if (welcomeStart) welcomeStart.disabled = live;
    $("#stop-btn").disabled = !live;
    $("#send-btn").disabled = context?.status !== "ready";
    $("#abort-btn").disabled = context?.status !== "ready";
    $("#raw-send").disabled = context?.status !== "ready";
    $("#prompt").disabled = context?.status !== "ready";
    for (const selector of ["#model-select", "#thinking-select", "#fast-toggle", "#state-btn", "#steering-select", "#follow-up-select", "#interrupt-select", "#compact-btn", "#retry-btn", "#subagents-btn", "#stats-btn", "#auto-compaction", "#auto-retry", "#subagent-level", "#bash-btn", "#abort-bash", "#todos-btn", "#login-provider", "#login-btn"]) $(selector).disabled = context?.status !== "ready";
    $("#fast-toggle").textContent = `Fast: ${state.runtime.fastModeEnabled ? "ON" : "OFF"}`;
    $("#auto-compaction").textContent = `Auto compact: ${state.runtime.autoCompactionEnabled ? "ON" : "OFF"}`;
    $("#auto-retry").textContent = `Auto retry: ${state.autoRetry ? "ON" : "OFF"}`;
    if (!state.ui.activeTurn) setRunState(context?.status === "ready" ? "Sẵn sàng" : context?.status || "Chưa kết nối");
  }

  function renderSessions(sessions = []) {
    const root = $("#sessions");
    root.innerHTML = `<button type="button" data-session-action="new">＋ New session</button>` + (sessions.length ? sessions.map((session) => `<button class="session-row" type="button" data-session-action="switch" data-session-id="${esc(session.sessionId)}"><strong>${esc(session.title || "Untitled session")}</strong><small>${esc(session.cwd || "cwd không xác định")} · ${esc(formatTime(session.updatedAt))} · ${Number(session._meta?.messageCount || 0)} msg</small></button>`).join("") : `<div class="empty">Chưa có session lưu trên máy.</div>`);
  }

  function renderModels(models = []) {
    state.models = models;
    const select = $("#model-select");
    select.innerHTML = models.length ? models.map((model, index) => `<option value="${index}">${esc(model.provider || "provider")}/${esc(model.id || model.name || "model")}</option>`).join("") : "<option>OMP chưa trả model</option>";
    const current = state.runtime.model;
    const currentIndex = models.findIndex((model) => model.provider === current?.provider && model.id === current?.id);
    if (currentIndex >= 0) select.value = String(currentIndex);
  }

  function renderCommands(commands = []) {
    state.commands = commands;
    $("#capabilities").textContent = commands.map((command) => `/${command.name}${command.input?.hint ? ` ${command.input.hint}` : ""} — ${command.description || ""}`).join("\n") || "OMP chưa trả commands.";
    $("#slash-commands").innerHTML = commands.map((command) => `<option value="/${esc(command.name)} ">${esc(command.description || command.name)}</option>`).join("");
  }

  function renderProviders(providers = []) {
    state.providers = providers;
    $("#login-provider").innerHTML = providers.length ? providers.map((provider) => `<option value="${esc(provider.id)}">${esc(provider.name)}${provider.authenticated ? " · đã đăng nhập" : " · chưa đăng nhập"}</option>`).join("") : "<option>Không có provider</option>";
  }

  async function loadSessions() {
    const cwd = $("#cwd").value.trim();
    try { renderSessions((await request(`/api/console/sessions${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`, { method: "GET" })).sessions || []); }
    catch (error) { $("#sessions").innerHTML = `<div class="empty error">${esc(error.message)}</div>`; }
  }

  async function sessionAction(action, sessionId, extra = {}) {
    if (!state.context) { showStatus("Khởi động OMP context trước", "bad"); return; }
    try {
      await request("/api/console/session", { method: "POST", body: JSON.stringify({ contextId: state.context.id, action, sessionId, ...extra }) });
      if (action === "switch" || action === "fork") state.activeSessionId = sessionId;
      $("#selected-session").textContent = state.activeSessionId ? `Đã chọn: ${state.activeSessionId}` : action === "new" ? "Session mới đang được tạo" : "Đã gửi tới OMP";
      addActivity(`Session · ${action}`, "Đã gửi yêu cầu tới OMP.");
      setTimeout(loadSessions, 300);
    } catch (error) { showStatus(error.message, "bad"); }
  }

  function handleExtensionRequest(frame) {
    if (frame.method === "cancel") {
      const dialog = $("#extension-dialog");
      if (dialog.dataset.requestId === frame.targetId && dialog.open) { dialog.returnValue = "cancel"; dialog.close(); }
      return;
    }
    if (frame.method === "set_editor_text") {
      $("#extension-input").value = frame.text || "";
      return;
    }
    if (frame.method === "notify" || frame.method === "setStatus" || frame.method === "setWidget" || frame.method === "setTitle") {
      if (frame.method === "setWidget" && !state.ui.activeTurn) return;
      addActivity(`Extension · ${frame.method}`, frame.message || frame.statusText || frame.widgetLines || frame.title || frame);
      return;
    }
    if (frame.method === "open_url") {
      addActivity("Extension · mở liên kết", frame.instructions || frame.url);
      window.open(frame.launchUrl || frame.url, "_blank", "noopener");
      return;
    }
    if (!["select", "confirm", "input", "editor"].includes(frame.method)) return;
    const dialog = $("#extension-dialog");
    const select = $("#extension-select");
    const input = $("#extension-input");
    addActivity(`Extension · ${frame.method}`, frame.message || frame.title || frame);
    $("#extension-title").textContent = frame.title || "OMP extension yêu cầu thao tác";
    $("#extension-message").textContent = frame.message || frame.placeholder || "";
    select.hidden = frame.method !== "select";
    input.hidden = !["input", "editor"].includes(frame.method);
    if (frame.method === "select") select.innerHTML = (frame.options || []).map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("");
    if (frame.method === "editor") input.value = frame.prefill || "";
    dialog.dataset.requestId = frame.id;
    dialog.dataset.method = frame.method;
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function handleResponse(frame) {
    if (!frame.success) { addActivity(`RPC lỗi · ${frame.command}`, frame.error); return; }
    if (frame.command === "get_state") {
      state.runtime = frame.data || {};
      state.context = { ...state.context, ...state.runtime, status: "ready" };
      $("#thinking-select").value = state.runtime.thinkingLevel || "off";
      $("#steering-select").value = state.runtime.steeringMode || "all";
      $("#follow-up-select").value = state.runtime.followUpMode || "all";
      $("#interrupt-select").value = state.runtime.interruptMode || "immediate";
      renderRuntime();
    }
    if (frame.command === "get_available_models") renderModels(frame.data?.models || []);
    if (frame.command === "get_login_providers") renderProviders(frame.data?.providers || []);
    if (frame.command === "set_fast_mode") { state.runtime.fastModeEnabled = frame.data?.enabled; renderRuntime(); }
    if (frame.command === "set_auto_compaction") { state.runtime.autoCompactionEnabled = frame.data?.enabled ?? state.runtime.autoCompactionEnabled; renderRuntime(); }
    if (frame.command === "get_messages") renderMessages(frame.data?.messages || []);
    if (["get_session_stats", "get_subagents", "get_subagent_messages", "get_messages_page"].includes(frame.command)) addActivity(`RPC · ${frame.command}`, frame.data || frame);
    if (["new_session", "switch_session", "branch"].includes(frame.command)) { send({ id: `state-after-${Date.now()}`, type: "get_state" }); send({ id: `messages-after-${Date.now()}`, type: "get_messages" }); }
    if (["export_html", "handoff", "compact", "branch"].includes(frame.command)) addActivity(`RPC · ${frame.command}`, frame.data || frame);
  }

  function messageContent(message) {
    const content = message?.content ?? message;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((block) => block?.type === "text").map((block) => block.text).join("");
  }

  function renderMessages(messages) {
    if (state.ui.activeTurn) return;
    const transcript = $("#transcript");
    transcript.innerHTML = "";
    state.ui.assistantMessage = null;
    if (!messages.length) {
      transcript.innerHTML = `<div class="welcome"><h2>Session sẵn sàng</h2><p>Nhập yêu cầu ở ô bên dưới. OMP sẽ trả lời trong Chat; các bước kỹ thuật chỉ xuất hiện trong Activity và Raw.</p></div>`;
      return;
    }
    for (const message of messages.slice(-100)) {
      const role = message.role === "assistant" || message.role === "user" ? message.role : "tool";
      const content = messageContent(message);
      if (content) appendChatMessage(role, content);
      else if (role === "tool") addActivity("Lịch sử · tool", message);
    }
  }

  function beginTurn() {
    state.ui.activeTurn = true;
    state.ui.assistantMessage = null;
    state.ui.activities = 0;
    $("#activity-list").innerHTML = "";
    $("#activity-count").textContent = "0";
    $("#activity-details").hidden = true;
    setRunState("Đang xử lý", "active");
  }

  function addActivity(title, payload) {
    const details = $("#activity-details");
    const list = $("#activity-list");
    const item = document.createElement("details");
    item.className = "activity-item";
    const summary = document.createElement("summary");
    summary.innerHTML = `<strong>${esc(title)}</strong><time>${new Date().toLocaleTimeString("vi-VN")}</time>`;
    const body = document.createElement("pre");
    body.textContent = text(payload);
    item.append(summary, body);
    list.append(item);
    state.ui.activities += 1;
    while (list.children.length > 80) list.firstElementChild.remove();
    $("#activity-count").textContent = String(state.ui.activities);
    $("#activity-title").textContent = state.ui.activeTurn ? "Đang xử lý · xem chi tiết" : "Chi tiết lượt chạy";
    details.hidden = false;
  }

  function appendChatMessage(role, content, allowEmpty = false) {
    const value = String(content ?? "").trim();
    if (!value && !allowEmpty) return null;
    const transcript = $("#transcript");
    const welcome = transcript.querySelector(".welcome");
    if (welcome || transcript.querySelector(".empty")) transcript.innerHTML = "";
    const item = document.createElement("article");
    item.className = `chat-message ${role}`;
    item.innerHTML = `<div class="message-meta"><span class="message-role">${role === "user" ? "Bạn" : role === "assistant" ? '<span class="assistant-mark" aria-hidden="true">✦</span>OMP' : "Tool"}</span><time>${new Date().toLocaleTimeString("vi-VN")}</time></div><div class="message-content"></div>`;
    item.querySelector(".message-content").textContent = value;
    transcript.append(item);
    transcript.scrollTop = transcript.scrollHeight;
    return item;
  }

  function updateAssistantMessage(content) {
    const value = String(content ?? "");
    if (!value) return;
    if (!state.ui.assistantMessage) state.ui.assistantMessage = appendChatMessage("assistant", value);
    else state.ui.assistantMessage.querySelector(".message-content").textContent = value;
    $("#transcript").scrollTop = $("#transcript").scrollHeight;
  }

  function handleMessageFrame(frame) {
    const type = frame.type;
    if (type === "message_start") {
      const message = frame.message || {};
      if (message.role === "assistant") setRunState("Đang trả lời", "active");
      if (message.role === "tool") addActivity("Tool bắt đầu", message);
      return;
    }
    if (type === "message_update") {
      const update = frame.assistantMessageEvent || {};
      if (update.type === "text_start") {
        if (state.ui.assistantMessage) state.ui.assistantMessage.querySelector(".message-content").textContent = "";
        else state.ui.assistantMessage = appendChatMessage("assistant", "", true);
      }
      if (update.type === "text_delta") {
        const current = state.ui.assistantMessage?.querySelector(".message-content")?.textContent || "";
        updateAssistantMessage(messageContent(update.partial) || current + (update.delta || ""));
      }
      if (update.type === "text_end") updateAssistantMessage(update.content || messageContent(update.partial));
      if (update.type === "thinking_end") addActivity("Suy nghĩ · đã hoàn tất", update.content || update);
      return;
    }
    if (type === "message_end") {
      const message = frame.message || {};
      if (message.role === "assistant") updateAssistantMessage(messageContent(message));
      if (message.role === "tool") addActivity("Tool hoàn tất", message);
      return;
    }
    if (type === "tool_execution_start") { addActivity("Tool · đang chạy", frame); return; }
    if (type === "tool_execution_end") { addActivity("Tool · hoàn tất", frame); return; }
    if (type === "turn_start" || type === "agent_start") {
      if (!state.ui.activeTurn) beginTurn();
      addActivity(type === "turn_start" ? "Bắt đầu lượt" : "Agent bắt đầu", "OMP đang xử lý yêu cầu.");
      return;
    }
    if (type === "turn_end" || type === "agent_end") {
      addActivity(type === "turn_end" ? "Lượt hoàn tất" : "Agent hoàn tất", type === "turn_end" ? frame.message || frame : frame);
      state.ui.activeTurn = false;
      state.ui.assistantMessage = null;
      setRunState("Hoàn tất", "done");
    }
  }

  function renderEvent(event, payload) {
    state.frameCount += 1;
    state.raw.unshift({ event, payload, at: Date.now() });
    state.raw = state.raw.slice(0, 80);
    $("#diagnostics").textContent = state.raw.slice(0, 12).map((item) => `${new Date(item.at).toLocaleTimeString("vi-VN")} ${item.event}\n${text(item.payload)}`).join("\n\n");
    $("#event-pill").textContent = `Events ${state.frameCount}`;
    if (event === "bridge_status") {
      state.context = payload;
      showStatus(payload.status === "ready" ? "OMP RPC ready" : `OMP ${payload.status}`, payload.status === "ready" ? "good" : payload.status === "error" ? "bad" : "");
      renderRuntime();
      return;
    }
    if (event === "bridge_error") { showStatus(payload.message || "Bridge error", "bad"); return; }
    if (event === "omp") {
      const frame = payload || {};
      if (frame.type === "available_commands_update") {
        const commands = frame.commands || [];
        renderCommands(commands);
      }
      if (frame.type === "ready") {
        state.context = { ...state.context, status: "ready", protocolVersion: frame.protocolVersion };
        showStatus("OMP RPC ready", "good");
        renderRuntime();
        setTimeout(() => { send({ id: "state-1", type: "get_state" }); send({ id: "models-1", type: "get_available_models" }); send({ id: "providers-1", type: "get_login_providers" }); send({ id: "messages-1", type: "get_messages" }); send({ id: "subagents-1", type: "set_subagent_subscription", level: "events" }); }, 50);
      }
      if (frame.type === "response") handleResponse(frame);
      if (frame.type === "extension_ui_request") handleExtensionRequest(frame);
      if (["message_start", "message_update", "message_end", "tool_execution_start", "tool_execution_end", "agent_start", "agent_end", "turn_start", "turn_end"].includes(frame.type)) handleMessageFrame(frame);
      if (!["ready", "available_commands_update", "response", "rpc_chunk", "extension_ui_request", "message_start", "message_update", "message_end", "tool_execution_start", "tool_execution_end", "agent_start", "agent_end", "turn_start", "turn_end"].includes(frame.type)) addActivity(`OMP · ${frame.type || "frame"}`, frame);
      return;
    }
    if (event === "omp_stderr") { showStatus(`OMP stderr: ${payload.text}`, ""); addActivity("OMP stderr", payload.text); }
    if (["agent_start", "turn_start", "agent_end", "turn_end", "message_update", "tool_execution_start", "tool_execution_end", "extension_ui_request"].includes(event)) handleMessageFrame({ type: event, ...payload });
  }

  function connectEvents() {
    if (state.source || !state.context || !state.clientId) return;
    state.source = new EventSource(`/api/console/events?clientId=${encodeURIComponent(state.clientId)}&contextId=${encodeURIComponent(state.context.id)}`);
    for (const name of ["omp", "bridge_status", "bridge_error", "omp_stderr"]) state.source.addEventListener(name, (event) => { try { renderEvent(name, JSON.parse(event.data)); } catch (error) { renderEvent("bridge_error", { message: `SSE frame/render lỗi: ${error.message}` }); } });
    state.source.onerror = () => { showStatus("Mất kết nối realtime, đang chờ…", "bad"); renderRuntime(); };
  }

  async function start() {
    try {
      if (!state.clientId) state.clientId = (await request("/api/console/connect", { method: "POST", body: "{}" })).clientId;
      const cwd = $("#cwd").value.trim();
      const result = await request("/api/console/start", { method: "POST", body: JSON.stringify(cwd ? { cwd } : {}) });
      state.context = result.context;
      localStorage.setItem("omp-console-context-id", state.context.id);
      state.frameCount = 0;
      showStatus("Đang khởi động OMP…");
      renderRuntime();
      connectEvents();
      setTimeout(() => send({ id: "negotiate-1", type: "negotiate_protocol", protocolVersion: 2 }), 100);
    } catch (error) { showStatus(error.message, "bad"); }
  }

  async function restore() {
    await loadSessions();
    const savedId = localStorage.getItem("omp-console-context-id");
    if (!savedId) return;
    try {
      const current = (await request("/api/console/state", { method: "GET" })).contexts.find((context) => context.id === savedId);
      if (!current || !["ready", "starting"].includes(current.status)) { localStorage.removeItem("omp-console-context-id"); return; }
      state.clientId = (await request("/api/console/connect", { method: "POST", body: "{}" })).clientId;
      state.context = current;
      showStatus("Đang nối lại OMP context…");
      renderRuntime();
      connectEvents();
    } catch (error) { showStatus(`Không nối lại được: ${error.message}`, "bad"); }
  }

  async function send(command) {
    if (!state.context) return;
    try { await request("/api/console/command", { method: "POST", body: JSON.stringify({ contextId: state.context.id, command }) }); }
    catch (error) { showStatus(error.message, "bad"); }
  }

  $("#start-btn").addEventListener("click", start);
  $("#welcome-start").addEventListener("click", start);
  $("#stop-btn").addEventListener("click", async () => { if (!state.context) return; await request("/api/console/stop", { method: "POST", body: JSON.stringify({ contextId: state.context.id }) }).catch((error) => showStatus(error.message, "bad")); localStorage.removeItem("omp-console-context-id"); });
  $("#refresh-btn").addEventListener("click", async () => { const result = await request("/api/console/state", { method: "GET" }).catch(() => null); if (result) $("#diagnostics").textContent = JSON.stringify(result, null, 2); });
  $("#raw-toggle").addEventListener("click", () => $("#raw-section").scrollIntoView({ behavior: "smooth", block: "start" }));
  $("#sessions").addEventListener("click", (event) => { const button = event.target.closest("[data-session-action]"); if (button) sessionAction(button.dataset.sessionAction, button.dataset.sessionId); });
  $("#session-actions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-command]");
    if (!button) return;
    const action = button.dataset.sessionCommand;
    const sessionId = state.activeSessionId;
    if (["rename", "fork", "branch"].includes(action) && !sessionId) { showStatus("Chọn session lưu trước", "bad"); return; }
    if (action === "rename") return sessionAction(action, sessionId, { name: $("#session-name").value });
    if (action === "branch") return sessionAction(action, sessionId, { entryId: $("#branch-entry").value });
    sessionAction(action, sessionId);
  });
  $("#raw-send").addEventListener("click", () => { try { send(JSON.parse($("#raw-input").value)); } catch { showStatus("Raw JSON không hợp lệ", "bad"); } });
  $("#abort-btn").addEventListener("click", () => send({ id: `abort-${Date.now()}`, type: "abort" }));
  $("#state-btn").addEventListener("click", () => send({ id: `state-${Date.now()}`, type: "get_state" }));
  $("#model-select").addEventListener("change", () => { const model = state.models[Number($("#model-select").value)]; if (model) send({ id: `model-${Date.now()}`, type: "set_model", provider: model.provider, modelId: model.id }); });
  $("#thinking-select").addEventListener("change", () => send({ id: `thinking-${Date.now()}`, type: "set_thinking_level", level: $("#thinking-select").value }));
  $("#fast-toggle").addEventListener("click", () => send({ id: `fast-${Date.now()}`, type: "set_fast_mode", enabled: !state.runtime.fastModeEnabled }));
  $("#steering-select").addEventListener("change", () => send({ id: `steering-${Date.now()}`, type: "set_steering_mode", mode: $("#steering-select").value }));
  $("#follow-up-select").addEventListener("change", () => send({ id: `follow-${Date.now()}`, type: "set_follow_up_mode", mode: $("#follow-up-select").value }));
  $("#interrupt-select").addEventListener("change", () => send({ id: `interrupt-${Date.now()}`, type: "set_interrupt_mode", mode: $("#interrupt-select").value }));
  $("#compact-btn").addEventListener("click", () => send({ id: `compact-${Date.now()}`, type: "compact" }));
  $("#retry-btn").addEventListener("click", () => send({ id: `retry-${Date.now()}`, type: "abort_retry" }));
  $("#subagents-btn").addEventListener("click", () => send({ id: `subagents-${Date.now()}`, type: "get_subagents" }));
  $("#stats-btn").addEventListener("click", () => send({ id: `stats-${Date.now()}`, type: "get_session_stats" }));
  $("#subagent-level").addEventListener("change", () => send({ id: `subagent-level-${Date.now()}`, type: "set_subagent_subscription", level: $("#subagent-level").value }));
  $("#auto-compaction").addEventListener("click", () => send({ id: `auto-compact-${Date.now()}`, type: "set_auto_compaction", enabled: !state.runtime.autoCompactionEnabled }));
  $("#auto-retry").addEventListener("click", () => { state.autoRetry = !state.autoRetry; renderRuntime(); send({ id: `auto-retry-${Date.now()}`, type: "set_auto_retry", enabled: state.autoRetry }); });
  $("#bash-btn").addEventListener("click", () => { const command = $("#bash-input").value.trim(); if (command) send({ id: `bash-${Date.now()}`, type: "bash", command }); });
  $("#abort-bash").addEventListener("click", () => send({ id: `abort-bash-${Date.now()}`, type: "abort_bash" }));
  $("#todos-btn").addEventListener("click", () => { try { const phases = JSON.parse($("#todo-json").value); if (!Array.isArray(phases)) throw new Error("phases phải là array"); send({ id: `todos-${Date.now()}`, type: "set_todos", phases }); } catch (error) { showStatus(`Todo JSON lỗi: ${error.message}`, "bad"); } });
  $("#login-btn").addEventListener("click", () => { const providerId = $("#login-provider").value; if (providerId) send({ id: `login-${Date.now()}`, type: "login", providerId }); });
  $("#slash-insert").addEventListener("click", () => { const value = $("#slash-input").value.trim(); if (!value) return; $("#prompt").value = `${value} `; $("#prompt").focus(); });
  $("#extension-dialog").addEventListener("close", () => {
    const dialog = $("#extension-dialog");
    const id = dialog.dataset.requestId;
    if (!id) return;
    const cancelled = dialog.returnValue !== "confirm";
    const method = dialog.dataset.method;
    const response = { type: "extension_ui_response", id, ...(cancelled ? { cancelled: true } : method === "select" ? { value: $("#extension-select").value } : method === "confirm" ? { confirmed: true } : { value: $("#extension-input").value }) };
    send(response);
    delete dialog.dataset.requestId;
    delete dialog.dataset.method;
  });
  $("#composer").addEventListener("submit", (event) => { event.preventDefault(); const message = $("#prompt").value.trim(); if (!message) return; $("#prompt").value = ""; const behavior = $("#prompt-behavior").value; beginTurn(); appendChatMessage("user", message); send({ id: `prompt-${Date.now()}`, type: behavior === "prompt" ? "prompt" : behavior === "steer" ? "steer" : "follow_up", message }); });
  $("#prompt").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#composer").requestSubmit(); } });
  $("#cwd").addEventListener("change", loadSessions);
  restore();
  renderRuntime();
})();
