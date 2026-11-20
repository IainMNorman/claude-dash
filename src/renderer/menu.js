export function createMenu(root, { prefix, groups, getValue, onSelect, count }) {
  let open = false;
  root.replaceChildren();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ddbtn';
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'ddmenu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  root.append(btn, menu);

  const byValue = new Map();
  const headers = [];
  for (const g of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'ddgroup';
    wrap.setAttribute('role', 'group');
    if (g.label) {
      const h = document.createElement('div');
      h.className = 'ddhead';
      wrap.append(h);
      headers.push([h, g.label]);
    }
    for (const it of g.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dditem' + (it.sub ? ' sub' : '');
      b.setAttribute('role', 'menuitemradio');
      b.dataset.value = it.value;
      b.innerHTML = `<span class="ddck"></span>${it.dot ? `<span class="dddot ${it.dot}"></span>` : ''}<span class="ddl"></span>${it.note ? `<span class="ddnote"></span>` : ''}<span class="ddn"></span>`;
      b.querySelector('.ddl').textContent = it.label;
      if (it.note) b.querySelector('.ddnote').textContent = it.note;
      b.onclick = () => { onSelect(it.value); close(true); };
      wrap.append(b);
      byValue.set(it.value, { el: b, it });
    }
    menu.append(wrap);
  }

  const items = () => [...menu.querySelectorAll('.dditem')];

  function refresh() {
    const v = getValue();
    const cur = byValue.get(v);
    const n = count ? count(v) : null;
    btn.innerHTML = `<span class="k"></span><span class="cur"></span>${n === null ? '' : '<b class="cn"></b>'}<span class="chev">▾</span>`;
    btn.querySelector('.k').textContent = prefix;
    btn.querySelector('.cur').textContent = cur ? cur.it.label : '';
    if (n !== null) btn.querySelector('.cn').textContent = n;
    for (const [val, { el }] of byValue) {
      const on = val === v;
      el.setAttribute('aria-checked', String(on));
      el.classList.toggle('on', on);
      if (count) el.querySelector('.ddn').textContent = count(val);
    }
    for (const [el, label] of headers) el.textContent = typeof label === 'function' ? label() : label;
  }

  function show() {
    open = true;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    refresh();
    const sel = menu.querySelector('.dditem.on') || items()[0];
    sel && sel.focus();
  }
  function close(focusBtn) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  }

  btn.onclick = () => (open ? close(true) : show());
  btn.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!open) show(); }
  };
  menu.onkeydown = (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
  };
  const onDoc = (e) => { if (open && !root.contains(e.target)) close(false); };
  document.addEventListener('click', onDoc);

  refresh();
  return { refresh, destroy: () => document.removeEventListener('click', onDoc), isOpen: () => open };
}
