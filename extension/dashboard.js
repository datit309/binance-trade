// Page controller: owns state, wires events, runs sync. Rendering is in ui.js; logic modules are pure.
import { computePositions } from './cost.js';
import { buildRows, summarize } from './portfolio.js';
import { createClient } from './binance.js';
import { pickSymbols, estimateMinutes, syncTrades, syncPrices, makePriceAt, toTrade } from './sync.js';
import { tradesToCsv, download } from './export.js';
import { render, showDetail, renderSettings, askConfirm } from './ui.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  screen: 'main',
  demo: params.has('demo'),
  rows: [], summary: summarize([]), positions: {},
  sync: null, // { phase, done, total, symbol, newTrades, stopping }
  lastSyncedAt: null,
  error: null, retry: null,
  keyWarning: false, keyError: null, keyBusy: false, hasKey: false,
  hideSmall: true, query: '', sort: { key: 'value', dir: 'desc' },
  apiKey: '', extraAssets: [], extraError: null,
};

let db = null;
let api = null;
let exchange = null; // [{symbol, base, quote}], cached for the session
let balances = null;
let tickers = null;
let abort = null;
const store = globalThis.chrome?.storage?.local;

const update = () => render(state);

function setError(e, retry = null) {
  console.error(e);
  state.error = e?.kind ? e.message : `Có lỗi xảy ra: ${e?.message ?? e}`;
  state.retry = retry;
}

function recompute(tradeRows, priceRows) {
  state.positions = computePositions(tradeRows.map(toTrade), makePriceAt(priceRows));
  // Without live balances (offline), fall back to what the trade history says is held.
  const held = balances ?? Object.fromEntries(
    Object.values(state.positions).filter((p) => p.qty > 0).map((p) => [p.asset, p.qty]));
  state.rows = buildRows(state.positions, held, tickers ?? {});
  state.summary = summarize(state.rows);
}

async function refresh() {
  const [tradeRows, priceRows] = await Promise.all([db.allTrades(), db.getPrices()]);
  try {
    [balances, tickers] = await Promise.all([api.account(), api.tickerPrices()]);
  } catch (e) {
    setError(e, refresh);
  }
  recompute(tradeRows, priceRows);
  update();
}

async function getExchange() {
  exchange ??= await api.exchangeInfo();
  return exchange;
}

async function runSync(full) {
  if (state.sync) return;
  abort = new AbortController();
  const { signal } = abort;
  state.error = null;
  state.sync = { phase: 'prepare', done: 0, total: 0, symbol: null, newTrades: 0, stopping: false };
  update();
  const onProgress = (p) => {
    state.sync = { ...p, stopping: state.sync.stopping };
    update();
  };

  try {
    const exchangeSymbols = await getExchange();
    const held = await api.account();
    const cursors = await db.getCursors();
    const symbols = pickSymbols({
      exchangeSymbols,
      balances: held,
      knownSymbols: cursors.filter((c) => c.last_trade_id != null).map((c) => c.symbol),
      extraAssets: state.extraAssets,
      full,
    });
    await syncTrades({ api, db, symbols, onProgress, signal });
    if (!signal.aborted) {
      const trades = (await db.allTrades()).map(toTrade);
      await syncPrices({ api, db, trades, exchangeSymbols, onProgress, signal });
    }
    if (!signal.aborted) {
      state.lastSyncedAt = Date.now();
      await store.set({ lastSyncedAt: state.lastSyncedAt });
    }
  } catch (e) {
    setError(e, () => runSync(full));
  } finally {
    state.sync = null;
    abort = null;
  }
  await refresh();
}

// ---------- key ----------

