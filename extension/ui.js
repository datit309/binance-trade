// DOM rendering only. State and behaviour live in dashboard.js.
import { fmtUsd, fmtSignedUsd, fmtPrice, fmtQty, fmtPct, fmtTime, fmtClock } from './format.js';

const $ = (id) => document.getElementById(id);

/** h('td', { class: 'left' }, 'text' | Node | [..]) — text is always set via textContent, never as HTML. */
function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [children].flat()) if (c != null) el.append(c);
  return el;
}

const tone = (n) => (n == null || Math.abs(n) < 0.005 ? '' : n > 0 ? 'up' : 'down');

const BADGES = {
  unknown: (r) => `${fmtQty(r.unknownQty)} không rõ giá vốn`,
  oversold: () => 'Thiếu lịch sử mua',
  unpriced: () => 'Có lệnh không quy đổi được',
  noprice: () => 'Không có giá USDT',
};
const EXPLAIN = {
  unknown: (r) => `${fmtQty(r.unknownQty)} ${r.asset} trong ví không có lệnh mua Spot tương ứng (nạp từ ngoài, Convert, Earn, P2P…). Giá trung bình chỉ tính trên phần mua qua Spot.`,
  oversold: () => 'Lịch sử có lệnh bán nhiều hơn số đã mua qua Spot. Một phần coin đến từ nguồn khác, nên lãi/lỗ đã chốt chỉ tính trên phần có giá mua.',
  unpriced: () => 'Có lệnh dùng cặp không quy đổi được sang USDT. Các lệnh đó bị bỏ khỏi giá vốn.',
  noprice: (r) => `Binance không có cặp ${r.asset}USDT nên không tính được giá trị hiện tại.`,
};
const SIDE = { BUY: 'Mua', SELL: 'Bán', FEE: 'Phí' };

const SORT_NULL_LAST = (a, b, key, dir) => {
  const x = a[key];
  const y = b[key];
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  const cmp = typeof x === 'string' ? x.localeCompare(y) : x - y;
  return dir === 'asc' ? cmp : -cmp;
};

export function visibleRows(state) {
  const q = state.query.trim().toUpperCase();
  return state.rows
    .filter((r) => !q || r.asset.includes(q))
    // "Small" means worth under 1 USDT. A coin with no price but a balance is never hidden.
    .filter((r) => !state.hideSmall || (r.value ?? (r.balance > 0 ? Infinity : 0)) >= 1)
    .sort((a, b) => SORT_NULL_LAST(a, b, state.sort.key, state.sort.dir));
}

const PALETTE = ['#f0b90b', '#4084ff', '#0ecb81', '#b083f0', '#ff8f40', '#39c5cf', '#f778ba'];
const OTHER = '#5b6470';

/** Sets r.alloc (% of portfolio value) on every row and returns asset -> colour for the largest holdings. */
function allocate(rows) {
  const total = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  for (const r of rows) r.alloc = total > 0 && r.value > 0 ? (r.value / total) * 100 : null;
  const ranked = rows.filter((r) => r.alloc != null).sort((a, b) => b.alloc - a.alloc);
  const colors = new Map(ranked.slice(0, PALETTE.length).map((r, i) => [r.asset, PALETTE[i]]));
  return { ranked, colors };
}

function renderAlloc({ ranked, colors }) {
  $('alloc').hidden = ranked.length === 0;
  const top = ranked.filter((r) => colors.has(r.asset));
  const rest = ranked.filter((r) => !colors.has(r.asset)).reduce((sum, r) => sum + r.alloc, 0);
  const parts = top.map((r) => ({ name: r.asset, pct: r.alloc, color: colors.get(r.asset) }));
  if (rest > 0) parts.push({ name: 'Khác', pct: rest, color: OTHER });
  $('alloc-bar').replaceChildren(...parts.map((p) =>
    h('i', { style: `width:${p.pct}%;background:${p.color}`, title: `${p.name} ${p.pct.toFixed(1)}%` })));
  $('alloc-legend').replaceChildren(...parts.map((p) => h('li', {}, [
    h('span', { class: 'dot', style: `background:${p.color}` }), h('b', {}, p.name), `${p.pct.toFixed(1)}%`,
  ])));
}

// Sub-1-USDT gaps are float/fee dust, not a real transfer out.
const movedOut = (r) => r.balance > 0 && r.movedOutQty * (r.price ?? 1) >= 1;
const dash = () => h('span', { class: 'zero' }, '—');
const flat = (n) => n == null || Math.abs(n) < 0.005;

