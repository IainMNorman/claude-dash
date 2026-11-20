export const SHORTCUTS = [
  { keys: '⌘F', label: 'Search' },
  { keys: 'Esc', label: 'Clear search' },
  { keys: '⌘1–4', label: 'Switch filter' },
  { keys: '⌘⇧A', label: 'Toggle activity drawer' },
  { keys: 'J / K', label: 'Next / previous session' },
  { keys: 'Enter', label: 'Open selected session' },
  { keys: 'P', label: 'Pin / unpin selected session' },
];

export function actionFor(e, { typing = false } = {}) {
  if (!e || e.defaultPrevented) return null;
  const key = String(e.key || '');
  const k = key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey && !e.shiftKey && k === 'f') return 'focusSearch';
  if (key === 'Escape' && !mod && !e.altKey && !e.shiftKey) return typing ? 'clearSearch' : null;
  if (typing) return null;
  if (mod && !e.altKey && !e.shiftKey && /^[1-4]$/.test(key)) return `filter:${Number(key) - 1}`;
  if (mod && e.shiftKey && !e.altKey && k === 'a') return 'toggleDrawer';
  if (mod || e.altKey || e.shiftKey) return null;
  if (k === 'j') return 'next';
  if (k === 'k') return 'prev';
  if (key === 'Enter') return 'open';
  if (k === 'p') return 'pin';
  return null;
}

const isTyping = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true);

export function initKeys(api, doc = document) {
  const handlers = {
    focusSearch: () => api.focusSearch(),
    clearSearch: () => api.clearSearch(),
    toggleDrawer: () => api.toggleDrawer(),
    next: () => api.moveSelection(1),
    prev: () => api.moveSelection(-1),
    open: () => api.openSelected(),
    pin: () => api.togglePinSelected(),
  };
  const onKey = (e) => {
    const action = actionFor(e, { typing: isTyping(doc.activeElement) });
    if (!action) return;
    e.preventDefault();
    if (action.startsWith('filter:')) api.setFilter(Number(action.slice(7)));
    else handlers[action]();
  };
  doc.addEventListener('keydown', onKey);
  return () => doc.removeEventListener('keydown', onKey);
}
