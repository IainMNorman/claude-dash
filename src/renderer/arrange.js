export function neededColumns(list, layout) {
  let max = 0;
  for (const s of list) if (layout[s.id]) max = Math.max(max, layout[s.id].col | 0);
  return max + 1;
}

export function foldCols(list, layout, n) {
  const cols = Array.from({ length: n }, () => []);
  const unplaced = [];
  for (const s of list) {
    const l = layout[s.id];
    if (!l) unplaced.push(s);
    else cols[Math.min(Math.max(0, l.col | 0), n - 1)].push(s);
  }
  for (const c of cols) c.sort((a, b) => layout[a.id].order - layout[b.id].order || a.id.localeCompare(b.id));
  return { cols, unplaced };
}

export function placeUnplaced(cols, unplaced, layout) {
  const updates = [];
  for (const s of unplaced) {
    let ci = 0;
    for (let i = 1; i < cols.length; i++) if (cols[i].length < cols[ci].length) ci = i;
    const last = cols[ci][cols[ci].length - 1];
    const order = last ? layout[last.id].order + 1 : 0;
    layout[s.id] = { col: ci, order };
    cols[ci].push(s);
    updates.push({ id: s.id, col: ci, order });
  }
  return updates;
}

export function orderFor(ids, index, layout) {
  const prev = ids[index - 1] && layout[ids[index - 1]];
  const next = ids[index] && layout[ids[index]];
  if (!prev && !next) return 0;
  if (!prev) return next.order - 1;
  if (!next) return prev.order + 1;
  return (prev.order + next.order) / 2;
}

export function dropIndex(midYs, y) {
  let i = 0;
  while (i < midYs.length && midYs[i] < y) i++;
  return i;
}

export function columnAt(rects, x) {
  let best = 0;
  let bestD = Infinity;
  rects.forEach((r, i) => {
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

export function effectiveColumnBounds({ nMin, nMax, count }) {
  const hi = Math.max(1, Math.min(nMax, count == null ? nMax : count));
  return { nMin: Math.min(nMin, hi), nMax: hi };
}

export function chooseColumns({ nMin, nMax, total, H, w, memo, now, count, dwellMs = 3000, slack = 0.7, growMargin = 1.25 }) {
  ({ nMin, nMax } = effectiveColumnBounds({ nMin, nMax, count }));
  let n = nMax;
  for (let k = nMin; k <= nMax; k++) if (total <= k * H) { n = k; break; }
  if (memo && memo.w === w && n !== memo.n && memo.n >= nMin && memo.n <= nMax) {
    const calm = now - memo.t >= dwellMs;
    if (n < memo.n && !(calm && total <= n * H * slack)) n = memo.n;
    else if (n > memo.n && !calm && total <= memo.n * H * growMargin) n = memo.n;
  }
  const next = memo && memo.w === w && memo.n === n ? memo : { n, w, t: now };
  return { n, memo: next };
}