const lastPrice = new Map(); // asset -> price at previous render, for the tick flash

function holdingRow(r, colors) {
  const prev = lastPrice.get(r.asset);
  const tick = prev == null || r.price == null || prev === r.price ? '' : r.price > prev ? 'tick-up' : 'tick-down';
  const color = colors.get(r.asset) ?? OTHER;
  const coin = h('div', { class: 'coin' }, [
    h('span', { class: 'dot', style: `background:${r.alloc == null ? 'transparent' : color}` }),
    h('b', {}, r.asset),
    ...r.warn.map((w) => h('span', { class: 'tag', title: EXPLAIN[w](r) }, BADGES[w](r))),
    movedOut(r)
      ? h('span', { class: 'tag plain', title: 'Đã rút hoặc chuyển sang Earn/Funding. Giá trung bình không đổi.' }, `chuyển ra ${fmtQty(r.movedOutQty)}`)
      : null,
  ]);
  const hasPnl = r.unrealized != null && r.knownQty > 0;
  const held = r.balance > 0;

  return h('tr', { tabindex: '0', 'data-asset': r.asset, 'aria-label': `Xem lệnh ${r.asset}` }, [
    h('td', { class: 'left' }, coin),
    h('td', { class: held ? '' : 'zero' }, fmtQty(r.balance)),
    h('td', {}, [
      h('span', { class: 'muted' }, r.avg == null ? '—' : fmtPrice(r.avg)),
      h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
      h('span', { class: 'now ' + tick }, r.price == null ? '—' : fmtPrice(r.price)),
    ]),
    h('td', {}, held && r.value != null ? fmtUsd(r.value) : dash()),
    h('td', { class: 'pnl ' + tone(r.unrealized) }, hasPnl ? fmtSignedUsd(r.unrealized) : dash()),
    h('td', {}, hasPnl ? h('span', { class: 'pill ' + tone(r.unrealized) }, fmtPct(r.unrealizedPct)) : dash()),
  ]);
}

function setStat(id, text, n, base = 'num') {
  const el = $(id);
  el.textContent = text;
  el.className = base + ' ' + tone(n);
}

export function render(state) {
  for (const s of ['setup', 'locked', 'main']) $('screen-' + s).hidden = state.screen !== s;
  if (state.screen === 'setup') {
    $('key-error').textContent = state.keyError ?? '';
    $('key-error').hidden = !state.keyError;
    $('key-submit').disabled = state.keyBusy;
    $('key-submit').textContent = state.keyBusy ? 'Đang kiểm tra key…' : 'Lưu và đồng bộ';
    $('key-cancel').hidden = !state.hasKey;
  }
  if (state.screen !== 'main') return;

  const syncing = state.sync != null;
  $('sync-status').textContent = syncing ? 'Đang đồng bộ'
    : state.lastSyncedAt ? `Đồng bộ lúc ${fmtClock(state.lastSyncedAt)}` : 'Chưa đồng bộ';
  $('sync-status').className = 'muted mono ' + (syncing ? 'busy' : state.lastSyncedAt ? '' : 'stale');
  $('live-status').textContent = state.live ? 'Giá trực tiếp' : 'Giá chưa trực tiếp';
  $('live-status').className = 'mono ' + (state.live ? 'on' : 'muted');
  $('btn-sync').textContent = syncing ? 'Dừng' : 'Đồng bộ';
  $('btn-sync').classList.toggle('primary', !syncing);
  $('btn-sync').disabled = state.demo || (syncing && state.sync.stopping);

  $('demo-banner').hidden = !state.demo;
  $('key-warning').hidden = !state.keyWarning;
  $('error').hidden = !state.error;
  $('error-text').textContent = state.error ?? '';
  $('error-retry').hidden = !state.retry;

  $('progress').hidden = !syncing;
  if (syncing) {
    const { phase, done, total, symbol, newTrades, stopping } = state.sync;
    $('progress-bar').value = total > 0 ? done / total : 0;
    $('progress-text').textContent =
      stopping ? 'Đang dừng…'
      : phase === 'prepare' ? 'Đang lấy danh sách cặp giao dịch…'
      : phase === 'prices' ? `Đang lấy giá quy đổi (${fmtQty(done)}/${fmtQty(total)})`
      : `Đang lấy lệnh ${symbol ?? ''} (${fmtQty(done)}/${fmtQty(total)}) · ${fmtQty(newTrades)} lệnh mới`;
  }

  const s = state.summary;
  setStat('stat-value', fmtUsd(s.value));
  setStat('stat-unrealized', fmtSignedUsd(s.unrealized), s.unrealized, 'num hero-pnl');
  setStat('stat-unrealized-pct', fmtPct(s.unrealizedPct), s.unrealized, 'pill big');
  setStat('stat-cost', fmtUsd(s.costHeld));
  setStat('stat-realized', fmtSignedUsd(s.realized), s.realized);
  setStat('stat-total', fmtSignedUsd(s.unrealized + s.realized), s.unrealized + s.realized);

  const allocation = allocate(state.rows);
  renderAlloc(allocation);

  $('search').value = state.query;
  $('hide-small').checked = state.hideSmall;
  for (const th of document.querySelectorAll('#holdings thead th')) {
    const key = th.querySelector('button').dataset.sort;
    if (key === state.sort.key) th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }

  const rows = visibleRows(state);
  $('row-count').textContent = state.rows.length ? `${rows.length}/${state.rows.length} coin` : '';
  const focused = document.activeElement?.closest?.('#holdings-body tr')?.dataset.asset;
  $('holdings-body').replaceChildren(...rows.map((r) => holdingRow(r, allocation.colors)));
  for (const r of state.rows) lastPrice.set(r.asset, r.price);
  // Live repaints rebuild the rows; keep keyboard focus where it was.
  if (focused) $('holdings-body').querySelector(`tr[data-asset="${CSS.escape(focused)}"]`)?.focus();
  $('holdings').hidden = rows.length === 0;
  $('empty').hidden = rows.length > 0;
  const noData = state.rows.length === 0;
  $('empty-text').textContent = noData
    ? 'Chưa có lệnh nào. Bấm Đồng bộ để lấy lịch sử từ Binance.'
    : 'Không có coin nào khớp.';
  $('empty-sync').hidden = !noData || syncing || state.demo;
}

