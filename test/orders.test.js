import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSymbolPair,
  sortNullLast,
  buildOpenOrders,
  summarizeOpenOrders,
  visibleOrders,
} from '../extension/orders.js';

const EX = [
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' },
  { symbol: 'ETHBTC', base: 'ETH', quote: 'BTC' },
  { symbol: 'SOLUSDC', base: 'SOL', quote: 'USDC' },
  { symbol: 'SOLEUR', base: 'SOL', quote: 'EUR' },
];

const approx = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ''}: expected ${expected}, got ${actual}`);

test('buildOpenOrders tính đúng distancePct, fillPct, OCO và quy đổi USDT', () => {
  const raw = [
    {
      symbol: 'BTCUSDT', orderId: 1, orderListId: -1, side: 'BUY', type: 'LIMIT',
      price: '60000', stopPrice: '0', origQty: '0.5', executedQty: '0.1',
      status: 'PARTIALLY_FILLED', time: 1700000100000, updateTime: 1700000200000,
    },
    {
      symbol: 'ETHBTC', orderId: 2, orderListId: 99, side: 'SELL', type: 'STOP_LOSS_LIMIT',
      price: '0.05', stopPrice: '0.048', origQty: '4', executedQty: '0',
      status: 'NEW', time: 1700000300000, updateTime: 1700000300000,
    },
    {
      symbol: 'SOLEUR', orderId: 3, orderListId: -1, side: 'SELL', type: 'LIMIT',
      price: '120', stopPrice: '0', origQty: '2', executedQty: '0',
      status: 'NEW', time: 1700000400000, updateTime: 1700000400000,
    },
  ];
  const tickers = { BTCUSDT: 75000, ETHBTC: 0.04, SOLEUR: 110, USDTEUR: 0.9 };
  const out = buildOpenOrders(raw, EX, tickers);

  assert.equal(out.length, 3);
  assert.equal(out[0].base, 'BTC');
  assert.equal(out[0].quote, 'USDT');
  assert.equal(out[0].isOco, false);
  approx(out[0].remainingQty, 0.4);
  approx(out[0].fillPct, 20);
  approx(out[0].distancePct, -20); // (60000 - 75000) / 75000 * 100
  approx(out[0].remainingValueUsdt, 24000);

  assert.equal(out[1].base, 'ETH');
  assert.equal(out[1].quote, 'BTC');
  assert.equal(out[1].isOco, true);
  assert.equal(out[1].stopPrice, 0.048);
  approx(out[1].distancePct, 25); // (0.05 - 0.04) / 0.04 * 100
  approx(out[1].remainingValueUsdt, 4 * 0.05 * 75000); // 15000 USDT

  approx(out[2].remainingValueUsdt, (2 * 120) / 0.9); // inverse fiat quote
});

test('buildOpenOrders xử lý fallback cặp lạ, giá = 0 và thiếu ticker', () => {
  const raw = [
    { symbol: 'DOGEUSDT', orderId: 10, orderListId: -1, side: 'BUY', type: 'MARKET', price: '0', stopPrice: '0', origQty: '100', executedQty: '0', status: 'NEW', time: 1000 },
    { symbol: 'XYZABC', orderId: 11, orderListId: -1, side: 'SELL', type: 'LIMIT', price: '10', stopPrice: '0', origQty: '5', executedQty: '0', status: 'NEW', time: 2000 },
  ];
  const out = buildOpenOrders(raw, [], { DOGEUSDT: 0.15 });
  assert.equal(out[0].base, 'DOGE');
  assert.equal(out[0].quote, 'USDT');
  assert.equal(out[0].distancePct, null);
  assert.equal(out[0].remainingValueUsdt, 0);

  assert.equal(out[1].base, 'XYZABC');
  assert.equal(out[1].quote, '');
  assert.equal(out[1].marketPrice, null);
  assert.equal(out[1].distancePct, null);
  assert.equal(out[1].remainingValueUsdt, null);
});

test('summarizeOpenOrders tổng hợp đếm lệnh, giá trị khóa và nhóm byAsset', () => {
  const orders = buildOpenOrders([
    { symbol: 'BTCUSDT', orderId: 1, orderListId: -1, side: 'BUY', type: 'LIMIT', price: '60000', stopPrice: '0', origQty: '0.1', executedQty: '0', status: 'NEW', time: 10 },
    { symbol: 'BTCUSDT', orderId: 2, orderListId: -1, side: 'SELL', type: 'LIMIT', price: '75000', stopPrice: '0', origQty: '0.2', executedQty: '0.1', status: 'PARTIALLY_FILLED', time: 20 },
    { symbol: 'SOLUSDC', orderId: 3, orderListId: -1, side: 'BUY', type: 'LIMIT', price: '100', stopPrice: '0', origQty: '5', executedQty: '0', status: 'NEW', time: 30 },
  ], EX, { BTCUSDT: 65000, SOLUSDC: 120 });

  const s = summarizeOpenOrders(orders);
  assert.equal(s.totalCount, 3);
  assert.equal(s.buyCount, 2);
  assert.equal(s.sellCount, 1);
  approx(s.buyValueUsdt, 6500);
  approx(s.sellValueUsdt, 7500);
  approx(s.totalLockedUsdt, 14000);
  assert.equal(s.byAsset.BTC.length, 2);
  assert.equal(s.byAsset.SOL.length, 1);
});

test('visibleOrders lọc theo query, side, typeFilter và sort đúng', () => {
  const orders = buildOpenOrders([
    { symbol: 'BTCUSDT', orderId: 1, orderListId: -1, side: 'BUY', type: 'LIMIT', price: '60000', stopPrice: '0', origQty: '0.1', executedQty: '0', status: 'NEW', time: 10 },
    { symbol: 'ETHBTC', orderId: 2, orderListId: 42, side: 'SELL', type: 'STOP_LOSS_LIMIT', price: '0.05', stopPrice: '0.048', origQty: '2', executedQty: '0', status: 'NEW', time: 30 },
    { symbol: 'SOLUSDC', orderId: 3, orderListId: -1, side: 'SELL', type: 'LIMIT_MAKER', price: '150', stopPrice: '0', origQty: '4', executedQty: '0', status: 'NEW', time: 20 },
  ], EX, { BTCUSDT: 65000, ETHBTC: 0.04, SOLUSDC: 130 });

  assert.deepEqual(
    visibleOrders(orders, { query: 'btc', side: 'ALL', typeFilter: 'ALL', sort: { key: 'time', dir: 'desc' } }).map((o) => o.orderId),
    [2, 1],
  );
  assert.deepEqual(
    visibleOrders(orders, { query: '', side: 'SELL', typeFilter: 'STOP', sort: { key: 'time', dir: 'asc' } }).map((o) => o.orderId),
    [2],
  );
  assert.deepEqual(
    visibleOrders(orders, { query: '', side: 'SELL', typeFilter: 'LIMIT', sort: { key: 'time', dir: 'asc' } }).map((o) => o.orderId),
    [3],
  );
});

test('sortNullLast sắp xếp đúng thứ tự, null luôn ở cuối', () => {
  const items = [
    { val: 10, name: 'b' },
    { val: null, name: 'd' },
    { val: 5, name: 'a' },
    { val: undefined, name: 'c' },
  ];

  const sortedAscVal = [...items].sort((a, b) => sortNullLast(a, b, 'val', 'asc'));
  assert.deepEqual(sortedAscVal.map((x) => x.val), [5, 10, null, undefined]);

  const sortedDescVal = [...items].sort((a, b) => sortNullLast(a, b, 'val', 'desc'));
  assert.deepEqual(sortedDescVal.map((x) => x.val), [10, 5, null, undefined]);

  const sortedAscName = [...items].sort((a, b) => sortNullLast(a, b, 'name', 'asc'));
  assert.deepEqual(sortedAscName.map((x) => x.name), ['a', 'b', 'c', 'd']);

  const bothNull = sortNullLast({ val: null }, { val: null }, 'val', 'asc');
  assert.equal(bothNull, 0);
});

test('parseSymbolPair phân giải symbol từ exchangeMap và fallback', () => {
  const map = new Map([['BTCUSDT', { base: 'BTC', quote: 'USDT' }]]);
  assert.deepEqual(parseSymbolPair('BTCUSDT', map), { base: 'BTC', quote: 'USDT' });
  assert.deepEqual(parseSymbolPair('BNBUSDC', map), { base: 'BNB', quote: 'USDC' });
  assert.deepEqual(parseSymbolPair('UNKNOWN', map), { base: 'UNKNOWN', quote: '' });
});
