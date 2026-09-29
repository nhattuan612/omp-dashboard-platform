    (function() {
      const chatInput = document.getElementById('chatInput');
      const sendBtn = document.getElementById('sendBtn');
      const chatStream = document.getElementById('chatStream');
      const greetingSection = document.getElementById('greetingSection');
      const chatScrollArea = document.getElementById('chatScrollArea');
      const toolsDrawer = document.getElementById('toolsDrawer');
      const toggleToolsBtn = document.getElementById('toggleToolsBtn');
      const closeToolsDrawerBtn = document.getElementById('closeToolsDrawerBtn');
      const speedToggleBtn = document.getElementById('speedToggleBtn');
      const activeToolsStrip = document.getElementById('activeToolsStrip');
      const toastNotice = document.getElementById('toastNotice');
      const toastMsg = document.getElementById('toastMsg');
      const upgradeModal = document.getElementById('upgradeModal');
      const closeModalBtn = document.getElementById('closeModalBtn');
      const confirmUpgradeBtn = document.getElementById('confirmUpgradeBtn');
      const mobileMenuBtn = document.getElementById('mobileMenuBtn');
      const mobileSidebarCloseBtn = document.getElementById('mobileSidebarCloseBtn');
      const appSidebar = document.getElementById('appSidebar');

      let isSpeedMode = false;
      let activeTags = [];
      let activeTools = new Set();

      function showToast(text) {
        if (typeof window !== "undefined") window.showToast = showToast;
        toastMsg.textContent = text;
        toastNotice.classList.add('show');
        setTimeout(() => toastNotice.classList.remove('show'), 2600);
      }

      function getTagIconSvg(iconName) {
        switch(iconName) {
          case 'code':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
          case 'globe':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
          case 'file':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
          case 'folder':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
          case 'calc':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line></svg>';
          case 'terminal':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';
          case 'shield':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
          case 'brain':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-5.04z"></path></svg>';
          case 'image':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
          case 'target':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>';
          case 'lightbulb':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"></path></svg>';
          case 'disc':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>';
          case 'lock':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
          case 'cloud':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>';
          case 'git':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M13 6h3a2 2 0 0 1 2 2v7"></path><line x1="6" y1="9" x2="6" y2="21"></line></svg>';
          case 'layout':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>';
          case 'palette':
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 10 10 0 0 0 9.5-6.5A10 10 0 0 0 12 2z"></path></svg>';
          default:
            return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';
        }
      }

      function updateActiveToolsUI() {
        if (!activeToolsStrip) return;
        activeToolsStrip.innerHTML = '';

        // Ego Browser và Toàn quyền đã có nút trạng thái sáng ở thanh công cụ dưới,
        // không hiển thị trùng lặp làm thẻ ở thanh trên để giữ dải thẻ gọn gàng trên 1 hàng duy nhất
        const visibleTags = activeTags.filter(tag => tag.name !== 'Ego Browser' && tag.name !== 'Toàn quyền tiếp cận' && tag.name !== 'Toàn quyền');

        // Khi không có thẻ nào: ẩn hoàn toàn dải thẻ và không hiển thị ô "+ Thêm thẻ" (từ yêu cầu image-63)
        // Người dùng có thể thêm bất kỳ thẻ, công cụ, plugin hoặc tệp nào từ nút dấu [+] ở thanh dưới
        if (visibleTags.length === 0) {
          activeToolsStrip.style.display = 'none';
          return;
        }

        // Khi có ít nhất 1 thẻ hoạt động: hiển thị dải thẻ
        activeToolsStrip.style.display = 'flex';
        visibleTags.forEach(tag => {
          const pill = document.createElement('div');
          pill.className = `active-tool-pill tag-${tag.category}`;
          pill.innerHTML = `
            <span style="display:inline-flex;align-items:center;gap:4px;">
              ${getTagIconSvg(tag.icon)}
              <span>${tag.name}</span>
            </span>
            <span class="remove-tool-btn" data-id="${tag.id}" title="Gỡ thẻ">✕</span>
          `;
          pill.querySelector('.remove-tool-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            removeTag(tag.id);
          });
          activeToolsStrip.appendChild(pill);
        });

        // Add "+ Thêm thẻ" trigger at the end of the strip
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-add-tag-trigger';
        addBtn.id = 'addTagTriggerBtn';
        addBtn.innerHTML = `
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Thêm thẻ</span>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        `;
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const pop = document.getElementById('addTagPopover');
          if (pop) pop.classList.toggle('show');
        });
        activeToolsStrip.appendChild(addBtn);

        // Update checkmarks in addTagPopover
        document.querySelectorAll('.add-tag-item').forEach(item => {
          const tagName = item.getAttribute('data-tag-name');
          const checkEl = item.querySelector('.add-tag-check');
          if (!checkEl) return;
          if (tagName === 'Ego Browser') {
            const egoToggle = document.getElementById('egoBrowserToggle');
            checkEl.textContent = (egoToggle && egoToggle.classList.contains('active')) ? '✓' : '';
          } else if (tagName === 'Toàn quyền tiếp cận' || tagName === 'Toàn quyền') {
            const faLabel = document.getElementById('fullAccessLabel');
            checkEl.textContent = (faLabel && faLabel.textContent === 'Toàn quyền') ? '✓' : '';
          } else {
            const isPresent = visibleTags.some(t => t.name === tagName);
            checkEl.textContent = isPresent ? '✓' : '';
          }
        });
      }

      function removeTag(tagId) {
        const idx = activeTags.findIndex(t => t.id === tagId);
        if (idx !== -1) {
          const removed = activeTags.splice(idx, 1)[0];
          if (removed.isTool) {
            activeTools.delete(removed.name);
            const toggleEl = document.querySelector(`.toggle-switch[data-tool="${removed.name}"]`);
            if (toggleEl) toggleEl.classList.remove('on');
          }
          if (removed.name === 'Ego Browser') {
            const egoToggle = document.getElementById('egoBrowserToggle');
            if (egoToggle) egoToggle.classList.remove('active');
          }
          if (removed.name === 'Toàn quyền tiếp cận') {
            const faBadge = document.getElementById('fullAccessBadge');
            const faLabel = document.getElementById('fullAccessLabel');
            if (faLabel) faLabel.textContent = 'Tiêu chuẩn';
            if (faBadge) {
              faBadge.style.color = 'var(--muted)';
              faBadge.style.borderColor = 'var(--border)';
              faBadge.style.background = 'var(--surface)';
            }
          }
          showToast(`Đã gỡ thẻ: ${removed.name}`);
          updateActiveToolsUI();
        }
      }

      function toggleTagByName(name, category, icon, isTool) {
        const idx = activeTags.findIndex(t => t.name === name);
        if (idx !== -1) {
          removeTag(activeTags[idx].id);
        } else {
          const newTag = {
            id: 'tag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            name: name,
            category: category || 'blue',
            icon: icon || 'code',
            isTool: !!isTool
          };
          activeTags.push(newTag);
          if (isTool) {
            activeTools.add(name);
            const toggleEl = document.querySelector(`.toggle-switch[data-tool="${name}"]`);
            if (toggleEl) toggleEl.classList.add('on');
          }
          showToast(`Đã thêm thẻ: ${name}`);
          updateActiveToolsUI();
        }
      }

      function toggleTool(toolName, forceState) {
        const isPresent = activeTags.some(t => t.name === toolName);
        const nextState = forceState !== undefined ? forceState : !isPresent;
        if (nextState && !isPresent) {
          activeTags.push({
            id: 'tool_' + Date.now(),
            name: toolName,
            category: 'blue',
            icon: 'code',
            isTool: true
          });
          activeTools.add(toolName);
          const toggleEl = document.querySelector(`.toggle-switch[data-tool="${toolName}"]`);
          if (toggleEl) {
            toggleEl.classList.add('on');
            toggleEl.setAttribute('aria-checked', 'true');
            const statusTag = toggleEl.closest('.tool-item-row')?.querySelector('.tool-item-status-tag');
            if (statusTag) {
              statusTag.textContent = 'Bật';
              statusTag.classList.add('tag-active');
            }
          }
          showToast(`Đã bật công cụ: ${toolName}`);
        } else if (!nextState && isPresent) {
          const idx = activeTags.findIndex(t => t.name === toolName);
          if (idx !== -1) activeTags.splice(idx, 1);
          activeTools.delete(toolName);
          const toggleEl = document.querySelector(`.toggle-switch[data-tool="${toolName}"]`);
          if (toggleEl) {
            toggleEl.classList.remove('on');
            toggleEl.setAttribute('aria-checked', 'false');
            const statusTag = toggleEl.closest('.tool-item-row')?.querySelector('.tool-item-status-tag');
            if (statusTag) {
              statusTag.textContent = 'Tắt';
              statusTag.classList.remove('tag-active');
            }
          }
          showToast(`Đã tắt công cụ: ${toolName}`);
        }
        updateActiveToolsUI();
      }

      updateActiveToolsUI();

      document.querySelectorAll('.toggle-switch').forEach(sw => {
        sw.addEventListener('click', () => {
          const tool = sw.getAttribute('data-tool');
          toggleTool(tool);
        });
      });
      if (speedToggleBtn) {
        speedToggleBtn.addEventListener('click', () => {
          isSpeedMode = !isSpeedMode;
          speedToggleBtn.classList.toggle('active', isSpeedMode);
          showToast(isSpeedMode ? 'Đã kích hoạt Chế độ Siêu tốc' : 'Đang dùng Chế độ Suy luận Tiêu chuẩn');
        });
      }
      function toggleDrawer(open) {
        if (!toolsDrawer) return;
        const mobile = window.matchMedia('(max-width: 920px)').matches;
        const currentOpen = mobile ? toolsDrawer.classList.contains('mobile-open') : !toolsDrawer.classList.contains('collapsed');
        const nextOpen = open !== undefined ? open : !currentOpen;
        toolsDrawer.classList.toggle('collapsed', !nextOpen);
        toolsDrawer.classList.toggle('mobile-open', mobile && nextOpen);
        if (!mobile) toolsDrawer.classList.remove('mobile-open');
        if (toggleToolsBtn) toggleToolsBtn.classList.toggle('active', nextOpen);
      }
      if (toggleToolsBtn) toggleToolsBtn.addEventListener('click', () => toggleDrawer());
      if (closeToolsDrawerBtn) closeToolsDrawerBtn.addEventListener('click', () => toggleDrawer(false));

      // ─── Drawer Tab Switching (Công cụ / Tệp tin) ───
      const drawerTabs = document.querySelectorAll('.drawer-tab');
      const drawerPanes = {
        tools: document.getElementById('tabToolsPane'),
        files: document.getElementById('tabFilesPane')
      };
      drawerTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const tabKey = tab.getAttribute('data-tab');
          drawerTabs.forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
          });
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          Object.keys(drawerPanes).forEach(k => {
            if (drawerPanes[k]) {
              drawerPanes[k].classList.toggle('active', k === tabKey);
            }
          });
        });
      });

      // ─── Filter files in Drawer Files Tab ───
      const drawerFilesSearchInput = document.getElementById('drawerFilesSearchInput');
      if (drawerFilesSearchInput) {
        drawerFilesSearchInput.addEventListener('input', () => {
          const query = drawerFilesSearchInput.value.toLowerCase().trim();
          document.querySelectorAll('.drawer-file-item').forEach(item => {
            const fileName = item.getAttribute('data-file-name')?.toLowerCase() || '';
            item.style.display = fileName.includes(query) ? 'flex' : 'none';
          });
        });
      }

      // ─── Preview File Action ───
      document.querySelectorAll('.view-file-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const item = btn.closest('.drawer-file-item');
          const fileName = item?.getAttribute('data-file-name') || 'Tệp';
          showToast(`Đang mở xem tệp: ${fileName}`);
        });
      });

      // ─── Upload file trigger ───
      const drawerUploadFileBtn = document.getElementById('drawerUploadFileBtn');
      if (drawerUploadFileBtn) {
        drawerUploadFileBtn.addEventListener('click', () => {
          showToast('Đang mở hộp thoại chọn tệp tải lên...');
        });
      }

      // ─── Allow clicking tool item row to toggle ───
      document.querySelectorAll('.tool-item-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.toggle-switch')) return;
          const sw = row.querySelector('.toggle-switch');
          if (sw) {
            const tool = sw.getAttribute('data-tool');
            if (tool) toggleTool(tool);
          }
        });
      });
      if (chatInput) {
        chatInput.addEventListener('input', () => {
          chatInput.style.height = 'auto';
          chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
          const len = chatInput.value.length;
          const estTokens = len === 0 ? 0 : Math.max(1, Math.round(len / 3.6));
          const counterEl = document.getElementById('charTokenCounter');
          if (counterEl) counterEl.textContent = `T ${len} ký tự · ~ ${estTokens} tokens`;
        });
      }

      // Welcome cards use the same real composer path as normal messages.
      document.addEventListener('click', (event) => {
        const card = event.target.closest('.quick-card');
        if (!card || !chatInput) return;
        const action = card.dataset.action || 'fill-dock';
        const prompt = card.dataset.prompt || '';
        if (action === 'new-chat') {
          event.preventDefault();
          if (typeof createNewSession === 'function') createNewSession();
          return;
        }
        if (action === 'ego-browser' && typeof toggleEgoBrowser === 'function' && !document.getElementById('egoBrowserToggle')?.classList.contains('active')) toggleEgoBrowser();
        if (action === 'plan-mode' && !document.getElementById('planYoloToggle')?.classList.contains('active')) document.getElementById('planYoloToggle')?.click();
        if (!prompt) return;
        chatInput.value = prompt;
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (action === 'send-now' || action === 'ego-browser' || action === 'plan-mode') document.getElementById('sendBtn')?.click();
        else chatInput.focus();
      }, true);

      // Activity detail collapsible toggles (Mặc định luôn thu gọn - from image-22 & 25)
      window.toggleActivityDetails = function(headerEl) {
        const box = headerEl.closest('.turn-activity-box');
        if (!box) return;
        box.classList.toggle('collapsed');
      };

      window.toggleTechDetails = function(btnEl) {
        btnEl.classList.toggle('expanded');
        const details = btnEl.nextElementSibling;
        if (details && details.classList.contains('activity-tech-details')) {
          details.classList.toggle('show');
        }
      };
      // Command micro-row execution group toggle (from image-51: Interleaved execution stream)
      window.toggleExecGroup = function(el) {
        el.classList.toggle('open');
        const next = el.nextElementSibling;
        if (next && next.classList.contains('exec-sub-list')) {
          next.classList.toggle('show');
        }
      };

      // Floating Scroll to Bottom Button
      const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
      if (scrollToBottomBtn && chatScrollArea) {
        chatScrollArea.addEventListener('scroll', () => {
          const isNearBottom = chatScrollArea.scrollHeight - chatScrollArea.scrollTop - chatScrollArea.clientHeight < 140;
          if (chatScrollArea.scrollTop > 120 && !isNearBottom) {
            scrollToBottomBtn.classList.add('visible');
          } else {
            scrollToBottomBtn.classList.remove('visible');
          }
        });
        scrollToBottomBtn.addEventListener('click', () => {
          chatScrollArea.scrollTo({ top: chatScrollArea.scrollHeight, behavior: 'smooth' });
        });
      }

      function scrollBottom() {
        setTimeout(() => {
          chatScrollArea.scrollTo({ top: chatScrollArea.scrollHeight, behavior: 'smooth' });
        }, 50);
      }

      function escapeHtml(str) {
        return str.replace(/[&<>"']/g, m => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[m]));
      }

      window.copySnippet = function(btn) {
        const pre = btn.closest('.code-box').querySelector('.code-pre');
        if (pre) {
          navigator.clipboard.writeText(pre.innerText).then(() => {
            showToast('Đã sao chép mã nguồn vào bộ nhớ tạm');
          });
        }
      };

      // ─── Workspace Selector in Bottom Meta (from image-28, 29, 30, 50) ───
      const promptWsTrigger = document.getElementById('promptWorkspaceTrigger');
      const promptWsDropdown = document.getElementById('promptWsDropdown');
      const promptCurrentWsLabel = document.getElementById('promptCurrentWsLabel');
      const promptWsWrapper = document.getElementById('promptWsWrapper');
      const promptWsChevron = document.getElementById('promptWsChevron');

      // "khi vào order rồi chỉ chổ listbox chọn folder chỉ hiện thông tin chứ ko hiện mũi tên để chọn nữa" (image-50)
      function updateWorkspaceSelectorVisibility() {
        const wsWrapper = document.getElementById('promptWsWrapper');
        const wsTrigger = document.getElementById('promptWorkspaceTrigger');
        const wsChevron = document.getElementById('promptWsChevron');
        const wsDropdown = document.getElementById('promptWsDropdown');
        const wsLabel = document.getElementById('promptCurrentWsLabel');
        if (!wsWrapper || !wsTrigger) return;

        // Đồng bộ nhãn thư mục từ session đang kích hoạt nếu có
        const activeSession = document.querySelector('.session-item.active');
        if (activeSession && wsLabel) {
          const sessionProject = activeSession.getAttribute('data-project');
          if (sessionProject) {
            wsLabel.textContent = sessionProject;
          }
        }

        const hasUserOrders = chatStream && chatStream.querySelector('.user-msg-wrap');
        if (hasUserOrders) {
          // ĐÃ VÀO ORDER: Luôn hiển thị thông tin thư mục, KHÔNG hiện mũi tên để chọn nữa (từ image-50)
          wsWrapper.classList.add('is-info-only');
          wsWrapper.classList.remove('is-picker');
          wsWrapper.style.display = 'inline-flex';
          const curWs = wsLabel ? wsLabel.textContent.trim() : 'Dự án';
          wsTrigger.setAttribute('title', `Thư mục dự án: ${curWs}`);
          wsTrigger.setAttribute('aria-haspopup', 'false');
          if (wsChevron) wsChevron.style.display = 'none';
          if (wsDropdown) wsDropdown.classList.remove('show');
        } else {
          // CHƯA VÀO ORDER (Cuộc trò chuyện mới): Hiện mũi tên để chọn không gian làm việc
          wsWrapper.classList.remove('is-info-only');
          wsWrapper.classList.add('is-picker');
          wsWrapper.style.display = 'inline-flex';
          wsTrigger.setAttribute('title', 'Chọn không gian làm việc cho cuộc trò chuyện mới');
          wsTrigger.setAttribute('aria-haspopup', 'true');
          if (wsChevron) wsChevron.style.display = 'inline-block';
        }
      }
      window.updateWorkspaceSelectorVisibility = updateWorkspaceSelectorVisibility;

      if (promptWsTrigger && promptWsDropdown) {
        promptWsTrigger.addEventListener('click', (e) => {
          e.stopPropagation();
          const wsWrapper = document.getElementById('promptWsWrapper');
          // Nếu đã vào order (chế độ chỉ hiển thị thông tin), không mở dropdown chọn nữa!
          if (wsWrapper && wsWrapper.classList.contains('is-info-only')) {
            return;
          }
          promptWsDropdown.classList.toggle('show');
          closePromptPopovers(promptWsDropdown);
        });

        promptWsDropdown.querySelectorAll('.prompt-ws-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const ws = item.getAttribute('data-ws');
            promptWsDropdown.querySelectorAll('.prompt-ws-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            if (promptCurrentWsLabel) promptCurrentWsLabel.textContent = ws;
            const activeSession = document.querySelector('.session-item.active');
            if (activeSession) {
              activeSession.setAttribute('data-project', ws);
            }
            const headerPillTitle = document.getElementById('headerSessionTitle');
            if (headerPillTitle) {
              headerPillTitle.title = `Không gian làm việc: ${ws}`;
            }
            showToast(`Đã chọn không gian làm việc: ${ws}`);
            promptWsDropdown.classList.remove('show');
          });
        });
      }

      // ─── Prompt Hint Dismiss ───
      const dismissHintBtn = document.getElementById('dismissHintBtn');
      const promptHint = document.getElementById('promptHint');
      if (dismissHintBtn && promptHint) {
        dismissHintBtn.addEventListener('click', () => {
          promptHint.style.display = 'none';
        });
      }

      // ─── Add Tag Popover Items (from image-11) ───
      const addTagPopover = document.getElementById('addTagPopover');
      if (addTagPopover) {
        addTagPopover.querySelectorAll('.add-tag-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = item.getAttribute('data-tag-name');
            const category = item.getAttribute('data-tag-category');
            const icon = item.getAttribute('data-tag-icon');
            if (name === 'Ego Browser') {
              toggleEgoBrowser();
            } else if (name === 'Toàn quyền tiếp cận' || name === 'Toàn quyền') {
              if (fullAccessBadge) fullAccessBadge.click();
            } else {
              const isTool = category === 'blue';
              toggleTagByName(name, category, icon, isTool);
            }
          });
        });
      }

      // ─── Plus Action Menu (from image-9) ───
      const promptPlusBtn = document.getElementById('promptPlusBtn');
      const promptPlusMenu = document.getElementById('promptPlusMenu');
      if (promptPlusBtn && promptPlusMenu) {
        const closePlusMenu = () => {
          promptPlusMenu.classList.remove('show');
          promptPlusBtn.setAttribute('aria-expanded', 'false');
        };
        const plusSearchInput = document.getElementById('plusMenuSearchInput');
        const plusEmptyState = document.getElementById('plusMenuEmpty');

        function resetPlusMenuSearch() {
          if (plusSearchInput) {
            plusSearchInput.value = '';
          }
          promptPlusMenu.querySelectorAll('.prompt-menu-item').forEach(item => {
            item.style.display = 'flex';
          });
          promptPlusMenu.querySelectorAll('.plus-menu-section').forEach(sec => {
            const hdr = sec.querySelector('.plus-menu-section-header');
            if (hdr) hdr.style.display = 'block';
          });
          if (plusEmptyState) plusEmptyState.style.display = 'none';
        }

        promptPlusBtn.addEventListener('click', (e) => {
          if (promptPlusBtn.dataset.productionBound === 'true') return;
          e.stopPropagation();
          const willShow = !promptPlusMenu.classList.contains('show');
          promptPlusMenu.classList.toggle('show', willShow);
          closePromptPopovers(promptPlusMenu);
          if (willShow) {
            resetPlusMenuSearch();
            if (plusSearchInput) {
              setTimeout(() => plusSearchInput.focus(), 50);
            }
          }
        });

        // Search filter listener
        if (plusSearchInput) {
          plusSearchInput.addEventListener('input', (e) => {
            const query = (e.target.value || '').toLowerCase().trim();
            let visibleTotal = 0;

            promptPlusMenu.querySelectorAll('.plus-menu-section').forEach(sec => {
              const items = sec.querySelectorAll('.prompt-menu-item');
              let visibleInSec = 0;
              items.forEach(item => {
                const searchData = (item.getAttribute('data-search') || '').toLowerCase();
                const text = (item.textContent || '').toLowerCase();
                const isMatch = !query || searchData.includes(query) || text.includes(query);
                if (isMatch) {
                  item.style.display = 'flex';
                  visibleInSec++;
                  visibleTotal++;
                } else {
                  item.style.display = 'none';
                }
              });
              const hdr = sec.querySelector('.plus-menu-section-header');
              if (hdr) hdr.style.display = (visibleInSec > 0 || !query) ? 'block' : 'none';
            });

            if (plusEmptyState) {
              plusEmptyState.style.display = visibleTotal === 0 ? 'block' : 'none';
            }
          });

          plusSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              closePlusMenu();
            }
          });
        }

        // Section 1: Thêm
        const plusAttachFile = document.getElementById('plusAttachFile');
        if (plusAttachFile) {
          plusAttachFile.addEventListener('click', () => {
            closePlusMenu();
            toggleTagByName('contact-page.html', 'emerald', 'file', false);
            showToast('Đã chọn tệp đính kèm: contact-page.html');
          });
        }

        const plusAttachOpenDesign = document.getElementById('plusAttachOpenDesign');
        if (plusAttachOpenDesign) {
          plusAttachOpenDesign.addEventListener('click', () => {
            closePlusMenu();
            toggleTagByName('Open Design Canvas', 'cyan', 'image', false);
            showToast('Đã đính kèm ảnh chụp bản vẽ Open Design vào ngữ cảnh');
          });
        }

        const plusWorkInProject = document.getElementById('plusWorkInProject');
        if (plusWorkInProject) {
          plusWorkInProject.addEventListener('click', () => {
            closePlusMenu();
            const wsDrop = document.getElementById('promptWsDropdown');
            if (wsDrop) wsDrop.classList.add('show');
            showToast('Chọn dự án làm việc cho cuộc trò chuyện mới');
          });
        }

        const plusSetGoal = document.getElementById('plusSetGoal');
        if (plusSetGoal) {
          plusSetGoal.addEventListener('click', () => {
            closePlusMenu();
            toggleTagByName('Mục tiêu dự án', 'amber', 'target', false);
            showToast('Đã đặt mục tiêu để tiếp tục theo đuổi');
          });
        }

        const plusPlanningMode = document.getElementById('plusPlanningMode');
        if (plusPlanningMode) {
          plusPlanningMode.addEventListener('click', () => {
            closePlusMenu();
            toggleTagByName('Chế độ lập kế hoạch', 'violet', 'lightbulb', false);
            showToast('Đã bật chế độ lập kế hoạch (Planning Mode)');
          });
        }

        const plusRecordSkill = document.getElementById('plusRecordSkill');
        if (plusRecordSkill) {
          plusRecordSkill.addEventListener('click', () => {
            closePlusMenu();
            toggleTagByName('Ghi kỹ năng', 'cyan', 'disc', false);
            showToast('Đã kích hoạt chế độ Ghi lại một kỹ năng mới');
          });
        }

        const plusDrawSketch = document.getElementById('plusDrawSketch');
        if (plusDrawSketch) {
          plusDrawSketch.addEventListener('click', () => {
            closePlusMenu();
            showToast('Mở bảng vẽ phác thảo ý tưởng (Sketch Canvas)');
          });
        }

        // Section: Công cụ thực thi (Tools)
        promptPlusMenu.querySelectorAll('.plus-tool-action-item').forEach(item => {
          item.addEventListener('click', () => {
            closePlusMenu();
            const toolName = item.getAttribute('data-tool');
            if (toolName && typeof toggleTool === 'function') {
              toggleTool(toolName);
            }
          });
        });

        // Section 2: Plugins
        promptPlusMenu.querySelectorAll('.plus-plugin-item').forEach(item => {
          item.addEventListener('click', () => {
            closePlusMenu();
            const pluginName = item.getAttribute('data-plugin') || 'Plugin';
            const cat = item.getAttribute('data-category') || 'blue';
            const icon = item.getAttribute('data-icon') || 'code';
            toggleTagByName(pluginName, cat, icon, false);
            showToast(`Đã kích hoạt plugin: ${pluginName}`);
          });
        });

        // Section 3: Ứng dụng
        promptPlusMenu.querySelectorAll('.plus-app-item').forEach(item => {
          item.addEventListener('click', () => {
            closePlusMenu();
            const appName = item.getAttribute('data-app') || 'Ứng dụng';
            const cat = item.getAttribute('data-category') || 'emerald';
            const icon = item.getAttribute('data-icon') || 'shield';
            toggleTagByName(appName, cat, icon, false);
            showToast(`Cấu hình ứng dụng: ${appName}`);
          });
        });

        // Section 4: Hội thoại đã lưu
        promptPlusMenu.querySelectorAll('.plus-chat-item').forEach(item => {
          item.addEventListener('click', () => {
            closePlusMenu();
            const chatName = item.getAttribute('data-chat') || 'Hội thoại';
            if (chatInput) {
              const prefix = `[Tham chiếu hội thoại: ${chatName}] `;
              if (!chatInput.value.includes(prefix)) {
                chatInput.value = prefix + chatInput.value;
              }
              chatInput.focus();
              const counterEl = document.getElementById('charTokenCounter');
              if (counterEl) {
                const len = chatInput.value.length;
                const tokens = Math.round(len / 3.8);
                counterEl.textContent = `T ${len} ký tự · ~ ${tokens} tokens`;
              }
            }
            showToast(`Đã đính kèm ngữ cảnh hội thoại: ${chatName}`);
          });
        });

        // Section 5: Tệp và trò chuyện search item
        const plusSearchActionItem = document.getElementById('plusSearchActionItem');
        if (plusSearchActionItem) {
          plusSearchActionItem.addEventListener('click', () => {
            if (plusSearchInput) {
              plusSearchInput.focus();
              plusSearchInput.select();
            }
            showToast('Nhập từ khóa để tìm kiếm tệp, plugin hoặc cuộc trò chuyện');
          });
        }
      }

      const attachBtn = document.getElementById('attachBtn');
      if (attachBtn) {
        attachBtn.addEventListener('click', () => {
          showToast('Chọn tệp đính kèm để bổ sung ngữ cảnh cho mô hình');
        });
      }

      // ─── Prompt Template Selector (from image-9) ───
      const promptTemplateSelect = document.getElementById('promptTemplateSelect');
      const promptTemplates = {
        'template-writer': 'Soạn thảo một bài viết blog chuyển đổi cao về [Chủ đề], giọng văn chuyên nghiệp, cấu trúc rõ ràng với mở bài thu hút, 3 luận điểm chính và lời kêu gọi hành động thuyết phục.',
        'template-audit': 'Kiểm toán toàn diện đoạn mã nguồn dưới đây về bảo mật, hiệu năng, cấu trúc module và đề xuất phương án tối ưu hóa chuẩn Design System:',
        'template-research': 'Tổng hợp tài liệu và so sánh đa chiều giữa [Công nghệ A] và [Công nghệ B] dựa trên dữ liệu cập nhật mới nhất, phân tích ưu nhược điểm và khuyến nghị áp dụng:',
        'template-data': 'Phân tích tập dữ liệu sau đây, trích xuất các chỉ số then chốt (KPIs), phát hiện xu hướng bất thường và đề xuất giải pháp hành động:',
        'template-seo': 'Đánh giá cấu trúc thẻ Heading, mật độ từ khóa, thẻ meta và tốc độ tải trang của URL [Địa chỉ trang web], lập danh sách công việc cần tối ưu hóa on-page:'
      };

      if (promptTemplateSelect && chatInput) {
        promptTemplateSelect.addEventListener('change', () => {
          const val = promptTemplateSelect.value;
          if (val && promptTemplates[val]) {
            chatInput.value = promptTemplates[val];
            chatInput.dispatchEvent(new Event('input'));
            chatInput.focus();
            showToast(`Đã áp dụng mẫu: ${promptTemplateSelect.options[promptTemplateSelect.selectedIndex].text}`);
          }
        });
      }

      // ─── Ego Browser Agent Toggle (from image-9) ───
      const egoBrowserToggle = document.getElementById('egoBrowserToggle');
      function toggleEgoBrowser() {
        if (!egoBrowserToggle) return;
        const willBeActive = !egoBrowserToggle.classList.contains('active');
        egoBrowserToggle.classList.toggle('active', willBeActive);
        egoBrowserToggle.setAttribute('title', willBeActive ? 'Tác tử Ego Browser: Đang BẬT (Nhấp để tắt)' : 'Tác tử Ego Browser: Đang TẮT (Nhấp để bật)');
        const settingsSwitch = document.getElementById('settingsEgoAgentSwitch');
        if (settingsSwitch) {
          settingsSwitch.checked = willBeActive;
        }
        // Ego Browser đã có nút sáng riêng ở dưới nên không tạo thẻ trùng lặp ở thanh trên
        const idx = activeTags.findIndex(t => t.name === 'Ego Browser');
        if (idx !== -1) activeTags.splice(idx, 1);
        showToast(willBeActive ? 'Đã kích hoạt tác tử Ego Browser' : 'Đang dùng chế độ duyệt tiêu chuẩn');
        updateActiveToolsUI();
      }
      if (egoBrowserToggle) {
        egoBrowserToggle.addEventListener('click', toggleEgoBrowser);
      }

      // ─── Full Access Permission Badge & Approval Popover (from image-9, 10 & 71) ───
      const fullAccessBadge = document.getElementById('fullAccessBadge');
      const fullAccessLabel = document.getElementById('fullAccessLabel');
      const fullAccessIcon = document.getElementById('fullAccessIcon');
      const approvalPopover = document.getElementById('approvalPopover');
      const approvalLearnMoreLink = document.getElementById('approvalLearnMoreLink');
      let currentPermissionMode = 'full_access';

      const permissionIcons = {
        require_approval: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"></path><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path></svg>`,
        approve_for_me: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 10 12 13 9 16"></polyline><line x1="13" y1="16" x2="16" y2="16"></line></svg>`,
        full_access: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
      };

      function setPermissionMode(mode, showToastMsg = true) {
        currentPermissionMode = mode;
        if (!fullAccessBadge || !fullAccessLabel) return;

        if (mode === 'require_approval') {
          fullAccessLabel.textContent = 'Yêu cầu phê duyệt';
          if (fullAccessIcon) fullAccessIcon.innerHTML = permissionIcons.require_approval;
          fullAccessBadge.style.color = 'var(--muted)';
          fullAccessBadge.style.borderColor = 'var(--border)';
          fullAccessBadge.style.background = 'var(--surface)';
          fullAccessBadge.classList.remove('is-active-warn');
          if (showToastMsg) showToast('Chế độ phê duyệt: Yêu cầu phê duyệt (Luôn hỏi trước khi thực thi)');
        } else if (mode === 'approve_for_me') {
          fullAccessLabel.textContent = 'Phê duyệt giúp tôi';
          if (fullAccessIcon) fullAccessIcon.innerHTML = permissionIcons.approve_for_me;
          fullAccessBadge.style.color = 'var(--fg)';
          fullAccessBadge.style.borderColor = 'color-mix(in oklab, var(--border), var(--fg) 25%)';
          fullAccessBadge.style.background = 'var(--surface)';
          fullAccessBadge.classList.remove('is-active-warn');
          if (showToastMsg) showToast('Chế độ phê duyệt: Phê duyệt giúp tôi (Chỉ hỏi khi không an toàn)');
        } else {
          // full_access (default - from image-71.png)
          fullAccessLabel.textContent = 'Toàn quyền tiếp cận';
          if (fullAccessIcon) fullAccessIcon.innerHTML = permissionIcons.full_access;
          fullAccessBadge.style.color = 'var(--warn)';
          fullAccessBadge.style.borderColor = 'color-mix(in oklab, var(--warn), transparent 60%)';
          fullAccessBadge.style.background = 'color-mix(in oklab, var(--warn), transparent 92%)';
          fullAccessBadge.classList.add('is-active-warn');
          if (showToastMsg) showToast('Chế độ phê duyệt: Toàn quyền tiếp cận (Truy cập không giới hạn)');
        }

        if (approvalPopover) {
          const items = approvalPopover.querySelectorAll('.approval-option-item');
          items.forEach(item => {
            const val = item.getAttribute('data-value');
            const isSel = val === mode;
            item.classList.toggle('selected', isSel);
            item.setAttribute('aria-checked', isSel ? 'true' : 'false');
          });
        }

        const settingsPermSel = document.getElementById('settingsPermissionSelect');
        if (settingsPermSel && settingsPermSel.value !== mode) {
          settingsPermSel.value = mode;
        }

        try { localStorage.setItem('neuratalk-permission-mode', mode); } catch (e) {}

        const idx = activeTags.findIndex(t => t.name === 'Toàn quyền tiếp cận' || t.name === 'Toàn quyền');
        if (idx !== -1) activeTags.splice(idx, 1);
        updateActiveToolsUI();
      }

      // Production default follows OMP's safest mode; migrate only explicit OMP choices.
      const savedPermMode = ({ 'always-ask': 'require_approval', write: 'approve_for_me', yolo: 'full_access' })[localStorage.getItem('omp.approvalMode')] || 'require_approval';
      setPermissionMode(savedPermMode, false);

      if (fullAccessBadge && approvalPopover) {
        fullAccessBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          const willShow = !approvalPopover.classList.contains('show');
          closePromptPopovers(approvalPopover);
          approvalPopover.classList.toggle('show', willShow);
          fullAccessBadge.classList.toggle('active-popover', willShow);
          fullAccessBadge.setAttribute('aria-expanded', willShow ? 'true' : 'false');
        });

        const optionItems = approvalPopover.querySelectorAll('.approval-option-item');
        optionItems.forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = item.getAttribute('data-value');
            if (val) {
              setPermissionMode(val, true);
              approvalPopover.classList.remove('show');
              fullAccessBadge.classList.remove('active-popover');
              fullAccessBadge.setAttribute('aria-expanded', 'false');
            }
          });
        });
      }

      if (approvalLearnMoreLink) {
        approvalLearnMoreLink.addEventListener('click', (e) => {
          e.stopPropagation();
          if (approvalPopover) approvalPopover.classList.remove('show');
          if (fullAccessBadge) fullAccessBadge.classList.remove('active-popover');
          const settingsBtn = document.getElementById('navSettingsBtn');
          if (settingsBtn) settingsBtn.click();
          showToast('Chính sách phê duyệt: Toàn quyền truy cập cho phép thực thi không giới hạn');
        });
      }

      // ─── Header Active Model Display (Display-only from user request) ───
      const headerModelPill = document.getElementById('headerModelPill');
      if (headerModelPill) {
        headerModelPill.style.cursor = 'pointer';
        headerModelPill.addEventListener('click', () => {
          if (typeof openSettingsModal === 'function') {
            openSettingsModal('models');
          } else {
            showToast('Mở cài đặt mô hình AI');
          }
        });
      }

      const headerModelNameText = document.getElementById('headerModelNameText');
      const headerModelReasoningBadge = document.getElementById('headerModelReasoningBadge');
      const MODEL_DICTIONARY = {
        'google-antigravity': {
          fullName: 'hon-pi/neural-flash-3.8',
          shortName: 'neural-flash-3.8',
          popoverName: 'google-antigravit...'
        },
        'neura-4.5': {
          fullName: '✦ Neura-4.5 Omni',
          shortName: 'Neura-4.5 Omni',
          popoverName: 'Neura-4.5 Omni'
        },
        'claude-3.7': {
          fullName: '✦ Claude 3.7 Sonnet',
          shortName: 'Claude 3.7 Sonnet',
          popoverName: 'Claude 3.7 Sonnet'
        },
        'deepseek-v3': {
          fullName: '✦ DeepSeek V3',
          shortName: 'DeepSeek V3',
          popoverName: 'DeepSeek V3'
        },
        'gpt-4o': {
          fullName: '✦ GPT-4o',
          shortName: 'GPT-4o',
          popoverName: 'GPT-4o'
        },
        'luna-5.6': {
          fullName: '✦ 5.6 Luna',
          shortName: '5.6 Luna',
          popoverName: '5.6 Luna'
        },
        'omp-rpc': {
          fullName: 'Default (CLI config / OMP)',
          shortName: 'Default (CLI config)',
          popoverName: 'Default (CLI config)'
        }
      };

      const REASONING_DICTIONARY = {
        'max': 'XHigh',
        'high': 'High',
        'medium': 'Medium',
        'low': 'Low',
        'none': 'Off'
      };

      function updateActiveModelInfo(val) {
        const info = MODEL_DICTIONARY[val] || { fullName: val, shortName: val, popoverName: val };
        const imageCapability = /(?:image|imagen)/i.test(String(val || '')) ? ' · Tạo ảnh' : '';
        const shortName = `${info.shortName}${imageCapability}`;
        const popoverName = `${info.popoverName}${imageCapability}`;
        if (headerModelNameText) headerModelNameText.textContent = shortName;
        if (headerModelPill) {
          headerModelPill.setAttribute('title', `Mô hình AI đang sử dụng: ${shortName}`);
          headerModelPill.setAttribute('aria-label', `Mô hình AI đang sử dụng: ${shortName}`);
        }
        if (modelActiveName) modelActiveName.textContent = popoverName;
      }

      function updateActiveReasoningInfo(reasoningVal) {
        const rName = REASONING_DICTIONARY[reasoningVal] || reasoningVal;
        if (headerModelReasoningBadge) headerModelReasoningBadge.textContent = rName;
        if (reasoningActiveName) reasoningActiveName.textContent = rName;
      }

      // ─── Model & Reasoning Popover (from image-26 & image-27) ───
      const promptModelIconBtn = document.getElementById('promptModelIconBtn');
      const modelReasoningPopover = document.getElementById('modelReasoningPopover');
      const promptModelSelect = document.getElementById('promptModelSelect');
      const modelActiveName = document.getElementById('modelActiveName');
      const modelCliOption = document.getElementById('modelCliOption');
      const promptThinkingSelect = document.getElementById('promptThinkingSelect');
      const reasoningActiveName = document.getElementById('reasoningActiveName');
      const openExecSettingsFromPopover = document.getElementById('openExecSettingsFromPopover');

      if (promptModelIconBtn && modelReasoningPopover) {
        promptModelIconBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const willShow = !modelReasoningPopover.classList.contains('show');
          closePromptPopovers(modelReasoningPopover);
          modelReasoningPopover.classList.toggle('show', willShow);
          promptModelIconBtn.classList.toggle('active', willShow);
        });
      }

      if (modelCliOption && promptModelSelect) {
        modelCliOption.addEventListener('click', () => {
          promptModelSelect.value = 'omp-rpc';
          promptModelSelect.dispatchEvent(new Event('change'));
          if (modelReasoningPopover) modelReasoningPopover.classList.remove('show');
          if (promptModelIconBtn) promptModelIconBtn.classList.remove('active');
        });
      }

      if (promptModelSelect) {
        promptModelSelect.addEventListener('change', () => {
          const val = promptModelSelect.value;
          updateActiveModelInfo(val);
          if (settingsDefaultModelSelect) settingsDefaultModelSelect.value = val;
          showToast(`Đã chuyển sang mô hình: ${promptModelSelect.options[promptModelSelect.selectedIndex].text}`);
        });
      }

      if (promptThinkingSelect) {
        promptThinkingSelect.addEventListener('change', () => {
          const rVal = promptThinkingSelect.value;
          const text = promptThinkingSelect.options[promptThinkingSelect.selectedIndex].text;
          updateActiveReasoningInfo(rVal);
          if (settingsDefaultReasoningSelect) settingsDefaultReasoningSelect.value = rVal;
          showToast(`Đã đặt Reasoning: ${text}`);
        });
      }

      if (openExecSettingsFromPopover) {
        openExecSettingsFromPopover.addEventListener('click', () => {
          if (modelReasoningPopover) modelReasoningPopover.classList.remove('show');
          if (promptModelIconBtn) promptModelIconBtn.classList.remove('active');
          if (typeof openSettingsModal === 'function') {
            openSettingsModal('models');
          } else {
            showToast('Mở cài đặt mô hình AI');
          }
        });
      }

      const voiceRecordBtn = document.getElementById('voiceRecordBtn');
      if (voiceRecordBtn) {
        voiceRecordBtn.addEventListener('click', () => {
          const isRecording = voiceRecordBtn.classList.toggle('recording');
          showToast(isRecording ? 'Đang lắng nghe giọng nói... Nhấn lại để hoàn tất' : 'Đã dừng thu âm');
        });
      }

      const imageUploadBtn = document.getElementById('imageUploadBtn');
      if (imageUploadBtn) {
        imageUploadBtn.addEventListener('click', () => {
          showToast('Chọn ảnh tham khảo từ thiết bị (PNG, JPG, WebP)');
        });
      }

      const enhancePromptBtn = document.getElementById('enhancePromptBtn');
      if (enhancePromptBtn && chatInput) {
        enhancePromptBtn.addEventListener('click', () => {
          const curr = chatInput.value.trim();
          if (curr) {
            chatInput.value = `Phân tích chuyên sâu và đưa ra phương án tối ưu nhất cho yêu cầu sau: ${curr}`;
            chatInput.dispatchEvent(new Event('input'));
            showToast('Đã nâng cấp câu lệnh với AI');
          } else {
            chatInput.value = 'Phân tích chi tiết và tối ưu hóa giải pháp cho dự án hiện tại';
            chatInput.dispatchEvent(new Event('input'));
            showToast('Đã chèn câu lệnh mẫu tối ưu');
          }
        });
      }

      function closePromptPopovers(except) {
        if (promptWsDropdown && promptWsDropdown !== except) promptWsDropdown.classList.remove('show');
        if (promptPlusMenu && promptPlusMenu !== except) promptPlusMenu.classList.remove('show');
        const addTagPop = document.getElementById('addTagPopover');
        if (addTagPop && addTagPop !== except) addTagPop.classList.remove('show');
        if (modelReasoningPopover && modelReasoningPopover !== except) {
          modelReasoningPopover.classList.remove('show');
          if (promptModelIconBtn) promptModelIconBtn.classList.remove('active');
        }
        const appPop = document.getElementById('approvalPopover');
        if (appPop && appPop !== except) {
          appPop.classList.remove('show');
          const faBadge = document.getElementById('fullAccessBadge');
          if (faBadge) {
            faBadge.classList.remove('active-popover');
            faBadge.setAttribute('aria-expanded', 'false');
          }
        }
      }

      document.addEventListener('click', (e) => {
        if (!e.target.closest('#promptWorkspaceTrigger') && !e.target.closest('#promptWsDropdown')) {
          if (promptWsDropdown) promptWsDropdown.classList.remove('show');
        }
        if (!e.target.closest('#promptPlusBtn') && !e.target.closest('#promptPlusMenu')) {
          if (promptPlusMenu) {
            promptPlusMenu.classList.remove('show');
            promptPlusBtn?.setAttribute('aria-expanded', 'false');
          }
        }
        if (!e.target.closest('#addTagTriggerBtn') && !e.target.closest('#addTagPopover')) {
          const addTagPop = document.getElementById('addTagPopover');
          if (addTagPop) addTagPop.classList.remove('show');
        }
        if (!e.target.closest('#promptModelIconBtn') && !e.target.closest('#modelReasoningPopover')) {
          if (modelReasoningPopover) modelReasoningPopover.classList.remove('show');
          if (promptModelIconBtn) promptModelIconBtn.classList.remove('active');
        }
        if (!e.target.closest('#fullAccessBadge') && !e.target.closest('#approvalPopover')) {
          const appPop = document.getElementById('approvalPopover');
          if (appPop) appPop.classList.remove('show');
          const faBadge = document.getElementById('fullAccessBadge');
          if (faBadge) {
            faBadge.classList.remove('active-popover');
            faBadge.setAttribute('aria-expanded', 'false');
          }
        }
      });

      function setModalOpen(open) {
        if (!upgradeModal) return;
        if (open) upgradeModal.classList.add('open');
        else upgradeModal.classList.remove('open');
      }
      if (closeModalBtn) closeModalBtn.addEventListener('click', () => setModalOpen(false));
      if (upgradeModal) {
        upgradeModal.addEventListener('click', (e) => {
          if (e.target === upgradeModal) setModalOpen(false);
        });
      }
      if (confirmUpgradeBtn) {
        confirmUpgradeBtn.addEventListener('click', () => {
          setModalOpen(false);
          showToast('Đã kích hoạt gói Hòn π Chuyên nghiệp thành công!');
        });
      }
      if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
          appSidebar.classList.toggle('mobile-open');
        });
      }
      if (mobileSidebarCloseBtn) mobileSidebarCloseBtn.addEventListener('click', () => appSidebar.classList.remove('mobile-open'));

      // ─── Left Sidebar Collapse & Expand (from image) ───
      const collapseSidebarBtn = document.getElementById('collapseSidebarBtn');
      const expandSidebarBtn = document.getElementById('expandSidebarBtn');

      function setSidebarCollapsed(collapsed) {
        if (collapsed) {
          appSidebar.classList.add('collapsed');
          if (expandSidebarBtn) expandSidebarBtn.classList.add('visible');
        } else {
          appSidebar.classList.remove('collapsed');
          if (expandSidebarBtn) expandSidebarBtn.classList.remove('visible');
        }
        if (collapseSidebarBtn) {
          const label = collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên';
          collapseSidebarBtn.setAttribute('aria-label', label);
          collapseSidebarBtn.title = `${label} (Ctrl+B)`;
        }
      }

      if (collapseSidebarBtn) {
        collapseSidebarBtn.addEventListener('click', () => {
          setSidebarCollapsed(true);
          showToast('Đã thu gọn thanh bên (Ctrl+B)');
        });
      }

      if (expandSidebarBtn) {
        expandSidebarBtn.addEventListener('click', () => {
          setSidebarCollapsed(false);
          showToast('Đã mở rộng thanh bên');
        });
      }

      // ─── Left Sidebar Horizontal Drag & Resize (Hòn π DS 1.0) ───
      const sidebarResizer = document.getElementById('sidebarResizer');
      const MIN_SIDEBAR_W = 260;
      const DEFAULT_SIDEBAR_W = 260;

      // Restore saved sidebar width if present
      try {
        const savedW = localStorage.getItem('neuratalk-sidebar-width');
        if (savedW && !isNaN(savedW)) {
          const clamped = Math.max(MIN_SIDEBAR_W, Math.min(Math.min(560, Math.floor(window.innerWidth * 0.55)), parseInt(savedW, 10)));
          appSidebar.style.setProperty('--sidebar-w', clamped + 'px');
        }
      } catch (e) {}

      if (sidebarResizer && appSidebar) {
        let isResizing = false;
        let startX = 0;
        let startW = DEFAULT_SIDEBAR_W;

        const onPointerMove = (e) => {
          if (!isResizing) return;
          const maxW = Math.min(560, Math.floor(window.innerWidth * 0.55));
          const delta = e.clientX - startX;
          let newW = Math.round(startW + delta);
          if (newW < MIN_SIDEBAR_W) newW = MIN_SIDEBAR_W;
          if (newW > maxW) newW = maxW;
          appSidebar.style.setProperty('--sidebar-w', newW + 'px');
        };

        const onPointerUp = (e) => {
          if (!isResizing) return;
          isResizing = false;
          appSidebar.classList.remove('is-resizing');
          sidebarResizer.classList.remove('active');
          document.body.classList.remove('is-sidebar-resizing');

          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerUp);

          try {
            sidebarResizer.releasePointerCapture(e.pointerId);
          } catch (err) {}

          const finalW = Math.round(appSidebar.getBoundingClientRect().width);
          try {
            localStorage.setItem('neuratalk-sidebar-width', finalW);
          } catch (err) {}
        };

        sidebarResizer.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          if (appSidebar.classList.contains('collapsed')) return;

          isResizing = true;
          startX = e.clientX;
          startW = appSidebar.getBoundingClientRect().width;

          appSidebar.classList.add('is-resizing');
          sidebarResizer.classList.add('active');
          document.body.classList.add('is-sidebar-resizing');

          try {
            sidebarResizer.setPointerCapture(e.pointerId);
          } catch (err) {}

          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);

          e.preventDefault();
        });

        // Double-click on resizer resets to default width
        sidebarResizer.addEventListener('dblclick', () => {
          appSidebar.style.setProperty('--sidebar-w', DEFAULT_SIDEBAR_W + 'px');
          try {
            localStorage.setItem('neuratalk-sidebar-width', DEFAULT_SIDEBAR_W);
          } catch (err) {}
          showToast('Đã đặt lại độ rộng sidebar (260px)');
        });
      }

      // ─── Sidebar Dynamic Counts & Structure Helpers ───
      function updateSidebarCounts() {
        const pinnedCount = document.querySelectorAll('#pinnedSessionsList .session-item:not([style*="display: none"]):not([data-archived="true"])').length;
        const pinnedBadge = document.getElementById('pinnedCountBadge');
        if (pinnedBadge) pinnedBadge.textContent = pinnedCount;

        const folders = document.querySelectorAll('.project-folder');
        const projectsCountBadge = document.getElementById('projectsCountBadge');
        if (projectsCountBadge) projectsCountBadge.textContent = folders.length;

        folders.forEach(folder => {
          const folderSessions = folder.querySelectorAll('.folder-sessions-container .session-item:not([style*="display: none"]):not([data-archived="true"])').length;
          const badge = folder.querySelector('.folder-count-badge');
          if (badge) badge.textContent = folderSessions;
        });

        const unassignedCount = document.querySelectorAll('#unassignedSessionsList .session-item:not([style*="display: none"]):not([data-archived="true"])').length;
        const unassignedBadge = document.getElementById('unassignedCountBadge');
        if (unassignedBadge) unassignedBadge.textContent = unassignedCount;
      }

      // Helper to create a new project folder if it doesn't exist
      function createProjectFolderElement(folderName) {
        const tree = document.getElementById('projectFoldersTree');
        if (!tree) return null;
        let existing = tree.querySelector(`.project-folder[data-folder="${folderName}"]`);
        if (existing) {
          return existing.querySelector('.project-folder-sessions');
        }

        const folderEl = document.createElement('div');
        folderEl.className = 'project-folder';
        folderEl.setAttribute('data-folder', folderName);
        folderEl.innerHTML = `
          <div class="folder-header-row" title="Nhấp để mở rộng / thu gọn">
            <div class="folder-header-left">
              <svg class="folder-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              <svg class="folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              <span class="folder-name">${folderName}</span>
              <span class="folder-count-badge">0</span>
            </div>
            <div class="folder-header-actions">
              <button type="button" class="tool-icon-btn folder-add-btn" title="Thêm cuộc trò chuyện vào ${folderName}" data-folder="${folderName}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
            </div>
          </div>
          <div class="folder-sessions-container project-folder-sessions" data-folder="${folderName}"></div>
        `;
        tree.appendChild(folderEl);
        bindFolderEvents(folderEl);
        updateSidebarCounts();
        return folderEl.querySelector('.project-folder-sessions');
      }
      // ─── Custom Input Modal Helper (Replaces native prompt) ───
      const customInputModal = document.getElementById('customInputModal');
      const customInputModalTitle = document.getElementById('customInputModalTitle');
      const customInputModalDesc = document.getElementById('customInputModalDesc');
      const customInputField = document.getElementById('customInputField');
      const confirmCustomInputBtn = document.getElementById('confirmCustomInputBtn');
      const cancelCustomInputBtn = document.getElementById('cancelCustomInputBtn');
      const closeCustomInputModalBtn = document.getElementById('closeCustomInputModalBtn');
      let customInputCallback = null;

      function closeCustomInputModal() {
        if (customInputModal) customInputModal.classList.remove('open');
        customInputCallback = null;
      }

      if (cancelCustomInputBtn) cancelCustomInputBtn.addEventListener('click', closeCustomInputModal);
      if (closeCustomInputModalBtn) closeCustomInputModalBtn.addEventListener('click', closeCustomInputModal);
      if (customInputModal) {
        customInputModal.addEventListener('click', (e) => {
          if (e.target === customInputModal) closeCustomInputModal();
        });
      }

      function submitCustomInput() {
        if (!customInputField) return;
        const val = customInputField.value.trim();
        if (val && typeof customInputCallback === 'function') {
          const cb = customInputCallback;
          closeCustomInputModal();
          cb(val);
        } else {
          closeCustomInputModal();
        }
      }

      if (confirmCustomInputBtn) confirmCustomInputBtn.addEventListener('click', submitCustomInput);
      if (customInputField) {
        customInputField.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitCustomInput();
          } else if (e.key === 'Escape') {
            closeCustomInputModal();
          }
        });
      }

      function openCustomInputModal({ title, desc, placeholder, defaultValue, onConfirm }) {
        if (!customInputModal || !customInputField) return;
        if (customInputModalTitle) customInputModalTitle.textContent = title || 'Tạo mới';
        if (customInputModalDesc) customInputModalDesc.textContent = desc || 'Vui lòng nhập thông tin:';
        customInputField.placeholder = placeholder || 'Nhập tên...';
        customInputField.value = defaultValue || '';
        customInputCallback = onConfirm;
        customInputModal.classList.add('open');
        setTimeout(() => {
          customInputField.focus();
          customInputField.select();
        }, 60);
      }

      // Bind folder header click & folder add button
      function bindFolderEvents(folderEl) {
        const headerRow = folderEl.querySelector('.folder-header-row');
        if (headerRow) {
          headerRow.addEventListener('click', (e) => {
            if (e.target.closest('.folder-add-btn')) return;
            folderEl.classList.toggle('collapsed');
          });
        }
        const addBtn = folderEl.querySelector('.folder-add-btn');
        if (addBtn) {
          addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const folderName = folderEl.getAttribute('data-folder') || '';
            openCustomInputModal({
              title: 'Cuộc trò chuyện mới',
              desc: `Nhập tiêu đề cuộc trò chuyện mới trong dự án "${folderName}":`,
              placeholder: 'Tiêu đề cuộc trò chuyện...',
              defaultValue: 'Công việc mới',
              onConfirm: (title) => {
                createSessionInFolder(title, folderName);
              }
            });
          });
        }
      }
      document.querySelectorAll('.project-folder').forEach(bindFolderEvents);

      function createSessionInFolder(title, folderName) {
        let container = document.querySelector(`.project-folder-sessions[data-folder="${folderName}"]`);
        if (!container) {
          container = createProjectFolderElement(folderName);
        }
        const newId = 's_' + Date.now();
        const newSessionEl = document.createElement('div');
        newSessionEl.className = 'session-item active';
        newSessionEl.setAttribute('data-session-id', newId);
        newSessionEl.setAttribute('data-project', folderName || '');
        newSessionEl.tabIndex = 0;
        newSessionEl.innerHTML = `
          <div class="session-item-left">
            <span class="session-title">✦ ${title}</span>
          </div>
          <div class="session-item-right">
            <span class="session-time" title="Vừa xong">1p</span>
          </div>
        `;
        chatStream.innerHTML = '';
        if (greetingSection) greetingSection.style.display = 'flex';
        chatInput.value = '';
        chatInput.focus();
        const wsLabel = document.getElementById('promptCurrentWsLabel');
        if (wsLabel) wsLabel.textContent = folderName || '2 side';
        if (typeof updateWorkspaceSelectorVisibility === 'function') updateWorkspaceSelectorVisibility();
        document.querySelectorAll('.session-item').forEach(s => s.classList.remove('active'));
        if (container) {
          container.insertBefore(newSessionEl, container.firstChild);
          const folderParent = container.closest('.project-folder');
          if (folderParent) folderParent.classList.remove('collapsed');
        } else {
          const unassignedList = document.getElementById('unassignedSessionsList');
          if (unassignedList) unassignedList.insertBefore(newSessionEl, unassignedList.firstChild);
        }
        bindSessionItemEvents(newSessionEl);
        updateSidebarCounts();
        showToast(`Đã tạo cuộc trò chuyện trong dự án: "${folderName}"`);
      }

      // ─── New Session CTA (Ctrl+K / ⊕ New Session) ───
      const newSessionBtn = document.getElementById('newSessionBtn');
      function createNewSession() {
        chatStream.innerHTML = '';
        if (greetingSection) greetingSection.style.display = 'flex';
        if (typeof hideFileChangePill === 'function') hideFileChangePill();
        activeTags = [];
        activeTools.clear();
        document.querySelectorAll('.tool-item-row .toggle-switch').forEach(sw => {
          sw.classList.remove('on');
          sw.setAttribute('aria-checked', 'false');
        });
        document.querySelectorAll('.tool-item-status-tag').forEach(st => {
          st.textContent = 'Tắt';
          st.classList.remove('tag-active');
        });
        updateActiveToolsUI();
        chatInput.value = '';
        chatInput.focus();
        const emptySessionsState = document.getElementById('emptySessionsState');
        if (emptySessionsState) emptySessionsState.classList.remove('visible');
        const wsLabel = document.getElementById('promptCurrentWsLabel');
        if (wsLabel) wsLabel.textContent = 'Design System';
        if (typeof updateWorkspaceSelectorVisibility === 'function') updateWorkspaceSelectorVisibility();
        
        document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
        const newId = 's_' + Date.now();
        const newSessionEl = document.createElement('div');
        newSessionEl.className = 'session-item active';
        newSessionEl.setAttribute('data-session-id', newId);
        newSessionEl.setAttribute('data-project', 'design-system');
        newSessionEl.tabIndex = 0;
        newSessionEl.innerHTML = `
          <div class="session-item-left">
            <span class="session-title">✦ Cuộc trò chuyện mới</span>
          </div>
          <div class="session-item-right">
            <span class="session-time" title="Vừa xong">1p</span>
          </div>
        `;
        
        let designSystemContainer = document.querySelector('.project-folder-sessions[data-folder="design-system"]');
        if (designSystemContainer) {
          designSystemContainer.insertBefore(newSessionEl, designSystemContainer.firstChild);
          const folderParent = designSystemContainer.closest('.project-folder');
          if (folderParent) folderParent.classList.remove('collapsed');
        } else {
          const unassignedList = document.getElementById('unassignedSessionsList');
          if (unassignedList) unassignedList.insertBefore(newSessionEl, unassignedList.firstChild);
        }

        bindSessionItemEvents(newSessionEl);
        updateSidebarCounts();
        showToast('Đã bắt đầu cuộc trò chuyện mới trong "Design System"');
      }

      if (newSessionBtn) {
        newSessionBtn.addEventListener('click', createNewSession);
      }

      // ─── Group Collapsing (Đã ghim, Dự án, Chưa phân loại) ───
      const togglePinnedCollapseBtn = document.getElementById('togglePinnedCollapseBtn');
      const pinnedSectionGroup = document.getElementById('pinnedSectionGroup');
      if (togglePinnedCollapseBtn && pinnedSectionGroup) {
        const togglePinned = () => {
          pinnedSectionGroup.classList.toggle('collapsed');
          togglePinnedCollapseBtn.setAttribute('aria-expanded', String(!pinnedSectionGroup.classList.contains('collapsed')));
        };
        togglePinnedCollapseBtn.addEventListener('click', togglePinned);
        togglePinnedCollapseBtn.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); togglePinned(); }
        });
      }

      const toggleProjectsCollapseBtn = document.getElementById('toggleProjectsCollapseBtn');
      const projectsSectionGroup = document.getElementById('projectsSectionGroup');
      if (toggleProjectsCollapseBtn && projectsSectionGroup) {
        const toggleProjects = () => {
          projectsSectionGroup.classList.toggle('collapsed');
          toggleProjectsCollapseBtn.setAttribute('aria-expanded', String(!projectsSectionGroup.classList.contains('collapsed')));
        };
        toggleProjectsCollapseBtn.addEventListener('click', toggleProjects);
        toggleProjectsCollapseBtn.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleProjects(); }
        });
      }

      const toggleUnassignedCollapseBtn = document.getElementById('toggleUnassignedCollapseBtn');
      const unassignedSectionGroup = document.getElementById('unassignedSectionGroup');
      if (toggleUnassignedCollapseBtn && unassignedSectionGroup) {
        const toggleUnassigned = () => {
          unassignedSectionGroup.classList.toggle('collapsed');
          toggleUnassignedCollapseBtn.setAttribute('aria-expanded', String(!unassignedSectionGroup.classList.contains('collapsed')));
        };
        toggleUnassignedCollapseBtn.addEventListener('click', toggleUnassigned);
        toggleUnassignedCollapseBtn.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleUnassigned(); }
        });
      }

      const showMore2SideBtn = document.getElementById('showMore2SideBtn');
      if (showMore2SideBtn) {
        showMore2SideBtn.addEventListener('click', () => {
          showToast('Đang hiển thị toàn bộ các cuộc trò chuyện trong "2 side"');
        });
      }

      const pinnedMoreOptionsBtn = document.getElementById('pinnedMoreOptionsBtn');
      if (pinnedMoreOptionsBtn) {
        pinnedMoreOptionsBtn.addEventListener('click', () => {
          showToast('Tùy chọn: Có thể kéo thả hoặc kích phải để bỏ ghim');
        });
      }

      const addProjectFolderHeaderBtn = document.getElementById('addProjectFolderHeaderBtn');
      if (addProjectFolderHeaderBtn) {
        addProjectFolderHeaderBtn.addEventListener('click', () => {
          openCustomInputModal({
            title: 'Thư mục dự án mới',
            desc: 'Nhập tên thư mục dự án mới:',
            placeholder: 'Tên thư mục...',
            defaultValue: 'Dự án mới',
            onConfirm: (name) => {
              createProjectFolderElement(name);
              showToast(`Đã tạo thư mục dự án: "${name}"`);
            }
          });
        });
      }

      // ─── Workspaces & Sessions Search / Filter ───
      const searchSessionsBtn = document.getElementById('searchSessionsBtn');
      const sessionSearchBox = document.getElementById('sessionSearchBox');
      const sessionSearchInput = document.getElementById('sessionSearchInput');
      const sessionSearchClear = document.getElementById('sessionSearchClear');
      const emptySessionsState = document.getElementById('emptySessionsState');
      const addWorkspaceBtn = document.getElementById('addWorkspaceBtn');

      if (searchSessionsBtn && sessionSearchBox) {
        searchSessionsBtn.addEventListener('click', () => {
          sessionSearchBox.classList.toggle('open');
          searchSessionsBtn.classList.toggle('active');
          if (sessionSearchBox.classList.contains('open') && sessionSearchInput) {
            sessionSearchInput.focus();
          }
        });
      }

      if (sessionSearchInput) {
        sessionSearchInput.addEventListener('input', () => {
          const query = sessionSearchInput.value.trim().toLowerCase();
          if (sessionSearchClear) {
            if (query) sessionSearchClear.classList.add('visible');
            else sessionSearchClear.classList.remove('visible');
          }
          let visibleCount = 0;
          document.querySelectorAll('.session-item').forEach(item => {
            const titleEl = item.querySelector('.session-title');
            const title = (titleEl ? titleEl.textContent : '').toLowerCase();
            const project = (item.getAttribute('data-project') || '').toLowerCase();
            if (title.includes(query) || project.includes(query)) {
              item.style.display = 'flex';
              visibleCount++;
              const folder = item.closest('.project-folder');
              if (folder && query) folder.classList.remove('collapsed');
            } else {
              item.style.display = 'none';
            }
          });
          if (emptySessionsState) {
            if (visibleCount === 0) emptySessionsState.classList.add('visible');
            else emptySessionsState.classList.remove('visible');
          }
          updateSidebarCounts();
        });
      }

      if (sessionSearchClear) {
        sessionSearchClear.addEventListener('click', () => {
          sessionSearchInput.value = '';
          sessionSearchClear.classList.remove('visible');
          document.querySelectorAll('.session-item').forEach(item => item.style.display = 'flex');
          if (emptySessionsState) emptySessionsState.classList.remove('visible');
          sessionSearchInput.focus();
          updateSidebarCounts();
        });
      }

      // ─── Sessions Filter & View Options Popover (from image-35) ───
      const filterSessionsBtn = document.getElementById('filterSessionsBtn');
      const sessionsFilterMenu = document.getElementById('sessionsFilterMenu');
      const sessionsFilterWrap = document.getElementById('sessionsFilterWrap');

      function toggleSessionsFilterMenu(forceState) {
        if (!sessionsFilterMenu || !filterSessionsBtn) return;
        const willOpen = typeof forceState === 'boolean' ? forceState : !sessionsFilterMenu.classList.contains('open');
        sessionsFilterMenu.classList.toggle('open', willOpen);
        filterSessionsBtn.classList.toggle('active', willOpen);
        filterSessionsBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (willOpen) {
          updateStatusFilterCounts();
        }
      }

      function closeSessionsFilterMenu() {
        if (!sessionsFilterMenu || !filterSessionsBtn) return;
        sessionsFilterMenu.classList.remove('open');
        filterSessionsBtn.classList.remove('active');
        filterSessionsBtn.setAttribute('aria-expanded', 'false');
      }

      if (filterSessionsBtn) {
        filterSessionsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleSessionsFilterMenu();
        });
      }

      // 1. Folders: Expand All / Collapse All
      const sfActionExpandFolders = document.getElementById('sfActionExpandFolders');
      if (sfActionExpandFolders) {
        sfActionExpandFolders.addEventListener('click', () => {
          document.querySelectorAll('.project-folder').forEach(folder => {
            folder.classList.remove('collapsed');
            folder.querySelector('.folder-header-row')?.setAttribute('aria-expanded', 'true');
          });
          const pinnedList = document.getElementById('pinnedSessionsList');
          const pinnedHeader = document.getElementById('pinnedGroupHeader');
          if (pinnedList) pinnedList.classList.remove('collapsed');
          if (pinnedHeader) pinnedHeader.classList.remove('collapsed');
          const count = document.querySelectorAll('.project-folder').length;
          closeSessionsFilterMenu();
          showToast(`Đã mở rộng tất cả ${count} thư mục dự án`);
        });
      }

      const sfActionCollapseFolders = document.getElementById('sfActionCollapseFolders');
      if (sfActionCollapseFolders) {
        sfActionCollapseFolders.addEventListener('click', () => {
          document.querySelectorAll('.project-folder').forEach(folder => {
            folder.classList.add('collapsed');
            folder.querySelector('.folder-header-row')?.setAttribute('aria-expanded', 'false');
          });
          const count = document.querySelectorAll('.project-folder').length;
          closeSessionsFilterMenu();
          showToast(`Đã thu gọn tất cả ${count} thư mục dự án`);
        });
      }

      // 2. Sorting Logic (Newest / Oldest / Alphabetical)
      let currentSortMode = 'newest';

      function parseSessionTimeScore(sessionItem) {
        const timeEl = sessionItem.querySelector('.session-time');
        if (!timeEl) return 999999;
        const t = timeEl.textContent.trim().toLowerCase();
        if (t === 'vừa xong' || t === 'now' || t === '0p' || t === '1p') return 0;
        const parts = [...t.matchAll(/(\d+)\s*(phút|p|giờ|g|ngày|n)/g)];
        if (parts.length) return parts.reduce((total, [, amount, unit]) => total + Number(amount) * (/ngày|n/.test(unit) ? 1440 : /giờ|g/.test(unit) ? 60 : 1), 0);
        return 999999;
      }

      function compactRelativeTimeText(value) {
        const text = String(value || '').trim().toLowerCase();
        if (text === 'vừa xong' || text === 'now' || text === '0p') return '1p';
        const match = text.match(/^(\d+)\s*(phút|giờ|ngày|p|g|n)(?:\s*trước)?$/);
        if (!match) return value;
        const unitMap = { phút: 'p', p: 'p', giờ: 'g', g: 'g', ngày: 'n', n: 'n' };
        const unit = unitMap[match[2]] || match[2];
        return `${match[1]}${unit}`;
      }

      function compactRelativeTimeFields(root = document) {
        const fields = [...root.querySelectorAll('.session-time, .file-item-date')];
        if (root.nodeType === 1 && root.matches('.session-time, .file-item-date')) fields.unshift(root);
        fields.forEach(field => {
          const original = field.textContent.trim();
          if (!field.getAttribute('title') && original) {
            field.setAttribute('title', original);
          }
          field.textContent = compactRelativeTimeText(original);
        });
      }
      compactRelativeTimeFields();

      function sortContainerItems(container, sortType) {
        if (!container) return;
        const items = Array.from(container.querySelectorAll(':scope > .session-item'));
        if (items.length <= 1) return;

        items.sort((a, b) => {
          if (sortType === 'newest') {
            return parseSessionTimeScore(a) - parseSessionTimeScore(b);
          } else if (sortType === 'oldest') {
            return parseSessionTimeScore(b) - parseSessionTimeScore(a);
          } else if (sortType === 'alpha') {
            const titleA = (a.querySelector('.session-title')?.textContent || '').replace(/^✦\s*/, '').trim();
            const titleB = (b.querySelector('.session-title')?.textContent || '').replace(/^✦\s*/, '').trim();
            return titleA.localeCompare(titleB, 'vi');
          }
          return 0;
        });

        items.forEach(item => container.appendChild(item));
      }

      function applySessionSort(sortType) {
        currentSortMode = sortType;
        sortContainerItems(document.getElementById('pinnedSessionsList'), sortType);
        document.querySelectorAll('.project-folder-sessions').forEach(container => {
          sortContainerItems(container, sortType);
        });
        sortContainerItems(document.getElementById('unassignedSessionsList'), sortType);

        document.querySelectorAll('.sf-sort-item').forEach(btn => {
          const isTarget = btn.getAttribute('data-sort') === sortType;
          btn.classList.toggle('active', isTarget);
          btn.setAttribute('aria-checked', isTarget ? 'true' : 'false');
        });

        closeSessionsFilterMenu();
        if (sortType === 'newest') {
          showToast('Đã sắp xếp cuộc trò chuyện: Mới nhất đến cũ nhất');
        } else if (sortType === 'oldest') {
          showToast('Đã sắp xếp cuộc trò chuyện: Cũ nhất đến mới nhất');
        } else if (sortType === 'alpha') {
          showToast('Đã sắp xếp cuộc trò chuyện: Theo tên (A → Z)');
        }
      }

      const sfSortNewest = document.getElementById('sfSortNewest');
      if (sfSortNewest) sfSortNewest.addEventListener('click', () => applySessionSort('newest'));

      const sfSortOldest = document.getElementById('sfSortOldest');
      if (sfSortOldest) sfSortOldest.addEventListener('click', () => applySessionSort('oldest'));

      const sfSortAlpha = document.getElementById('sfSortAlpha');
      if (sfSortAlpha) sfSortAlpha.addEventListener('click', () => applySessionSort('alpha'));

      // 3. Status Filters (Running / Unread / Pinned)
      let currentFilterMode = 'all';

      function updateStatusFilterCounts() {
        const runningCount = document.querySelectorAll('.session-item.running').length;
        const unreadCount = document.querySelectorAll('.session-item.has-unread').length;
        const pinnedCount = document.querySelectorAll('.session-item.pinned').length;

        const runningBadge = document.getElementById('sfRunningCount');
        const unreadBadge = document.getElementById('sfUnreadCount');
        const pinnedBadge = document.getElementById('sfPinnedCount');

        if (runningBadge) runningBadge.textContent = runningCount;
        if (unreadBadge) unreadBadge.textContent = unreadCount;
        if (pinnedBadge) pinnedBadge.textContent = pinnedCount;
      }

      function applySessionStatusFilter(filterMode) {
        const allSessions = document.querySelectorAll('.session-item');
        const pinnedGroup = document.getElementById('pinnedSectionGroup');
        const projectsGroup = document.getElementById('projectsSectionGroup');
        const unassignedGroup = document.getElementById('unassignedSectionGroup');

        if (currentFilterMode === filterMode) {
          currentFilterMode = 'all';
        } else {
          currentFilterMode = filterMode;
        }

        document.querySelectorAll('.sf-filter-item').forEach(btn => {
          const isActive = btn.getAttribute('data-filter') === currentFilterMode;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });

        if (currentFilterMode === 'all') {
          allSessions.forEach(item => item.style.display = 'flex');
          if (pinnedGroup) pinnedGroup.style.display = '';
          if (projectsGroup) projectsGroup.style.display = '';
          if (unassignedGroup) unassignedGroup.style.display = '';
          document.querySelectorAll('.project-folder').forEach(folder => folder.style.display = '');
          closeSessionsFilterMenu();
          showToast('Bộ lọc: Đang hiển thị tất cả cuộc trò chuyện');
          return;
        }

        if (currentFilterMode === 'running') {
          let visibleCount = 0;
          allSessions.forEach(item => {
            const isRunning = item.classList.contains('running');
            item.style.display = isRunning ? 'flex' : 'none';
            if (isRunning) visibleCount++;
          });

          document.querySelectorAll('.project-folder').forEach(folder => {
            const hasRunning = folder.querySelector('.session-item.running');
            folder.style.display = hasRunning ? '' : 'none';
            if (hasRunning) folder.classList.remove('collapsed');
          });

          if (unassignedGroup) {
            const hasRunningUnassigned = unassignedGroup.querySelector('.session-item.running');
            unassignedGroup.style.display = hasRunningUnassigned ? '' : 'none';
          }
          closeSessionsFilterMenu();
          showToast(`Bộ lọc: Đang hiển thị ${visibleCount} cuộc trò chuyện đang chạy`);
        } else if (currentFilterMode === 'unread') {
          let visibleCount = 0;
          allSessions.forEach(item => {
            const isUnread = item.classList.contains('has-unread');
            item.style.display = isUnread ? 'flex' : 'none';
            if (isUnread) visibleCount++;
          });

          document.querySelectorAll('.project-folder').forEach(folder => {
            const hasUnread = folder.querySelector('.session-item.has-unread');
            folder.style.display = hasUnread ? '' : 'none';
            if (hasUnread) folder.classList.remove('collapsed');
          });

          if (unassignedGroup) {
            const hasUnreadUnassigned = unassignedGroup.querySelector('.session-item.has-unread');
            unassignedGroup.style.display = hasUnreadUnassigned ? '' : 'none';
          }
          closeSessionsFilterMenu();
          showToast(`Bộ lọc: Đang hiển thị ${visibleCount} cuộc trò chuyện chưa đọc`);
        } else if (currentFilterMode === 'pinned') {
          if (pinnedGroup) {
            pinnedGroup.style.display = '';
            const pinnedList = document.getElementById('pinnedSessionsList');
            if (pinnedList) pinnedList.classList.remove('collapsed');
          }
          if (projectsGroup) projectsGroup.style.display = 'none';
          if (unassignedGroup) unassignedGroup.style.display = 'none';
          const count = document.querySelectorAll('#pinnedSessionsList .session-item').length;
          closeSessionsFilterMenu();
          showToast(`Bộ lọc: Đang xem ${count} cuộc trò chuyện đã ghim`);
        }
      }

      const sfFilterRunning = document.getElementById('sfFilterRunning');
      if (sfFilterRunning) sfFilterRunning.addEventListener('click', () => applySessionStatusFilter('running'));

      const sfFilterUnread = document.getElementById('sfFilterUnread');
      if (sfFilterUnread) sfFilterUnread.addEventListener('click', () => applySessionStatusFilter('unread'));

      const sfFilterPinned = document.getElementById('sfFilterPinned');
      if (sfFilterPinned) sfFilterPinned.addEventListener('click', () => applySessionStatusFilter('pinned'));

      // 4. Display Density & Timestamps
      const sfToggleCompact = document.getElementById('sfToggleCompact');
      if (sfToggleCompact) {
        sfToggleCompact.addEventListener('click', () => {
          const sessionsList = document.getElementById('sessionsList');
          const compactPill = document.getElementById('sfCompactPill');
          if (!sessionsList) return;
          const isCompact = sessionsList.classList.toggle('compact-density');
          if (compactPill) {
            compactPill.textContent = isCompact ? 'Bật' : 'Tắt';
            compactPill.classList.toggle('active', isCompact);
          }
          sfToggleCompact.classList.toggle('active', isCompact);
          sfToggleCompact.setAttribute('aria-checked', isCompact ? 'true' : 'false');
          showToast(isCompact ? 'Chế độ hiển thị: Thu gọn (Xem được nhiều cuộc trò chuyện hơn)' : 'Chế độ hiển thị: Tiêu chuẩn');
        });
      }

      const sfToggleTimestamps = document.getElementById('sfToggleTimestamps');
      if (sfToggleTimestamps) {
        sfToggleTimestamps.addEventListener('click', () => {
          const sessionsList = document.getElementById('sessionsList');
          const timestampsPill = document.getElementById('sfTimestampsPill');
          if (!sessionsList) return;
          const isHidden = sessionsList.classList.toggle('hide-timestamps');
          const isVisible = !isHidden;
          if (timestampsPill) {
            timestampsPill.textContent = isVisible ? 'Bật' : 'Tắt';
            timestampsPill.classList.toggle('active', isVisible);
          }
          sfToggleTimestamps.classList.toggle('active', isVisible);
          sfToggleTimestamps.setAttribute('aria-checked', isVisible ? 'true' : 'false');
          showToast(isVisible ? 'Đã bật hiển thị mốc thời gian' : 'Đã ẩn mốc thời gian (Tối giản danh sách)');
        });
      }

      // 5. Reset All
      const sfActionResetAll = document.getElementById('sfActionResetAll');
      if (sfActionResetAll) {
        sfActionResetAll.addEventListener('click', () => {
          currentFilterMode = 'all';
          applySessionStatusFilter('all');
          applySessionSort('newest');

          const sessionsList = document.getElementById('sessionsList');
          if (sessionsList) {
            sessionsList.classList.remove('compact-density');
            sessionsList.classList.remove('hide-timestamps');
          }
          const compactPill = document.getElementById('sfCompactPill');
          if (compactPill) {
            compactPill.textContent = 'Tắt';
            compactPill.classList.remove('active');
          }
          if (sfToggleCompact) {
            sfToggleCompact.classList.remove('active');
            sfToggleCompact.setAttribute('aria-checked', 'false');
          }

          const timestampsPill = document.getElementById('sfTimestampsPill');
          if (timestampsPill) {
            timestampsPill.textContent = 'Bật';
            timestampsPill.classList.add('active');
          }
          if (sfToggleTimestamps) {
            sfToggleTimestamps.classList.add('active');
            sfToggleTimestamps.setAttribute('aria-checked', 'true');
          }

          document.querySelectorAll('.project-folder').forEach(folder => {
            const name = folder.getAttribute('data-folder');
            if (name === 'dual-engine' || name === 'design-system') {
              folder.classList.remove('collapsed');
            } else {
              folder.classList.add('collapsed');
            }
          });

          closeSessionsFilterMenu();
          showToast('Đã khôi phục hiển thị danh sách mặc định');
        });
      }

      if (addWorkspaceBtn) {
        addWorkspaceBtn.addEventListener('click', () => {
          openCustomInputModal({
            title: 'Thư mục dự án mới',
            desc: 'Nhập tên thư mục dự án mới cho không gian làm việc:',
            placeholder: 'Tên thư mục...',
            defaultValue: 'Dự án Trí tuệ Nhân tạo mới',
            onConfirm: (name) => {
              createProjectFolderElement(name);
              showToast(`Đã tạo thư mục dự án: "${name}"`);
            }
          });
        });
      }

      // ─── Hòn π Context Menu System (From image-1.png) ───
      const sessionContextMenu = document.getElementById('sessionContextMenu');
      const ctxPinLabel = document.getElementById('ctxPinLabel');
      const ctxUnreadLabel = document.getElementById('ctxUnreadLabel');
      const ctxRunningLabel = document.getElementById('ctxRunningLabel');
      const deleteConfirmModal = document.getElementById('deleteConfirmModal');
      const deleteSessionNamePreview = document.getElementById('deleteSessionNamePreview');
      const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
      const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
      const shareSessionModal = document.getElementById('shareSessionModal');
      const shareSessionNamePreview = document.getElementById('shareSessionNamePreview');
      const shareLinkInput = document.getElementById('shareLinkInput');
      const copyShareLinkBtn = document.getElementById('copyShareLinkBtn');
      const closeShareModalBtn = document.getElementById('closeShareModalBtn');
      const closeShareModalBottomBtn = document.getElementById('closeShareModalBottomBtn');
      const exportMarkdownBtn = document.getElementById('exportMarkdownBtn');
      const openWindowModal = document.getElementById('openWindowModal');
      const openWindowSessionTitle = document.getElementById('openWindowSessionTitle');
      const openWindowSlug = document.getElementById('openWindowSlug');
      const openWindowTranscriptPreview = document.getElementById('openWindowTranscriptPreview');
      const closeOpenWindowBtn = document.getElementById('closeOpenWindowBtn');
      const closeOpenWindowBottomBtn = document.getElementById('closeOpenWindowBottomBtn');
      const launchRealBrowserTabBtn = document.getElementById('launchRealBrowserTabBtn');

      let targetSessionItem = null;
      let sessionToDelete = null;

      function openSessionContextMenu(e, item) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        targetSessionItem = item;

        document.querySelectorAll('.session-item').forEach(el => el.classList.remove('context-active'));
        item.classList.add('context-active');

        // Update labels based on session state
        const isPinned = item.classList.contains('pinned');
        const isUnread = item.classList.contains('unread');
        const currentProject = item.getAttribute('data-project') || '';
        const currentSection = item.getAttribute('data-section') || '';

        if (ctxPinLabel) ctxPinLabel.textContent = isPinned ? 'Bỏ ghim' : 'Ghim';
        if (ctxUnreadLabel) ctxUnreadLabel.textContent = isUnread ? 'Đánh dấu là đã đọc' : 'Đánh dấu là chưa đọc';
        const isRunning = item.classList.contains('running');
        if (ctxRunningLabel) ctxRunningLabel.textContent = isRunning ? 'Dừng tiến trình chạy' : 'Bật tiến trình chạy';
        // Mark active submenus
        document.querySelectorAll('.context-submenu-item[data-project]').forEach(p => {
          p.classList.toggle('active-item', p.getAttribute('data-project') === currentProject);
        });
        document.querySelectorAll('.context-submenu-item[data-section]').forEach(s => {
          s.classList.toggle('active-item', s.getAttribute('data-section') === currentSection);
        });

        // Position coordinates
        let posX = e && e.clientX ? e.clientX : 180;
        let posY = e && e.clientY ? e.clientY : 160;

        if (!e || !e.clientX) {
          const itemRect = item.getBoundingClientRect();
          posX = itemRect.right - 40;
          posY = itemRect.top + 10;
        }

        const menuWidth = 230;
        const menuHeight = 430;
        if (posX + menuWidth > window.innerWidth - 10) {
          posX = Math.max(10, window.innerWidth - menuWidth - 12);
        }
        if (posY + menuHeight > window.innerHeight - 10) {
          posY = Math.max(10, window.innerHeight - menuHeight - 12);
        }

        const shouldFlip = posX + menuWidth + 200 > window.innerWidth;
        document.querySelectorAll('.context-submenu').forEach(sub => {
          sub.classList.toggle('flip-left', shouldFlip);
        });

        if (sessionContextMenu) {
          sessionContextMenu.style.left = posX + 'px';
          sessionContextMenu.style.top = posY + 'px';
          sessionContextMenu.classList.add('open');
        }
      }

      function closeSessionContextMenu() {
        if (sessionContextMenu) sessionContextMenu.classList.remove('open');
        document.querySelectorAll('.session-item').forEach(el => el.classList.remove('context-active'));
      }

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.neuratalk-context-menu')) {
          closeSessionContextMenu();
        }
      });
      document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('.session-item')) {
          closeSessionContextMenu();
        }
      });
      window.addEventListener('scroll', closeSessionContextMenu, true);

      // ─── Tác vụ 1: Đặt lại tên (Rename) ───
      function startRenameSession(item) {
        if (!item) return;
        closeSessionContextMenu();
        const titleEl = item.querySelector('.session-title');
        if (!titleEl) return;
        const currentTitle = titleEl.textContent.replace(/^✦\s*/, '').trim();

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'session-rename-input';
        input.value = currentTitle;

        titleEl.style.display = 'none';
        titleEl.parentNode.insertBefore(input, titleEl.nextSibling);
        input.focus();
        input.select();

        let committed = false;
        function commitRename() {
          if (committed) return;
          committed = true;
          const newName = input.value.trim();
          if (newName && newName !== currentTitle) {
            titleEl.textContent = (item.classList.contains('active') ? '✦ ' : '') + newName;
            showToast(`Đã đổi tên thành: "${newName}"`);
          }
          input.remove();
          titleEl.style.display = '';
        }

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitRename();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            committed = true;
            input.remove();
            titleEl.style.display = '';
          }
        });
        input.addEventListener('blur', commitRename);
      }

      // ─── Tác vụ 2: Ghim / Bỏ ghim (Pin / Unpin / Tick / Untick) ───
      function togglePinSession(item) {
        if (!item) return;
        closeSessionContextMenu();
        const isPinned = item.classList.contains('pinned');
        const projectName = item.getAttribute('data-project') || '';
        const titleEl = item.querySelector('.session-title');
        const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';

        if (!isPinned) {
          // TÍCK NÓ LÊN (GHIM LÊN TRÊN):
          item.classList.add('pinned');
          const pinBtn = item.querySelector('.session-pin-btn');
          if (pinBtn) {
            pinBtn.setAttribute('title', projectName ? `Bỏ ghim (Trả về thư mục ${projectName})` : 'Bỏ ghim (Trả về Chưa phân loại)');
            pinBtn.setAttribute('aria-label', 'Bỏ ghim');
          }

          // Ensure project tag badge exists if it has a project
          let tag = item.querySelector('.session-badge-tag');
          if (projectName) {
            if (!tag) {
              tag = document.createElement('span');
              tag.className = 'session-badge-tag';
              const left = item.querySelector('.session-item-left') || item;
              left.appendChild(tag);
            }
            tag.textContent = projectName;
          }

          // Ensure pin icon is present
          let pinIcon = item.querySelector('.session-pin-icon');
          if (!pinIcon) {
            pinIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            pinIcon.setAttribute('class', 'session-pin-icon');
            pinIcon.setAttribute('viewBox', '0 0 24 24');
            pinIcon.setAttribute('fill', 'none');
            pinIcon.setAttribute('stroke', 'currentColor');
            pinIcon.setAttribute('stroke-width', '2.2');
            pinIcon.innerHTML = '<line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>';
            const dot = item.querySelector('.session-dot');
            const left = item.querySelector('.session-item-left') || item;
            if (dot) dot.after(pinIcon);
            else left.prepend(pinIcon);
            pinIcon.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              togglePinSession(item);
            });
          }
          pinIcon.setAttribute('title', projectName ? `Bỏ ghim (Trả về thư mục ${projectName})` : 'Bỏ ghim (Trả về Chưa phân loại)');
          pinIcon.setAttribute('aria-label', 'Bỏ ghim');

          const pinnedList = document.getElementById('pinnedSessionsList');
          if (pinnedList) {
            pinnedList.appendChild(item);
          }
          showToast(`Đã ghim lên trên: "${sessionTitle}"`);
        } else {
          // UNTICK (TRẢ VỀ LẠI FOLDER DỰ ÁN HOẶC CHƯA PHÂN LOẠI):
          item.classList.remove('pinned');
          const pinBtn = item.querySelector('.session-pin-btn');
          if (pinBtn) {
            pinBtn.setAttribute('title', 'Ghim lên trên (Tíck lên trên)');
            pinBtn.setAttribute('aria-label', 'Ghim lên trên');
          }

          if (projectName && projectName !== 'none') {
            // Trả về folder dự án tương ứng
            let targetFolderSessions = document.querySelector(`.project-folder-sessions[data-folder="${projectName}"]`);
            if (!targetFolderSessions) {
              targetFolderSessions = createProjectFolderElement(projectName);
            }
            if (targetFolderSessions) {
              targetFolderSessions.insertBefore(item, targetFolderSessions.firstChild);
              const folderParent = targetFolderSessions.closest('.project-folder');
              if (folderParent) folderParent.classList.remove('collapsed');
              showToast(`Đã trả về thư mục dự án: "${projectName}"`);
            }
          } else {
            // Không thuộc dự án nào -> chuyển về mục Chưa phân loại ở đáy
            const unassignedList = document.getElementById('unassignedSessionsList');
            if (unassignedList) {
              unassignedList.insertBefore(item, unassignedList.firstChild);
              showToast(`Đã trả về mục Chưa phân loại ở dưới cùng`);
            }
          }
        }
        updateSidebarCounts();
      }

      // ─── Tác vụ 3: Đánh dấu là chưa đọc / đã đọc (Unread / Read) ───
      function toggleUnreadSession(item) {
        if (!item) return;
        closeSessionContextMenu();
        const isUnread = item.classList.toggle('unread');
        showToast(isUnread ? 'Đã đánh dấu là chưa đọc' : 'Đã đánh dấu là đã đọc');
      }

      // ─── Tác vụ: Bật / Dừng tiến trình chạy (Toggle Running State) ───
      function toggleRunningSession(item) {
        if (!item) return;
        closeSessionContextMenu();
        ensureSessionSpinner(item);
        const willRun = !item.classList.contains('running');
        item.classList.toggle('running', willRun);
        const titleEl = item.querySelector('.session-title');
        const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';
        if (willRun) {
          showToast(`Đang chạy tác vụ AI cho: "${sessionTitle}"`);
        } else {
          showToast(`Đã dừng tác vụ: "${sessionTitle}"`);
        }
      }

      function ensureSessionSpinner(item) {
        if (!item) return;
        const right = item.querySelector('.session-item-right');
        if (right && !right.querySelector('.session-spinner')) {
          const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          spinner.setAttribute('class', 'session-spinner');
          spinner.setAttribute('viewBox', '0 0 24 24');
          spinner.setAttribute('fill', 'none');
          spinner.setAttribute('stroke', 'currentColor');
          spinner.setAttribute('stroke-width', '2.5');
          spinner.setAttribute('stroke-linecap', 'round');
          spinner.setAttribute('aria-label', 'Đang xử lý tác vụ');
          spinner.innerHTML = '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25"></circle><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor"></path>';
          right.appendChild(spinner);
        }
      }

      // ─── Tác vụ 4: Lưu trữ (Archive with Undo) ───
      function archiveSession(item) {
        if (!item) return;
        closeSessionContextMenu();
        item.classList.add('archiving');
        const titleEl = item.querySelector('.session-title');
        const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';
        setTimeout(() => {
          item.style.display = 'none';
          item.setAttribute('data-archived', 'true');
          item.classList.remove('archiving');

          if (item.classList.contains('active')) {
            const nextVisible = Array.from(document.querySelectorAll('.session-item')).find(el => el.style.display !== 'none' && !el.getAttribute('data-archived'));
            if (nextVisible) {
              nextVisible.click();
            } else {
              const emptySessionsState = document.getElementById('emptySessionsState');
              if (emptySessionsState) emptySessionsState.classList.add('visible');
            }
          }

          toastMsg.innerHTML = `Đã lưu trữ "${sessionTitle}" <button id="undoArchiveBtn" style="margin-left:8px;padding:2px 8px;border-radius:var(--radius-sm);background:var(--accent);color:var(--accent-on);border:none;cursor:pointer;font-size:11.5px;font-weight:600;">Hoàn tác</button>`;
          toastNotice.classList.add('show');
          setTimeout(() => {
            const undoBtn = document.getElementById('undoArchiveBtn');
            if (undoBtn) {
              undoBtn.onclick = () => {
                item.removeAttribute('data-archived');
                item.style.display = 'flex';
                showToast(`Đã khôi phục "${sessionTitle}"`);
              };
            }
          }, 50);
          setTimeout(() => {
            toastNotice.classList.remove('show');
          }, 3500);
        }, 200);
      }

      // ─── Tác vụ 5: Xoá vĩnh viễn (Delete Permanently) ───
      function confirmDeleteSession(item) {
        if (!item) return;
        closeSessionContextMenu();
        sessionToDelete = item;
        const titleEl = item.querySelector('.session-title');
        const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';
        if (deleteSessionNamePreview) deleteSessionNamePreview.textContent = sessionTitle;
        if (deleteConfirmModal) deleteConfirmModal.classList.add('open');
      }

      if (cancelDeleteBtn && deleteConfirmModal) {
        cancelDeleteBtn.addEventListener('click', () => {
          deleteConfirmModal.classList.remove('open');
          sessionToDelete = null;
        });
      }

      if (confirmDeleteBtn && deleteConfirmModal) {
        confirmDeleteBtn.addEventListener('click', () => {
          if (sessionToDelete) {
            const titleEl = sessionToDelete.querySelector('.session-title');
            const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';
            const wasActive = sessionToDelete.classList.contains('active');
            sessionToDelete.classList.add('archiving');
            setTimeout(() => {
              sessionToDelete.remove();
              sessionToDelete = null;
              if (wasActive) {
                const firstRemaining = Array.from(document.querySelectorAll('.session-item')).find(el => el.style.display !== 'none' && !el.getAttribute('data-archived'));
                if (firstRemaining) firstRemaining.click();
                else {
                  const emptySessionsState = document.getElementById('emptySessionsState');
                  if (emptySessionsState) emptySessionsState.classList.add('visible');
                }
              }
              showToast(`Đã xoá vĩnh viễn: "${sessionTitle}"`);
            }, 180);
          }
          deleteConfirmModal.classList.remove('open');
        });
      }

      // ─── Tác vụ 6: Dự án (Project) Submenu ───
      function assignProjectToSession(item, projectName) {
        if (!item) return;
        closeSessionContextMenu();
        const isPinned = item.classList.contains('pinned');
        const titleEl = item.querySelector('.session-title');
        const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';

        if (projectName === 'none' || !projectName) {
          item.setAttribute('data-project', '');
          const tag = item.querySelector('.session-badge-tag');
          if (tag) tag.remove();

          if (!isPinned) {
            const unassignedList = document.getElementById('unassignedSessionsList');
            if (unassignedList) {
              unassignedList.insertBefore(item, unassignedList.firstChild);
            }
            showToast(`Đã chuyển "${sessionTitle}" về mục Chưa phân loại (ở dưới cùng)`);
          } else {
            const pinBtn = item.querySelector('.session-pin-btn');
            if (pinBtn) pinBtn.setAttribute('title', 'Bỏ ghim (Trả về Chưa phân loại)');
            showToast(`Đã gỡ "${sessionTitle}" khỏi dự án (khi bỏ ghim sẽ về Chưa phân loại)`);
          }
        } else {
          item.setAttribute('data-project', projectName);
          let tag = item.querySelector('.session-badge-tag');
          if (!tag) {
            tag = document.createElement('span');
            tag.className = 'session-badge-tag';
            const left = item.querySelector('.session-item-left') || item;
            left.appendChild(tag);
          }
          tag.textContent = projectName;

          if (!isPinned) {
            let targetFolderSessions = document.querySelector(`.project-folder-sessions[data-folder="${projectName}"]`);
            if (!targetFolderSessions) {
              targetFolderSessions = createProjectFolderElement(projectName);
            }
            if (targetFolderSessions) {
              targetFolderSessions.insertBefore(item, targetFolderSessions.firstChild);
              const folderParent = targetFolderSessions.closest('.project-folder');
              if (folderParent) folderParent.classList.remove('collapsed');
            }
            showToast(`Đã chuyển "${sessionTitle}" vào thư mục dự án: "${projectName}"`);
          } else {
            const pinBtn = item.querySelector('.session-pin-btn');
            if (pinBtn) pinBtn.setAttribute('title', `Bỏ ghim (Trả về thư mục ${projectName})`);
            showToast(`Đã cập nhật dự án: "${projectName}" (khi bỏ ghim sẽ về thư mục này)`);
          }
        }
        updateSidebarCounts();
      }

      document.querySelectorAll('.context-submenu-item[data-project]').forEach(el => {
        el.addEventListener('click', () => {
          const project = el.getAttribute('data-project');
          assignProjectToSession(targetSessionItem, project);
        });
      });

      const newProjectSubmenuItem = document.querySelector('.new-project-item');
      if (newProjectSubmenuItem) {
        newProjectSubmenuItem.addEventListener('click', () => {
          closeSessionContextMenu();
          openCustomInputModal({
            title: 'Tạo dự án mới',
            desc: 'Nhập tên dự án mới cho cuộc trò chuyện:',
            placeholder: 'Tên dự án...',
            defaultValue: 'Dự án Trí tuệ Nhân tạo mới',
            onConfirm: (name) => {
              createProjectFolderElement(name);
              assignProjectToSession(targetSessionItem, name);
            }
          });
        });
      }

      // ─── Tác vụ 7: Mục (Section) Submenu ───
      function assignSectionToSession(item, sectionName) {
        if (!item) return;
        closeSessionContextMenu();
        item.setAttribute('data-section', sectionName);
        showToast(`Đã phân loại vào mục: "${sectionName}"`);
      }

      document.querySelectorAll('.context-submenu-item[data-section]').forEach(el => {
        el.addEventListener('click', () => {
          const section = el.getAttribute('data-section');
          assignSectionToSession(targetSessionItem, section);
        });
      });

      const newSectionSubmenuItem = document.querySelector('.new-section-item');
      if (newSectionSubmenuItem) {
        newSectionSubmenuItem.addEventListener('click', () => {
          closeSessionContextMenu();
          openCustomInputModal({
            title: 'Thêm mục mới',
            desc: 'Nhập tên mục phân loại mới:',
            placeholder: 'Tên mục...',
            defaultValue: 'Chuyên đề Nghiên cứu',
            onConfirm: (name) => {
              assignSectionToSession(targetSessionItem, name);
            }
          });
        });
      }

      // ─── Tác vụ 8: Chia sẻ (Share Session Modal) ───
      function openShareModalForSession(item) {
        if (!item) return;
        closeSessionContextMenu();
        const titleEl = item.querySelector('.session-title');
        const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';
        if (shareSessionNamePreview) shareSessionNamePreview.textContent = sessionTitle;
        const slug = sessionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
        if (shareLinkInput) {
          shareLinkInput.value = `https://hon-pi.ai/share/${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
        }
        if (shareSessionModal) shareSessionModal.classList.add('open');
      }

      if (closeShareModalBtn && shareSessionModal) {
        closeShareModalBtn.addEventListener('click', () => shareSessionModal.classList.remove('open'));
      }
      if (closeShareModalBottomBtn && shareSessionModal) {
        closeShareModalBottomBtn.addEventListener('click', () => shareSessionModal.classList.remove('open'));
      }

      if (copyShareLinkBtn && shareLinkInput) {
        copyShareLinkBtn.addEventListener('click', () => {
          shareLinkInput.select();
          try {
            navigator.clipboard.writeText(shareLinkInput.value);
          } catch (e) {}
          showToast('Đã sao chép liên kết chia sẻ vào bộ nhớ tạm');
        });
      }

      if (exportMarkdownBtn) {
        exportMarkdownBtn.addEventListener('click', () => {
          const sessionTitle = shareSessionNamePreview ? shareSessionNamePreview.textContent : 'Cuộc trò chuyện Hòn π';
          const mdContent = `# Cuộc trò chuyện Hòn π: ${sessionTitle}\nThời gian xuất bản: ${new Date().toLocaleString('vi-VN')}\n\n---\n\n### Người dùng:\n${chatInput.value || 'Xin chào Hòn π! Hãy kiểm tra hệ thống cơ sở dữ liệu và các bản sao lưu.'}\n\n### Hệ thống AI Hòn π:\nĐã kiểm tra 14 bảng cơ sở dữ liệu. Toàn bộ bản lưu trữ đã được đồng bộ hóa 100% với máy chủ điều phối đám mây.`;
          try {
            navigator.clipboard.writeText(mdContent);
          } catch (e) {}
          showToast('Đã xuất và sao chép định dạng Markdown');
        });
      }

      // ─── Tác vụ 9: Sao chép (Copy Submenu) ───
      document.querySelectorAll('.context-submenu-item[data-copy-type]').forEach(el => {
        el.addEventListener('click', () => {
          if (!targetSessionItem) return;
          const copyType = el.getAttribute('data-copy-type');
          const titleEl = targetSessionItem.querySelector('.session-title');
          const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';
          closeSessionContextMenu();

          if (copyType === 'link') {
            const slug = sessionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const url = `https://hon-pi.ai/c/${slug}`;
            try { navigator.clipboard.writeText(url); } catch (e) {}
            showToast('Đã sao chép liên kết cuộc trò chuyện');
          } else if (copyType === 'content') {
            const content = `[Cuộc trò chuyện Hòn π: ${sessionTitle}]\nNgười dùng: Kiểm tra tiện ích sao lưu dữ liệu\nHòn π: Hệ thống đã kiểm tra 14 bảng cơ sở dữ liệu và tiện ích sao lưu hoàn toàn tương thích.`;
            try { navigator.clipboard.writeText(content); } catch (e) {}
            showToast('Đã sao chép toàn bộ nội dung hội thoại');
          } else if (copyType === 'duplicate') {
            const clone = targetSessionItem.cloneNode(true);
            const newId = 's_' + Date.now();
            clone.setAttribute('data-session-id', newId);
            clone.classList.remove('active', 'context-active');
            const cloneTitle = clone.querySelector('.session-title');
            if (cloneTitle) cloneTitle.textContent = `[Bản sao] ${sessionTitle}`;
            targetSessionItem.after(clone);
            bindSessionItemEvents(clone);
            updateSidebarCounts();
            showToast(`Đã nhân bản: "[Bản sao] ${sessionTitle}"`);
          }
        });
      });

      // ─── Tác vụ 10: Fork (Phân nhánh Submenu) ───
      document.querySelectorAll('.context-submenu-item[data-fork-type]').forEach(el => {
        el.addEventListener('click', () => {
          if (!targetSessionItem) return;
          const forkType = el.getAttribute('data-fork-type');
          const titleEl = targetSessionItem.querySelector('.session-title');
          const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';

          const forkEl = document.createElement('div');
          const newId = 'fork_' + Date.now();
          forkEl.className = 'session-item active';
          forkEl.setAttribute('data-session-id', newId);
          forkEl.setAttribute('data-project', targetSessionItem.getAttribute('data-project') || 'design-system');
          forkEl.setAttribute('data-section', 'Nghiên cứu & Ý tưởng');
          forkEl.tabIndex = 0;
          forkEl.innerHTML = `
            <div class="session-item-left">
              <span class="session-dot" style="background: var(--accent);"></span>
              <svg class="session-pin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
              <span class="session-title">⑂ [Nhánh] ${sessionTitle}</span>
              <span class="session-badge-tag">nhánh</span>
            </div>
            <div class="session-item-right">
              <span class="unread-indicator"></span>
              <span class="session-time" title="Vừa xong">1p</span>
            </div>
          `;
          document.querySelectorAll('.session-item').forEach(s => s.classList.remove('active'));
          targetSessionItem.after(forkEl);
          bindSessionItemEvents(forkEl);
          updateSidebarCounts();
          if (forkType === 'latest') {
            showToast(`Đã tạo nhánh hội thoại từ tin nhắn cuối: "${sessionTitle}"`);
          } else if (forkType === 'history') {
            showToast(`Đã tạo nhánh hội thoại toàn bộ lịch sử: "${sessionTitle}"`);
          } else {
            showToast(`Đã tạo nhánh hội thoại vào dự án mới`);
          }
        });
      });

      // ─── Tác vụ 11: Mở trong cửa sổ mới (Open in New Window) ───
      function openWindowForSession(item) {
        if (!item) return;
        closeSessionContextMenu();
        const titleEl = item.querySelector('.session-title');
        const sessionTitle = (titleEl ? titleEl.textContent : '').replace(/^✦\s*/, '').trim() || 'Cuộc trò chuyện';
        if (openWindowSessionTitle) openWindowSessionTitle.textContent = sessionTitle;
        if (openWindowSlug) openWindowSlug.textContent = sessionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (openWindowTranscriptPreview) {
          openWindowTranscriptPreview.innerHTML = `
            <div style="margin-bottom:8px;font-weight:600;color:var(--accent);">Không gian làm việc Độc lập Hòn π AI</div>
            <p style="margin:0 0 8px;"><strong>Ngữ cảnh:</strong> Cuộc trò chuyện "${sessionTitle}" đang hoạt động với đầy đủ 8 công cụ nâng cao và mô hình Hòn π Cốt lõi v2.4.</p>
            <p style="margin:0;color:var(--muted);font-size:12px;">Nhấn "Mở tab trình duyệt mới" để tách biệt hoàn toàn không gian làm việc này.</p>
          `;
        }
        if (openWindowModal) openWindowModal.classList.add('open');
      }

      if (closeOpenWindowBtn && openWindowModal) {
        closeOpenWindowBtn.addEventListener('click', () => openWindowModal.classList.remove('open'));
      }
      if (closeOpenWindowBottomBtn && openWindowModal) {
        closeOpenWindowBottomBtn.addEventListener('click', () => openWindowModal.classList.remove('open'));
      }
      if (launchRealBrowserTabBtn) {
        launchRealBrowserTabBtn.addEventListener('click', () => {
          showToast('Đang khởi tạo tab trình duyệt độc lập...');
          setTimeout(() => {
            window.open(window.location.href, '_blank');
          }, 300);
        });
      }

      // Bind menu item click events
      document.querySelectorAll('.context-menu-item[data-action]').forEach(item => {
        item.addEventListener('click', (e) => {
          if (item.classList.contains('has-submenu')) return;
          const action = item.getAttribute('data-action');
          if (action === 'rename') startRenameSession(targetSessionItem);
          else if (action === 'pin') togglePinSession(targetSessionItem);
          else if (action === 'unread') toggleUnreadSession(targetSessionItem);
          else if (action === 'toggle-running') toggleRunningSession(targetSessionItem);
          else if (action === 'archive') archiveSession(targetSessionItem);
          else if (action === 'delete') confirmDeleteSession(targetSessionItem);
          else if (action === 'share') openShareModalForSession(targetSessionItem);
          else if (action === 'open-window') openWindowForSession(targetSessionItem);
        });
      });

      // Bind Session Item Events
      function bindSessionItemEvents(item) {
        ensureSessionSpinner(item);
        compactRelativeTimeFields(item);
        item.addEventListener('click', (e) => {
          if (e.target.closest('.session-pin-icon')) {
            e.preventDefault();
            e.stopPropagation();
            togglePinSession(item);
            return;
          }
          if (e.target.closest('.session-rename-input')) {
            return;
          }
          e.preventDefault();
          setActiveSession(item);
        });

        item.addEventListener('contextmenu', (e) => {
          openSessionContextMenu(e, item);
        });


        const pinIcon = item.querySelector('.session-pin-icon');
        if (pinIcon) {
          pinIcon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePinSession(item);
          });
        }
      }
      document.querySelectorAll('.session-item').forEach(bindSessionItemEvents);
      updateSidebarCounts();
      // ─── Connection Status Pill (from image) ───
      const connectionStatusPill = document.getElementById('connectionStatusPill');
      const connectionStatusLabel = document.getElementById('connectionStatusLabel');
      const connectionStates = [
        { state: 'connected', label: 'Đã kết nối', toast: 'Máy chủ kết nối: độ trễ 24ms' },
        { state: 'syncing', label: 'Đang đồng bộ...', toast: 'Đang đồng bộ hóa không gian làm việc...' },
        { state: 'disconnected', label: 'Đã ngắt kết nối', toast: 'Đã ngắt kết nối khỏi máy chủ điều phối' }
      ];
      let currentConnIndex = 0;

      if (connectionStatusPill && connectionStatusLabel) {
        connectionStatusPill.addEventListener('click', () => {
          currentConnIndex = (currentConnIndex + 1) % connectionStates.length;
          const next = connectionStates[currentConnIndex];
          connectionStatusPill.className = `status-pill status-${next.state}`;
          connectionStatusLabel.textContent = next.label;
          showToast(next.toast);
        });
      }

      const navSettingsBtn = document.getElementById('navSettingsBtn');
      if (navSettingsBtn) {
        navSettingsBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (typeof openSettingsModal === 'function') {
            openSettingsModal('general');
          } else {
            showToast('Đã mở bảng điều khiển Cài đặt');
          }
        });
      }
      document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          const navName = item.getAttribute('data-nav');
          const navText = item.querySelector('span:nth-child(2)')?.textContent || '';
          if (navName !== 'chat' && navText) {
            showToast(`Đã chuyển đến ${navText}`);
          }
        });
      });

      document.getElementById('attachBtn')?.addEventListener('click', () => showToast('Đã mở hộp thoại đính kèm tệp'));
      document.getElementById('enhancePromptBtn')?.addEventListener('click', () => {
        if (chatInput && chatInput.value.trim()) {
          chatInput.value = 'Mở rộng phân tích chuyên sâu với độ chuẩn xác kỹ thuật cao: ' + chatInput.value.trim();
          showToast('Đã tối ưu câu lệnh bằng AI');
        } else {
          showToast('Vui lòng nhập câu lệnh trước khi tối ưu');
        }
      });
      document.getElementById('imageUploadBtn')?.addEventListener('click', () => showToast('Đã sẵn sàng tải lên ảnh tham khảo'));
      document.getElementById('voiceRecordBtn')?.addEventListener('click', () => showToast('Đang lắng nghe giọng nói của bạn...'));

      // ─── File Change Cards & Code Diff Review Modal Logic (from image-94, 95, 96) ───
      const codeDiffFilesData = {
        'dashboard-live.js': {
          name: 'dashboard-live.js',
          path: '/workspace/analytics-platform/src/dashboard-live.js',
          add: 7,
          del: 3,
          reverted: false,
          lines: [
            { type: 'normal', oldNum: 142, newNum: 142, code: '  // Runtime connection heartbeat verification' },
            { type: 'normal', oldNum: 143, newNum: 143, code: '  async function verifyOmpGatewayConnection() {' },
            { type: 'del', oldNum: 144, newNum: '', code: '-   const res = await fetch("http://127.0.0.1:61277/health");' },
            { type: 'del', oldNum: 145, newNum: '', code: '-   if (!res.ok) throw new Error("Gateway offline");' },
            { type: 'del', oldNum: 146, newNum: '', code: '-   return await res.json();' },
            { type: 'add', oldNum: '', newNum: 144, code: '+   const statusEndpoint = config.useNativeStatus ? "/status" : "/health";' },
            { type: 'add', oldNum: '', newNum: 145, code: '+   const res = await fetch(`http://127.0.0.1:61277${statusEndpoint}`);' },
            { type: 'add', oldNum: '', newNum: 146, code: '+   if (!res.ok) {' },
            { type: 'add', oldNum: '', newNum: 147, code: '+     logger.warn("Syncing OMP status threshold with upstream broker");' },
            { type: 'add', oldNum: '', newNum: 148, code: '+     return { status: "fallback", accounts: 6, availableQuota: 0.99 };' },
            { type: 'add', oldNum: '', newNum: 149, code: '+   }' },
            { type: 'add', oldNum: '', newNum: 150, code: '+   return await res.json();' },
            { type: 'normal', oldNum: 147, newNum: 151, code: '  }' },
            { type: 'normal', oldNum: 148, newNum: 152, code: '  export { verifyOmpGatewayConnection };' }
          ]
        },
        'server.mjs': {
          name: 'server.mjs',
          path: '/workspace/analytics-platform/src/server.mjs',
          add: 2,
          del: 1,
          reverted: false,
          lines: [
            { type: 'normal', oldNum: 58, newNum: 58, code: '  import { createServer } from "node:http";' },
            { type: 'del', oldNum: 59, newNum: '', code: '- const DEFAULT_ESTIMATED_START_LABEL = "Khởi chạy ban đầu";' },
            { type: 'add', oldNum: '', newNum: 59, code: '+ const DEFAULT_ESTIMATED_START_LABEL = "Ước tính bắt đầu";' },
            { type: 'add', oldNum: '', newNum: 60, code: '+ const STATUS_REFRESH_INTERVAL_MS = 24_000;' },
            { type: 'normal', oldNum: 60, newNum: 61, code: '  export const appConfig = { label: DEFAULT_ESTIMATED_START_LABEL };' }
          ]
        },
        'dashboard-live-work': {
          name: 'dashboard-live.js (Work)',
          path: '/workspace/analytics-platform/src/dashboard-live.js',
          add: 7,
          del: 3,
          reverted: false,
          lines: [
            { type: 'normal', oldNum: 88, newNum: 88, code: '  // Sync working copy with OMP broker stream' },
            { type: 'del', oldNum: 89, newNum: '', code: '- broadcastStateChange({ type: "SYNC_LOCAL" });' },
            { type: 'del', oldNum: 90, newNum: '', code: '- updateMetricsCounter(clientMetrics);' },
            { type: 'del', oldNum: 91, newNum: '', code: '- return true;' },
            { type: 'add', oldNum: '', newNum: 89, code: '+ if (config.syncStatusWithOmp) {' },
            { type: 'add', oldNum: '', newNum: 90, code: '+   broadcastStateChange({ type: "SYNC_OMP_STATUS", payload: upstreamStatus });' },
            { type: 'add', oldNum: '', newNum: 91, code: '+ } else {' },
            { type: 'add', oldNum: '', newNum: 92, code: '+   broadcastStateChange({ type: "SYNC_LOCAL" });' },
            { type: 'add', oldNum: '', newNum: 93, code: '+ }' },
            { type: 'add', oldNum: '', newNum: 94, code: '+ updateMetricsCounter(clientMetrics);' },
            { type: 'add', oldNum: '', newNum: 95, code: '+ return true;' }
          ]
        },
        'quota-logic-smoke.mjs': {
          name: 'quota-logic-smoke.mjs',
          path: '/workspace/analytics-platform/src/quota-logic-smoke.mjs',
          add: 45,
          del: 1,
          reverted: false,
          lines: [
            { type: 'normal', oldNum: 1, newNum: 1, code: 'import assert from "node:assert";' },
            { type: 'del', oldNum: 2, newNum: '', code: '- console.log("Running smoke test...");' },
            { type: 'add', oldNum: '', newNum: 2, code: '+ import { verifyOmpGatewayConnection } from "./dashboard-live.js";' },
            { type: 'add', oldNum: '', newNum: 3, code: '+ describe("Quota logic smoke test", async () => {' },
            { type: 'add', oldNum: '', newNum: 4, code: '+   it("should match OMP upstream threshold accurately", async () => {' },
            { type: 'add', oldNum: '', newNum: 5, code: '+     const state = await verifyOmpGatewayConnection();' },
            { type: 'add', oldNum: '', newNum: 6, code: '+     assert.strictEqual(state.accounts, 6);' },
            { type: 'add', oldNum: '', newNum: 7, code: '+     assert.ok(state.availableQuota >= 0.98);' },
            { type: 'add', oldNum: '', newNum: 8, code: '+   });' },
            { type: 'add', oldNum: '', newNum: 9, code: '+ });' }
          ]
        },
        'package.json': {
          name: 'package.json',
          path: '/workspace/analytics-platform/src/package.json',
          add: 10,
          del: 0,
          reverted: false,
          lines: [
            { type: 'normal', oldNum: 18, newNum: 18, code: '  "scripts": {' },
            { type: 'normal', oldNum: 19, newNum: 19, code: '    "start": "node server.mjs",' },
            { type: 'add', oldNum: '', newNum: 20, code: '+   "test:smoke": "node quota-logic-smoke.mjs",' },
            { type: 'add', oldNum: '', newNum: 21, code: '+   "sync:omp": "node sync-omp-threshold.mjs"' },
            { type: 'normal', oldNum: 20, newNum: 22, code: '  },' }
          ]
        },
        'elementor-batch': {
          name: '.batch-optimizer.mjs',
          path: '/workspace/design-system/.batch-optimizer.mjs',
          add: 35,
          del: 35,
          reverted: false,
          lines: [
            { type: 'normal', oldNum: 10, newNum: 10, code: '  // Batch processing 23 Elementor pages' },
            { type: 'del', oldNum: 11, newNum: '', code: '- async function processPageOld(pageId) {' },
            { type: 'del', oldNum: 12, newNum: '', code: '-   return await legacyBatchSync(pageId);' },
            { type: 'del', oldNum: 13, newNum: '', code: '- }' },
            { type: 'add', oldNum: '', newNum: 11, code: '+ async function processBatchPage(pageId, index) {' },
            { type: 'add', oldNum: '', newNum: 12, code: '+   console.log(`[Batch 23] Processing page ${index + 1}/23: ${pageId}`);' },
            { type: 'add', oldNum: '', newNum: 13, code: '+   return await elementorModernSync(pageId);' },
            { type: 'add', oldNum: '', newNum: 14, code: '+ }' },
            { type: 'normal', oldNum: 14, newNum: 15, code: '  export { processBatchPage };' }
          ]
        }
      };

      let activeDiffFileKey = 'dashboard-live.js';
      let currentDiffScope = 'multi';

      function openCodeDiffReviewModal(type = 'multi', targetFileKey = null) {
        currentDiffScope = type;
        const modal = document.getElementById('codeDiffReviewModal');
        if (!modal) return;

        const titleEl = document.getElementById('diffModalTitle');
        const addStatEl = document.getElementById('diffModalAddStat');
        const delStatEl = document.getElementById('diffModalDelStat');
        const filesCountEl = document.getElementById('diffModalFilesCount');
        const tabsBar = document.getElementById('diffTabsBar');

        let fileKeys = [];
        if (type === 'single') {
          fileKeys = ['elementor-batch'];
          activeDiffFileKey = 'elementor-batch';
          if (titleEl) titleEl.textContent = 'Xem xét thay đổi: .batch-optimizer.mjs';
          if (addStatEl) addStatEl.textContent = '+35';
          if (delStatEl) delStatEl.textContent = '-35';
          if (filesCountEl) filesCountEl.textContent = '• 1 tệp đã chỉnh sửa';
        } else {
          fileKeys = ['dashboard-live.js', 'server.mjs', 'dashboard-live-work', 'quota-logic-smoke.mjs', 'package.json'];
          activeDiffFileKey = targetFileKey && fileKeys.includes(targetFileKey) ? targetFileKey : 'dashboard-live.js';
          if (titleEl) titleEl.textContent = 'Xem xét thay đổi mã nguồn';
          if (addStatEl) addStatEl.textContent = '+71';
          if (delStatEl) delStatEl.textContent = '-8';
          if (filesCountEl) filesCountEl.textContent = '• 5 tệp đã chỉnh sửa';
        }

        // Render file tabs
        if (tabsBar) {
          tabsBar.innerHTML = fileKeys.map(key => {
            const f = codeDiffFilesData[key];
            if (!f) return '';
            const isActive = key === activeDiffFileKey;
            const statusLabel = f.reverted ? ' (Đã hoàn tác)' : '';
            return `
              <button type="button" class="diff-tab-btn ${isActive ? 'active' : ''}" data-file-key="${key}" onclick="switchDiffTab('${key}')" role="tab" aria-selected="${isActive}">
                <span>${f.name}${statusLabel}</span>
                <span class="diff-stat-add">+${f.add}</span>
                <span class="diff-stat-del">-${f.del}</span>
              </button>
            `;
          }).join('');
        }

        renderDiffViewer(activeDiffFileKey);
        modal.classList.add('open');
      }
      window.openCodeDiffReviewModal = openCodeDiffReviewModal;

      function closeCodeDiffReviewModal() {
        const modal = document.getElementById('codeDiffReviewModal');
        if (modal) modal.classList.remove('open');
      }
      window.closeCodeDiffReviewModal = closeCodeDiffReviewModal;

      function switchDiffTab(fileKey) {
        if (!codeDiffFilesData[fileKey]) return;
        activeDiffFileKey = fileKey;
        document.querySelectorAll('.diff-tab-btn').forEach(btn => {
          const k = btn.getAttribute('data-file-key');
          btn.classList.toggle('active', k === fileKey);
          btn.setAttribute('aria-selected', k === fileKey ? 'true' : 'false');
        });
        renderDiffViewer(fileKey);
      }
      window.switchDiffTab = switchDiffTab;

      function renderDiffViewer(fileKey) {
        const file = codeDiffFilesData[fileKey];
        if (!file) return;

        const pathEl = document.getElementById('diffActiveFilePath');
        if (pathEl) {
          pathEl.textContent = file.path;
        }

        const container = document.getElementById('diffCodeContainer');
        if (!container) return;

        container.innerHTML = file.lines.map(line => {
          const typeClass = line.type === 'add' ? 'is-add' : line.type === 'del' ? 'is-del' : 'is-normal';
          const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
          const safeCode = typeof escapeHtml === 'function' ? escapeHtml(line.code) : line.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `
            <div class="diff-line ${typeClass}">
              <div class="diff-line-num">${line.oldNum || ''}</div>
              <div class="diff-line-num">${line.newNum || ''}</div>
              <div class="diff-line-marker">${marker}</div>
              <div class="diff-line-code">${safeCode}</div>
            </div>
          `;
        }).join('');
      }
      // ─── Floating Changed Files Status Pill Controller (from image-95) ───
      // Quy tắc: Chỉ khi nào edit file mới hiện, chỉ khi nào edit thì mới hiện!
      function showFileChangePill(fileCount = 4, addCount = 18, delCount = 8) {
        const bar = document.getElementById('fileChangeFloatingBar');
        if (!bar) return;
        const textEl = bar.querySelector('.file-change-pill-text');
        const addEl = bar.querySelector('.diff-stat-add');
        const delEl = bar.querySelector('.diff-stat-del');
        if (textEl) textEl.textContent = `${fileCount} tệp đã thay đổi`;
        if (addEl) addEl.textContent = `+${addCount}`;
        if (delEl) delEl.textContent = `-${delCount}`;
        bar.style.display = 'flex';
        bar.classList.add('is-visible');
      }
      window.showFileChangePill = showFileChangePill;

      function hideFileChangePill() {
        const bar = document.getElementById('fileChangeFloatingBar');
        if (!bar) return;
        bar.style.display = 'none';
        bar.classList.remove('is-visible');
      }
      window.hideFileChangePill = hideFileChangePill;

      function revertFileChanges(btn, fileDesc) {
        const desc = fileDesc || 'tệp';
        if (btn) {
          btn.style.opacity = '0.65';
          btn.innerHTML = `<span>Đã hoàn tác ✓</span>`;
          btn.disabled = true;
          const card = btn.closest('.file-change-card');
          if (card) {
            card.classList.add('is-reverted');
            const title = card.querySelector('.file-change-title');
            if (title && !title.textContent.includes('(Đã hoàn tác)')) {
              title.textContent += ' (Đã hoàn tác)';
            }
          }
        }
        hideFileChangePill();
        showToast(`Đã hoàn tác các thay đổi trên ${desc}`);
      }
      window.revertFileChanges = revertFileChanges;

      function revertCurrentDiffFile() {
        const file = codeDiffFilesData[activeDiffFileKey];
        if (!file) return;
        file.reverted = true;
        showToast(`Đã hoàn tác thay đổi trên: ${file.name}`);
        switchDiffTab(activeDiffFileKey);
        const allReverted = Object.values(codeDiffFilesData).every(f => f.reverted);
        if (allReverted) {
          hideFileChangePill();
        }
      }
      window.revertCurrentDiffFile = revertCurrentDiffFile;

      function applyDiffChanges() {
        showToast('Đã chấp thuận và áp dụng các thay đổi mã nguồn thành công');
        hideFileChangePill();
        closeCodeDiffReviewModal();
      }
      window.applyDiffChanges = applyDiffChanges;
      function toggleExtraFileRows(btn) {
        const extraRows = document.getElementById('extraFileRows');
        if (!extraRows) return;
        const isHidden = extraRows.style.display === 'none';
        if (isHidden) {
          extraRows.style.display = 'block';
          if (btn) {
            btn.classList.add('is-expanded');
            const txt = btn.querySelector('.expand-btn-text');
            if (txt) txt.textContent = 'Thu gọn';
          }
        } else {
          extraRows.style.display = 'none';
          if (btn) {
            btn.classList.remove('is-expanded');
            const txt = btn.querySelector('.expand-btn-text');
            if (txt) txt.textContent = 'Hiển thị thêm 2 tệp';
          }
        }
      }
      window.toggleExtraFileRows = toggleExtraFileRows;

      document.getElementById('codeDiffReviewModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'codeDiffReviewModal') closeCodeDiffReviewModal();
      });
      document.getElementById('btnCloseDiffReviewModal')?.addEventListener('click', closeCodeDiffReviewModal);
      document.getElementById('btnCloseDiffReviewModalFooter')?.addEventListener('click', closeCodeDiffReviewModal);
      document.getElementById('btnModalRevertFile')?.addEventListener('click', revertCurrentDiffFile);
      document.getElementById('btnModalApplyDiff')?.addEventListener('click', applyDiffChanges);

      // ─── Theme Switcher Logic & Keyboard Shortcut ───
      const themeLightBtn = document.getElementById('themeLightBtn');
      const themeDarkBtn = document.getElementById('themeDarkBtn');

      function applyTheme(theme, notify = false, persist = true) {
        document.documentElement.setAttribute('data-theme', theme);
        if (persist) {
          try { localStorage.setItem('neuratalk-theme', theme); } catch (e) {}
        }

        if (theme === 'dark') {
          themeDarkBtn.classList.add('active');
          themeDarkBtn.setAttribute('aria-checked', 'true');
          themeLightBtn.classList.remove('active');
          themeLightBtn.setAttribute('aria-checked', 'false');
          if (notify) showToast('Đã chuyển sang Chế độ Tối (Alt+T)');
        } else {
          themeLightBtn.classList.add('active');
          themeLightBtn.setAttribute('aria-checked', 'true');
          themeDarkBtn.classList.remove('active');
          themeDarkBtn.setAttribute('aria-checked', 'false');
          if (notify) showToast('Đã chuyển sang Chế độ Sáng (Alt+T)');
        }
      }

      function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark', true);
      }

      themeLightBtn.addEventListener('click', () => applyTheme('light', true));
      themeDarkBtn.addEventListener('click', () => applyTheme('dark', true));

      // ─── Top Bar Features & Bottom Console Panel (from image-6.png) ───
      const headerSessionPill = document.getElementById('headerSessionPill');
      const headerSessionTitle = document.getElementById('headerSessionTitle');
      const headerSessionEditBtn = document.getElementById('headerSessionEditBtn');
      const headerMoreBtn = document.getElementById('headerMoreBtn');
      const headerMoreMenu = document.getElementById('headerMoreMenu');
      const headerActionRename = document.getElementById('headerActionRename');
      const headerActionPin = document.getElementById('headerActionPin');
      const headerActionDelete = document.getElementById('headerActionDelete');
      const headerShareBtn = document.getElementById('headerShareBtn');
      const toggleBottomPanelBtn = document.getElementById('toggleBottomPanelBtn');
      const bottomPanel = document.getElementById('bottomPanel');
      const bottomPanelResizer = document.getElementById('bottomPanelResizer');
      const tabBtnTerminal = document.getElementById('tabBtnTerminal');
      const tabBtnLogs = document.getElementById('tabBtnLogs');
      const tabBtnOutput = document.getElementById('tabBtnOutput');
      const paneTerminal = document.getElementById('paneTerminal');
      const paneLogs = document.getElementById('paneLogs');
      const paneOutput = document.getElementById('paneOutput');
      const terminalInput = document.getElementById('terminalInput');
      const terminalHistory = document.getElementById('terminalHistory');
      const clearConsoleBtn = document.getElementById('clearConsoleBtn');
      const copyConsoleBtn = document.getElementById('copyConsoleBtn');
      const closeBottomPanelBtn = document.getElementById('closeBottomPanelBtn');
      const logsCountBadge = document.getElementById('logsCountBadge');

      function getActiveSessionItem() {
        return document.querySelector('.session-item.active') || document.querySelector('.session-item[data-session-id="s_2s_1"]') || document.querySelector('.session-item');
      }
      // Session conversation cache for seamless switching between sessions
      const sessionChatCache = {};
      let currentActiveSessionId = 's_2s_1';

      // Prototype transcript fixtures were removed from the live surface.
      // Production sessions are loaded exclusively from the OMP API.
      function setActiveSession(item, notify = true) {
        if (!item) return;
        const newSessionId = item.getAttribute('data-session-id') || 's_' + Date.now();

        // 1. Save current active session chat
        if (currentActiveSessionId && chatStream && currentActiveSessionId !== newSessionId) {
          const floatingBar = document.getElementById('fileChangeFloatingBar');
          sessionChatCache[currentActiveSessionId] = {
            html: chatStream.innerHTML,
            greetingDisplay: greetingSection ? greetingSection.style.display : 'none',
            fileChangePillVisible: floatingBar ? (floatingBar.style.display !== 'none' && floatingBar.classList.contains('is-visible')) : false,
          };
        }

        currentActiveSessionId = newSessionId;

        // 2. Set active class on session item
        document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        item.classList.remove('unread');

        // 3. Restore chat content for new session
        if (sessionChatCache[newSessionId]) {
          chatStream.innerHTML = sessionChatCache[newSessionId].html;
          if (greetingSection) {
            greetingSection.style.display = sessionChatCache[newSessionId].greetingDisplay || 'none';
          }
          if (sessionChatCache[newSessionId].fileChangePillVisible) {
            if (typeof showFileChangePill === 'function') showFileChangePill();
          } else {
            if (typeof hideFileChangePill === 'function') hideFileChangePill();
          }
        } else if (newSessionId !== 's_2s_1') {
          chatStream.innerHTML = '';
          if (greetingSection) {
            greetingSection.style.display = 'flex';
          }
          if (typeof hideFileChangePill === 'function') hideFileChangePill();
        } else {
          if (typeof hideFileChangePill === 'function') hideFileChangePill();
        }

        // Rebuild turn navigation ticks for this session!
        if (typeof buildTurnNavTicks === 'function') {
          setTimeout(buildTurnNavTicks, 30);
        }

        const chatScroll = document.getElementById('chatScrollArea');
        if (chatScroll) {
          setTimeout(() => { chatScroll.scrollTop = 0; }, 20);
        }

        const titleEl = item.querySelector('.session-title');
        const rawTitle = titleEl ? titleEl.textContent : '';
        const cleanTitle = rawTitle.replace(/^[✦⑂\s*]+/, '').trim() || 'Cuộc trò chuyện';
        const project = item.getAttribute('data-project') || '';
        const wsLabel = document.getElementById('promptCurrentWsLabel');
        if (wsLabel && project) {
          wsLabel.textContent = project;
        }
        if (headerSessionTitle) {
          headerSessionTitle.textContent = cleanTitle;
        }
        if (headerSessionPill) {
          headerSessionPill.title = project ? `Nhấp đúp hoặc bấm biểu tượng bút để đổi tên · Thư mục: ${project}` : 'Nhấp đúp hoặc bấm biểu tượng bút để đổi tên';
        }
        if (typeof updateWorkspaceSelectorVisibility === 'function') {
          updateWorkspaceSelectorVisibility();
        }
        if (notify) {
          showToast(`Chuyển sang: ${cleanTitle}`);
        }
      }
      // ─── Fixed Vertical Rail of Chat Area Frame (from image-54, 55) ───
      // Purely visual frame indicator; always fixed to the chat frame without drag or hover triggers

      // ─── Turn Ticks Navigator & Drag-to-Scrub Timeline (Menu cuộn phân đoạn lượt & kéo timeline) ───
      const chatTurnNav = document.getElementById('chatTurnNav');
      const turnNavTicks = document.getElementById('turnNavTicks');
      let turnNavTimer = null;
      let isScrubbingTurnNav = false;

      function scrollToTurn(idx, smooth = true) {
        if (!chatScrollArea) return;
        const userMsgs = chatScrollArea.querySelectorAll('.user-msg-wrap');
        if (!userMsgs[idx]) return;
        const msg = userMsgs[idx];
        const containerTop = chatScrollArea.getBoundingClientRect().top;
        const msgTop = msg.getBoundingClientRect().top;
        const targetScroll = chatScrollArea.scrollTop + (msgTop - containerTop) - 24;
        chatScrollArea.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: smooth ? 'smooth' : 'auto'
        });
        setActiveTurnTick(idx);
      }

      function setActiveTurnTick(activeIdx) {
        if (!turnNavTicks) return;
        const allTicks = turnNavTicks.querySelectorAll('.turn-tick');
        allTicks.forEach((tick, idx) => {
          if (idx === activeIdx) {
            tick.classList.add('active');
          } else {
            tick.classList.remove('active');
          }
        });
      }

      function updateTurnNav() {
        if (!chatScrollArea || !turnNavTicks || !chatTurnNav) return;
        const userMsgs = chatScrollArea.querySelectorAll('.user-msg-wrap');
        const turnCount = userMsgs.length;

        if (turnCount <= 1) {
          chatTurnNav.style.display = 'none';
          return;
        } else {
          chatTurnNav.style.display = 'flex';
        }

        // Re-render ticks when message count changes
        const currentTicks = turnNavTicks.querySelectorAll('.turn-tick');
        if (currentTicks.length !== turnCount) {
          turnNavTicks.innerHTML = '';
          userMsgs.forEach((msg, idx) => {
            const tick = document.createElement('div');
            tick.className = 'turn-tick';
            tick.setAttribute('data-turn-idx', idx);
            const textPreview = msg.querySelector('.user-msg-bubble')?.textContent?.trim().slice(0, 36) || `Lượt ${idx + 1}`;
            const timeEl = msg.querySelector('.user-msg-time');
            const timeText = timeEl ? timeEl.textContent.trim() : '';

            // Tooltip preview
            const tooltip = document.createElement('div');
            tooltip.className = 'turn-tick-tooltip';
            tooltip.setAttribute('role', 'tooltip');
            tooltip.innerHTML = `
              <span class="tick-tooltip-idx">#${idx + 1}</span>
              <span class="tick-tooltip-text">${escapeHtml(textPreview)}</span>
              ${timeText ? `<span class="tick-tooltip-time">(${timeText})</span>` : ''}
            `;
            tick.appendChild(tooltip);

            tick.addEventListener('click', (e) => {
              e.stopPropagation();
              scrollToTurn(idx, true);
            });

            turnNavTicks.appendChild(tick);
          });
        }

        // Calculate which turn is currently active based on scroll position (when not scrubbing)
        if (!isScrubbingTurnNav) {
          const containerTop = chatScrollArea.getBoundingClientRect().top;
          let activeIdx = 0;
          userMsgs.forEach((msg, idx) => {
            const rect = msg.getBoundingClientRect();
            if (rect.top - containerTop <= 240) {
              activeIdx = idx;
            }
          });
          setActiveTurnTick(activeIdx);
        }

        // Subtle highlight pulse when scrolling
        chatTurnNav.classList.add('is-scrolling');
        clearTimeout(turnNavTimer);
        turnNavTimer = setTimeout(() => {
          chatTurnNav.classList.remove('is-scrolling');
        }, 1200);
      }

      // Drag to scrub interaction
      function handleTurnScrub(e, smooth = false) {
        if (!turnNavTicks || !chatScrollArea) return;
        const userMsgs = chatScrollArea.querySelectorAll('.user-msg-wrap');
        const turnCount = userMsgs.length;
        if (turnCount <= 1) return;

        const rect = turnNavTicks.getBoundingClientRect();
        if (rect.height <= 0) return;
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        const ratio = y / rect.height;
        const targetIdx = Math.min(turnCount - 1, Math.floor(ratio * turnCount));

        scrollToTurn(targetIdx, smooth);

        // Highlight hover state on active target tick
        const allTicks = turnNavTicks.querySelectorAll('.turn-tick');
        allTicks.forEach((t, i) => {
          if (i === targetIdx) {
            t.classList.add('is-hovered');
          } else {
            t.classList.remove('is-hovered');
          }
        });
      }

      if (chatTurnNav) {
        chatTurnNav.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          isScrubbingTurnNav = true;
          chatTurnNav.classList.add('is-scrubbing');
          handleTurnScrub(e, true);
          if (typeof chatTurnNav.setPointerCapture === 'function') {
            try { chatTurnNav.setPointerCapture(e.pointerId); } catch(_) {}
          }
          e.preventDefault();
        });

        window.addEventListener('pointermove', (e) => {
          if (!isScrubbingTurnNav) return;
          handleTurnScrub(e, false);
        });

        const stopTurnScrubbing = (e) => {
          if (!isScrubbingTurnNav) return;
          isScrubbingTurnNav = false;
          chatTurnNav.classList.remove('is-scrubbing');
          if (turnNavTicks) {
            turnNavTicks.querySelectorAll('.turn-tick').forEach(t => t.classList.remove('is-hovered'));
          }
        };

        window.addEventListener('pointerup', stopTurnScrubbing);
        window.addEventListener('pointercancel', stopTurnScrubbing);
      }

      if (chatScrollArea) {
        chatScrollArea.addEventListener('scroll', updateTurnNav, { passive: true });
        // Initial populate
        updateTurnNav();
      }

      // Inline rename on top bar
      function startRenameHeaderSession() {
        if (!headerSessionTitle) return;
        if (headerSessionPill && headerSessionPill.querySelector('.header-session-rename-input')) return;
        const currentTitle = headerSessionTitle.textContent.trim();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'header-session-rename-input';
        input.value = currentTitle;
        headerSessionTitle.style.display = 'none';
        headerSessionTitle.parentNode.insertBefore(input, headerSessionTitle.nextSibling);
        input.focus();
        input.select();

        let finished = false;
        function finishRename(save) {
          if (finished) return;
          finished = true;
          const newTitle = input.value.trim();
          if (save && newTitle && newTitle !== currentTitle) {
            headerSessionTitle.textContent = newTitle;
            const activeItem = getActiveSessionItem();
            if (activeItem) {
              const itemTitleEl = activeItem.querySelector('.session-title');
              if (itemTitleEl) {
                itemTitleEl.textContent = (activeItem.classList.contains('active') ? '✦ ' : '') + newTitle;
              }
            }
            showToast(`Đã đổi tên thành: "${newTitle}"`);
          }
          headerSessionTitle.style.display = '';
          input.remove();
        }

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') finishRename(true);
          else if (e.key === 'Escape') finishRename(false);
        });
        input.addEventListener('blur', () => finishRename(true));
      }

      if (headerSessionEditBtn) {
        headerSessionEditBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          startRenameHeaderSession();
        });
      }
      if (headerSessionPill) {
        headerSessionPill.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startRenameHeaderSession();
        });
      }

      // More Actions (···)
      if (headerMoreBtn && headerMoreMenu) {
        headerMoreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          headerMoreMenu.classList.toggle('open');
        });
      }

      if (headerActionRename) {
        headerActionRename.addEventListener('click', () => {
          if (headerMoreMenu) headerMoreMenu.classList.remove('open');
          startRenameHeaderSession();
        });
      }

      if (headerActionPin) {
        headerActionPin.addEventListener('click', () => {
          if (headerMoreMenu) headerMoreMenu.classList.remove('open');
          const item = getActiveSessionItem();
          if (item) togglePinSession(item);
        });
      }

      if (headerActionDelete) {
        headerActionDelete.addEventListener('click', () => {
          if (headerMoreMenu) headerMoreMenu.classList.remove('open');
          const item = getActiveSessionItem();
          if (item) openDeleteModalForSession(item);
        });
      }

      // Share button from image-6.png
      if (headerShareBtn) {
        headerShareBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const item = getActiveSessionItem();
          if (item) openShareModalForSession(item);
        });
      }


      // Bottom Console Panel Toggle & Interactions from image-6.png
      function toggleBottomPanel(forceState) {
        if (!bottomPanel) return;
        const mainApp = document.querySelector('.app-main');
        const isOpen = forceState !== undefined ? forceState : !bottomPanel.classList.contains('open');
        if (isOpen) {
          bottomPanel.classList.add('open');
          if (toggleBottomPanelBtn) toggleBottomPanelBtn.classList.add('active');
          if (mainApp) mainApp.classList.add('has-bottom-panel');
          if (terminalInput) terminalInput.focus();
          if (chatFrameRail && chatFrameRailBar) {
            chatFrameRail.classList.remove('is-hovered');
            chatFrameRailBar.classList.remove('is-visible');
            if (chatScrollArea && chatScrollArea.style.cursor === 'col-resize') chatScrollArea.style.cursor = '';
          }
        } else {
          bottomPanel.classList.remove('open');
          if (toggleBottomPanelBtn) toggleBottomPanelBtn.classList.remove('active');
          if (mainApp) mainApp.classList.remove('has-bottom-panel');
        }
      }

      if (toggleBottomPanelBtn) {
        toggleBottomPanelBtn.addEventListener('click', () => {
          toggleBottomPanel();
        });
      }
      if (closeBottomPanelBtn) {
        closeBottomPanelBtn.addEventListener('click', () => {
          toggleBottomPanel(false);
        });
      }

      // Bottom panel tabs
      const bottomTabBtns = [tabBtnTerminal, tabBtnLogs, tabBtnOutput];
      const bottomPanes = { terminal: paneTerminal, logs: paneLogs, output: paneOutput };
      bottomTabBtns.forEach(btn => {
        if (!btn) return;
        btn.addEventListener('click', () => {
          const tabKey = btn.getAttribute('data-tab');
          bottomTabBtns.forEach(b => b && b.classList.remove('active'));
          btn.classList.add('active');
          Object.keys(bottomPanes).forEach(k => {
            if (bottomPanes[k]) bottomPanes[k].style.display = k === tabKey ? 'flex' : 'none';
          });
          if (tabKey === 'terminal' && terminalInput) terminalInput.focus();
        });
      });

      // Clear console
      if (clearConsoleBtn) {
        clearConsoleBtn.addEventListener('click', () => {
          const activeTab = document.querySelector('.bottom-tab-btn.active')?.getAttribute('data-tab');
          if (activeTab === 'terminal' && terminalHistory) {
            terminalHistory.innerHTML = '<div class="terminal-line muted">Hòn π AI Sandbox Environment v1.0.0 (Màn hình đã được xóa).</div>';
          } else if (activeTab === 'logs') {
            const logsStream = document.getElementById('logsStream');
            if (logsStream) logsStream.innerHTML = '<div class="log-entry info"><span class="log-time">' + new Date().toTimeString().split(' ')[0] + '</span><span class="log-badge info">INFO</span><span class="log-msg">Nhật ký đã được xóa sạch.</span></div>';
            if (logsCountBadge) logsCountBadge.textContent = '0';
          } else if (activeTab === 'output') {
            const outputViewer = document.getElementById('outputViewer');
            if (outputViewer) outputViewer.innerHTML = '<pre class="output-pre"><code>// Đầu ra trống</code></pre>';
          }
          showToast('Đã xóa màn hình console');
        });
      }

      // Copy console
      if (copyConsoleBtn) {
        copyConsoleBtn.addEventListener('click', () => {
          const activeTab = document.querySelector('.bottom-tab-btn.active')?.getAttribute('data-tab');
          let text = '';
          if (activeTab === 'terminal' && terminalHistory) text = terminalHistory.innerText;
          else if (activeTab === 'logs') text = document.getElementById('logsStream')?.innerText || '';
          else if (activeTab === 'output') text = document.getElementById('outputViewer')?.innerText || '';
          try {
            navigator.clipboard.writeText(text);
            showToast('Đã sao chép nội dung console vào bộ nhớ tạm');
          } catch (e) {
            showToast('Không thể sao chép');
          }
        });
      }

      // Terminal input commands
      if (terminalInput && terminalHistory) {
        terminalInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const cmd = terminalInput.value.trim();
            if (!cmd) return;
            const linePrompt = document.createElement('div');
            linePrompt.className = 'terminal-line prompt-line';
            linePrompt.innerHTML = `<span class="terminal-prompt">hon-pi@sandbox:~/2-side $</span><span class="terminal-cmd">${cmd}</span>`;
            terminalHistory.appendChild(linePrompt);

            const outLine = document.createElement('div');
            outLine.className = 'terminal-line';

            if (cmd === 'clear') {
              terminalHistory.innerHTML = '';
            } else if (cmd === 'help') {
              outLine.innerHTML = `<span class="muted">Các lệnh mẫu hỗ trợ:</span><br/>` +
                `• <b>help</b>: Danh sách câu lệnh<br/>` +
                `• <b>clear</b>: Xóa màn hình terminal<br/>` +
                `• <b>ls</b>: Liệt kê tệp tin trong thư mục dự án<br/>` +
                `• <b>status</b>: Xem trạng thái hệ thống sandbox<br/>` +
                `• <b>date</b>: Xem thời gian máy chủ<br/>` +
                `• <b>python [mã]</b>: Chạy mã Python thử nghiệm`;
              terminalHistory.appendChild(outLine);
            } else if (cmd === 'ls') {
              outLine.innerHTML = `<span class="success">contact-page.html  main.py  config.json  assets/  tests/</span>`;
              terminalHistory.appendChild(outLine);
            } else if (cmd === 'status') {
              outLine.innerHTML = `<span class="success">Hệ thống Sandbox: TRỰC TUYẾN · Node: v20.12 · Python: 3.11 · Bộ nhớ: 42.6 MB</span>`;
              terminalHistory.appendChild(outLine);
            } else if (cmd === 'date') {
              outLine.textContent = new Date().toString();
              terminalHistory.appendChild(outLine);
            } else if (cmd.startsWith('python')) {
              outLine.innerHTML = `<span class="success">[Python 3.11 Output]: Thực thi thành công trong 18ms.</span>`;
              terminalHistory.appendChild(outLine);
            } else {
              outLine.innerHTML = `<span class="muted">[Đã ghi nhận lệnh]: "${cmd}". Đang chuyển tiếp xử lý qua Agent Worker...</span>`;
              terminalHistory.appendChild(outLine);
            }

            terminalHistory.scrollTop = terminalHistory.scrollHeight;
            terminalInput.value = '';
          }
        });
      }

      // Resizable Bottom Panel
      if (bottomPanelResizer && bottomPanel) {
        let isResizingBottom = false;
        let startY = 0;
        let startH = 240;

        bottomPanelResizer.addEventListener('mousedown', (e) => {
          isResizingBottom = true;
          startY = e.clientY;
          startH = bottomPanel.offsetHeight;
          bottomPanelResizer.classList.add('is-resizing');
          document.body.style.cursor = 'row-resize';
          document.body.style.userSelect = 'none';
          e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
          if (!isResizingBottom) return;
          const deltaY = startY - e.clientY;
          const newH = Math.min(Math.max(startH + deltaY, 140), 520);
          bottomPanel.style.height = `${newH}px`;
          document.querySelector('.app-main')?.style.setProperty('--bottom-panel-h', `${newH}px`);
          if (chatFrameRailBar && chatFrameRailBar.classList.contains('is-visible') && typeof updateRailBarPosition === 'function') {
            updateRailBarPosition(e.clientY);
          }
        });

        window.addEventListener('mouseup', () => {
          if (isResizingBottom) {
            isResizingBottom = false;
            bottomPanelResizer.classList.remove('is-resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
          }
        });
      }
      // ─── Chat Body Width Horizontal Drag & Resize (Dynamic Full-Height Edge Activation - from image-55, 59 & drawing) ───
      const chatFrameRail = document.getElementById('chatFrameRail');
      const chatFrameRailBar = document.querySelector('.chat-frame-rail-bar');
      const mainChatContainer = document.querySelector('.chat-container');
      const DEFAULT_BODY_W = 820;
      const MIN_BODY_W = 600;
      const MAX_BODY_W = 1800;
      const railWidthTooltip = document.getElementById('railWidthTooltip');
      const railHitWidth = chatFrameRailBar ? parseFloat(getComputedStyle(chatFrameRailBar).width) : 0;
      const getMaxAllowedBodyWidth = () => {
        const availableAreaW = (chatScrollArea ? chatScrollArea.clientWidth : window.innerWidth) - 40;
        return Math.max(MIN_BODY_W, Math.min(MAX_BODY_W, Math.floor(availableAreaW)));
      };
      const canResizeBody = () => getMaxAllowedBodyWidth() > MIN_BODY_W;
      const getRailLeft = (containerRect) => Math.max(
        Math.round(containerRect.left - 24),
        Math.round((chatScrollArea ? chatScrollArea.getBoundingClientRect().left : 0) + 8)
      );

      // Restore saved chat body width if present
      try {
        const savedBodyW = parseInt(localStorage.getItem('neuratalk-body-width'), 10);
        if (savedBodyW && savedBodyW >= MIN_BODY_W) {
          const maxAllowed = getMaxAllowedBodyWidth();
          const clamped = Math.max(MIN_BODY_W, Math.min(maxAllowed, savedBodyW));
          document.documentElement.style.setProperty('--chat-body-max-width', clamped + 'px');
        }
      } catch (e) {}

      if (chatFrameRail && mainChatContainer) {
        let isResizingBody = false;
        let centerX = 0;
        const hideRail = () => {
          chatFrameRail.classList.remove('is-hovered');
          if (chatFrameRailBar) chatFrameRailBar.classList.remove('is-visible');
          if (chatScrollArea && chatScrollArea.style.cursor === 'col-resize') chatScrollArea.style.cursor = '';
        };

        // Override the legacy 920px hide only when the chat body has real resize room.
        const syncRailVisibility = () => {
          const display = canResizeBody() ? 'block' : 'none';
          if (chatFrameRail.style.getPropertyValue('display') !== display || chatFrameRail.style.getPropertyPriority('display') !== 'important') {
            chatFrameRail.style.setProperty('display', display, 'important');
          }
          if (chatFrameRailBar && (chatFrameRailBar.style.getPropertyValue('display') !== display || chatFrameRailBar.style.getPropertyPriority('display') !== 'important')) {
            chatFrameRailBar.style.setProperty('display', display, 'important');
          }
          if (display === 'none') hideRail();
        };
        syncRailVisibility();

        const updateRailBarPosition = (clientY) => {
          if (!mainChatContainer || !chatFrameRailBar) return;
          if (!canResizeBody()) {
            syncRailVisibility();
            return;
          }
          const containerRect = mainChatContainer.getBoundingClientRect();
          const headerEl = document.querySelector('.main-header');
          const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 64;

          const barH = 84;
          const minY = headerBottom + 8;
          // STRICT BOUNDARY: The chat frame rail MUST NEVER enter or overlap the bottom console panel (Terminal & Execution Logs)
          let bottomLimit = window.innerHeight - 8;
          if (bottomPanel && bottomPanel.classList.contains('open')) {
            const bpRect = bottomPanel.getBoundingClientRect();
            bottomLimit = Math.min(bottomLimit, bpRect.top - 12);
          }

          const maxY = bottomLimit - barH;
          if (minY > maxY) {
            chatFrameRail.classList.remove('is-hovered');
            chatFrameRailBar.classList.remove('is-visible');
            return;
          }

          const currentY = (clientY !== undefined && clientY !== null) ? clientY : (headerBottom + (bottomLimit - headerBottom) / 2);
          const clampedY = Math.max(minY, Math.min(maxY, currentY - barH / 2));
          const targetX = getRailLeft(containerRect);
          if (railWidthTooltip) {
            const tooltipOnRight = targetX < 128;
            const tooltipLeft = tooltipOnRight ? 'calc(100% + 12px)' : 'auto';
            const tooltipRight = tooltipOnRight ? 'auto' : 'calc(100% + 12px)';
            if (railWidthTooltip.style.left !== tooltipLeft) railWidthTooltip.style.left = tooltipLeft;
            if (railWidthTooltip.style.right !== tooltipRight) railWidthTooltip.style.right = tooltipRight;
          }

          chatFrameRail.style.setProperty('--rail-bar-x', targetX + 'px');
          chatFrameRail.style.setProperty('--rail-bar-y', clampedY + 'px');
          chatFrameRailBar.style.left = targetX + 'px';
          chatFrameRailBar.style.top = clampedY + 'px';
        };

        const onMoveBody = (e) => {
          if (!isResizingBody) return;
          const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : null);
          const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : null);
          if (clientX === null) return;
          const targetW = Math.round(2 * (centerX - clientX));
          const maxAllowed = getMaxAllowedBodyWidth();
          const clampedW = Math.max(MIN_BODY_W, Math.min(maxAllowed, targetW));
          document.documentElement.style.setProperty('--chat-body-max-width', clampedW + 'px');
          updateRailBarPosition(clientY);

          if (railWidthTooltip) {
            const isMax = clampedW >= maxAllowed;
            const isMin = clampedW <= MIN_BODY_W;
            railWidthTooltip.textContent = isMax ? `${clampedW}px (Tối đa)` : (isMin ? `${clampedW}px (Tối thiểu)` : `${clampedW}px`);
          }
        };

        const onUpBody = (e) => {
          if (!isResizingBody) return;
          isResizingBody = false;
          chatFrameRail.classList.remove('is-resizing');
          chatFrameRailBar.classList.remove('is-resizing');
          document.body.classList.remove('is-resizing-chat-body');

          window.removeEventListener('pointermove', onMoveBody);
          window.removeEventListener('pointerup', onUpBody);
          window.removeEventListener('mousemove', onMoveBody);
          window.removeEventListener('mouseup', onUpBody);

          if (e && e.pointerId && chatFrameRail.releasePointerCapture) {
            try {
              chatFrameRail.releasePointerCapture(e.pointerId);
            } catch (err) {}
          }

          const currentW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-body-max-width'), 10);
          if (currentW && currentW >= MIN_BODY_W) {
            try {
              localStorage.setItem('neuratalk-body-width', currentW);
            } catch (err) {}
          }

          if (e && e.clientX !== undefined) {
            checkEdgeHover(e.clientX, e.clientY);
          } else {
            chatFrameRail.classList.remove('is-hovered');
            chatFrameRailBar.classList.remove('is-visible');
          }
        };

        const onStartBody = (e) => {
          if (e.button !== undefined && e.button !== 0) return;
          isResizingBody = true;

          const rect = mainChatContainer.getBoundingClientRect();
          centerX = rect.left + rect.width / 2;

          chatFrameRail.classList.add('is-resizing');
          chatFrameRailBar.classList.add('is-resizing');
          document.body.classList.add('is-resizing-chat-body');
          updateRailBarPosition(e.clientY);

          const currentW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-body-max-width'), 10) || DEFAULT_BODY_W;
          if (railWidthTooltip) {
            const maxAllowed = getMaxAllowedBodyWidth();
            const isMax = currentW >= maxAllowed;
            const isMin = currentW <= MIN_BODY_W;
            railWidthTooltip.textContent = isMax ? `${currentW}px (Tối đa)` : (isMin ? `${currentW}px (Tối thiểu)` : `${currentW}px`);
          }

          if (e.pointerId && chatFrameRail.setPointerCapture) {
            try {
              chatFrameRail.setPointerCapture(e.pointerId);
            } catch (err) {}
          }

          window.addEventListener('pointermove', onMoveBody);
          window.addEventListener('pointerup', onUpBody);
          window.addEventListener('mousemove', onMoveBody);
          window.addEventListener('mouseup', onUpBody);
          e.preventDefault();
        };

        // Dynamic full-height edge zone checking (activates along full height of body edge from top to bottom - image-54, 55, 59 & drawing)
        const isPointerInEdgeZone = (clientX, clientY) => {
          if (isResizingBody || !mainChatContainer) return false;
          if (!canResizeBody()) {
            syncRailVisibility();
            return false;
          }

          // CRITICAL: If cursor is inside or hovering the bottom console panel (Terminal & Execution Logs), NEVER activate rail!
          if (bottomPanel && bottomPanel.classList.contains('open')) {
            const bpRect = bottomPanel.getBoundingClientRect();
            if (clientY >= bpRect.top - 6) return false;
          }

          const targetEl = document.elementFromPoint(clientX, clientY);
          if (targetEl && targetEl.closest('#bottomPanel, .bottom-panel, .bottom-panel-resizer, .bottom-panel-header, .bottom-panel-body, #terminalInput, #terminalHistory')) {
            return false;
          }

          const containerRect = mainChatContainer.getBoundingClientRect();
          const headerEl = document.querySelector('.main-header');
          const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 64;

          // Keep the full-height hover zone, but only across the visible handle's width.
          const railLeft = getRailLeft(containerRect);
          const inX = clientX >= railLeft && clientX < railLeft + railHitWidth;

          // Vertical range: from header bottom down to the top of bottom panel (if open) or window bottom
          let maxBottomY = window.innerHeight - 2;
          if (bottomPanel && bottomPanel.classList.contains('open')) {
            const bpRect = bottomPanel.getBoundingClientRect();
            maxBottomY = Math.min(maxBottomY, bpRect.top - 10);
          }

          const inY = clientY >= (headerBottom + 2) && clientY <= maxBottomY;
          return inX && inY;
        };

        const checkEdgeHover = (clientX, clientY) => {
          if (isResizingBody || !mainChatContainer) return;
          syncRailVisibility();
          if (!canResizeBody()) return;

          // If bottom panel is open and mouse is anywhere inside or near bottom panel, immediately hide rail
          if (bottomPanel && bottomPanel.classList.contains('open')) {
            const bpRect = bottomPanel.getBoundingClientRect();
            if (clientY >= bpRect.top - 6) {
              chatFrameRail.classList.remove('is-hovered');
              chatFrameRailBar.classList.remove('is-visible');
              if (chatScrollArea && chatScrollArea.style.cursor === 'col-resize') {
                chatScrollArea.style.cursor = '';
              }
              return;
            }
          }

          if (isPointerInEdgeZone(clientX, clientY)) {
            updateRailBarPosition(clientY);
            chatFrameRail.classList.add('is-hovered');
            chatFrameRailBar.classList.add('is-visible');
            const targetEl = document.elementFromPoint(clientX, clientY);
            const isClickable = targetEl && targetEl.closest('button, a, input, select, textarea, [role="button"], .tool-icon-btn, .msg-act-btn, #bottomPanel, .bottom-panel');
            if (chatScrollArea && !isClickable) {
              chatScrollArea.style.cursor = 'col-resize';
            } else if (chatScrollArea) {
              chatScrollArea.style.cursor = '';
            }
          } else {
            chatFrameRail.classList.remove('is-hovered');
            chatFrameRailBar.classList.remove('is-visible');
            if (chatScrollArea && chatScrollArea.style.cursor === 'col-resize') {
              chatScrollArea.style.cursor = '';
            }
          }
        };

        if (bottomPanel) {
          const hideRailOnBottomPanel = () => {
            if (!isResizingBody && chatFrameRail && chatFrameRailBar) {
              chatFrameRail.classList.remove('is-hovered');
              chatFrameRailBar.classList.remove('is-visible');
              if (chatScrollArea && chatScrollArea.style.cursor === 'col-resize') {
                chatScrollArea.style.cursor = '';
              }
            }
          };
          bottomPanel.addEventListener('mouseenter', hideRailOnBottomPanel);
          bottomPanel.addEventListener('mousemove', hideRailOnBottomPanel);
        }

        const appMainEl = document.querySelector('.app-main');
        const edgeEventTarget = appMainEl || window;

        edgeEventTarget.addEventListener('mousemove', (e) => {
          checkEdgeHover(e.clientX, e.clientY);
        }, { passive: true });

        edgeEventTarget.addEventListener('mouseleave', () => {
          if (!isResizingBody) {
            chatFrameRail.classList.remove('is-hovered');
            chatFrameRailBar.classList.remove('is-visible');
            if (chatScrollArea) chatScrollArea.style.cursor = '';
          }
        });
        window.addEventListener('resize', () => {
          if (isResizingBody && !canResizeBody()) onUpBody();
          hideRail();
          syncRailVisibility();
        });

        edgeEventTarget.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || isResizingBody) return;
          if (e.target && e.target.closest('button, a, input, select, textarea, [role="button"], .tool-icon-btn, .msg-act-btn')) return;
          if (isPointerInEdgeZone(e.clientX, e.clientY)) {
            onStartBody(e);
          }
        });

        edgeEventTarget.addEventListener('dblclick', (e) => {
          if (e.target && e.target.closest('button, a, input, select, textarea, [role="button"], .tool-icon-btn, .msg-act-btn')) return;
          if (isPointerInEdgeZone(e.clientX, e.clientY)) {
            e.stopPropagation();
            document.documentElement.style.setProperty('--chat-body-max-width', DEFAULT_BODY_W + 'px');
            try {
              localStorage.removeItem('neuratalk-body-width');
            } catch (err) {}
            updateRailBarPosition(e.clientY);
            if (typeof showToast === 'function') {
              showToast('Đã khôi phục độ rộng khung chat: ' + DEFAULT_BODY_W + 'px');
            }
          }
        });
      }

      document.addEventListener('click', (e) => {
        if (headerMoreMenu && !e.target.closest('.header-dropdown-wrap')) {
          headerMoreMenu.classList.remove('open');
        }
        if (sessionsFilterMenu && !e.target.closest('#sessionsFilterWrap')) {
          closeSessionsFilterMenu();
        }
      });

      // ─── Quota OMP Global Status Bar Logic (from image-7.png) ───
      const quotaOmpBar = document.getElementById('quotaOmpBar');
      const quotaCountdownText = document.getElementById('quotaCountdownText');
      const quotaRefreshBtn = document.getElementById('quotaRefreshBtn');
      const openQuotaDashboardBtn = document.getElementById('openQuotaDashboardBtn');
      const quotaDashboardModal = document.getElementById('quotaDashboardModal');
      const closeQuotaModalTopBtn = document.getElementById('closeQuotaModalTopBtn');
      const closeQuotaModalBottomBtn = document.getElementById('closeQuotaModalBottomBtn');
      const forceSyncAllOmpBtn = document.getElementById('forceSyncAllOmpBtn');
      const headerActionToggleQuota = document.getElementById('headerActionToggleQuota');
      const quotaSyncDot = document.querySelector('.quota-sync-dot');

      let quotaCountdown = 24;
      let quotaTimer = null;

      const modalQuotaCountdownText = document.getElementById('modalQuotaCountdownText');
      const modalLastSyncTime = document.getElementById('modalLastSyncTime');

      function startQuotaCountdown() {
        if (quotaTimer) clearInterval(quotaTimer);
        quotaTimer = setInterval(() => {
          quotaCountdown--;
          if (quotaCountdown <= 0) {
            quotaCountdown = 30;
            if (quotaSyncDot) {
              quotaSyncDot.style.animation = 'none';
              void quotaSyncDot.offsetWidth;
              quotaSyncDot.style.animation = 'syncPulse 0.5s ease-in-out 3';
            }
          }
          if (quotaCountdownText) {
            quotaCountdownText.textContent = `${quotaCountdown}s`;
          }
          if (modalQuotaCountdownText) {
            modalQuotaCountdownText.textContent = `${quotaCountdown}s`;
          }
        }, 1000);
      }
      startQuotaCountdown();

      function refreshQuota(manual = true) {
        if (quotaRefreshBtn) {
          quotaRefreshBtn.classList.add('spinning');
          setTimeout(() => {
            quotaRefreshBtn.classList.remove('spinning');
          }, 800);
        }
        quotaCountdown = 30;
        if (quotaCountdownText) quotaCountdownText.textContent = '30s';
        if (modalQuotaCountdownText) modalQuotaCountdownText.textContent = '30s';
        const now = new Date();
        const timeStr = String(now.getHours()).padStart(2, '0') + ':' +
                        String(now.getMinutes()).padStart(2, '0') + ':' +
                        String(now.getSeconds()).padStart(2, '0');
        if (modalLastSyncTime) modalLastSyncTime.textContent = timeStr;
        if (manual) {
          showToast('Đã làm mới dữ liệu Quota OMP (5 tài khoản liên kết, Reset sớm nhất sau 28p)');
        }
      }

      if (quotaRefreshBtn) {
        quotaRefreshBtn.addEventListener('click', () => refreshQuota(true));
      }

      if (openQuotaDashboardBtn && quotaDashboardModal) {
        openQuotaDashboardBtn.addEventListener('click', () => {
          quotaDashboardModal.classList.add('open');
        });
      }

      function closeQuotaModal() {
        if (quotaDashboardModal) quotaDashboardModal.classList.remove('open');
      }

      if (closeQuotaModalTopBtn) closeQuotaModalTopBtn.addEventListener('click', closeQuotaModal);
      if (closeQuotaModalBottomBtn) closeQuotaModalBottomBtn.addEventListener('click', closeQuotaModal);
      if (quotaDashboardModal) {
        quotaDashboardModal.addEventListener('click', (e) => {
          if (e.target === quotaDashboardModal) closeQuotaModal();
        });
      }

      if (forceSyncAllOmpBtn) {
        forceSyncAllOmpBtn.addEventListener('click', () => {
          forceSyncAllOmpBtn.disabled = true;
          forceSyncAllOmpBtn.innerHTML = `<span>Đang đồng bộ...</span>`;
          setTimeout(() => {
            forceSyncAllOmpBtn.disabled = false;
            forceSyncAllOmpBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg><span>Đồng bộ lại dữ liệu</span>`;
            refreshQuota(false);
            showToast('Đã đồng bộ lại dữ liệu 5 tài khoản OMP thành công!');
          }, 900);
        });
      }

      function toggleQuotaBar() {
        const quotaWidget = document.getElementById('headerQuotaWidget');
        if (!quotaWidget) return;
        const isHidden = quotaWidget.style.display === 'none';
        quotaWidget.style.display = isHidden ? 'inline-flex' : 'none';
        showToast(isHidden ? 'Đã hiển thị widget Hạn mức OMP' : 'Đã ẩn widget Hạn mức OMP (⌥⌘Q để bật lại)');
      }

      const headerActionSelectModel = document.getElementById('headerActionSelectModel');
      if (headerActionSelectModel) {
        headerActionSelectModel.addEventListener('click', () => {
          if (headerMoreMenu) headerMoreMenu.classList.remove('open');
          if (promptModelIconBtn) {
            promptModelIconBtn.click();
          } else if (typeof openSettingsModal === 'function') {
            openSettingsModal('models');
          }
        });
      }
      const headerActionCheckQuota = document.getElementById('headerActionCheckQuota');
      if (headerActionCheckQuota && quotaDashboardModal) {
        headerActionCheckQuota.addEventListener('click', () => {
          if (headerMoreMenu) headerMoreMenu.classList.remove('open');
          quotaDashboardModal.classList.add('open');
        });
      }

      // ─── Active Account Management & Switcher Controller in Chat UI ───
      const CHAT_OMP_ACCOUNTS = {
        'acc-2': { id: 'acc-2', email: 'gemini-prod-core@company.ai', shortName: 'gemini-prod', provider: 'Gemini Advanced', isExhausted: false, resetStr: '0g 28p', colorKey: 'cyan', colorName: 'Cyan', initials: 'GP' },
        'acc-4': { id: 'acc-4', email: 'gemini-flash-runner@enterprise.vn', shortName: 'gemini-flash', provider: 'Google Gemini', isExhausted: true, resetStr: '0g 42p', colorKey: 'orange', colorName: 'Cam', initials: 'GF' },
        'acc-1': { id: 'acc-1', email: 'workspace-dev-alpha@example.com', shortName: 'dev-alpha', provider: 'Claude / GPT Shared', isExhausted: false, resetStr: '1g 14p', colorKey: 'emerald', colorName: 'Ngọc lục', initials: 'WA' },
        'acc-3': { id: 'acc-3', email: 'research-anthropic-team@corp.io', shortName: 'anthropic-team', provider: 'Claude / GPT Shared', isExhausted: false, resetStr: '3g 45p', colorKey: 'purple', colorName: 'Tím', initials: 'RA' },
        'acc-5': { id: 'acc-5', email: 'ops-multi-backup@devops.net', shortName: 'multi-backup', provider: 'Claude / GPT Shared', isExhausted: false, resetStr: '4g 10p', colorKey: 'pink', colorName: 'Hồng', initials: 'OM' }
      };

      function getChatAccountColorMeta(idOrEmail) {
        if (!idOrEmail) return { colorKey: 'cyan', initials: 'OM', name: 'Cyan' };
        const raw = String(idOrEmail).trim().toLowerCase();
        if (CHAT_OMP_ACCOUNTS[raw]) return CHAT_OMP_ACCOUNTS[raw];
        for (const [key, val] of Object.entries(CHAT_OMP_ACCOUNTS)) {
          if (raw.includes(key) || key.includes(raw) || (val.email && raw.includes(val.email))) return val;
        }
        return { colorKey: 'cyan', initials: 'OM', name: 'Cyan' };
      }

      function getChatActiveAccountState() {
        const saved = localStorage.getItem('honpi_active_omp_account');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.id && CHAT_OMP_ACCOUNTS[parsed.id]) {
              return parsed;
            }
          } catch (e) {}
        }
        return {
          id: 'acc-2',
          email: 'gemini-prod-core@company.ai',
          provider: 'Gemini Advanced',
          startTime: Date.now() - (105 * 60 * 1000)
        };
      }

      function saveChatActiveAccountState(state) {
        try {
          localStorage.setItem('honpi_active_omp_account', JSON.stringify(state));
        } catch (e) {}
      }

      function getChatFormattedDuration(startTime) {
        const diffMs = Math.max(0, Date.now() - startTime);
        const totalMins = Math.floor(diffMs / 60000);
        const days = Math.floor(totalMins / 1440);
        const hours = Math.floor((totalMins % 1440) / 60);
        const mins = totalMins % 60;
        if (days > 0) return `${days}n ${hours}g`;
        if (hours > 0) return `${hours}g ${mins}p`;
        return `${mins}p`;
      }

      function switchChatOmpAccount(targetId) {
        const target = CHAT_OMP_ACCOUNTS[targetId];
        if (!target) return;

        const current = getChatActiveAccountState();
        if (current.id === targetId) {
          showToast(`Tài khoản ${target.email} hiện đang được sử dụng rồi.`);
          return;
        }

        if (target.isExhausted) {
          showToast(`⚠️ Chú ý: ${target.email} đã hết 100% quota (reset sau ${target.resetStr}). Đã chuyển sang dùng dự phòng.`);
        } else {
          showToast(`✓ Đã chuyển sang tài khoản ${target.email}. Sẵn sàng cho hội thoại.`);
        }
        const newState = {
          id: targetId,
          email: target.email,
          provider: target.provider,
          startTime: Date.now()
        };
        saveChatActiveAccountState(newState);
        updateChatActiveAccountUI();
      }
      const isProductionChatRoute = /^\/chat\/?$/.test(window.location.pathname);
      if (!isProductionChatRoute) window.switchChatOmpAccount = switchChatOmpAccount;

      function updateChatActiveAccountUI() {
        const active = getChatActiveAccountState();
        const durationStr = getChatFormattedDuration(active.startTime);
        const targetMeta = CHAT_OMP_ACCOUNTS[active.id] || { email: active.email, provider: active.provider, shortName: 'acc' };
        const activeColor = getChatAccountColorMeta(active.id || active.email);

        // 1. Header widget pill
        const headerShort = document.getElementById('headerActiveAccountEmailShort');
        const headerDuration = document.getElementById('headerActiveAccountDuration');
        const headerPill = document.getElementById('headerActiveAccountPill');
        if (headerShort) {
          headerShort.textContent = targetMeta.shortName || active.email.split('@')[0];
          headerShort.className = '';
          headerShort.style.color = 'var(--fg)';
        }
        if (headerDuration) headerDuration.textContent = durationStr;
        if (headerPill) headerPill.title = `Tài khoản OMP đang sử dụng: ${active.email} · Đang xài: ${durationStr}`;

        // 2. Modal Active Account Banner
        const modalEmail = document.getElementById('chatModalActiveEmail');
        const modalBadge = document.getElementById('chatModalActiveBadge');
        const modalProvider = document.getElementById('chatModalActiveProviderBadge');
        const modalDuration = document.getElementById('chatModalActiveDuration');
        if (modalEmail) {
          modalEmail.textContent = active.email;
          modalEmail.className = '';
          modalEmail.style.color = 'var(--fg)';
        }
        if (modalBadge) {
          modalBadge.textContent = activeColor.initials;
          modalBadge.className = 'acc-avatar-badge';
        }
        if (modalProvider) modalProvider.textContent = active.provider;
        if (modalDuration) modalDuration.textContent = durationStr;

        // 3. Modal Table Rows
        Object.keys(CHAT_OMP_ACCOUNTS).forEach(accId => {
          const row = document.getElementById(`chatAccRow_${accId}`);
          const btn = document.getElementById(`btnChatSwitch_${accId}`);
          if (!row || !btn) return;

          const durationTag = row.querySelector('.row-duration-text');
          const isActive = (accId === active.id);

          if (isActive) {
            row.classList.add('is-active-row');
            row.style.background = 'color-mix(in oklab, var(--accent), transparent 93%)';
            row.style.borderLeft = '3px solid var(--accent)';
            if (durationTag) {
              durationTag.textContent = `Đang dùng: ${durationStr}`;
              durationTag.style.color = 'var(--accent)';
              durationTag.style.fontWeight = '600';
            }
            btn.className = 'btn-account-active';
            btn.disabled = true;
            btn.onclick = null;
            btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>Đang dùng</span>`;
          } else {
            row.classList.remove('is-active-row');
            row.style.background = 'transparent';
            row.style.borderLeft = '3px solid transparent';
            if (durationTag) {
              durationTag.textContent = 'Chờ chọn';
              durationTag.style.color = 'var(--muted)';
              durationTag.style.fontWeight = 'normal';
            }
            btn.className = 'btn-switch-account';
            btn.disabled = false;
            btn.onclick = () => switchChatOmpAccount(accId);
            btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16"/></svg><span>Chuyển</span>`;
          }
        });

        // Reorder: Active account row ALWAYS moved to the first row (top position)
        const rowsContainer = document.getElementById('chatModalAccountsRows');
        if (rowsContainer) {
          const activeRow = document.getElementById(`chatAccRow_${active.id}`);
          if (activeRow && rowsContainer.firstElementChild !== activeRow) {
            rowsContainer.insertBefore(activeRow, rowsContainer.firstElementChild);
          }
          // Update STT badges in the reordered rows
          Array.from(rowsContainer.children).forEach((row, idx) => {
            const badge = row.querySelector('.acc-order-badge');
            if (badge) {
              badge.textContent = `#0${idx + 1}`;
              if (idx === 0) {
                badge.classList.add('is-active');
              } else {
                badge.classList.remove('is-active');
              }
            }
          });
        }
      }
      if (!isProductionChatRoute) {
        window.updateChatActiveAccountUI = updateChatActiveAccountUI;
        updateChatActiveAccountUI();
        setInterval(updateChatActiveAccountUI, 30000);
      }

      // ─── Modal Cài đặt Hệ thống (Settings Modal from image-38 & image-39) ───
      const settingsModal = document.getElementById('settingsModal');
      const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
      const settingsNavBtns = document.querySelectorAll('.settings-nav-btn');
      const settingsTabPanes = document.querySelectorAll('.settings-tab-pane');
      const headerActionOpenSettings = document.getElementById('headerActionOpenSettings');


      // General settings controls (image-38)
      const themeCards = document.querySelectorAll('.appearance-card');
      const sidebarAccentSwatches = document.querySelectorAll('.sidebar-accent-swatch');
      const sidebarAccentCurrentBadge = document.getElementById('sidebarAccentCurrentBadge');
      const canvasToneCards = document.querySelectorAll('.canvas-tone-card');
      const canvasToneCurrentBadge = document.getElementById('canvasToneCurrentBadge');
      const fontFamilyCards = document.querySelectorAll('.font-family-card');
      const fontFamilyCurrentBadge = document.getElementById('fontFamilyCurrentBadge');
      const canvasToneNames = {
        'deep-tech': 'Deep Tech',
        'obsidian': 'Obsidian',
        'charcoal': 'Charcoal',
        'midnight': 'Midnight',
        'ocean': 'Ocean'
      };
      const fontFamilyNames = {
        'inter': 'Inter',
        'chatgptstyle': 'Open Sans',
        'be-vietnam': 'Be Vietnam Pro',
        'geist': 'Geist',
        'jetbrains': 'JetBrains Mono',
        'system': 'System'
      };
      const accentNamesMap = {
        'neutral': 'Đơn sắc tối giản',
        'cobalt': 'Xanh Cobalt (Hòn π)',
        'emerald': 'Xanh lục (Emerald)',
        'violet': 'Tím (Violet)',
        'amber': 'Hổ phách (Amber)',
        'cyan': 'Xanh lơ (Cyan)',
        'rose': 'Hoa hồng (Rose)'
      };
      const fontSizeDisplay = document.getElementById('fontSizeDisplay');
      const fontSizeDecBtn = document.getElementById('fontSizeDecBtn');
      const fontSizeIncBtn = document.getElementById('fontSizeIncBtn');
      const settingsPermissionSelect = document.getElementById('settingsPermissionSelect');
      const settingsLanguageSelect = document.getElementById('settingsLanguageSelect');
      const settingsConvDisplaySelect = document.getElementById('settingsConvDisplaySelect');
      const settingsEnterBehaviorSelect = document.getElementById('settingsEnterBehaviorSelect');
      const settingsOmpBrowserModeSelect = document.getElementById('settingsOmpBrowserModeSelect');
      const settingsOmpShareModeSelect = document.getElementById('settingsOmpShareModeSelect');
      const ompMemoryState = document.getElementById('ompMemoryState');
      const btnRefreshOmpMemory = document.getElementById('btnRefreshOmpMemory');
      const settingsAgentRoleSelect = document.getElementById('settingsAgentRoleSelect');
      const settingsCustomPromptArea = document.getElementById('settingsCustomPromptArea');

      // Models tab controls
      const settingsDefaultModelSelect = document.getElementById('settingsDefaultModelSelect');
      const settingsDefaultReasoningSelect = document.getElementById('settingsDefaultReasoningSelect');
      const settingsTempRange = document.getElementById('settingsTempRange');
      const settingsTempVal = document.getElementById('settingsTempVal');

      let currentChatFontSize = parseInt(localStorage.getItem('neuratalk-chat-font-size'), 10) || 14;

      function applyChatFontSize(size) {
        currentChatFontSize = Math.max(12, Math.min(18, size));
        if (fontSizeDisplay) fontSizeDisplay.textContent = currentChatFontSize;
        localStorage.setItem('neuratalk-chat-font-size', currentChatFontSize);
        const chatContainer = document.querySelector('.chat-container');
        if (chatContainer) {
          chatContainer.style.setProperty('--chat-content-font-size', currentChatFontSize + 'px');
        }
        document.querySelectorAll('.chat-item-text, .ai-message-card, .chat-item-body').forEach(el => {
          el.style.fontSize = currentChatFontSize + 'px';
        });
      }

      // Initialize saved font size
      applyChatFontSize(currentChatFontSize);

      function openSettingsModal(targetTab) {
        if (!settingsModal) return;
        switchSettingsTab(targetTab || 'general');
        syncSettingsUIWithCurrentState();
        settingsModal.classList.add('open');
      }

      function closeSettingsModal() {
        if (settingsModal) settingsModal.classList.remove('open');
      }

      function switchSettingsTab(tabKey) {
        const paneSuffix = String(tabKey || '').split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
        settingsNavBtns.forEach(btn => {
          const isActive = btn.getAttribute('data-tab') === tabKey;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        settingsTabPanes.forEach(pane => {
          pane.classList.toggle('active', pane.id === `settingsTab${paneSuffix}`);
        });
      }

      function syncSettingsUIWithCurrentState() {
        syncOmpSettingsUI();
        // Sync theme cards with current data-theme
        const savedTheme = localStorage.getItem('neuratalk-theme');
        const currentTheme = savedTheme === 'system' ? 'system' : (document.documentElement.getAttribute('data-theme') || 'dark');
        themeCards.forEach(card => {
          const val = card.getAttribute('data-theme-val');
          card.classList.toggle('active', val === currentTheme);
          card.setAttribute('aria-checked', val === currentTheme ? 'true' : 'false');
        });

        // Sync font size display
        if (fontSizeDisplay) fontSizeDisplay.textContent = currentChatFontSize;

        // Sync model name from prompt model selector if available
        // Sync model from prompt model selector if available
        const promptModelSelect = document.getElementById('promptModelSelect');
        if (settingsDefaultModelSelect && promptModelSelect) {
          settingsDefaultModelSelect.value = promptModelSelect.value;
        }

        // Sync reasoning from prompt thinking selector if available
        const promptThinkingSelect = document.getElementById('promptThinkingSelect');
        if (settingsDefaultReasoningSelect && promptThinkingSelect) {
          settingsDefaultReasoningSelect.value = promptThinkingSelect.value;
        }

        // Sync sidebar accent swatches with current data-sidebar-accent
        const currentSidebarAccent = document.documentElement.getAttribute('data-sidebar-accent') || 'neutral';
        sidebarAccentSwatches.forEach(swatch => {
          const isAct = swatch.getAttribute('data-accent') === currentSidebarAccent;
          swatch.classList.toggle('active', isAct);
          swatch.setAttribute('aria-checked', isAct ? 'true' : 'false');
        });
        if (sidebarAccentCurrentBadge) {
          sidebarAccentCurrentBadge.textContent = accentNamesMap[currentSidebarAccent] || 'Đơn sắc tối giản';
        }

        const currentCanvasTone = document.documentElement.getAttribute('data-canvas-tone') || 'deep-tech';
        canvasToneCards.forEach(card => {
          const active = card.getAttribute('data-tone') === currentCanvasTone;
          card.classList.toggle('active', active);
          card.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        if (canvasToneCurrentBadge) canvasToneCurrentBadge.textContent = canvasToneNames[currentCanvasTone] || canvasToneNames['deep-tech'];

        const currentFontFamily = document.documentElement.getAttribute('data-font-family') || 'inter';
        fontFamilyCards.forEach(card => {
          const active = card.getAttribute('data-font') === currentFontFamily;
          card.classList.toggle('active', active);
          card.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        if (fontFamilyCurrentBadge) fontFamilyCurrentBadge.textContent = fontFamilyNames[currentFontFamily] || fontFamilyNames.inter;

        // Sync dynamic colorful badges toggle with current data-colorful-badges
        const dynamicBadgesToggle = document.getElementById('settingsDynamicBadgesToggle');
        if (dynamicBadgesToggle) {
          dynamicBadgesToggle.checked = document.documentElement.getAttribute('data-colorful-badges') !== 'false';
        }
      }

      settingsNavBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const tabKey = btn.getAttribute('data-tab');
          if (tabKey) switchSettingsTab(tabKey);
        });
      });

      if (closeSettingsModalBtn) closeSettingsModalBtn.addEventListener('click', closeSettingsModal);

      if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
          if (e.target === settingsModal) closeSettingsModal();
        });
      }

      if (headerActionOpenSettings) {
        headerActionOpenSettings.addEventListener('click', () => {
          if (headerMoreMenu) headerMoreMenu.classList.remove('open');
          openSettingsModal('general');
        });
      }

      // Appearance Card clicks
      themeCards.forEach(card => {
        card.addEventListener('click', () => {
          const val = card.getAttribute('data-theme-val');
          if (!val) return;
          themeCards.forEach(c => c.classList.remove('active'));
          card.classList.add('active');

          if (val === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            applyTheme(prefersDark ? 'dark' : 'light', false, false);
            try { localStorage.setItem('neuratalk-theme', 'system'); } catch (_) {}
            showToast('Đã áp dụng giao diện: Theo hệ điều hành');
          } else {
            applyTheme(val);
            localStorage.setItem('neuratalk-theme', val);
            showToast(`Đã chuyển sang giao diện: ${val === 'dark' ? 'Tối (Dark Charcoal)' : 'Sáng (Neutral Modern)'}`);
          }
        });
      });

      // Sidebar accent color selector
      function applySidebarAccent(accentKey, notify = true) {
        const key = accentNamesMap[accentKey] ? accentKey : 'neutral';
        document.documentElement.setAttribute('data-sidebar-accent', key);
        localStorage.setItem('neuratalk-sidebar-accent', key);

        if (sidebarAccentCurrentBadge) {
          sidebarAccentCurrentBadge.textContent = accentNamesMap[key] || 'Đơn sắc tối giản';
        }

        sidebarAccentSwatches.forEach(swatch => {
          const isAct = swatch.getAttribute('data-accent') === key;
          swatch.classList.toggle('active', isAct);
          swatch.setAttribute('aria-checked', isAct ? 'true' : 'false');
        });

        if (notify) {
          showToast(`Đã đổi màu nhấn thanh bên: ${accentNamesMap[key]}`);
        }
      }

      // Initialize saved sidebar accent on page load
      const savedSidebarAccent = localStorage.getItem('neuratalk-sidebar-accent') || 'neutral';
      applySidebarAccent(savedSidebarAccent, false);

      sidebarAccentSwatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
          const accentKey = swatch.getAttribute('data-accent');
          if (accentKey) applySidebarAccent(accentKey, true);
        });
      });

      function applyCanvasTone(toneKey, notify = true) {
        const key = canvasToneNames[toneKey] ? toneKey : 'deep-tech';
        document.documentElement.setAttribute('data-canvas-tone', key);
        try { localStorage.setItem('honpi-canvas-tone', key); } catch (_) {}
        canvasToneCards.forEach(card => {
          const active = card.getAttribute('data-tone') === key;
          card.classList.toggle('active', active);
          card.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        if (canvasToneCurrentBadge) canvasToneCurrentBadge.textContent = canvasToneNames[key];
        if (notify) showToast(`Đã đổi tông màu toàn trang: ${canvasToneNames[key]}`);
      }

      function applyFontFamily(fontKey, notify = true) {
        const key = fontFamilyNames[fontKey] ? fontKey : 'inter';
        document.documentElement.setAttribute('data-font-family', key);
        try { localStorage.setItem('honpi-font-family', key); } catch (_) {}
        fontFamilyCards.forEach(card => {
          const active = card.getAttribute('data-font') === key;
          card.classList.toggle('active', active);
          card.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        if (fontFamilyCurrentBadge) fontFamilyCurrentBadge.textContent = fontFamilyNames[key];
        if (notify) showToast(`Đã đổi phông chữ toàn trang: ${fontFamilyNames[key]}`);
      }

      applyCanvasTone(document.documentElement.getAttribute('data-canvas-tone') || localStorage.getItem('honpi-canvas-tone') || 'deep-tech', false);
      applyFontFamily(document.documentElement.getAttribute('data-font-family') || localStorage.getItem('honpi-font-family') || 'inter', false);
      canvasToneCards.forEach(card => card.addEventListener('click', () => applyCanvasTone(card.getAttribute('data-tone'))));
      fontFamilyCards.forEach(card => card.addEventListener('click', () => applyFontFamily(card.getAttribute('data-font'))));

      function syncOmpSettingsUI() {
        const browserMode = localStorage.getItem('omp.browserMode') === 'ego-browser' ? 'on' : 'off';
        if (settingsOmpBrowserModeSelect) settingsOmpBrowserModeSelect.value = browserMode;
        if (settingsOmpShareModeSelect) settingsOmpShareModeSelect.value = localStorage.getItem('omp.shareMode') || 'encrypted';
        if (settingsAgentRoleSelect) settingsAgentRoleSelect.value = localStorage.getItem('honpi-agent-role') || 'general';
        if (settingsCustomPromptArea) settingsCustomPromptArea.value = localStorage.getItem('honpi-agent-prompt') || '';
      }

      settingsOmpBrowserModeSelect?.addEventListener('change', () => {
        const next = settingsOmpBrowserModeSelect.value === 'on';
        localStorage.setItem('omp.browserMode', next ? 'ego-browser' : 'none');
        const ego = document.getElementById('egoBrowserToggle');
        if (ego && ego.classList.contains('active') !== next) ego.click();
        showToast(next ? 'Đã bật Browser mode OMP' : 'Đã tắt Browser mode OMP');
      });
      settingsOmpShareModeSelect?.addEventListener('change', () => {
        localStorage.setItem('omp.shareMode', settingsOmpShareModeSelect.value);
        showToast(`Đã chọn share mode OMP: ${settingsOmpShareModeSelect.options[settingsOmpShareModeSelect.selectedIndex]?.textContent || settingsOmpShareModeSelect.value}`);
      });
      btnRefreshOmpMemory?.addEventListener('click', () => {
        if (ompMemoryState) ompMemoryState.textContent = 'Đang kiểm tra trạng thái Memory qua OMP…';
        btnRefreshOmpMemory.disabled = true;
        setTimeout(() => {
          if (ompMemoryState) ompMemoryState.textContent = 'Runtime hiện chưa công bố endpoint Memory riêng; dữ liệu chat vẫn được lấy trực tiếp từ session OMP.';
          btnRefreshOmpMemory.disabled = false;
          showToast('Đã kiểm tra trạng thái Memory OMP');
        }, 250);
      });
      settingsAgentRoleSelect?.addEventListener('change', () => {
        localStorage.setItem('honpi-agent-role', settingsAgentRoleSelect.value);
        showToast('Đã lưu tác tử mặc định cho chat mới');
      });
      settingsCustomPromptArea?.addEventListener('change', () => localStorage.setItem('honpi-agent-prompt', settingsCustomPromptArea.value));

      const welcomeDefaults = [
        ['cobalt', 'Cobalt', 'Mở cuộc trò chuyện mới', '', 'new-chat'],
        ['emerald', 'Emerald', 'Bắt đầu bằng GitHub', 'Khởi tạo tác vụ phân tích repository và triage PRs trên GitHub', 'send-now'],
        ['violet', 'Violet', 'Bắt đầu bằng Skill', 'Kích hoạt Open Design Skill để phân tích và xây dựng nguyên mẫu giao diện chuẩn Design System', 'send-now'],
        ['cyan', 'Cyan', 'Bắt đầu bằng Ego Browser', 'Khởi chạy tác tử Ego Browser để tự động truy cập, khảo sát và thu thập dữ liệu web trực tiếp', 'ego-browser'],
        ['rose', 'Rose', 'Bắt đầu bằng Open Design', 'Đính kèm bản thiết kế giao diện từ Open Design để hiện thực hóa mã nguồn HTML/CSS chuẩn Design System', 'send-now'],
        ['amber', 'Amber', 'Chế độ lập kế hoạch', 'Bật chế độ lập kế hoạch để phân tích yêu cầu bài toán và chia nhỏ các bước thực thi chi tiết', 'plan-mode']
      ];
      let welcomeConfig = welcomeDefaults.map(([colorKey, colorName, title, prompt, option]) => ({ colorKey, colorName, title, desc: prompt || 'Mở một phiên hội thoại trống để bắt đầu', prompt, option }));
      let welcomeEditIndex = 0;
      try {
        const saved = JSON.parse(localStorage.getItem('honpi_welcome_config') || 'null');
        if (saved?.cards?.length === 6) welcomeConfig = saved.cards;
      } catch (_) {}
      const welcomeTitleInput = document.getElementById('welcomeTitleInput');
      const welcomeDescInput = document.getElementById('welcomeDescInput');
      const welcomeBlockSelector = document.getElementById('welcomeBlockSelector');
      const welcomeBlockTitleInput = document.getElementById('welcomeBlockTitleInput');
      const welcomeBlockDescInput = document.getElementById('welcomeBlockDescInput');
      const welcomeBlockPromptInput = document.getElementById('welcomeBlockPromptInput');
      const welcomeBlockOptionSelect = document.getElementById('welcomeBlockOptionSelect');

      function applyWelcomeConfig() {
        const title = localStorage.getItem('honpi_welcome_title') || 'Chào mừng bạn đến với Hòn π';
        const desc = localStorage.getItem('honpi_welcome_desc') || 'Trợ lý AI thông minh điều phối luồng công việc, phân tích mã nguồn và tự động hóa.';
        const heroTitle = document.querySelector('.greeting-hero-title');
        const heroDesc = document.querySelector('.greeting-hero-desc');
        if (heroTitle) heroTitle.textContent = title;
        if (heroDesc) heroDesc.textContent = desc;
        document.querySelectorAll('.quick-grid .quick-card').forEach((card, index) => {
          const config = welcomeConfig[index];
          if (!config) return;
          card.querySelector('.quick-card-title')?.replaceChildren(document.createTextNode(config.title || 'Hành động nhanh'));
          card.title = config.desc || config.prompt || config.title || '';
          card.dataset.prompt = config.prompt || '';
          card.dataset.action = config.option || 'fill-dock';
        });
      }
      function renderWelcomeEditor() {
        if (!welcomeBlockSelector) return;
        welcomeBlockSelector.replaceChildren(...welcomeConfig.map((config, index) => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = index === welcomeEditIndex ? 'active' : ''; button.dataset.index = String(index);
          button.setAttribute('aria-selected', index === welcomeEditIndex ? 'true' : 'false'); button.textContent = `${index + 1}. ${config.colorName || 'Thẻ'}`;
          button.addEventListener('click', () => { saveWelcomeEditorBlock(); welcomeEditIndex = index; renderWelcomeEditor(); populateWelcomeEditor(); });
          return button;
        }));
      }
      function populateWelcomeEditor() {
        const config = welcomeConfig[welcomeEditIndex]; if (!config) return;
        if (welcomeBlockTitleInput) welcomeBlockTitleInput.value = config.title || '';
        if (welcomeBlockDescInput) welcomeBlockDescInput.value = config.desc || '';
        if (welcomeBlockPromptInput) welcomeBlockPromptInput.value = config.prompt || '';
        if (welcomeBlockOptionSelect) welcomeBlockOptionSelect.value = config.option || 'fill-dock';
      }
      function saveWelcomeEditorBlock() {
        const config = welcomeConfig[welcomeEditIndex]; if (!config) return;
        if (welcomeBlockTitleInput) config.title = welcomeBlockTitleInput.value.trim();
        if (welcomeBlockDescInput) config.desc = welcomeBlockDescInput.value.trim();
        if (welcomeBlockPromptInput) config.prompt = welcomeBlockPromptInput.value.trim();
        if (welcomeBlockOptionSelect) config.option = welcomeBlockOptionSelect.value;
      }
      document.getElementById('btnSaveWelcomeConfig')?.addEventListener('click', () => {
        saveWelcomeEditorBlock();
        if (welcomeTitleInput) localStorage.setItem('honpi_welcome_title', welcomeTitleInput.value.trim() || 'Chào mừng bạn đến với Hòn π');
        if (welcomeDescInput) localStorage.setItem('honpi_welcome_desc', welcomeDescInput.value.trim() || 'Trợ lý AI thông minh điều phối luồng công việc, phân tích mã nguồn và tự động hóa.');
        localStorage.setItem('honpi_welcome_config', JSON.stringify({ cards: welcomeConfig }));
        applyWelcomeConfig(); showToast('Đã lưu cài đặt màn hình chào mừng');
      });
      document.getElementById('btnResetWelcomeConfig')?.addEventListener('click', () => {
        welcomeConfig = welcomeDefaults.map(([colorKey, colorName, title, prompt, option]) => ({ colorKey, colorName, title, desc: prompt || 'Mở một phiên hội thoại trống để bắt đầu', prompt, option }));
        localStorage.removeItem('honpi_welcome_config'); localStorage.removeItem('honpi_welcome_title'); localStorage.removeItem('honpi_welcome_desc');
        if (welcomeTitleInput) welcomeTitleInput.value = 'Chào mừng bạn đến với Hòn π';
        if (welcomeDescInput) welcomeDescInput.value = 'Trợ lý AI thông minh điều phối luồng công việc, phân tích mã nguồn và tự động hóa.';
        welcomeEditIndex = 0; renderWelcomeEditor(); populateWelcomeEditor(); applyWelcomeConfig(); showToast('Đã khôi phục màn hình chào mặc định');
      });
      const agentInstructionDefaults = '# Hòn π OMP Agent Instructions\n- Trả lời ngắn gọn bằng tiếng Việt.\n- Kiểm tra runtime thật trước khi kết luận.\n- Hoàn tất flow và báo rõ bước tiếp theo.';
      const agentInstructionArea = document.getElementById('ompAgentInstructionsTextarea');
      const agentPromptStats = document.getElementById('agentPromptStats');
      function syncAgentInstructionStats() { if (agentPromptStats && agentInstructionArea) agentPromptStats.textContent = `${agentInstructionArea.value.length.toLocaleString()} ký tự · ${agentInstructionArea.value ? agentInstructionArea.value.split('\n').length : 0} dòng`; }
      if (agentInstructionArea) {
        agentInstructionArea.value = localStorage.getItem('honpi_omp_agent_instructions') ?? agentInstructionDefaults;
        agentInstructionArea.addEventListener('input', syncAgentInstructionStats); syncAgentInstructionStats();
      }
      document.getElementById('btnSaveAgentInstructions')?.addEventListener('click', () => { localStorage.setItem('honpi_omp_agent_instructions', agentInstructionArea?.value || ''); syncAgentInstructionStats(); showToast('Đã lưu chỉ dẫn Agent OMP'); });
      document.getElementById('btnClearAgentInstructions')?.addEventListener('click', () => { if (agentInstructionArea) agentInstructionArea.value = ''; localStorage.setItem('honpi_omp_agent_instructions', ''); syncAgentInstructionStats(); showToast('Đã xóa chỉ dẫn Agent OMP'); });
      document.getElementById('btnResetAgentInstructions')?.addEventListener('click', () => { if (agentInstructionArea) agentInstructionArea.value = agentInstructionDefaults; localStorage.setItem('honpi_omp_agent_instructions', agentInstructionDefaults); syncAgentInstructionStats(); showToast('Đã khôi phục mẫu chỉ dẫn Agent OMP'); });
      if (welcomeTitleInput) welcomeTitleInput.value = localStorage.getItem('honpi_welcome_title') || 'Chào mừng bạn đến với Hòn π';
      if (welcomeDescInput) welcomeDescInput.value = localStorage.getItem('honpi_welcome_desc') || 'Trợ lý AI thông minh điều phối luồng công việc, phân tích mã nguồn và tự động hóa.';
      renderWelcomeEditor(); populateWelcomeEditor(); applyWelcomeConfig();

      // Dynamic Colorful Badges toggle (image-52)
      const settingsDynamicBadgesToggle = document.getElementById('settingsDynamicBadgesToggle');

      function applyColorfulBadges(isColorful, notify = true) {
        document.documentElement.setAttribute('data-colorful-badges', isColorful ? 'true' : 'false');
        localStorage.setItem('neuratalk-colorful-badges', isColorful ? 'true' : 'false');
        if (settingsDynamicBadgesToggle) {
          settingsDynamicBadgesToggle.checked = isColorful;
        }
        if (notify) {
          showToast(isColorful ? 'Đã bật màu sắc linh hoạt cho các cụm badge' : 'Đã chuyển các cụm badge về dạng đơn sắc tối giản');
        }
      }

      // Initialize saved dynamic badge colors setting on page load (defaulting to true)
      const savedColorfulBadges = localStorage.getItem('neuratalk-colorful-badges') !== 'false';
      applyColorfulBadges(savedColorfulBadges, false);

      if (settingsDynamicBadgesToggle) {
        settingsDynamicBadgesToggle.addEventListener('change', (e) => {
          applyColorfulBadges(e.target.checked, true);
        });
      }

      // Font size buttons
      if (fontSizeDecBtn) {
        fontSizeDecBtn.addEventListener('click', () => {
          applyChatFontSize(currentChatFontSize - 1);
          showToast(`Cỡ chữ cuộc trò chuyện: ${currentChatFontSize}px`);
        });
      }
      if (fontSizeIncBtn) {
        fontSizeIncBtn.addEventListener('click', () => {
          applyChatFontSize(currentChatFontSize + 1);
          showToast(`Cỡ chữ cuộc trò chuyện: ${currentChatFontSize}px`);
        });
      }

      // Permission Select in Settings Modal
      if (settingsPermissionSelect) {
        settingsPermissionSelect.addEventListener('change', (e) => {
          const val = e.target.value;
          if (typeof setPermissionMode === 'function') {
            setPermissionMode(val, true);
          }
        });
      }

      // Language Select
      if (settingsLanguageSelect) {
        settingsLanguageSelect.addEventListener('change', (e) => {
          showToast(e.target.value === 'vi' ? 'Ngôn ngữ giao diện: Tiếng Việt' : 'Language set to English');
        });
      }

      // Conversation Display
      if (settingsConvDisplaySelect) {
        settingsConvDisplaySelect.addEventListener('change', (e) => {
          const isCompact = e.target.value === 'compact';
          document.querySelectorAll('.turn-activity-box').forEach(box => {
            box.classList.toggle('collapsed', isCompact);
          });
          showToast(isCompact ? 'Chế độ hiển thị: Thu gọn' : 'Chế độ hiển thị: Đầy đủ');
        });
      }

      const settingsEgoAgentSwitch = document.getElementById('settingsEgoAgentSwitch');
      if (settingsEgoAgentSwitch) {
        settingsEgoAgentSwitch.addEventListener('change', () => {
          const isChecked = settingsEgoAgentSwitch.checked;
          if (egoBrowserToggle) {
            egoBrowserToggle.classList.toggle('active', isChecked);
            egoBrowserToggle.setAttribute('title', isChecked ? 'Tác tử Ego Browser: Đang BẬT (Nhấp để tắt)' : 'Tác tử Ego Browser: Đang TẮT (Nhấp để bật)');
          }
          updateActiveToolsUI();
          showToast(isChecked ? 'Đã bật tác tử duyệt web Ego Browser' : 'Đã tắt tác tử duyệt web Ego Browser');
        });
      }

      // Temperature slider
      if (settingsTempRange && settingsTempVal) {
        settingsTempRange.addEventListener('input', (e) => {
          settingsTempVal.textContent = e.target.value;
        });
      }

      // Default model selector
      // Default model selector
      if (settingsDefaultModelSelect) {
        settingsDefaultModelSelect.addEventListener('change', (e) => {
          const selectedVal = e.target.value;
          const promptModelSelect = document.getElementById('promptModelSelect');
          if (promptModelSelect) {
            promptModelSelect.value = selectedVal;
            promptModelSelect.dispatchEvent(new Event('change'));
          }
        });
      }

      // Default reasoning selector
      if (settingsDefaultReasoningSelect) {
        settingsDefaultReasoningSelect.addEventListener('change', (e) => {
          const selectedVal = e.target.value;
          const promptThinkingSelect = document.getElementById('promptThinkingSelect');
          if (promptThinkingSelect) {
            promptThinkingSelect.value = selectedVal;
            promptThinkingSelect.dispatchEvent(new Event('change'));
          }
        });
      }

      // Global keyboard shortcuts: Alt+T (Theme), Ctrl/Cmd+B (Sidebar), Ctrl/Cmd+K (New Session), Context Menu shortcuts
      window.addEventListener('keydown', (e) => {
        // Don't trigger session actions while actively typing in text inputs
        const isInputActive = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

        if ((e.altKey && (e.key === 't' || e.key === 'T')) || ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'd' || e.key === 'D'))) {
          e.preventDefault();
          toggleTheme();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          const isCollapsed = appSidebar.classList.contains('collapsed');
          setSidebarCollapsed(!isCollapsed);
          showToast(isCollapsed ? 'Đã mở rộng thanh bên' : 'Đã thu gọn thanh bên');
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          createNewSession();
        } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
          e.preventDefault();
          openSettingsModal('general');
        } else if (e.key === 'Escape') {
          closeSessionContextMenu();
          if (headerMoreMenu) headerMoreMenu.classList.remove('open');
          if (bottomPanel && bottomPanel.classList.contains('open')) toggleBottomPanel(false);
          if (deleteConfirmModal) deleteConfirmModal.classList.remove('open');
          if (shareSessionModal) shareSessionModal.classList.remove('open');
          if (openWindowModal) openWindowModal.classList.remove('open');
          if (quotaDashboardModal) quotaDashboardModal.classList.remove('open');
          if (settingsModal) closeSettingsModal();
          if (sessionsFilterMenu) closeSessionsFilterMenu();
          if (customInputModal) closeCustomInputModal();
          if (approvalPopover) {
            approvalPopover.classList.remove('show');
            if (fullAccessBadge) {
              fullAccessBadge.classList.remove('active-popover');
              fullAccessBadge.setAttribute('aria-expanded', 'false');
            }
          }
          if (document.getElementById('codeDiffReviewModal')) closeCodeDiffReviewModal();
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const diffModal = document.getElementById('codeDiffReviewModal');
          if (diffModal && diffModal.style.display === 'flex') {
            const tabs = Array.from(document.querySelectorAll('.diff-tab-btn'));
            const activeIndex = tabs.findIndex(t => t.classList.contains('active'));
            if (activeIndex !== -1 && tabs.length > 1) {
              const nextIndex = e.key === 'ArrowRight' ? (activeIndex + 1) % tabs.length : (activeIndex - 1 + tabs.length) % tabs.length;
              const nextKey = tabs[nextIndex].getAttribute('data-file-key');
              if (nextKey) switchDiffTab(nextKey);
            }
          }
        } else if ((e.altKey && (e.metaKey || e.ctrlKey || true)) && (e.key === 'q' || e.key === 'Q')) {
          e.preventDefault();
          toggleQuotaBar();
        } else if (!isInputActive) {
          const activeOrTarget = targetSessionItem || document.querySelector('.session-item.active') || document.querySelector('.session-item');
          
          // Option+Cmd+R / Alt+R: Rename
          if ((e.altKey && (e.metaKey || e.ctrlKey || true)) && (e.key === 'r' || e.key === 'R')) {
            e.preventDefault();
            if (activeOrTarget) startRenameSession(activeOrTarget);
          }
          // Option+Cmd+P / Alt+P: Pin/Unpin
          else if ((e.altKey && (e.metaKey || e.ctrlKey || true)) && (e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            if (activeOrTarget) togglePinSession(activeOrTarget);
          }
          // Shift+Cmd+U / Shift+U: Unread
          else if (e.shiftKey && (e.metaKey || e.ctrlKey || e.altKey) && (e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            if (activeOrTarget) toggleUnreadSession(activeOrTarget);
          }
          // Shift+Cmd+A / Shift+A: Archive
          else if (e.shiftKey && (e.metaKey || e.ctrlKey || e.altKey) && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            if (activeOrTarget) archiveSession(activeOrTarget);
          }
          // Option+Cmd+X / Alt+X: Toggle Running
          else if ((e.altKey && (e.metaKey || e.ctrlKey || true)) && (e.key === 'x' || e.key === 'X')) {
            e.preventDefault();
            if (activeOrTarget) toggleRunningSession(activeOrTarget);
          }
        }
      });

      // Initialize theme, including a live system preference mode.
      let initialTheme = 'dark';
      let themeMode = 'dark';
      try {
        const saved = localStorage.getItem('neuratalk-theme');
        if (saved === 'dark' || saved === 'light' || saved === 'system') {
          themeMode = saved;
          initialTheme = saved === 'system'
            ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : saved;
        } else {
          initialTheme = 'dark';
          localStorage.setItem('neuratalk-theme', 'dark');
        }
      } catch (e) {}
      applyTheme(initialTheme, false, themeMode !== 'system');
      if (themeMode === 'system') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
        systemTheme.addEventListener?.('change', (event) => {
          applyTheme(event.matches ? 'dark' : 'light', false, false);
          try { localStorage.setItem('neuratalk-theme', 'system'); } catch (_) {}
        });
      }
      if (typeof updateWorkspaceSelectorVisibility === 'function') {
        updateWorkspaceSelectorVisibility();
      }
    })();
  
