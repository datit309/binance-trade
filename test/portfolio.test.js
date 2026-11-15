import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, summarize } from '../extension/portfolio.js';

const position = (asset, qty, cost, extra = {}) => ({
  asset, qty, cost, avg: qty > 0 ? cost / qty : 0, realized: 0,
  oversold: false, unpriced: false, history: [], ...extra,
});
const row = (positions, balances, tickers, asset) =>
  buildRows(positions, balances, tickers).find((r) => r.asset === asset);
const check = (actual, want) => {
  for (const [k, v] of Object.entries(want)) {
    if (typeof v === 'number') assert.ok(Math.abs(actual[k] - v) < 1e-9, `${k}: expected ${v}, got ${actual[k]}`);
    else assert.deepEqual(actual[k], v, k);
  }
};

test('khớp hoàn toàn', () => {
  const r = row({ BTC: position('BTC', 1, 100) }, { BTC: 1 }, { BTCUSDT: 150 }, 'BTC');
  check(r, {
    balance: 1, avg: 100, price: 150, value: 150, knownQty: 1, costHeld: 100,
    unrealized: 50, unrealizedPct: 50, warn: [],
  });
});

test('số dư lớn hơn', () => {
  const r = row({ BTC: position('BTC', 1, 100) }, { BTC: 3 }, { BTCUSDT: 150 }, 'BTC');
  check(r, { value: 450, knownQty: 1, costHeld: 100, unrealized: 50, unknownQty: 2, warn: ['unknown'] });
});

test('chênh lệch bụi', () => {
  const r = row({ BTC: position('BTC', 1, 100) }, { BTC: 1.000001 }, { BTCUSDT: 150 }, 'BTC');
  check(r, { warn: [] });
});

test('số dư nhỏ hơn', () => {
  const r = row({ BTC: position('BTC', 3, 300) }, { BTC: 1 }, { BTCUSDT: 150 }, 'BTC');
  check(r, { knownQty: 1, costHeld: 100, unrealized: 50, movedOutQty: 2, warn: [] });
});

test('không có giá', () => {
  const r = row({ ALT: position('ALT', 5, 10) }, { ALT: 5 }, {}, 'ALT');
  check(r, { price: null, value: null, unrealized: null, warn: ['noprice'] });
});

test('có số dư, không có lệnh', () => {
  const r = row({}, { ARB: 10 }, { ARBUSDT: 1 }, 'ARB');
  check(r, { avg: null, knownQty: 0, unknownQty: 10, warn: ['unknown'] });
});

test('bỏ stablecoin', () => {
  assert.deepEqual(buildRows({}, { USDT: 500 }, {}), []);
});

test('đã bán hết', () => {
  const r = row({ BTC: position('BTC', 0, 0, { realized: 30 }) }, {}, { BTCUSDT: 150 }, 'BTC');
  check(r, { balance: 0, realized: 30 });
});

test('cờ từ vị thế', () => {
  const r = row({ ALT: position('ALT', 1, 1, { oversold: true, unpriced: true }) }, { ALT: 1 }, { ALTUSDT: 1 }, 'ALT');
  check(r, { warn: ['oversold', 'unpriced'] });
});

test('sắp xếp theo giá trị giảm dần, null cuối', () => {
  const rows = buildRows({}, { A: 1, B: 1, C: 1 }, { AUSDT: 5, CUSDT: 9 });
  assert.deepEqual(rows.map((r) => r.asset), ['C', 'A', 'B']);
});

test('tổng', () => {
  const rows = buildRows(
    { BTC: position('BTC', 1, 100), ETH: position('ETH', 0, 0, { realized: 30 }) },
    { BTC: 1 }, { BTCUSDT: 150 });
  check(summarize(rows), { costHeld: 100, value: 150, unrealized: 50, unrealizedPct: 50, realized: 30 });
});