async function saveKey(apiKey, secret) {
  if (!apiKey || !secret) {
    state.keyError = 'Nhập đủ API Key và Secret Key.';
    return update();
  }
  state.keyBusy = true;
  state.keyError = null;
  update();

  const candidate = createClient({ apiKey, secret });
  try {
    await candidate.account(); // proves the key works before anything is stored
  } catch (e) {
    state.keyBusy = false;
    state.keyError = e.kind ? e.message : `Có lỗi xảy ra: ${e.message}`;
    return update();
  }

  let risky = false;
  try {
    const r = await candidate.apiRestrictions();
    risky = r.canTrade || r.canWithdraw;
  } catch {
    // Permission lookup is advisory; never block on it.
  }

  await store.set({ apiKey, secret, keyRisky: risky });
  api = candidate;
  exchange = null;
  Object.assign(state, {
    apiKey, hasKey: true, keyBusy: false, keyWarning: risky, screen: 'main', error: null,
  });
  $('key-form').reset();
  update();
  await runSync(false);
}

async function removeKey() {
  const ok = await askConfirm('Xóa API key khỏi máy này? Lịch sử lệnh đã lưu vẫn được giữ.', 'Xóa key', { danger: true });
  if (!ok) return;
  abort?.abort();
  await store.remove(['apiKey', 'secret', 'keyRisky']);
  api = null;
  balances = tickers = null;
  Object.assign(state, { apiKey: '', hasKey: false, keyWarning: false, screen: 'setup', keyError: null });
  $('settings').close();
  update();
}

// ---------- settings ----------

const settingsView = () => renderSettings({
  apiKeyMasked: state.apiKey ? '••••••••' + state.apiKey.slice(-4) : 'Dữ liệu mẫu',
  extraAssets: state.extraAssets, extraError: state.extraError, demo: state.demo,
});

async function scanFull() {
  try {
    const n = (await getExchange()).length;
    const ok = await askConfirm(
      `Quét toàn bộ ${n.toLocaleString('en-US')} cặp trên Binance, mất khoảng ${estimateMinutes(n)} phút. ` +
      'Giữ tab này mở trong lúc quét; nếu đóng, lần sau sẽ chạy tiếp từ chỗ dừng.', 'Quét toàn bộ');
    if (!ok) return;
    $('settings').close();
    await runSync(true);
  } catch (e) {
    $('settings').close();
    setError(e, scanFull);
    update();
  }
}

async function addExtra(raw) {
  const asset = raw.trim().toUpperCase();
  if (!asset) return;
  state.extraError = null;
  try {
    const known = (await getExchange()).some((s) => s.base === asset);
    if (!known) state.extraError = 'Không tìm thấy coin này trên Binance Spot.';
    else if (!state.extraAssets.includes(asset)) {
      state.extraAssets = [...state.extraAssets, asset];
      await store.set({ extraAssets: state.extraAssets });
    }
  } catch (e) {
    state.extraError = e.kind ? e.message : `Có lỗi xảy ra: ${e.message}`;
  }
  if (!state.extraError) $('extra-asset').value = '';
  settingsView();
}

async function wipe() {
  const ok = await askConfirm(
    'Xóa toàn bộ lịch sử lệnh đã lưu trên máy này? API key được giữ lại. Bạn có thể đồng bộ lại từ Binance bất cứ lúc nào.',
    'Xóa dữ liệu', { danger: true });
  if (!ok) return;
  await db.wipe();
  await store.remove('lastSyncedAt');
  state.lastSyncedAt = null;
  $('settings').close();
  await refresh();
}

// ---------- events ----------

function openDetail(tr) {
  const row = state.rows.find((r) => r.asset === tr.dataset.asset);
  if (row) showDetail(row, state.positions[row.asset]);
}