// ---------- coin detail ----------

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

/** Fills against the average-cost line: where each buy/sell landed relative to cost basis and the current price. */
function priceChart(history, currentPrice) {
  const fills = history.filter((x) => x.side !== 'FEE' && x.qty > 0);
  if (fills.length < 2) return null;

  const W = 840, H = 210, L = 64, R = 14, T = 10, B = 22;
  const times = fills.map((x) => x.time);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times, t0 + 1);
  const values = [...fills.map((x) => x.price), ...history.filter((x) => x.qtyAfter > 0).map((x) => x.avgAfter)];
  if (currentPrice != null) values.push(currentPrice);
  let lo = Math.min(...values), hi = Math.max(...values);
  const padY = (hi - lo || hi || 1) * 0.08;
  lo -= padY; hi += padY;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Giá các lệnh mua bán so với giá trung bình' });
  for (const f of [0, 0.5, 1]) {
    const v = lo + padY + (hi - lo - 2 * padY) * f;
    svg.append(s('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }),
      s('text', { x: L - 8, y: y(v) + 3, 'text-anchor': 'end' }, fmtPrice(v)));
  }
  svg.append(s('text', { x: L, y: H - 6 }, fmtTime(t0).slice(0, 10)),
    s('text', { x: W - R, y: H - 6, 'text-anchor': 'end' }, fmtTime(t1).slice(0, 10)));

  if (currentPrice != null) {
    svg.append(s('line', { class: 'now', x1: L, x2: W - R, y1: y(currentPrice), y2: y(currentPrice) }));
  }

  // Average cost as a step line; it breaks whenever the position is fully closed.
  let d = '';
  let open = false;
  for (const p of history) {
    if (p.qtyAfter <= 0) { open = false; continue; }
    const px = x(Math.min(Math.max(p.time, t0), t1)).toFixed(1);
    const py = y(p.avgAfter).toFixed(1);
    d += open ? `H${px}V${py}` : `M${px},${py}`;
    open = true;
  }
  if (open) d += `H${W - R}`;
  if (d) svg.append(s('path', { class: 'avg', d }));

  for (const f of fills) {
    const dot = s('circle', { class: f.side === 'BUY' ? 'buy' : 'sell', cx: x(f.time).toFixed(1), cy: y(f.price).toFixed(1), r: 3.5 });
    dot.append(s('title', {}, `${SIDE[f.side]} ${fmtQty(f.qty)} @ ${fmtPrice(f.price)} · ${fmtTime(f.time)}`));
    svg.append(dot);
  }

  const key = (cls, label) => h('span', {}, [h('i', { class: 'key ' + cls }), label]);
  return [svg, h('figcaption', {}, [
    key('', 'Giá trung bình'), key('buy', 'Mua'), key('sell', 'Bán'),
    currentPrice != null ? key('now', `Giá hiện tại ${fmtPrice(currentPrice)}`) : null,
  ])];
}

