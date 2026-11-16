import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleRows, historyRow, holdingRow, movedOut } from '../extension/ui.js';

const baseState = {
  query: '',
  hideSmall: true,
  holdingsFilter: 'all',
  sort: { key: 'value', dir: 'desc' },
  ordersSummary: { byAsset: { BTC: [{ orderId: 1 }] } },
  rows: [
    { asset: 'BTC', balance: 0.1, value: 6500, warn: [] },
    { asset: 'ARB', balance: 100, value: 70, warn: ['unknown'] },
    { asset: 'DUST', balance: 0.1, value: 0.5, warn: [] },
    { asset: 'NOPRICE', balance: 10, value: null, warn: ['noprice'] },
  ],
};

test('visibleRows lọc theo holdingsFilter warn và orders', () => {
  assert.deepEqual(visibleRows(baseState).map((r) => r.asset), ['BTC', 'ARB', 'NOPRICE']);
  assert.deepEqual(
    visibleRows({ ...baseState, holdingsFilter: 'warn' }).map((r) => r.asset),
    ['ARB', 'NOPRICE'],
  );
  assert.deepEqual(
    visibleRows({ ...baseState, holdingsFilter: 'orders' }).map((r) => r.asset),
    ['BTC'],
  );
});

test('visibleRows lọc theo query không phân biệt hoa thường và khoảng trắng thừa', () => {
  assert.deepEqual(
    visibleRows({ ...baseState, query: '  ar  ' }).map((r) => r.asset),
    ['ARB'],
  );
});

test('visibleRows xử lý ordersSummary hoặc byAsset khuyết', () => {
  assert.deepEqual(
    visibleRows({ ...baseState, ordersSummary: null, holdingsFilter: 'orders' }).map((r) => r.asset),
    [],
  );
  assert.deepEqual(
    visibleRows({ ...baseState, ordersSummary: {}, holdingsFilter: 'orders' }).map((r) => r.asset),
    [],
  );
});

test('visibleRows giữ lại dust coin khi hideSmall = false', () => {
  assert.deepEqual(
    visibleRows({ ...baseState, hideSmall: false }).map((r) => r.asset),
    ['BTC', 'ARB', 'DUST', 'NOPRICE'],
  );
});

test('visibleRows sort theo key và dir với null xếp cuối cùng', () => {
  const sortedAsc = visibleRows({ ...baseState, sort: { key: 'value', dir: 'asc' } });
  assert.deepEqual(sortedAsc.map((r) => r.asset), ['ARB', 'BTC', 'NOPRICE']);
});

test('historyRow hiển thị lệnh unpriced chuẩn xác', () => {
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => ({
      tag,
      setAttribute() {},
      children: [],
      append(...items) { this.children.push(...items); },
    }),
  };
  try {
    const tr = {
      time: 1700000000000,
      symbol: 'ALTXYZ',
      side: 'BUY',
      qty: 10,
      price: 0,
      fee: 0,
      feeAsset: 'XYZ',
      unpriced: true,
    };
    const row = historyRow(tr);
    assert.equal(row.children[3].children[0], '—');
    assert.equal(row.children[6].children[0], '— (chưa có giá)');
  } finally {
    if (prevDoc) globalThis.document = prevDoc;
    else delete globalThis.document;
  }
});

test('movedOut nhận diện cả khi balance = 0 nhưng movedOutQty > 0', () => {
  assert.equal(movedOut({ balance: 0, movedOutQty: 1, price: 100 }), true);
  assert.equal(movedOut({ balance: 0, movedOutQty: 0, price: 100 }), false);
});

test('holdingRow hiển thị thông tin Earn ước tính khi balance = 0 và qty > 0', () => {
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => ({
      tag,
      setAttribute() {},
      children: [],
      append(...items) { this.children.push(...items); },
    }),
  };
  try {
    const r = {
      asset: 'BTC',
      balance: 0,
      qty: 1,
      avg: 60000,
      price: 90000,
      value: 0,
      knownQty: 0,
      costHeld: 0,
      unrealized: null,
      unrealizedPct: null,
      movedOutQty: 1,
      movedOutCost: 60000,
      movedOutValue: 90000,
      movedOutUnrealized: 30000,
      movedOutUnrealizedPct: 50,
      warn: [],
      realized: 0,
    };
    const rowEl = holdingRow(r, { balancesDetail: {}, ordersSummary: {}, open24h: {} }, new Map());
    // Cột số lượng (td 1) phải chứa text Earn
    const balanceCell = rowEl.children[1];
    assert.ok(balanceCell.children[0].children[1].children[0].includes('Earn: 1'));

    // Cột giá trị (td 3) không được là dash() mà phải là giá trị ước tính
    const valueCell = rowEl.children[3];
    assert.ok(valueCell.children[0].children[0].children[0].includes('90,000'));

    // Cột lãi/lỗ (td 4) phải hiển thị lãi ước tính
    const pnlCell = rowEl.children[4];
    assert.ok(pnlCell.children[0].children[0].children[0].includes('30,000'));
  } finally {
    if (prevDoc) globalThis.document = prevDoc;
    else delete globalThis.document;
  }
});