function wire() {
  $('key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveKey($('api-key').value.trim(), $('api-secret').value.trim());
  });
  $('key-cancel').addEventListener('click', () => { state.screen = 'main'; state.keyError = null; update(); });
  $('locked-retry').addEventListener('click', () => location.reload());

  $('btn-sync').addEventListener('click', () => {
    if (state.sync) {
      state.sync.stopping = true;
      abort?.abort();
      update();
    } else {
      runSync(false);
    }
  });
  $('empty-sync').addEventListener('click', () => runSync(false));
  $('error-retry').addEventListener('click', () => {
    const retry = state.retry;
    state.error = state.retry = null;
    update();
    retry?.();
  });
  document.addEventListener('click', (e) => {
    const dismiss = e.target.closest('[data-dismiss]')?.dataset.dismiss;
    if (dismiss === 'error') state.error = state.retry = null;
    if (dismiss === 'key-warning') {
      state.keyWarning = false;
      store?.set({ keyRisky: false });
    }
    if (dismiss) update();

    if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
    if (e.target instanceof HTMLDialogElement && e.target.id !== 'confirm') e.target.close(); // backdrop click
  });

  $('search').addEventListener('input', (e) => { state.query = e.target.value; update(); });
  $('hide-small').addEventListener('change', (e) => {
    state.hideSmall = e.target.checked;
    store?.set({ hideSmall: state.hideSmall });
    update();
  });
  $('holdings').querySelector('thead').addEventListener('click', (e) => {
    const key = e.target.closest('button')?.dataset.sort;
    if (!key) return;
    const same = state.sort.key === key;
    state.sort = { key, dir: same ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : key === 'asset' ? 'asc' : 'desc' };
    update();
  });
  $('holdings-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (tr) openDetail(tr);
  });
  $('holdings-body').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr')) {
      e.preventDefault();
      openDetail(e.target);
    }
  });

  $('btn-settings').addEventListener('click', () => {
    state.extraError = null;
    settingsView();
    $('settings').showModal();
  });
  $('key-change').addEventListener('click', () => {
    $('settings').close();
    state.screen = 'setup';
    update();
    $('api-key').focus();
  });
  $('key-remove').addEventListener('click', removeKey);
  $('scan-full').addEventListener('click', scanFull);
  $('extra-form').addEventListener('submit', (e) => { e.preventDefault(); addExtra($('extra-asset').value); });
  $('extra-list').addEventListener('click', async (e) => {
    const asset = e.target.dataset.removeExtra;
    if (!asset) return;
    state.extraAssets = state.extraAssets.filter((a) => a !== asset);
    await store.set({ extraAssets: state.extraAssets });
    settingsView();
  });
  $('export-sqlite').addEventListener('click', async () =>
    download('binance-spot.sqlite3', await db.exportFile(), 'application/vnd.sqlite3'));
  $('export-csv').addEventListener('click', async () =>
    download('binance-spot-trades.csv', tradesToCsv(await db.allTrades()), 'text/csv'));
  $('wipe').addEventListener('click', wipe);

  window.addEventListener('beforeunload', (e) => { if (state.sync && !state.demo) e.preventDefault(); });
}

// ---------- boot ----------

async function bootDemo() {
  const { demo } = await import('./demo-data.js');
  balances = demo.balances;
  tickers = demo.tickers;
  state.lastSyncedAt = demo.lastSyncedAt;
  recompute(demo.rows, demo.priceRows);

  const view = params.get('state');
  if (view === 'setup' || view === 'locked') state.screen = view;
  if (view === 'syncing') state.sync = { phase: 'trades', done: 12, total: 140, symbol: 'BTCUSDT', newTrades: 3204, stopping: false };
  if (view === 'error') state.error = 'Không kết nối được tới Binance. Kiểm tra mạng rồi thử lại.';
  if (view === 'empty') {
    state.rows = [];
    state.summary = summarize([]);
    state.lastSyncedAt = null;
  }
  update();
}

async function boot() {
  wire();
  if (state.demo) return bootDemo();

  try {
    const { openDb } = await import('./db.js');
    db = await openDb();
  } catch (e) {
    if (e.code === 'LOCKED') state.screen = 'locked';
    else setError(new Error(`không mở được cơ sở dữ liệu (${e.message})`));
    return update();
  }

  const saved = await store.get(['apiKey', 'secret', 'keyRisky', 'extraAssets', 'lastSyncedAt', 'hideSmall']);
  state.extraAssets = saved.extraAssets ?? [];
  state.lastSyncedAt = saved.lastSyncedAt ?? null;
  state.hideSmall = saved.hideSmall ?? true;

  if (!saved.apiKey || !saved.secret) {
    state.screen = 'setup';
    return update();
  }
  api = createClient({ apiKey: saved.apiKey, secret: saved.secret });
  Object.assign(state, { apiKey: saved.apiKey, hasKey: true, keyWarning: Boolean(saved.keyRisky) });
  await refresh();
}

boot();
