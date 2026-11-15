import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradesToCsv } from '../extension/export.js';

const row = (extra = {}) => ({
  symbol: 'BTCUSDT', id: 7, order_id: 107, base: 'BTC', quote: 'USDT', price: '100.5', qty: '2',
  quote_qty: '201', commission: '0.002', commission_asset: 'BTC', time: Date.UTC(2026, 0, 5, 9, 7, 0), is_buyer: 1, is_maker: 0, ...extra,
});

test('tradesToCsv', () => {
  const lines = tradesToCsv([row(), row({ id: 8, is_buyer: 0 })]).trimEnd().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'time,symbol,side,price,qty,quote_qty,commission,commission_asset,trade_id,order_id');
  assert.equal(lines[1], '2026-01-05T09:07:00.000Z,BTCUSDT,BUY,100.5,2,201,0.002,BTC,7,107');
  assert.ok(lines[2].includes(',SELL,'));
});

test('tradesToCsv bọc nháy', () => {
  const csv = tradesToCsv([row({ commission_asset: 'A,"B' })]);
  assert.ok(csv.includes('"A,""B"'));
});
