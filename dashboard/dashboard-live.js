(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>\"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[char]));
  const clamp = (value) => Math.min(100, Math.max(0, Number(value) * 100 || 0));
  const now = () => Date.now();
  let model = null;
  let historyData = null;
  let filter = 'all';
  let search = '';

  function formatDate(value) {
    return value ? new Date(value).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : 'Chưa xác định';
  }

  function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'đã tới hạn';
    const totalMinutes = Math.floor(milliseconds / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return [days ? `${days}n` : '', hours ? `${hours}g` : '', `${minutes}p`].filter(Boolean).join(' ');
  }

  function formatTokens(value) {
    return Math.round(Number(value) || 0).toLocaleString('vi-VN');
  }

  function formatCompactTokens(value) {
    const amount = Number(value) || 0;
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `${(amount / 1000).toFixed(1)}k`;
    return String(Math.round(amount));
  }

  function windowLabel(limit) {
    if (limit.durationMs === 18000000) return '5 giờ';
    if (limit.durationMs === 604800000) return '7 ngày';
    return limit.window || 'Quota';
  }

  function uniqueLimits(account) {
    const limits = new Map();
    for (const limit of account.limits || []) {
      const key = limit.sharedGroup || limit.id;
      const old = limits.get(key);
      if (!old || limit.usedFraction > old.usedFraction) limits.set(key, limit);
    }
    return [...limits.values()].sort((a, b) => (a.durationMs || 0) - (b.durationMs || 0));
  }

  function statusFor(account) {
    const values = uniqueLimits(account).map((limit) => limit.usedFraction);
    if (!values.length) return 'warning';
    const highest = Math.max(...values);
    if (highest >= 1) return 'exhausted';
    if (highest >= 0.9) return 'critical';
    if (highest >= 0.75) return 'warning';
    return 'ok';
  }

  function statusText(status) {
    return { exhausted: 'Hết quota', critical: 'Nguy hiểm >90%', warning: 'Cảnh báo >75%', ok: 'OK' }[status];
  }

  function fillClass(percent) {
    return percent >= 90 ? 'fill-danger' : percent >= 75 ? 'fill-warn' : 'fill-ok';
  }

  function rateClass(percent) {
    return percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : '';
  }

  function providerLabel(account) {
    return account.provider === 'google-antigravity' ? 'Google Gemini' : account.provider;
  }

  function nearestReset(account) {
    return uniqueLimits(account).map((limit) => limit.resetsAt).filter(Boolean).sort((a, b) => a - b)[0] || null;
  }

  function renderWindow(limit) {
    const used = clamp(limit.usedFraction);
    const startedAt = limit.resetsAt && limit.durationMs ? limit.resetsAt - limit.durationMs : null;
    return `<div class="window-item">
      <div class="window-top-info"><span class="window-name">${esc(limit.label)} · ${esc(windowLabel(limit))}${limit.shared ? ' (Shared)' : ''}</span>
        <span class="window-rates"><strong class="rate-used ${rateClass(used)}">Đã dùng: ${used.toFixed(1)}%</strong><span class="rate-remain"> · Còn: ${(100 - used).toFixed(1)}%</span></span></div>
      <div class="quota-progress-track" role="progressbar" aria-label="${esc(limit.label)} ${esc(windowLabel(limit))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${used.toFixed(1)}"><div class="quota-progress-fill ${fillClass(used)}" style="width:${used}%"></div></div>
      <div class="window-sub-info"><span>Bắt đầu: <strong class="num">${esc(formatDate(startedAt))}</strong></span><span>Reset: <strong class="num">${esc(formatDate(limit.resetsAt))}</strong></span></div>
    </div>`;
  }

  function renderCard(account) {
    const limits = uniqueLimits(account);
    const status = statusFor(account);
    const highest = limits.length ? Math.max(...limits.map((limit) => clamp(limit.usedFraction))) : 0;
    const reset = nearestReset(account);
    const resetMinutes = reset ? Math.max(0, Math.floor((reset - now()) / 60000)) : 999999;
    const content = limits.length ? limits.map(renderWindow).join('') : '<div class="missing-data-alert">Chưa lấy được quota từ OMP.</div>';
    const integrity = limits.length ? '✓ Có dữ liệu quota' : '▲ Thiếu dữ liệu';
    const preferred = model.preferredAccountEmail && account.email.toLowerCase() === model.preferredAccountEmail.toLowerCase();
    const marker = preferred ? '<span class="active-account-badge">ƯU TIÊN OMP</span>' : '';
    const action = preferred
      ? '<button class="btn btn-secondary use-account-btn" type="button" disabled>Đang ưu tiên OMP</button>'
      : `<button class="btn btn-secondary use-account-btn" type="button" data-email="${esc(account.email)}">Sử dụng acc này</button>`;
    return `<article class="account-card state-${status}${preferred ? ' is-active' : ''}" data-status="${status}" data-used="${highest}" data-reset-mins="${resetMinutes}" data-email="${esc(account.email)}" data-active="${Boolean(preferred)}">
      <div class="acc-header"><div class="acc-identity"><span class="acc-email" title="${esc(account.email)}">${esc(account.email)}</span><div class="acc-tags"><span class="acc-provider">${esc(providerLabel(account))}</span><span class="acc-login">● Đã đăng nhập</span>${marker}</div></div><span class="status-pill status-${status}">${statusText(status)}</span></div>
      <div class="acc-windows">${content}</div>
      <div class="acc-footer"><span class="reset-countdown${reset && reset - now() < 3600000 ? ' urgent' : ''}">Reset sau: <strong>${esc(formatDuration(reset ? reset - now() : 0))}</strong></span><span class="data-integrity-badge ${limits.length ? 'complete' : 'missing'}">${integrity}</span></div>
      <div class="acc-actions">${action}</div>
    </article>`;
  }

  function groupWindows(accounts) {
    const groups = new Map();
    for (const account of accounts) {
      for (const limit of uniqueLimits(account)) {
        const key = `${limit.sharedGroup || limit.label}:${limit.durationMs || limit.window}`;
        let group = groups.get(key);
        if (!group) {
          group = { label: limit.shared ? 'Claude/GPT Shared' : limit.label, window: windowLabel(limit), values: [], resets: [] };
          groups.set(key, group);
        }
        group.values.push(clamp(limit.usedFraction));
        if (limit.resetsAt) group.resets.push(limit.resetsAt);
      }
    }
    return [...groups.values()].sort((a, b) => (a.window === '5 giờ' ? -1 : 1) - (b.window === '5 giờ' ? -1 : 1));
  }

  function renderOverview() {
    const accounts = model.accounts || [];
    const statuses = accounts.map(statusFor);
    const count = (value) => statuses.filter((status) => status === value).length;
    const total = accounts.length + (model.accountsWithoutUsage || []).length;
    const totalPill = $('.kpi-total-pill strong');
    if (totalPill) totalPill.textContent = `${accounts.length}/${total}`;
    const chips = $('.kpi-status-chips');
    if (chips) {
      const chip = (className, label, value) => value ? `<span class="kpi-chip ${className}">${label}</span>` : '';
      chips.innerHTML = [
        chip('chip-ok', `● ${count('ok')} OK`, count('ok')),
        chip('chip-warn', `▲ ${count('warning')} Cảnh báo >75%`, count('warning')),
        chip('chip-danger', `■ ${count('critical')} Nguy hiểm >90%`, count('critical')),
        chip('chip-danger', `✕ ${count('exhausted')} Hết quota`, count('exhausted'))
      ].join('');
    }
    const earliest = accounts.map(nearestReset).filter(Boolean).sort((a, b) => a - b)[0];
    const quotaWindows = accounts.flatMap(uniqueLimits);
    const exhaustedWindows = quotaWindows.filter((limit) => limit.usedFraction >= 1).length;
    const meta = $('.kpi-meta-row');
    if (meta) meta.innerHTML = `<span>${accounts.length} có quota · ${(model.accountsWithoutUsage || []).length} chưa lấy · ${(model.disabledCredentials || []).length} disabled · ${quotaWindows.length - exhaustedWindows}/${quotaWindows.length} cửa sổ còn quota · Ưu tiên OMP: ${esc(model.preferredAccountEmail || 'chưa đặt')}</span><span style="color:var(--danger);font-weight:600">Reset sớm: ${earliest ? formatDuration(earliest - now()) : 'Chưa xác định'}</span>`;
    const grid = $('.windows-mini-grid');
    if (!grid) return;
    grid.innerHTML = groupWindows(accounts).map((group) => {
      const average = group.values.length ? group.values.reduce((sum, value) => sum + value, 0) / group.values.length : 0;
      const peak = group.values.length ? Math.max(...group.values) : 0;
      const reset = group.resets.sort((a, b) => a - b)[0];
      return `<div class="window-mini-box"><div class="win-head"><span class="win-type">${esc(group.label)} ${esc(group.window)}</span><span class="win-val num">${average.toFixed(1)}%</span></div><div class="win-track" title="Trung bình: ${average.toFixed(1)}% | Đỉnh: ${peak.toFixed(1)}%"><div class="win-fill ${fillClass(peak)}" style="width:${average}%"></div></div><div class="win-meta"><span>Còn: ${(100 - average).toFixed(1)}% · Đỉnh: ${peak.toFixed(1)}% · ${group.values.length}/${accounts.length} acc</span><span>Reset: ${reset ? formatDuration(reset - now()) : '—'}</span></div></div>`;
    }).join('');
  }

  function renderHistory() {
    if (!historyData) return;
    const summary = historyData.summary || {};
    $('#history-requests').textContent = formatTokens(summary.requests);
    $('#history-total').textContent = formatCompactTokens(summary.total);
    $('#history-input').textContent = formatCompactTokens((summary.input || 0) + (summary.cacheRead || 0));
    $('#history-output').textContent = formatCompactTokens(summary.output);
    const rows = $('#history-rows');
    if (!rows) return;
    if (!historyData.items?.length) {
      rows.innerHTML = '<tr><td class="history-empty" colspan="7">Chưa có nhật ký token OMP.</td></tr>';
      return;
    }
    rows.innerHTML = historyData.items.map((item) => `<tr>
      <td class="num">${esc(formatDate(item.timestamp))}</td>
      <td class="history-account">${esc(item.email || 'Chưa xác định')}</td>
      <td class="history-model">${esc(`${item.provider}/${item.model}`)}</td>
      <td class="num">${formatTokens(item.input)}</td>
      <td class="num">${formatTokens(item.output)}</td>
      <td class="num">${formatTokens((item.cacheRead || 0) + (item.cacheWrite || 0))}</td>
      <td class="num"><strong>${formatTokens(item.total)}</strong></td>
    </tr>`).join('');
  }

  function updateCounts() {
    const counts = { all: model.accounts.length, warning: 0, critical: 0, exhausted: 0, ok: 0 };
    model.accounts.forEach((account) => { counts[statusFor(account)] += 1; });
    document.querySelectorAll('.filter-btn').forEach((button) => {
      const count = button.querySelector('.filter-count');
      const value = counts[button.dataset.filter] ?? 0;
      if (count) count.textContent = value;
      button.classList.toggle('is-hidden', button.dataset.filter !== 'all' && value === 0);
    });
  }

  function renderCards() {
    const cards = document.querySelectorAll('.account-card');
    cards.forEach((card) => {
      const matchFilter = filter === 'all' || card.dataset.status === filter;
      const haystack = `${card.dataset.email} ${$('.acc-provider', card)?.textContent || ''}`.toLowerCase();
      card.style.display = matchFilter && (!search || haystack.includes(search)) ? 'flex' : 'none';
    });
  }

  function installAccountActions() {
    document.querySelectorAll('.use-account-btn:not([disabled])').forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = 'true';
      button.addEventListener('click', async () => {
        button.disabled = true;
        const result = await fetch('/api/select-account', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: button.dataset.email })
        }).then((response) => response.json()).catch((error) => ({ ok: false, message: error.message }));
        showToast(result.message || 'Không thể chọn account');
        if (result.ok) await load();
        else button.disabled = false;
      });
    });
  }

  function render() {
    if (!model) return;
    const preferredEmail = model.preferredAccountEmail?.toLowerCase();
    const accounts = [...model.accounts].sort((a, b) => Number(b.email.toLowerCase() === preferredEmail) - Number(a.email.toLowerCase() === preferredEmail));
    $('.accounts-grid').innerHTML = accounts.length ? accounts.map(renderCard).join('') : '<div class="card">Chưa có account OMP.</div>';
    renderOverview();
    renderHistory();
    updateCounts();
    renderCards();
    installAccountActions();
    const sync = $('#live-sync-time');
    if (sync) sync.textContent = new Date(model.updatedAt).toLocaleTimeString('vi-VN');
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    $('#toast-msg').textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }

  async function load() {
    const [statusResponse, historyResponse] = await Promise.all([fetch('/api/status'), fetch('/api/history?limit=50')]);
    model = await statusResponse.json();
    historyData = await historyResponse.json();
    render();
  }

  window.applyFilter = function (value, element) {
    filter = value;
    document.querySelectorAll('.filter-btn').forEach((button) => button.classList.toggle('active', button === element));
    renderCards();
  };
  window.handleSearch = function (value) { search = value.trim().toLowerCase(); renderCards(); };
  window.handleSort = function (criteria) {
    const container = $('.accounts-grid');
    [...container.querySelectorAll('.account-card')].sort((a, b) => {
      const activeDelta = Number(b.dataset.active === 'true') - Number(a.dataset.active === 'true');
      if (activeDelta) return activeDelta;
      return criteria === 'usage-desc' ? Number(b.dataset.used) - Number(a.dataset.used) : criteria === 'reset-asc' ? Number(a.dataset.resetMins) - Number(b.dataset.resetMins) : a.dataset.email.localeCompare(b.dataset.email);
    }).forEach((card) => container.appendChild(card));
  };
  window.triggerSync = async function () { await fetch('/api/refresh', { method: 'POST' }); await load(); showToast('Đã làm mới dữ liệu OMP'); };
  window.refreshHistory = async function () { historyData = await fetch('/api/history?limit=50').then((response) => response.json()); renderHistory(); showToast('Đã làm mới History token OMP'); };

  function installLoginButton() {
    const syncButton = document.querySelector('[onclick="triggerSync()"]');
    if (!syncButton || $('#add-account')) return;
    const button = document.createElement('button');
    button.id = 'add-account';
    button.className = 'btn btn-primary';
    button.type = 'button';
    button.textContent = 'Thêm tài khoản';
    button.addEventListener('click', async () => {
      const result = await fetch('/api/login', { method: 'POST' }).then((response) => response.json());
      showToast(result.message || 'Đã mở Google OAuth');
      const timer = setInterval(async () => {
        const state = await fetch('/api/login-status').then((response) => response.json());
        if (state.state === 'complete') { clearInterval(timer); await load(); showToast(state.message); }
        if (state.state === 'error') { clearInterval(timer); showToast(state.message); }
      }, 3000);
    });
    syncButton.before(button);
  }

  installLoginButton();
  $('#history-refresh')?.addEventListener('click', window.refreshHistory);
  load().catch((error) => showToast(`Không đọc được quota: ${error.message}`));
  setInterval(() => load().catch(() => {}), 60000);
})();
