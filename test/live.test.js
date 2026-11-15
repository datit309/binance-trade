import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTicker } from '../extension/live.js';

function harness() {
  const sockets = [];
  const timers = [];
  class FakeWS {
    constructor(url) { this.url = url; this.closed = false; sockets.push(this); }
    close() { this.closed = true; this.onclose?.(); }
  }
  return { sockets, timers, WebSocketImpl: FakeWS, setTimer: (fn, ms) => timers.push({ fn, ms }) };
}

test('mở một kết nối gộp cho mọi cặp', () => {
  const h = harness();
  openTicker({ symbols: ['BTCUSDT', 'ETHUSDT'], onPrice() {}, ...h });
  assert.equal(h.sockets.length, 1);
  assert.equal(h.sockets[0].url, 'wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker/ethusdt@miniTicker');
});

test('không có cặp nào thì không mở kết nối', () => {
  const h = harness();
  openTicker({ symbols: [], onPrice() {}, ...h });
  assert.equal(h.sockets.length, 0);
});

test('đọc giá và bỏ qua tin rác', () => {
  const h = harness();
  const got = [];
  openTicker({ symbols: ['BTCUSDT'], onPrice: (s, p, open) => got.push([s, p, open]), ...h });
  const ws = h.sockets[0];
  ws.onmessage({ data: JSON.stringify({ stream: 'btcusdt@miniTicker', data: { s: 'BTCUSDT', c: '67450.10', o: '66000' } }) });
  ws.onmessage({ data: 'not json' });
  ws.onmessage({ data: JSON.stringify({ result: null, id: 1 }) });
  ws.onmessage({ data: JSON.stringify({ data: { s: 'BTCUSDT', c: 'abc' } }) });
  assert.deepEqual(got, [['BTCUSDT', 67450.1, 66000]]);
});

test('báo trạng thái và tự nối lại khi rớt', () => {
  const h = harness();
  const status = [];
  openTicker({ symbols: ['BTCUSDT'], onPrice() {}, onStatus: (s) => status.push(s), retryMs: 3000, ...h });
  h.sockets[0].onopen();
  h.sockets[0].onclose();
  assert.deepEqual(status, [true, false]);
  assert.equal(h.timers.at(-1).ms, 3000);
  h.timers.at(-1).fn();
  assert.equal(h.sockets.length, 2);
});

test('close() dừng hẳn, không nối lại', () => {
  const h = harness();
  const t = openTicker({ symbols: ['BTCUSDT'], onPrice() {}, ...h });
  t.close();
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.timers.length, 0);
});
