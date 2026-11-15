import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, createClient, BinanceError } from '../extension/binance.js';

const NOW = 1_700_000_000_000;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

// handler(url, init, callIndexForThatPath) -> Response | throws
function setup(handlers, { serverTime = NOW } = {}) {
  const calls = [];
  const sleeps = [];
  const counts = {};
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url, path: u.pathname, params: u.searchParams, headers: init.headers ?? {} });
    counts[u.pathname] = (counts[u.pathname] ?? 0) + 1;
    if (u.pathname === '/api/v3/time' && !handlers[u.pathname]) return json({ serverTime });
    return handlers[u.pathname](u, init, counts[u.pathname]);
  };
  const client = createClient({
    apiKey: 'KEY', secret: 'SECRET', fetch, now: () => NOW,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { client, calls, sleeps, of: (path) => calls.filter((c) => c.path === path) };
}

test('sign: vector của Binance', async () => {
  const sig = await sign(
    'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j',
    'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559');
  assert.equal(sig, 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
});

test('request có ký', async () => {
  const s = setup({ '/api/v3/myTrades': () => json([{ id: 5 }]) });
  assert.deepEqual(await s.client.myTrades('BTCUSDT', 5), [{ id: 5 }]);
  const [c] = s.of('/api/v3/myTrades');
  assert.ok(c.url.startsWith('https://api.binance.com/api/v3/myTrades?'));
  assert.equal(c.params.get('symbol'), 'BTCUSDT');
  assert.equal(c.params.get('fromId'), '5');
  assert.equal(c.params.get('limit'), '1000');
  assert.ok(c.params.get('timestamp'));
  assert.match(c.params.get('signature'), /^[0-9a-f]{64}$/);
  assert.equal(c.headers['X-MBX-APIKEY'], 'KEY');
  // signature covers exactly the query string before it
  const qs = c.url.split('?')[1];
  const unsigned = qs.slice(0, qs.lastIndexOf('&signature='));
  assert.equal(c.params.get('signature'), await sign('SECRET', unsigned));
});

test('request công khai không ký', async () => {
  const s = setup({ '/api/v3/ticker/price': () => json([{ symbol: 'BTCUSDT', price: '67450.10' }]) });
  assert.deepEqual(await s.client.tickerPrices(), { BTCUSDT: 67450.1 });
  const [c] = s.of('/api/v3/ticker/price');
  assert.equal(c.params.get('signature'), null);
  assert.equal(c.headers['X-MBX-APIKEY'], undefined);
  assert.equal(s.of('/api/v3/time').length, 0);
});

test('lệch giờ', async () => {
  const s = setup({ '/api/v3/myTrades': () => json([]) }, { serverTime: NOW + 5000 });
  await s.client.myTrades('BTCUSDT', 0);
  await s.client.myTrades('BTCUSDT', 0);
  assert.equal(s.of('/api/v3/myTrades')[0].params.get('timestamp'), String(NOW + 5000));
  assert.equal(s.of('/api/v3/time').length, 1);
});

test('-1021 tự sửa', async () => {
  const s = setup({
    '/api/v3/myTrades': (u, i, n) => (n === 1 ? json({ code: -1021, msg: 'Timestamp' }, 400) : json([{ id: 1 }])),
  });
  assert.deepEqual(await s.client.myTrades('BTCUSDT', 0), [{ id: 1 }]);
  assert.equal(s.of('/api/v3/time').length, 2); // lần đầu + đúng 1 lần lấy lại
});

test('key sai', async () => {
  const s = setup({ '/api/v3/account': () => json({ code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' }, 401) });
  await assert.rejects(s.client.account(), (e) => {
    assert.ok(e instanceof BinanceError);
    assert.equal(e.kind, 'auth');
    assert.equal(e.code, -2015);
    assert.equal(e.message, 'API key không hợp lệ, đã hết hạn, hoặc bị giới hạn IP.');
    return true;
  });
});

test('gần ngưỡng weight', async () => {
  const s = setup({ '/api/v3/ticker/price': () => json([], 200, { 'x-mbx-used-weight-1m': '4900' }) });
  await s.client.tickerPrices();
  assert.equal(s.sleeps.length, 0);
  await s.client.tickerPrices();
  assert.equal(s.sleeps.length, 1);
  assert.ok(s.sleeps[0] > 1000 && s.sleeps[0] <= 61000);
});

test('429 rồi thành công', async () => {
  const s = setup({
    '/api/v3/ticker/price': (u, i, n) => (n === 1 ? json({}, 429, { 'Retry-After': '7' }) : json([])),
  });
  await s.client.tickerPrices();
  assert.deepEqual(s.sleeps, [8000]);
});

test('418 không gọi lại', async () => {
  const s = setup({ '/api/v3/ticker/price': () => json({}, 418, { 'Retry-After': '120' }) });
  await assert.rejects(s.client.tickerPrices(), (e) => e.kind === 'ratelimit' && e.retryAfter === 120);
  assert.equal(s.of('/api/v3/ticker/price').length, 1);
});

test('429 hai lần liền', async () => {
  const s = setup({ '/api/v3/ticker/price': () => json({}, 429, { 'Retry-After': '3' }) });
  await assert.rejects(s.client.tickerPrices(), (e) => e.kind === 'ratelimit' && e.retryAfter === 3);
  assert.equal(s.of('/api/v3/ticker/price').length, 2);
});

test('mạng lỗi', async () => {
  const s = setup({ '/api/v3/ticker/price': () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(s.client.tickerPrices(), (e) =>
    e.kind === 'network' && e.message === 'Không kết nối được tới Binance. Kiểm tra mạng rồi thử lại.');
});

test('định dạng kết quả', async () => {
  const s = setup({
    '/api/v3/exchangeInfo': () => json({ symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' }] }),
    '/api/v3/account': () => json({ balances: [{ asset: 'BTC', free: '0.5', locked: '0.25' }, { asset: 'ETH', free: '0', locked: '0' }] }),
    '/sapi/v1/account/apiRestrictions': () => json({ enableReading: true, enableSpotAndMarginTrading: true, enableWithdrawals: false }),
    '/api/v3/klines': () => json([[60000, '1', '2', '0.5', '1.5', '10', 119999, '15', 3, '5', '7', '0']]),
  });
  assert.deepEqual(await s.client.exchangeInfo(), [{ symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' }]);
  assert.deepEqual(await s.client.account(), { BTC: 0.75 });
  assert.deepEqual(await s.client.apiRestrictions(), { canTrade: true, canWithdraw: false });
  assert.deepEqual(await s.client.klines('BTCUSDT', 60000, 1000), [{ minute: 60000, close: 1.5 }]);
  const k = s.of('/api/v3/klines')[0].params;
  assert.equal(k.get('interval'), '1m');
  assert.equal(k.get('startTime'), '60000');
  assert.equal(k.get('limit'), '1000');
});

test('accountBalances tách free, locked và total', async () => {
  const s = setup({
    '/api/v3/account': () => json({
      balances: [
        { asset: 'BTC', free: '0.5', locked: '0.25' },
        { asset: 'USDT', free: '100', locked: '400' },
        { asset: 'ETH', free: '0', locked: '0' },
      ],
    }),
  });
  assert.deepEqual(await s.client.accountBalances(), {
    total: { BTC: 0.75, USDT: 500 },
    free: { BTC: 0.5, USDT: 100 },
    locked: { BTC: 0.25, USDT: 400 },
  });
  const [c] = s.of('/api/v3/account');
  assert.equal(c.params.get('omitZeroBalances'), 'true');
  assert.ok(c.params.get('signature'));
});

test('openOrders ký HMAC khi lấy tất cả và khi truyền symbol', async () => {
  const sample = [{ symbol: 'BTCUSDT', orderId: 11, side: 'BUY', type: 'LIMIT', price: '60000' }];
  const s = setup({ '/api/v3/openOrders': () => json(sample) });

  assert.deepEqual(await s.client.openOrders(), sample);
  assert.deepEqual(await s.client.openOrders('BTCUSDT'), sample);

  const calls = s.of('/api/v3/openOrders');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.get('symbol'), null);
  assert.equal(calls[1].params.get('symbol'), 'BTCUSDT');
  assert.equal(calls[0].headers['X-MBX-APIKEY'], 'KEY');
  assert.match(calls[0].params.get('signature'), /^[0-9a-f]{64}$/);
});