export function showDetail(row, position) {
  $('detail-title').textContent = `${row.asset} · lịch sử lệnh Spot`;
  const hasPnl = row.unrealized != null && row.knownQty > 0;
  const stat = (label, value, n) => h('div', {}, [h('dt', {}, label), h('dd', { class: tone(n) }, value)]);
  $('detail-stats').replaceChildren(
    stat('Số lượng', fmtQty(row.balance)),
    stat('Giá trung bình', fmtPrice(row.avg)),
    stat('Giá hiện tại', fmtPrice(row.price)),
    stat('So với giá TB', hasPnl ? fmtPct(row.unrealizedPct) : '—', hasPnl ? row.unrealized : null),
    stat('Vốn đang giữ', row.costHeld > 0 ? fmtUsd(row.costHeld) : '—'),
    stat('Giá trị', row.balance > 0 ? fmtUsd(row.value) : '—'),
    stat('Lãi/lỗ chưa chốt', hasPnl ? fmtSignedUsd(row.unrealized) : '—', hasPnl ? row.unrealized : null),
    stat('Lãi/lỗ đã chốt', fmtSignedUsd(row.realized), row.realized),
  );

  const notes = row.warn.map((w) => h('li', {}, EXPLAIN[w](row)));
  if (movedOut(row)) {
    notes.push(h('li', { class: 'plain' },
      `Đã chuyển ${fmtQty(row.movedOutQty)} ${row.asset} ra khỏi ví Spot (rút, Earn, Funding). Giá trung bình không đổi.`));
  }
  $('detail-notes').replaceChildren(...notes);

  const chronological = position?.history ?? [];
  const chart = priceChart(chronological, row.price);
  $('detail-chart').hidden = !chart;
  $('detail-chart').replaceChildren(...(chart ?? []));

  const history = [...chronological].reverse();
  $('history-body').replaceChildren(...(history.length
    ? history.map((x) => h('tr', {}, [
        h('td', { class: 'left' }, fmtTime(x.time)),
        h('td', { class: 'left' }, x.symbol),
        h('td', { class: 'left side-' + x.side }, SIDE[x.side]),
        h('td', {}, fmtPrice(x.price)),
        h('td', {}, fmtQty(x.qty)),
        h('td', { class: 'muted' }, x.fee > 0 ? `${fmtQty(x.fee)} ${x.feeAsset}` : '—'),
        h('td', {}, x.qtyAfter > 0 ? fmtPrice(x.avgAfter) : '—'),
      ]))
    : [h('tr', {}, h('td', { class: 'left muted', colspan: '7' }, 'Chưa có lệnh Spot nào cho coin này.'))]));

  $('detail').showModal();
  $('detail').querySelector('.dialog-body').scrollTop = 0;
}

export function renderSettings({ apiKeyMasked, extraAssets, extraError, demo }) {
  $('key-masked').textContent = apiKeyMasked;
  $('extra-error').textContent = extraError ?? '';
  $('extra-error').hidden = !extraError;
  $('extra-list').replaceChildren(...extraAssets.map((a) =>
    h('li', {}, [a, h('button', { type: 'button', 'data-remove-extra': a, 'aria-label': `Bỏ ${a}` }, '×')])));
  for (const id of ['key-change', 'key-remove', 'scan-full', 'export-sqlite', 'export-csv', 'wipe']) $(id).disabled = demo;
  $('extra-form').querySelector('button').disabled = demo;
}

/** Promise<boolean>. Native <dialog>, so Esc cancels and focus is trapped for free. */
export function askConfirm(text, okLabel, { danger = false } = {}) {
  const dlg = $('confirm');
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  $('confirm-ok').className = 'btn ' + (danger ? 'danger' : 'primary');
  dlg.returnValue = 'cancel';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}
