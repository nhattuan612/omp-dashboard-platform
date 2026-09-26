# Session controls audit — 2026-09-22

Scope: live `http://127.0.0.1:4177/chat`, production adapter in `honpi-chat-dashboard-SKE.html`, OMP runtime `~/.omp/usage-dashboard/server.mjs`. No create/delete/fork action was executed.

## Verified live

- `/api/v1/sessions?limit=3`: HTTP 200, `x-total-count: 395`, `x-next-cursor: 3`; UI loads 50 then `Tải thêm phiên` loads 100. Pagination works.
- Search `OpenDesign`: 18 visible rows, folders expanded, empty state hidden. Search works while current DOM is mounted.
- Folder header click: `aria-expanded=true → false`, `.collapsed=false → true`. Click toggle works.
- Filter popup opens and updates `aria-expanded`; live pinned filter hides project/unassigned groups and shows pinned group.
- Sort popup changes active item. Alphabetical works. Oldest/newest is wrong for compound ages (`15g 23p`, `2g 9p`) because `parseSessionTimeScore()` only parses one unit. Observed oldest usage list: `1g 9p, 1g 19p, 1g 38p, 1g 54p, 15g 23p, 2g 9p, 2g, 7p`.
- Reset/reload/pagination recreates session DOM and resets sort/filter/folder state to defaults. Search is also lost after any `loadSessions()` refresh because adapter reads `#sidebarSearchInput` while real input is `#sessionSearchInput`.
- Context menu contains live actions: `Đặt lại tên`, `Ghim/Bỏ ghim`, `Đánh dấu chưa đọc/đã đọc`, `Tạo nhánh`, `Chia sẻ liên kết`, `Lưu trữ`, `Xoá vĩnh viễn`.

## Blocking failures

1. **Rename is broken in the live in-app browser.** Clicking `Đặt lại tên` calls `window.prompt()` at production adapter line ~14868. Live dev log: `Error: prompt() is not supported.` No API request occurs. Replace with existing `customInputModal`.
2. **Delete is likely broken in the same browser.** Adapter calls `window.confirm()` at line ~14869; native dialogs are unsupported in this environment. Replace with existing `deleteConfirmModal` before calling API. Do not rely on `confirm()`.
3. **Header menu still exposes fake production actions.** `headerActionDuplicate` and `headerActionExport` have only old prototype handlers (lines ~13366–13409), are not intercepted by production adapter, and do not call `/api/v1/sessions/.../action`. Duplicate only clones DOM and disappears on reload; Export writes hard-coded sample conversation content. Hide them or wire real backend actions.
4. **Folder/project organization is not persisted.** `addWorkspaceBtn`/`addProjectFolderHeaderBtn`, `createProjectFolderElement()`, and `assignProjectToSession()` mutate DOM only. Production dynamic context menu has no project assignment. A new folder/session assignment disappears after `loadSessions()`/reload; no `/sessions/action` folder action exists.

## Settings popup audit

- **Works:** theme cards persist/apply theme; sidebar accent swatches persist; chat font +/- changes display and message font; dynamic badge checkbox persists; permission select maps to `state.approvalMode` and is sent in stream; model select is populated from `/api/v1/models` and updates `state.activeModel`; Browser mode select updates `state.browserMode` (capability reports partial).
- **UI-only / no backend effect:** Language select only shows a toast (line ~14507); no locale/state persistence. Conversation display select toggles `.turn-activity-box`, but live production renderer has 0 such nodes, so no visible effect. Temperature slider only updates `settingsTempVal`; `sendPrompt()` never sends it. Max tokens select has no listener. Enter behavior select has no listener and is never read by `sendPrompt()`.
- **Reasoning mismatch:** Settings reasoning select dispatches the prototype `promptThinkingSelect` change handler, which updates labels only. Production `sendPrompt()` sends `state.thinking`; no live handler updates `state.thinking`, so selected reasoning can display as changed but requests still use the initial state value.
- **Agent Hub tab:** only displays a capability note (`Task, subagent và advisor...`); no controls or operations are available. This is informational, not a usable Agent Hub.
- **Plugins tab:** production replaces the old plugin settings with the Browser mode capability card; old plugin toggles are not available after `ensureOmpSettings()`.

## Recommended patch order

1. Replace `window.prompt`/`window.confirm` with `customInputModal`/`deleteConfirmModal`, then verify API calls and refreshed state.
2. Remove or backend-wire header duplicate/export; do not show fake success/sample export.
3. Implement persisted folder metadata/action or hide folder creation/assignment controls from production.
4. Fix sort parser using `updatedAt` from state (not compact display text), and preserve sort/filter/search/density/timestamps across `renderSessions()`.
5. Wire settings that OMP accepts (`thinking`, model, approval, browser mode); hide or mark language, temperature, max tokens, enter behavior and conversation display until backend/runtime behavior exists.
