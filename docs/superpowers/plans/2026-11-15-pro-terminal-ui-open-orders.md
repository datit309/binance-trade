# Pro Trading Terminal UI & Open Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thiết kế lại toàn bộ giao diện extension Quản lý vốn Binance Spot theo phong cách Obsidian Pro Trading Terminal (KPI Strip, Workspace Tabs, Slide-over Coin Drawer, biểu đồ tương tác) và tích hợp theo dõi lệnh Spot đang đặt chờ khớp (`GET /api/v3/openOrders`).

**Architecture:** Mở rộng Binance client chỉ đọc thêm `accountBalances()` và `openOrders()`, tách logic tính toán thuần của Open Orders sang `extension/orders.js` và logic vẽ biểu đồ SVG tương tác sang `extension/chart.js`. Tầng giao diện (`dashboard.html`, `dashboard.css`, `ui.js`, `dashboard.js`) giữ nguyên vanilla HTML/CSS/ES modules không build step, dùng `demo-data.js` mở rộng để kiểm tra đầy đủ các trạng thái qua `?demo=1`.

**Tech Stack:** Chrome Manifest V3, Vanilla HTML/CSS/JS (ES modules), WebCrypto HMAC-SHA256, SQLite WASM (opfs-sahpool), Binance REST & `@miniTicker` WebSocket, Node 24 (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-15-pro-terminal-ui-open-orders-design.md`

## Global Constraints

- Host mạng duy nhất: `https://api.binance.com` (và WebSocket công khai `wss://stream.binance.com:9443/stream`). Không CDN font, không script từ xa, không analytics.
- Tuyệt đối chỉ đọc: không thêm endpoint đặt lệnh, hủy lệnh hay sửa lệnh.
- Không framework, không bundler, không build step.
- Toàn bộ chữ giao diện là tiếng Việt; số định dạng `en-US` (`12,430.50`), `font-variant-numeric: tabular-nums`.
- Stablecoin (`STABLES` từ `extension/cost.js`) = `USDT, USDC, FDUSD, BUSD, TUSD, DAI`, quy đổi 1 = 1 USDT.
- API key + secret chỉ lưu trong `chrome.storage.local`, không vào SQLite hay log.
- Giữ toàn bộ 70 unit test hiện có (`npm test`) pass 100%.

---

### Task 1: Mở rộng Binance client (`accountBalances` và `openOrders`)

**Files:**
- Modify: `extension/binance.js:93-130`
- Test: `test/binance.test.js:122-137`

**Interfaces:**
- Consumes: hàm nội bộ `request(path, params, { signed })` trong `extension/binance.js`
- Produces:
  - `client.accountBalances() -> Promise<{ total: Record<string, number>, free: Record<string, number>, locked: Record<string, number> }>`
  - `client.openOrders(symbol?: string) -> Promise<Array<object>>`
  - Giữ nguyên `client.account() -> Promise<Record<string, number>>`

- [ ] **Step 1: Viết unit test thất bại cho `accountBalances()` và `openOrders()` trong `test/binance.test.js`**

Thêm 2 test ở cuối `test/binance.test.js` (sau dòng 137):

```js
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
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --test test/binance.test.js`
Expected: FAIL với lỗi `s.client.accountBalances is not a function` và `s.client.openOrders is not a function`.

- [ ] **Step 3: Implement `accountBalances()` và `openOrders()` trong `extension/binance.js`**

Sửa khối `return { ... }` ở `extension/binance.js:93-130`:

```js
  return {
    async exchangeInfo() {
      const { symbols } = await request('/api/v3/exchangeInfo');
      return symbols.map((s) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));
    },

    async accountBalances() {
      const { balances } = await request('/api/v3/account', { omitZeroBalances: 'true' }, { signed: true });
      const total = {};
      const free = {};
      const locked = {};
      for (const b of balances) {
        const f = Number(b.free);
        const l = Number(b.locked);
        const sum = f + l;
        if (sum > 0) {
          total[b.asset] = sum;
          free[b.asset] = f;
          locked[b.asset] = l;
        }
      }
      return { total, free, locked };
    },

    async account() {
      const { total } = await this.accountBalances();
      return total;
    },

    async apiRestrictions() {
      const r = await request('/sapi/v1/account/apiRestrictions', {}, { signed: true });
      return { canTrade: Boolean(r.enableSpotAndMarginTrading), canWithdraw: Boolean(r.enableWithdrawals) };
    },

    myTrades(symbol, fromId) {
      return request('/api/v3/myTrades', { symbol, fromId: String(fromId), limit: '1000' }, { signed: true });
    },

    openOrders(symbol) {
      return request('/api/v3/openOrders', symbol ? { symbol } : {}, { signed: true });
    },

    async tickerPrices() {
      const list = await request('/api/v3/ticker/price');
      return Object.fromEntries(list.map((t) => [t.symbol, Number(t.price)]));
    },

    async klines(symbol, startTime, limit) {
      const rows = await request('/api/v3/klines', {
        symbol, interval: '1m', startTime: String(startTime), limit: String(limit),
      });
      return rows.map((k) => ({ minute: k[0], close: Number(k[4]) }));
    },
  };
```

- [ ] **Step 4: Chạy toàn bộ test suite để xác nhận pass**

Run: `npm test`
Expected: PASS 72 tests (0 fail).

- [ ] **Step 5: Commit**

```bash
git add extension/binance.js test/binance.test.js
git commit -m "feat: add accountBalances and read-only openOrders to binance client"
```

---

### Task 2: Module xử lý dữ liệu thuần Open Orders (`extension/orders.js`)

**Files:**
- Create: `extension/orders.js`
- Test: `test/orders.test.js`

**Interfaces:**
- Consumes: `STABLES` từ `./cost.js`
- Produces:
  - `parseSymbolPair(symbol, exchangeMap)`
  - `sortNullLast(a, b, key, dir)`
  - `buildOpenOrders(rawOrders, exchangeSymbols, tickers) -> OpenOrder[]`
  - `summarizeOpenOrders(orders) -> { totalCount, buyCount, sellCount, buyValueUsdt, sellValueUsdt, totalLockedUsdt, byAsset }`
  - `visibleOrders(orders, { query, side, typeFilter, sort }) -> OpenOrder[]`

- [ ] **Step 1: Viết unit test thất bại trong `test/orders.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenOrders, summarizeOpenOrders, visibleOrders } from '../extension/orders.js';

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
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --test test/orders.test.js`
Expected: FAIL với lỗi không tìm thấy `extension/orders.js`.

- [ ] **Step 3: Tạo `extension/orders.js`**

```js
// Pure Open Orders transformation, USDT valuation, and filtering. No DOM, no chrome.*.
import { STABLES } from './cost.js';

const FALLBACK_QUOTES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'DAI', 'BTC', 'ETH', 'BNB'];

export function parseSymbolPair(symbol, exchangeMap) {
  const known = exchangeMap.get(symbol);
  if (known) return known;
  for (const q of FALLBACK_QUOTES) {
    if (symbol.length > q.length && symbol.endsWith(q)) {
      return { base: symbol.slice(0, -q.length), quote: q };
    }
  }
  return { base: symbol, quote: '' };
}

function toUsdtValue(quote, quoteAmount, tickers) {
  if (!quote || !Number.isFinite(quoteAmount)) return null;
  if (STABLES.has(quote)) return quoteAmount;
  const direct = tickers[quote + 'USDT'];
  if (direct != null && direct > 0) return quoteAmount * direct;
  const inverse = tickers['USDT' + quote];
  if (inverse != null && inverse > 0) return quoteAmount / inverse;
  return null;
}

export function buildOpenOrders(rawOrders, exchangeSymbols, tickers = {}) {
  const exchangeMap = new Map(exchangeSymbols.map((s) => [s.symbol, { base: s.base, quote: s.quote }]));

  return rawOrders.map((o) => {
    const { base, quote } = parseSymbolPair(o.symbol, exchangeMap);
    const price = Number(o.price);
    const stopNum = Number(o.stopPrice);
    const stopPrice = Number.isFinite(stopNum) && stopNum > 0 ? stopNum : null;
    const origQty = Number(o.origQty);
    const executedQty = Number(o.executedQty);
    const remainingQty = Math.max(0, origQty - executedQty);
    const fillPct = origQty > 0 ? Math.min(100, (executedQty / origQty) * 100) : 0;
    const marketPrice = tickers[o.symbol] ?? null;
    const distancePct = price > 0 && marketPrice != null && marketPrice > 0
      ? ((price - marketPrice) / marketPrice) * 100
      : null;
    const remainingValueUsdt = price > 0
      ? toUsdtValue(quote, remainingQty * price, tickers)
      : 0;
    const isOco = o.orderListId != null && Number(o.orderListId) !== -1;

    return {
      orderId: o.orderId,
      orderListId: o.orderListId ?? -1,
      isOco,
      symbol: o.symbol,
      base,
      quote,
      side: o.side,
      type: o.type,
      status: o.status,
      price,
      stopPrice,
      origQty,
      executedQty,
      remainingQty,
      fillPct,
      marketPrice,
      distancePct,
      remainingValueUsdt,
      time: Number(o.time ?? o.updateTime ?? 0),
      updateTime: Number(o.updateTime ?? o.time ?? 0),
    };
  });
}

export function summarizeOpenOrders(orders) {
  let buyCount = 0;
  let sellCount = 0;
  let buyValueUsdt = 0;
  let sellValueUsdt = 0;
  const byAsset = {};

  for (const o of orders) {
    (byAsset[o.base] ??= []).push(o);
    const val = o.remainingValueUsdt ?? 0;
    if (o.side === 'BUY') {
      buyCount += 1;
      buyValueUsdt += val;
    } else {
      sellCount += 1;
      sellValueUsdt += val;
    }
  }

  return {
    totalCount: orders.length,
    buyCount,
    sellCount,
    buyValueUsdt,
    sellValueUsdt,
    totalLockedUsdt: buyValueUsdt + sellValueUsdt,
    byAsset,
  };
}

const isStopOrder = (o) => o.isOco || (o.type && o.type.includes('STOP')) || (o.type && o.type.includes('TAKE_PROFIT'));

export const sortNullLast = (a, b, key, dir) => {
  const x = a[key];
  const y = b[key];
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  const cmp = typeof x === 'string' ? x.localeCompare(y) : x - y;
  return dir === 'asc' ? cmp : -cmp;
};

export function visibleOrders(orders, { query = '', side = 'ALL', typeFilter = 'ALL', sort = { key: 'time', dir: 'desc' } } = {}) {
  const q = query.trim().toUpperCase();
  return orders
    .filter((o) => !q || o.symbol.includes(q) || o.base.includes(q))
    .filter((o) => side === 'ALL' || o.side === side)
    .filter((o) => typeFilter === 'ALL' || (typeFilter === 'STOP' ? isStopOrder(o) : !isStopOrder(o)))
    .sort((a, b) => sortNullLast(a, b, sort.key, sort.dir));
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test`
Expected: PASS toàn bộ tests (bao gồm 4 test mới trong `test/orders.test.js`).

- [ ] **Step 5: Commit**

```bash
git add extension/orders.js test/orders.test.js
git commit -m "feat: add pure open orders processing and valuation module"
```

---

### Task 3: Bổ sung Open Orders, `free`/`locked` và `open24h` vào `extension/demo-data.js`

**Files:**
- Modify: `extension/demo-data.js:58-69`
- Test: `test/orders.test.js` (thêm 1 test smoke kiểm chứng `demo` data chạy qua `buildOpenOrders` + `summarizeOpenOrders`)

**Interfaces:**
- Produces thêm trên `demo`:
  - `demo.balancesDetail: { total, free, locked }` (tổng khớp `demo.balances`)
  - `demo.open24h: Record<string, number>`
  - `demo.exchangeSymbols: Array<{ symbol, base, quote }>`
  - `demo.openOrders: Array<RawBinanceOrder>` (gồm BUY LIMIT, SELL LIMIT, PARTIALLY_FILLED, STOP_LOSS_LIMIT OCO, lệnh mua DOGE khi `balance.DOGE === 0`, và 1 lệnh đặt xa biên giá để test badge ngoài khung giá trên chart)

- [ ] **Step 1: Thêm test kiểm tra `demo` data vào cuối `test/orders.test.js`**

```js
test('demo data hợp lệ qua buildOpenOrders và summarizeOpenOrders', async () => {
  const { demo } = await import('../extension/demo-data.js');
  const parsed = buildOpenOrders(demo.openOrders, demo.exchangeSymbols, demo.tickers);
  assert.equal(parsed.length, demo.openOrders.length);
  const summary = summarizeOpenOrders(parsed);
  assert.ok(summary.buyCount > 0 && summary.sellCount > 0);
  for (const [asset, total] of Object.entries(demo.balances)) {
    approx(demo.balancesDetail.free[asset] + demo.balancesDetail.locked[asset], total, asset);
  }
});
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `node --test test/orders.test.js`
Expected: FAIL với lỗi `Cannot read properties of undefined (reading 'length')` vì `demo.openOrders` chưa tồn tại.

- [ ] **Step 3: Cập nhật `extension/demo-data.js` (dòng 58-69)**

```js
const balances = {
  BTC: 0.18348, ETH: 1.1, SOL: 14.2, ARB: 1200, LINK: 35, NEWT: 500, BNB: 2.458, USDT: 1840.55, PEPE: 0,
};

export const demo = {
  rows,
  priceRows,
  balances,
  balancesDetail: {
    total: balances,
    free: {
      BTC: 0.13348, ETH: 0.6, SOL: 10.2, ARB: 1200, LINK: 35, NEWT: 500, BNB: 2.458, USDT: 450.05, PEPE: 0,
    },
    locked: {
      BTC: 0.05, ETH: 0.5, SOL: 4.0, ARB: 0, LINK: 0, NEWT: 0, BNB: 0, USDT: 1390.5, PEPE: 0,
    },
  },
  tickers: {
    BTCUSDT: 67450, ETHUSDT: 2380, SOLUSDT: 139.1, ARBUSDT: 0.71, LINKUSDT: 15.84, BNBUSDT: 612,
    DOGEUSDT: 0.162, PEPEUSDT: 0.0000098,
  },
  open24h: {
    BTCUSDT: 65820, ETHUSDT: 2445, SOLUSDT: 134.8, ARBUSDT: 0.735, LINKUSDT: 15.12, BNBUSDT: 604,
    DOGEUSDT: 0.155, PEPEUSDT: 0.0000102,
  },
  exchangeSymbols: [
    { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' },
    { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT' },
    { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT' },
    { symbol: 'ARBUSDT', base: 'ARB', quote: 'USDT' },
    { symbol: 'LINKUSDT', base: 'LINK', quote: 'USDT' },
    { symbol: 'NEWTUSDT', base: 'NEWT', quote: 'USDT' },
    { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT' },
    { symbol: 'DOGEUSDT', base: 'DOGE', quote: 'USDT' },
    { symbol: 'PEPEUSDT', base: 'PEPE', quote: 'USDT' },
  ],
  openOrders: [
    {
      symbol: 'BTCUSDT', orderId: 9101, orderListId: -1, side: 'SELL', type: 'LIMIT',
      price: '74500', stopPrice: '0', origQty: '0.05', executedQty: '0',
      status: 'NEW', time: Date.now() - 2 * 3_600_000, updateTime: Date.now() - 2 * 3_600_000,
    },
    {
      symbol: 'BTCUSDT', orderId: 9102, orderListId: -1, side: 'BUY', type: 'LIMIT',
      price: '61500', stopPrice: '0', origQty: '0.02', executedQty: '0.008',
      status: 'PARTIALLY_FILLED', time: Date.now() - 9 * 3_600_000, updateTime: Date.now() - 1_800_000,
    },
    {
      symbol: 'ETHUSDT', orderId: 9103, orderListId: 77, side: 'SELL', type: 'STOP_LOSS_LIMIT',
      price: '2180', stopPrice: '2200', origQty: '0.5', executedQty: '0',
      status: 'NEW', time: Date.now() - 18 * 3_600_000, updateTime: Date.now() - 18 * 3_600_000,
    },
    {
      symbol: 'SOLUSDT', orderId: 9104, orderListId: -1, side: 'SELL', type: 'LIMIT_MAKER',
      price: '165', stopPrice: '0', origQty: '4', executedQty: '0',
      status: 'NEW', time: Date.now() - 28 * 3_600_000, updateTime: Date.now() - 28 * 3_600_000,
    },
    {
      symbol: 'DOGEUSDT', orderId: 9105, orderListId: -1, side: 'BUY', type: 'LIMIT',
      price: '0.145', stopPrice: '0', origQty: '4500', executedQty: '0',
      status: 'NEW', time: Date.now() - 36 * 3_600_000, updateTime: Date.now() - 36 * 3_600_000,
    },
  ],
  lastSyncedAt: Date.now() - 4 * 60_000,
};
```

- [ ] **Step 4: Chạy test xác nhận pass**

Run: `npm test`
Expected: PASS toàn bộ tests.

- [ ] **Step 5: Commit**

```bash
git add extension/demo-data.js test/orders.test.js
git commit -m "feat: add sample open orders, locked balances, and 24h open prices to demo data"
```

---

### Task 4: Biểu đồ SVG tương tác & đường giá Open Orders (`extension/chart.js`)

**Files:**
- Create: `extension/chart.js`
- Test: `test/chart.test.js`

**Interfaces:**
- Consumes: `fmtPrice`, `fmtQty`, `fmtTime` từ `./format.js`
- Produces:
  - `computeChartBounds(fills, history, currentPrice, openOrders) -> { lo, hi, baseLo, baseHi, inRangeOrders, outOfRangeOrders }`
  - `renderPriceChart({ history, currentPrice, openOrders }) -> [HTMLElement, ...]` hoặc `null` nếu có `< 2` fills

- [ ] **Step 1: Viết test thất bại cho `computeChartBounds` trong `test/chart.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeChartBounds } from '../extension/chart.js';

test('computeChartBounds giữ lệnh chờ hợp lý trong khung và đẩy lệnh cực xa ra ngoài khung', () => {
  const fills = [
    { side: 'BUY', price: 60000, time: 1000, qty: 0.1 },
    { side: 'BUY', price: 65000, time: 2000, qty: 0.1 },
  ];
  const history = [
    { qtyAfter: 0.1, avgAfter: 60000 },
    { qtyAfter: 0.2, avgAfter: 62500 },
  ];
  const openOrders = [
    { orderId: 1, side: 'SELL', price: 74500 },   // trong ngưỡng [24000, 168625]
    { orderId: 2, side: 'SELL', price: 250000 },  // vượt 2.5x -> outOfRange
    { orderId: 3, side: 'BUY', price: 15000 },    // dưới 0.4x -> outOfRange
    { orderId: 4, side: 'BUY', price: 0 },        // bỏ qua vì price <= 0
  ];
  const res = computeChartBounds(fills, history, 67450, openOrders);

  assert.equal(res.inRangeOrders.map((o) => o.orderId).join(','), '1');
  assert.equal(res.outOfRangeOrders.map((o) => o.orderId).join(','), '2,3');
  assert.ok(res.lo < 60000 && res.hi > 74500);
});
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `node --test test/chart.test.js`
Expected: FAIL với lỗi không tìm thấy `extension/chart.js`.

- [ ] **Step 3: Implement `extension/chart.js`**

```js
// SVG cost-basis & open-order price chart with hover crosshair tooltip.
import { fmtPrice, fmtQty, fmtTime } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIDE_LABEL = { BUY: 'Mua', SELL: 'Bán', FEE: 'Phí' };

function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
}

function domEl(tag, cls, children = []) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of [children].flat()) if (c != null) el.append(c);
  return el;
}

export function computeChartBounds(fills, history, currentPrice, openOrders = []) {
  const baseValues = [
    ...fills.map((x) => x.price),
    ...history.filter((x) => x.qtyAfter > 0).map((x) => x.avgAfter),
  ];
  if (currentPrice != null) baseValues.push(currentPrice);
  const baseLo = Math.min(...baseValues);
  const baseHi = Math.max(...baseValues);

  const inRangeOrders = [];
  const outOfRangeOrders = [];
  for (const o of openOrders) {
    if (!(o.price > 0)) continue;
    if (o.price >= baseLo * 0.4 && o.price <= baseHi * 2.5) inRangeOrders.push(o);
    else outOfRangeOrders.push(o);
  }

  const allValues = [...baseValues, ...inRangeOrders.map((o) => o.price)];
  let lo = Math.min(...allValues);
  let hi = Math.max(...allValues);
  const padY = (hi - lo || hi || 1) * 0.1;
  lo -= padY;
  hi += padY;
  return { lo, hi, baseLo, baseHi, inRangeOrders, outOfRangeOrders };
}

export function renderPriceChart({ history, currentPrice, openOrders = [] }) {
  const fills = history.filter((x) => x.side !== 'FEE' && x.qty > 0);
  if (fills.length < 2) return null;

  const W = 740;
  const H = 228;
  const L = 72;
  const R = 74;
  const T = 14;
  const B = 24;

  const times = fills.map((x) => x.time);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times, t0 + 1);
  const { lo, hi, inRangeOrders, outOfRangeOrders } = computeChartBounds(fills, history, currentPrice, openOrders);

  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const stage = domEl('div', 'chart-stage');
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': 'Biểu đồ giá các lệnh mua bán so với giá vốn trung bình và lệnh chờ khớp',
  });

  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id: 'avg-area-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(
    svgEl('stop', { offset: '0%', 'stop-color': '#e5a93c', 'stop-opacity': '0.18' }),
    svgEl('stop', { offset: '100%', 'stop-color': '#e5a93c', 'stop-opacity': '0' }),
  );
  defs.append(grad);
  svg.append(defs);

  for (const f of [0, 0.5, 1]) {
    const v = lo + (hi - lo) * (0.1 + f * 0.8);
    const py = y(v).toFixed(1);
    svg.append(
      svgEl('line', { class: 'grid', x1: L, x2: W - R, y1: py, y2: py }),
      svgEl('text', { x: L - 8, y: Number(py) + 3, 'text-anchor': 'end' }, fmtPrice(v)),
    );
  }
  svg.append(
    svgEl('text', { x: L, y: H - 6 }, fmtTime(t0).slice(0, 10)),
    svgEl('text', { x: W - R, y: H - 6, 'text-anchor': 'end' }, fmtTime(t1).slice(0, 10)),
  );

  // Average cost step line + translucent area fill
  let d = '';
  let areaD = '';
  let open = false;
  let firstX = null;
  let lastX = null;
  const baselineY = (H - B).toFixed(1);
  for (const p of history) {
    if (p.qtyAfter <= 0) {
      if (open && lastX != null) {
        areaD += `L${lastX},${baselineY}Z`;
      }
      open = false;
      continue;
    }
    const px = x(Math.min(Math.max(p.time, t0), t1)).toFixed(1);
    const py = y(p.avgAfter).toFixed(1);
    if (!open) {
      firstX = px;
      d += `M${px},${py}`;
      areaD += `M${firstX},${baselineY}L${px},${py}`;
      open = true;
    } else {
      d += `H${px}V${py}`;
      areaD += `H${px}V${py}`;
    }
    lastX = px;
  }
  if (open) {
    const endX = (W - R).toFixed(1);
    d += `H${endX}`;
    areaD += `H${endX}L${endX},${baselineY}Z`;
  }
  if (areaD) svg.append(svgEl('path', { class: 'avg-area', d: areaD }));
  if (d) svg.append(svgEl('path', { class: 'avg', d }));

  // Current market price reference line
  if (currentPrice != null) {
    const cy = y(currentPrice).toFixed(1);
    svg.append(
      svgEl('line', { class: 'now', x1: L, x2: W - R, y1: cy, y2: cy }),
      svgEl('text', { class: 'axis-tag now-tag', x: W - R + 6, y: Number(cy) + 3 }, fmtPrice(currentPrice)),
    );
  }

  // Open order limit levels inside chart bounds
  for (const o of inRangeOrders) {
    const oy = y(o.price).toFixed(1);
    const cls = o.side === 'BUY' ? 'order-buy' : 'order-sell';
    svg.append(
      svgEl('line', { class: `order-line ${cls}`, x1: L, x2: W - R, y1: oy, y2: oy }),
      svgEl('text', { class: `axis-tag ${cls}`, x: W - R + 6, y: Number(oy) + 3 }, fmtPrice(o.price)),
    );
  }

  const crosshair = svgEl('line', { class: 'crosshair', x1: 0, x2: 0, y1: T, y2: H - B, visibility: 'hidden' });
  svg.append(crosshair);

  const tooltip = domEl('div', 'chart-tooltip');
  tooltip.hidden = true;

  for (const f of fills) {
    const cx = x(f.time);
    const cy = y(f.price);
    const dot = svgEl('circle', {
      class: f.side === 'BUY' ? 'buy' : 'sell',
      cx: cx.toFixed(1),
      cy: cy.toFixed(1),
      r: 4,
      tabindex: '0',
    });
    const showTip = () => {
      crosshair.setAttribute('x1', cx.toFixed(1));
      crosshair.setAttribute('x2', cx.toFixed(1));
      crosshair.setAttribute('visibility', 'visible');
      tooltip.replaceChildren(
        domEl('div', 'tt-head', `${SIDE_LABEL[f.side]} · ${fmtTime(f.time)}`),
        domEl('div', 'tt-row', `${f.symbol}: ${fmtQty(f.qty)} @ ${fmtPrice(f.price)}`),
        f.qtyAfter > 0 ? domEl('div', 'tt-sub', `Giá TB sau lệnh: ${fmtPrice(f.avgAfter)}`) : null,
      );
      tooltip.hidden = false;
      const pctX = (cx / W) * 100;
      const pctY = (cy / H) * 100;
      tooltip.style.left = `${Math.min(Math.max(pctX, 14), 82)}%`;
      tooltip.style.top = `${Math.max(pctY - 8, 6)}%`;
    };
    const hideTip = () => {
      crosshair.setAttribute('visibility', 'hidden');
      tooltip.hidden = true;
    };
    dot.addEventListener('mouseenter', showTip);
    dot.addEventListener('focus', showTip);
    dot.addEventListener('mouseleave', hideTip);
    dot.addEventListener('blur', hideTip);
    svg.append(dot);
  }

  stage.append(svg, tooltip);

  const out = [];
  if (outOfRangeOrders.length > 0) {
    const summary = outOfRangeOrders
      .map((o) => `${SIDE_LABEL[o.side]} @ ${fmtPrice(o.price)}`)
      .join(' · ');
    out.push(domEl('div', 'chart-out-range', `Lệnh chờ ngoài khung giá: ${summary}`));
  }
  out.push(stage);

  const key = (cls, label) => domEl('span', '', [domEl('i', 'key ' + cls), label]);
  out.push(domEl('figcaption', '', [
    key('', 'Giá trung bình'),
    key('buy', 'Mua'),
    key('sell', 'Bán'),
    currentPrice != null ? key('now', `Hiện tại ${fmtPrice(currentPrice)}`) : null,
    inRangeOrders.length > 0 ? key('ord', `${inRangeOrders.length} lệnh chờ`) : null,
  ]));
  return out;
}
```

- [ ] **Step 4: Chạy test xác nhận pass**

Run: `npm test`
Expected: PASS toàn bộ tests (bao gồm `test/chart.test.js`).

- [ ] **Step 5: Commit**

```bash
git add extension/chart.js test/chart.test.js
git commit -m "feat: add interactive SVG chart with open-order levels and hover tooltip"
```

---

### Task 5: Thiết kế lại Markup & CSS Obsidian Pro Terminal (`extension/dashboard.html`, `extension/dashboard.css`)

**Files:**
- Modify: `extension/dashboard.html`
- Modify: `extension/dashboard.css`

**Interfaces:**
- Produces toàn bộ DOM IDs mà `extension/ui.js` và `extension/dashboard.js` dùng:
  - `#screen-setup`, `#key-form`, `#api-key`, `#api-secret`, `#toggle-secret`, `#key-error`, `#key-submit`, `#key-cancel`
  - `#screen-locked`, `#locked-retry`
  - `#screen-main`, `#live-status`, `#sync-status`, `#btn-refresh`, `#btn-sync`, `#btn-settings`
  - `#demo-banner`, `#key-warning`, `#error`, `#error-text`, `#error-retry`, `#progress`, `#progress-bar`, `#progress-text`
  - `#kpi-value`, `#kpi-value-sub`, `#kpi-unrealized`, `#kpi-unrealized-pct`, `#kpi-cost`, `#kpi-cost-sub`, `#kpi-realized`, `#kpi-net-sub`, `#kpi-orders-card`, `#kpi-orders`, `#kpi-orders-sub`
  - `#alloc`, `#alloc-bar`, `#alloc-legend`
  - `#tab-holdings`, `#tab-holdings-count`, `#tab-orders`, `#tab-orders-count`, `#tab-orders-dot`
  - `#panel-holdings`, `#search`, `#holdings-filters`, `#hide-small`, `#row-count`, `#holdings`, `#holdings-body`, `#empty`, `#empty-text`, `#empty-sync`
  - `#panel-orders`, `#orders-summary-buy`, `#orders-summary-sell`, `#orders-error`, `#orders-error-text`, `#orders-retry`, `#order-search`, `#order-side-filters`, `#order-type-filters`, `#order-count`, `#open-orders`, `#open-orders-body`, `#orders-empty`, `#orders-empty-text`
  - `#drawer-backdrop`, `#drawer`, `#drawer-avatar`, `#drawer-title`, `#drawer-price`, `#drawer-change24h`, `#drawer-close`, `#drawer-avg`, `#drawer-now`, `#drawer-cost`, `#drawer-realized`, `#drawer-balance-sub`, `#drawer-notes`, `#drawer-chart`, `#drawer-orders-section`, `#drawer-orders-body`, `#drawer-history-body`
  - `#settings`, `#key-masked`, `#key-change`, `#key-remove`, `#scan-full`, `#extra-form`, `#extra-asset`, `#extra-error`, `#extra-list`, `#export-sqlite`, `#export-csv`, `#wipe`, `#confirm`, `#confirm-text`, `#confirm-ok`

- [ ] **Step 1: Viết lại `extension/dashboard.html`**

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Quản lý vốn · Binance Spot</title>
  <link rel="icon" href="icons/48.png">
  <link rel="stylesheet" href="dashboard.css">
</head>
<body>

<!-- Chưa có key: Split 2 cột -->
<main id="screen-setup" class="center-screen" hidden>
  <div class="setup-shell">
    <aside class="setup-info">
      <div class="brand-row">
        <img src="icons/128.png" alt="Quản lý vốn" width="40" height="40">
        <div>
          <h1>Quản lý vốn</h1>
          <span class="badge-spot">BINANCE SPOT TERMINAL</span>
        </div>
      </div>
      <p class="lead">Theo dõi giá vốn trung bình, lãi/lỗ thực tế và các lệnh Spot đang chờ khớp theo thời gian thực.</p>
      <ul class="trust-list">
        <li>
          <strong>Chỉ đọc dữ liệu (Read-only)</strong>
          <span>Chỉ dùng quyền xem tài khoản và lịch sử lệnh; không đặt hay hủy lệnh.</span>
        </li>
        <li>
          <strong>Lưu trữ cục bộ 100%</strong>
          <span>Lịch sử lưu trong SQLite OPFS trên máy. Key chỉ gửi tới <code>api.binance.com</code>.</span>
        </li>
      </ul>
      <div class="setup-steps">
        <h2>Hướng dẫn 3 bước lấy API Key</h2>
        <ol class="steps">
          <li>Mở <b>Binance → Tài khoản → Quản lý API → Tạo API</b>.</li>
          <li>Chỉ giữ bật <b>Cho phép đọc (Enable Reading)</b>. Tắt giao dịch và rút tiền.</li>
          <li>Dán API Key và Secret Key vào khung bên cạnh.</li>
        </ol>
      </div>
    </aside>

    <form id="key-form" class="card setup-form" novalidate>
      <h2>Kết nối tài khoản</h2>
      <div class="field">
        <label for="api-key">API Key</label>
        <input id="api-key" name="apiKey" autocomplete="off" spellcheck="false" placeholder="Nhập Binance API Key…" required>
      </div>
      <div class="field">
        <label for="api-secret">Secret Key</label>
        <div class="input-with-btn">
          <input id="api-secret" name="secret" type="password" autocomplete="off" spellcheck="false" placeholder="Nhập Secret Key…" required>
          <button id="toggle-secret" class="btn ghost small" type="button" aria-label="Hiện hoặc ẩn Secret Key">Hiện</button>
        </div>
      </div>

      <p id="key-error" class="field-error" role="alert" hidden></p>
      <button id="key-submit" class="btn primary block" type="submit">Lưu và đồng bộ</button>
      <button id="key-cancel" class="btn ghost block" type="button" hidden>Quay lại dashboard</button>

      <p class="note">Key lưu trong <code>chrome.storage.local</code> không mã hóa trên đĩa.</p>
      <p class="note demo-link"><a href="?demo=1">Xem thử giao diện với dữ liệu mẫu →</a></p>
    </form>
  </div>
</main>

<!-- Tab khác đang giữ database -->
<main id="screen-locked" class="center-screen" hidden>
  <div class="card status-card">
    <div class="status-icon warn">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M7 11V7a5 5 0 0 1 10 0v4M5 11h14v9H5z"/></svg>
    </div>
    <h1>Dashboard đang mở ở tab khác</h1>
    <p class="lead">Cơ sở dữ liệu SQLite OPFS chỉ cho phép một kết nối tại một thời điểm. Hãy dùng tab đang mở hoặc đóng tab kia rồi thử lại.</p>
    <button id="locked-retry" class="btn primary" type="button">Thử lại</button>
  </div>
</main>

<!-- Màn hình chính -->
<div id="screen-main" hidden>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand-row">
        <img src="icons/48.png" alt="" width="24" height="24">
        <h1>Quản lý vốn</h1>
        <span class="badge-spot">SPOT</span>
      </div>

      <div class="topbar-actions">
        <span id="live-status" class="status-pill" role="status">Ngoại tuyến</span>
        <span id="sync-status" class="mono muted">Chưa đồng bộ</span>
        <button id="btn-refresh" class="btn small" type="button" title="Cập nhật nhanh số dư, giá và lệnh chờ khớp">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
          <span>Làm mới</span>
        </button>
        <button id="btn-sync" class="btn primary small" type="button">Đồng bộ</button>
        <button id="btn-settings" class="btn icon small" type="button" aria-label="Cài đặt" title="Cài đặt">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5c0-.5 0-.9-.1-1.3l2-1.5-2-3.4-2.3.9c-.7-.6-1.4-1-2.2-1.3L14.4 3h-4l-.4 2.4c-.8.3-1.5.7-2.2 1.3l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9c.7.6 1.4 1 2.2 1.3l.4 2.4h4l.4-2.4c.8-.3 1.5-.7 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.3Z"/></svg>
        </button>
      </div>
    </div>
  </header>

  <main class="page">
    <div id="demo-banner" class="banner info" hidden>
      <span>Đang xem dữ liệu mẫu (bao gồm danh mục và lệnh chờ khớp giả lập).</span>
      <a class="btn small" href="dashboard.html">Thoát demo</a>
    </div>
    <div id="key-warning" class="banner warn" role="status" hidden>
      <span>API Key này đang bật quyền giao dịch hoặc rút tiền. Extension chỉ cần quyền đọc; bạn nên tạo key chỉ đọc.</span>
      <button class="btn small ghost" type="button" data-dismiss="key-warning">Đã hiểu</button>
    </div>
    <div id="error" class="banner error" role="alert" hidden>
      <span id="error-text"></span>
      <button id="error-retry" class="btn small" type="button">Thử lại</button>
      <button class="btn small ghost" type="button" data-dismiss="error" aria-label="Đóng thông báo">Đóng</button>
    </div>

    <section id="progress" class="panel progress" hidden>
      <div class="progress-head">
        <span id="progress-text" aria-live="polite"></span>
      </div>
      <progress id="progress-bar" max="1" value="0"></progress>
    </section>

    <!-- Executive KPI Strip -->
    <section class="kpi-strip" aria-label="Tổng quan tài khoản">
      <article class="kpi-card anchor">
        <span class="kpi-label">Tổng giá trị Spot</span>
        <strong id="kpi-value" class="kpi-val num">—</strong>
        <span id="kpi-value-sub" class="kpi-sub num">—</span>
      </article>
      <article class="kpi-card">
        <span class="kpi-label">Lãi/lỗ chưa chốt</span>
        <div class="kpi-inline">
          <strong id="kpi-unrealized" class="kpi-val num">—</strong>
          <span id="kpi-unrealized-pct" class="pill">—</span>
        </div>
        <span class="kpi-sub">Tính trên phần có giá vốn rõ ràng</span>
      </article>
      <article class="kpi-card">
        <span class="kpi-label">Vốn đang giữ</span>
        <strong id="kpi-cost" class="kpi-val num">—</strong>
        <span id="kpi-cost-sub" class="kpi-sub">Giá vốn bình quân gia quyền</span>
      </article>
      <article class="kpi-card">
        <span class="kpi-label">Lãi/lỗ đã chốt</span>
        <strong id="kpi-realized" class="kpi-val num">—</strong>
        <span id="kpi-net-sub" class="kpi-sub num">—</span>
      </article>
      <button id="kpi-orders-card" class="kpi-card kpi-action" type="button" title="Mở tab Lệnh chờ khớp">
        <span class="kpi-label">Lệnh chờ khớp</span>
        <strong id="kpi-orders" class="kpi-val num">0 lệnh</strong>
        <span id="kpi-orders-sub" class="kpi-sub num">—</span>
      </button>
    </section>

    <!-- Allocation Strip -->
    <section id="alloc" class="panel alloc" hidden aria-label="Phân bổ tài sản">
      <div class="alloc-bar" id="alloc-bar" role="img" aria-label="Tỷ trọng danh mục"></div>
      <ul id="alloc-legend" class="alloc-legend"></ul>
    </section>

    <!-- Workspace Tabs -->
    <div class="workspace-tabs" role="tablist" aria-label="Chế độ xem dữ liệu">
      <button id="tab-holdings" class="tab-btn active" type="button" role="tab" aria-selected="true" aria-controls="panel-holdings">
        <span>Danh mục nắm giữ</span>
        <span id="tab-holdings-count" class="tab-badge num">0</span>
      </button>
      <button id="tab-orders" class="tab-btn" type="button" role="tab" aria-selected="false" aria-controls="panel-orders">
        <span id="tab-orders-dot" class="tab-dot" hidden></span>
        <span>Lệnh chờ khớp</span>
        <span id="tab-orders-count" class="tab-badge num">0</span>
      </button>
    </div>

    <!-- Tab 1: Danh mục nắm giữ -->
    <section id="panel-holdings" class="workspace-panel" role="tabpanel" aria-labelledby="tab-holdings">
      <div class="toolbar">
        <input id="search" type="search" placeholder="Tìm coin…" aria-label="Tìm coin" autocomplete="off">
        <div id="holdings-filters" class="seg-group" role="group" aria-label="Lọc danh mục">
          <button type="button" class="seg-btn active" data-hfilter="all">Tất cả</button>
          <button type="button" class="seg-btn" data-hfilter="warn">Có cảnh báo</button>
          <button type="button" class="seg-btn" data-hfilter="orders">Có lệnh chờ</button>
        </div>
        <span id="row-count" class="row-count num"></span>
        <label class="check"><input id="hide-small" type="checkbox"> Ẩn dưới 1 USDT</label>
      </div>

      <div class="panel table-card">
        <table id="holdings">
          <thead>
            <tr>
              <th scope="col" class="left"><button type="button" data-sort="asset">Coin</button></th>
              <th scope="col"><button type="button" data-sort="balance">Số lượng</button></th>
              <th scope="col"><button type="button" data-sort="price">Giá TB → Hiện tại</button></th>
              <th scope="col"><button type="button" data-sort="value">Giá trị / Tỷ trọng</button></th>
              <th scope="col"><button type="button" data-sort="unrealized">Lãi/lỗ</button></th>
              <th scope="col"><button type="button" data-sort="unrealizedPct">Hiệu suất</button></th>
            </tr>
          </thead>
          <tbody id="holdings-body"></tbody>
        </table>
        <div id="empty" class="empty" hidden>
          <p id="empty-text"></p>
          <button id="empty-sync" class="btn primary" type="button">Đồng bộ ngay</button>
        </div>
      </div>
    </section>

    <!-- Tab 2: Lệnh chờ khớp -->
    <section id="panel-orders" class="workspace-panel" role="tabpanel" aria-labelledby="tab-orders" hidden>
      <div class="orders-summary panel">
        <div class="orders-summary-stats">
          <span class="summary-chip buy">Mua chờ: <b id="orders-summary-buy" class="num">0 lệnh</b></span>
          <span class="summary-chip sell">Bán chờ: <b id="orders-summary-sell" class="num">0 lệnh</b></span>
        </div>
        <div id="orders-error" class="orders-err" hidden>
          <span id="orders-error-text"></span>
          <button id="orders-retry" class="btn small" type="button">Thử lại</button>
        </div>
      </div>

      <div class="toolbar">
        <input id="order-search" type="search" placeholder="Tìm cặp, ví dụ BTCUSDT…" aria-label="Tìm cặp lệnh chờ" autocomplete="off">
        <div id="order-side-filters" class="seg-group" role="group" aria-label="Lọc chiều lệnh">
          <button type="button" class="seg-btn active" data-oside="ALL">Tất cả</button>
          <button type="button" class="seg-btn" data-oside="BUY">Mua</button>
          <button type="button" class="seg-btn" data-oside="SELL">Bán</button>
        </div>
        <div id="order-type-filters" class="seg-group" role="group" aria-label="Lọc loại lệnh">
          <button type="button" class="seg-btn active" data-otype="ALL">Mọi loại</button>
          <button type="button" class="seg-btn" data-otype="LIMIT">Limit</button>
          <button type="button" class="seg-btn" data-otype="STOP">Stop / OCO</button>
        </div>
        <span id="order-count" class="row-count num"></span>
      </div>

      <div class="panel table-card">
        <table id="open-orders">
          <thead>
            <tr>
              <th scope="col" class="left"><button type="button" data-osort="time">Thời gian</button></th>
              <th scope="col" class="left"><button type="button" data-osort="symbol">Cặp &amp; Loại</button></th>
              <th scope="col" class="left"><button type="button" data-osort="side">Chiều</button></th>
              <th scope="col"><button type="button" data-osort="price">Giá đặt</button></th>
              <th scope="col"><button type="button" data-osort="distancePct">Cách giá TT</button></th>
              <th scope="col"><button type="button" data-osort="fillPct">Khối lượng / Tiến độ</button></th>
              <th scope="col"><button type="button" data-osort="remainingValueUsdt">Giá trị còn lại</button></th>
              <th scope="col" class="left"><button type="button" data-osort="status">Trạng thái</button></th>
            </tr>
          </thead>
          <tbody id="open-orders-body"></tbody>
        </table>
        <div id="orders-empty" class="empty" hidden>
          <p id="orders-empty-text">Hiện không có lệnh Spot nào đang chờ khớp.</p>
        </div>
      </div>
    </section>

    <p class="footnote">Giá vốn: bình quân gia quyền từ lịch sử khớp lệnh Spot (USDT, đã gồm phí). Lệnh chờ khớp lấy trực tiếp qua API chỉ đọc.</p>
  </main>
</div>

<!-- Slide-over Coin Drawer -->
<div id="drawer-backdrop" class="drawer-backdrop" hidden></div>
<aside id="drawer" class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" hidden tabindex="-1">
  <header class="drawer-head">
    <div class="drawer-title-wrap">
      <span id="drawer-avatar" class="avatar"></span>
      <div>
        <div class="drawer-name-line">
          <h2 id="drawer-title">BTC</h2>
          <span id="drawer-price" class="num">—</span>
          <span id="drawer-change24h" class="chg-badge num" hidden></span>
        </div>
        <p id="drawer-balance-sub" class="drawer-sub num">—</p>
      </div>
    </div>
    <button id="drawer-close" class="btn small ghost" type="button" aria-label="Đóng chi tiết">Đóng (Esc)</button>
  </header>

  <div class="drawer-body">
    <dl class="detail-stats">
      <div><dt>Giá trung bình</dt><dd id="drawer-avg" class="num">—</dd></div>
      <div><dt>Giá hiện tại</dt><dd id="drawer-now" class="num">—</dd></div>
      <div><dt>Vốn đang giữ</dt><dd id="drawer-cost" class="num">—</dd></div>
      <div><dt>Đã chốt</dt><dd id="drawer-realized" class="num">—</dd></div>
    </dl>

    <ul id="drawer-notes" class="notes"></ul>
    <figure id="drawer-chart" class="chart" hidden></figure>

    <section id="drawer-orders-section" class="drawer-section" hidden>
      <h3>Lệnh đang chờ khớp</h3>
      <div class="panel table-card">
        <table class="mini-table">
          <thead>
            <tr>
              <th scope="col" class="left">Cặp &amp; Chiều</th>
              <th scope="col">Giá đặt</th>
              <th scope="col">Cách TT</th>
              <th scope="col">Khối lượng</th>
              <th scope="col">Giá trị</th>
            </tr>
          </thead>
          <tbody id="drawer-orders-body"></tbody>
        </table>
      </div>
    </section>

    <section class="drawer-section">
      <h3>Lịch sử khớp lệnh</h3>
      <div class="panel table-card">
        <table id="history">
          <thead>
            <tr>
              <th scope="col" class="left">Thời gian</th>
              <th scope="col" class="left">Cặp</th>
              <th scope="col" class="left">Loại</th>
              <th scope="col">Giá sau phí</th>
              <th scope="col">Lượng</th>
              <th scope="col">Phí</th>
              <th scope="col">Giá TB sau lệnh</th>
            </tr>
          </thead>
          <tbody id="drawer-history-body"></tbody>
        </table>
      </div>
    </section>
  </div>
</aside>

<!-- Cài đặt -->
<dialog id="settings" aria-labelledby="settings-title">
  <header class="dialog-head">
    <h2 id="settings-title">Cài đặt</h2>
    <button class="btn ghost small" type="button" data-close>Đóng</button>
  </header>
  <div class="dialog-body settings">
    <section>
      <h3>Kết nối API Key</h3>
      <p class="row">
        <code id="key-masked"></code>
        <button id="key-change" class="btn small" type="button">Đổi key</button>
        <button id="key-remove" class="btn small danger" type="button">Xóa key</button>
      </p>
    </section>

    <section>
      <h3>Phạm vi quét lịch sử</h3>
      <p class="muted">Đồng bộ thường chỉ quét coin đang có số dư. Coin đã bán hết cần quét toàn bộ, hoặc thêm tay bên dưới.</p>
      <p class="row"><button id="scan-full" class="btn small" type="button">Quét toàn bộ</button></p>
      <form id="extra-form" class="row">
        <input id="extra-asset" placeholder="Thêm coin, ví dụ DOGE" aria-label="Thêm coin để quét" autocomplete="off" spellcheck="false">
        <button class="btn small" type="submit">Thêm</button>
      </form>
      <p id="extra-error" class="field-error" role="alert" hidden></p>
      <ul id="extra-list" class="chips"></ul>
      <p class="muted">Cặp đã bị Binance hủy niêm yết có thể không lấy lại được lệnh. Coin mua qua các cặp đó sẽ hiện là “không rõ giá vốn”.</p>
    </section>

    <section>
      <h3>Sao lưu &amp; Dữ liệu</h3>
      <p class="row">
        <button id="export-sqlite" class="btn small" type="button">Xuất .sqlite</button>
        <button id="export-csv" class="btn small" type="button">Xuất CSV</button>
        <button id="wipe" class="btn small danger" type="button">Xóa toàn bộ dữ liệu</button>
      </p>
      <p class="muted">Dữ liệu lưu cục bộ trên máy này. File xuất ra không chứa API key.</p>
    </section>
  </div>
</dialog>

<!-- Hỏi xác nhận -->
<dialog id="confirm" aria-labelledby="confirm-text">
  <form method="dialog" class="confirm">
    <p id="confirm-text"></p>
    <div class="row end">
      <button class="btn small" value="cancel">Hủy</button>
      <button id="confirm-ok" class="btn primary small" value="ok"></button>
    </div>
  </form>
</dialog>

<script type="module" src="dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Viết lại `extension/dashboard.css` theo bảng token Obsidian Pro Terminal**

```css
/* Obsidian Pro Trading Terminal — self-contained dark slate palette, zero external CDNs. */
:root {
  --bg: #090b0f;
  --surface-1: #0e1218;
  --surface-2: #151b23;
  --surface-3: #1c2430;
  --border: #1f2733;
  --border-strong: #2e394a;
  --ink-strong: #f1f5f9;
  --ink: #b6c2d2;
  --ink-muted: #748399;
  --ink-dim: #4c586b;
  --accent: #e5a93c;
  --accent-hover: #f0b84d;
  --accent-ink: #0c1015;
  --accent-bg: rgba(229, 169, 60, 0.12);
  --accent-border: rgba(229, 169, 60, 0.30);
  --up: #16c784;
  --up-bg: rgba(22, 199, 132, 0.12);
  --up-border: rgba(22, 199, 132, 0.28);
  --down: #ea3943;
  --down-bg: rgba(234, 57, 67, 0.12);
  --down-border: rgba(234, 57, 67, 0.28);
  --warn: #eab308;
  --warn-bg: rgba(234, 179, 8, 0.11);
  --info: #38bdf8;
  --info-bg: rgba(56, 189, 248, 0.10);
  --topbar-h: 56px;
  --w: 1360px;
  --ease: 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
  --mono: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color-scheme: dark;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }

body {
  margin: 0;
  min-height: 100dvh;
  background:
    radial-gradient(ellipse 80% 50% at 50% -10%, rgba(56, 189, 248, 0.045), transparent),
    var(--bg);
  color: var(--ink);
  font: 13.5px/1.45 var(--sans);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, p, ul, ol, dl, dd, figure { margin: 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.muted { color: var(--ink-muted); }
.num, td, .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.up { color: var(--up); }
.down { color: var(--down); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

/* ---------- buttons & inputs ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 34px; padding: 0 14px;
  border: 1px solid var(--border-strong); border-radius: 6px;
  background: var(--surface-2); color: var(--ink-strong);
  font: 500 13px var(--sans); white-space: nowrap; cursor: pointer;
  transition: background var(--ease), border-color var(--ease), color var(--ease), transform var(--ease);
}
.btn:hover:not(:disabled) { background: var(--surface-3); border-color: #3b495e; }
.btn:active:not(:disabled) { transform: scale(0.98); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
.btn.primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn.ghost { background: transparent; border-color: transparent; color: var(--ink-muted); }
.btn.ghost:hover:not(:disabled) { background: var(--surface-2); color: var(--ink-strong); }
.btn.danger { color: var(--down); border-color: var(--down-border); background: var(--down-bg); }
.btn.danger:hover:not(:disabled) { background: rgba(234, 57, 67, 0.2); }
.btn.small { height: 30px; padding: 0 11px; font-size: 12.5px; }
.btn.icon { width: 32px; padding: 0; color: var(--ink-muted); }
.btn.block { width: 100%; height: 42px; font-size: 14px; }

input:not([type="checkbox"]) {
  height: 34px; padding: 0 12px; width: 100%;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface-1); color: var(--ink-strong); font: 13px var(--sans);
  transition: border-color var(--ease), background var(--ease);
}
input:not([type="checkbox"]):hover { border-color: var(--border-strong); }
input:not([type="checkbox"]):focus { border-color: var(--accent); background: var(--surface-2); outline: none; }
input::placeholder { color: var(--ink-dim); }
input[type="checkbox"] { width: 14px; height: 14px; accent-color: var(--accent); margin: 0; cursor: pointer; }

.panel, .card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
}

/* ---------- setup & locked ---------- */
.center-screen { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
.setup-shell {
  width: 100%; max-width: 840px;
  display: grid; grid-template-columns: 1.05fr 1fr; gap: 28px; align-items: stretch;
}
.setup-info { display: flex; flex-direction: column; gap: 18px; padding: 12px 0; }
.brand-row { display: flex; align-items: center; gap: 10px; }
.brand-row img { border-radius: 6px; flex: none; }
.setup-info h1 { font-size: 20px; font-weight: 600; color: var(--ink-strong); letter-spacing: -0.01em; }
.badge-spot {
  display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px;
  background: var(--accent-bg); border: 1px solid var(--accent-border);
  color: var(--accent); font: 600 10.5px var(--mono); letter-spacing: 0.06em;
}
.setup-info .lead { color: var(--ink); font-size: 14px; line-height: 1.55; max-width: 44ch; }
.trust-list { list-style: none; padding: 0; display: grid; gap: 10px; }
.trust-list li {
  padding: 12px 14px; border-radius: 8px; background: var(--surface-1); border: 1px solid var(--border);
  display: grid; gap: 3px;
}
.trust-list strong { color: var(--ink-strong); font-size: 13px; }
.trust-list span { color: var(--ink-muted); font-size: 12.5px; }
.setup-steps h2 { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-muted); margin-bottom: 8px; }
.steps { padding-left: 18px; display: grid; gap: 6px; color: var(--ink); font-size: 13px; }
.steps b { color: var(--ink-strong); }

.setup-form { padding: 28px; display: grid; gap: 14px; align-content: start; }
.setup-form h2 { font-size: 17px; color: var(--ink-strong); }
.field { display: grid; gap: 6px; }
.field label { font-size: 12.5px; font-weight: 500; color: var(--ink); }
.setup-form input { height: 40px; font-family: var(--mono); font-size: 13px; }
.input-with-btn { display: flex; align-items: center; gap: 6px; }
.input-with-btn input { flex: 1; }
.field-error { color: var(--down); font-size: 12.5px; }
.note { color: var(--ink-muted); font-size: 12px; }
.demo-link { text-align: center; padding-top: 4px; border-top: 1px solid var(--border); }

.status-card {
  width: 100%; max-width: 440px; padding: 32px;
  display: grid; gap: 14px; justify-items: start;
}
.status-icon {
  width: 42px; height: 42px; border-radius: 8px;
  display: grid; place-items: center; background: var(--warn-bg); color: var(--warn);
}
.status-card h1 { font-size: 18px; color: var(--ink-strong); }
.status-card .lead { color: var(--ink-muted); font-size: 13.5px; }

/* ---------- top command bar ---------- */
.topbar {
  position: sticky; top: 0; z-index: 10; height: var(--topbar-h);
  background: rgba(9, 11, 15, 0.86);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}
@supports not (backdrop-filter: blur(10px)) {
  .topbar { background: var(--bg); }
}
.topbar-inner {
  max-width: var(--w); height: 100%; margin: 0 auto; padding: 0 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.topbar h1 { font-size: 15px; font-weight: 600; color: var(--ink-strong); letter-spacing: -0.01em; }
.topbar-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
#sync-status { font-size: 12px; }
.status-pill {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px;
  border-radius: 4px; border: 1px solid var(--border); background: var(--surface-1);
  color: var(--ink-muted); font: 600 11.5px var(--sans);
}
.status-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--ink-dim); }
.status-pill.on { color: var(--up); background: var(--up-bg); border-color: var(--up-border); }
.status-pill.on::before { background: var(--up); animation: pulse 1.8s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }

/* ---------- page layout ---------- */
.page { max-width: var(--w); margin: 0 auto; padding: 18px 24px 56px; display: grid; gap: 16px; }

.banner {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px 9px 14px;
  border-radius: 6px; font-size: 13px; color: var(--ink-strong); border: 1px solid transparent;
}
.banner span { flex: 1; }
.banner.info { background: var(--info-bg); border-color: rgba(56, 189, 248, 0.25); }
.banner.warn { background: var(--warn-bg); border-color: rgba(234, 179, 8, 0.25); }
.banner.error { background: var(--down-bg); border-color: var(--down-border); }

.progress { padding: 12px 16px; display: grid; gap: 8px; }
progress { width: 100%; height: 4px; appearance: none; border: 0; border-radius: 2px; overflow: hidden; background: var(--surface-3); }
progress::-webkit-progress-bar { background: var(--surface-3); }
progress::-webkit-progress-value { background: var(--accent); transition: width 0.2s; }
#progress-text { color: var(--ink); font: 12.5px var(--mono); }

/* ---------- Executive KPI Strip ---------- */
.kpi-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.kpi-card {
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px 16px; display: grid; gap: 6px; align-content: start; text-align: left;
  transition: border-color var(--ease), background var(--ease);
}
.kpi-card.anchor { border-color: var(--border-strong); background: linear-gradient(180deg, #121720 0%, var(--surface-1) 100%); }
.kpi-action { cursor: pointer; font: inherit; color: inherit; }
.kpi-action:hover { border-color: var(--accent-border); background: var(--surface-2); }
.kpi-label { font-size: 12px; color: var(--ink-muted); font-weight: 500; }
.kpi-val { font-size: 21px; font-weight: 600; color: var(--ink-strong); letter-spacing: -0.02em; line-height: 1.2; }
.kpi-val.up { color: var(--up); }
.kpi-val.down { color: var(--down); }
.kpi-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kpi-sub { font-size: 11.5px; color: var(--ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpi-sub.up { color: var(--up); }
.kpi-sub.down { color: var(--down); }

/* ---------- Allocation strip ---------- */
.alloc { padding: 12px 16px; display: grid; gap: 10px; }
.alloc-bar { display: flex; height: 6px; gap: 2px; border-radius: 3px; overflow: hidden; background: var(--surface-2); }
.alloc-bar i { display: block; min-width: 2px; }
.alloc-legend { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; font: 12px var(--mono); color: var(--ink-muted); }
.alloc-legend button {
  border: 0; background: none; padding: 2px 4px; border-radius: 4px;
  display: inline-flex; align-items: center; gap: 5px; font: inherit; color: inherit; cursor: pointer;
}
.alloc-legend button:hover { background: var(--surface-2); color: var(--ink-strong); }
.alloc-legend b { color: var(--ink-strong); font-weight: 600; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex: none; }

/* ---------- Workspace tabs ---------- */
.workspace-tabs {
  display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid var(--border); padding-bottom: 0;
}
.tab-btn {
  display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px;
  border: 0; border-bottom: 2px solid transparent; border-radius: 6px 6px 0 0;
  background: transparent; color: var(--ink-muted); font: 600 13.5px var(--sans); cursor: pointer;
  transition: color var(--ease), background var(--ease), border-color var(--ease);
}
.tab-btn:hover { color: var(--ink-strong); background: var(--surface-1); }
.tab-btn.active { color: var(--ink-strong); border-bottom-color: var(--accent); background: var(--surface-1); }
.tab-badge {
  padding: 1px 6px; border-radius: 4px; font-size: 11.5px; font-weight: 600;
  background: var(--surface-2); color: var(--ink);
}
.tab-btn.active .tab-badge { background: var(--accent-bg); color: var(--accent); }
.tab-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

.workspace-panel { display: grid; gap: 12px; }

/* ---------- toolbar & filters ---------- */
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.toolbar input[type="search"] { width: 220px; }
.seg-group {
  display: inline-flex; padding: 2px; border-radius: 6px;
  background: var(--surface-1); border: 1px solid var(--border);
}
.seg-btn {
  height: 28px; padding: 0 10px; border: 0; border-radius: 4px;
  background: transparent; color: var(--ink-muted); font: 500 12px var(--sans); cursor: pointer;
  transition: background var(--ease), color var(--ease);
}
.seg-btn:hover { color: var(--ink-strong); }
.seg-btn.active { background: var(--surface-3); color: var(--ink-strong); }
.row-count { font-size: 12px; color: var(--ink-muted); margin-left: auto; }
.check { display: inline-flex; align-items: center; gap: 7px; color: var(--ink-muted); font-size: 12.5px; cursor: pointer; user-select: none; }

/* ---------- tables ---------- */
.table-card { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 0 14px; text-align: right; white-space: nowrap; }
th.left, td.left { text-align: left; }
thead th { height: 36px; font: 500 11.5px var(--sans); color: var(--ink-muted); background: var(--surface-1); border-bottom: 1px solid var(--border); }
thead th button {
  width: 100%; height: 36px; padding: 0; border: 0; background: none; color: inherit;
  font: inherit; text-align: inherit; cursor: pointer; white-space: nowrap;
}
thead th button:hover { color: var(--ink-strong); }
th[aria-sort] button { color: var(--accent); }
th[aria-sort="ascending"] button::after { content: " ▲"; font-size: 8px; vertical-align: 1px; }
th[aria-sort="descending"] button::after { content: " ▼"; font-size: 8px; vertical-align: 1px; }

#holdings thead th, #open-orders thead th { position: sticky; top: 0; z-index: 2; }
#holdings td, #open-orders td { height: 54px; font-size: 13.5px; color: var(--ink-strong); }
tbody tr + tr td { border-top: 1px solid var(--border); }
#holdings tbody tr, #open-orders tbody tr { cursor: pointer; transition: background var(--ease); }
#holdings tbody tr:hover, #holdings tbody tr:focus-visible,
#open-orders tbody tr:hover, #open-orders tbody tr:focus-visible { background: var(--surface-2); }
#holdings tbody tr:focus-visible, #open-orders tbody tr:focus-visible { outline-offset: -2px; }

.cell-stack { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 2px; vertical-align: middle; }
.cell-stack.left { align-items: flex-start; }
.cell-sub { font-size: 11.5px; color: var(--ink-muted); }
.cell-sub.lock { color: var(--accent); }

.coin { display: flex; align-items: center; gap: 10px; font-family: var(--sans); }
.avatar {
  width: 28px; height: 28px; border-radius: 6px; flex: none;
  display: inline-grid; place-items: center; font: 700 11px var(--mono);
  background: var(--surface-3); color: var(--ink-strong); border: 1px solid var(--border-strong);
}
.coin-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.coin b { font-size: 14px; color: var(--ink-strong); }

.tag {
  display: inline-flex; align-items: center; height: 19px; padding: 0 6px; border-radius: 4px;
  font: 500 11px var(--sans); color: var(--warn); background: var(--warn-bg);
}
.tag.plain { color: var(--ink-muted); background: var(--surface-2); }
.tag.ord { color: var(--accent); background: var(--accent-bg); border: 1px solid var(--accent-border); }
.tag.oco { color: var(--info); background: var(--info-bg); }

.price-line { display: inline-flex; align-items: center; gap: 6px; }
.arrow { color: var(--ink-dim); }
.now { display: inline-block; padding: 1px 4px; border-radius: 4px; }
.now.tick-up { animation: tick-up 0.8s ease-out; }
.now.tick-down { animation: tick-down 0.8s ease-out; }
@keyframes tick-up { from { background: var(--up-bg); color: var(--up); } }
@keyframes tick-down { from { background: var(--down-bg); color: var(--down); } }

.chg-badge { font-size: 11px; padding: 1px 5px; border-radius: 4px; }
.chg-badge.up { color: var(--up); background: var(--up-bg); }
.chg-badge.down { color: var(--down); background: var(--down-bg); }

.pill {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 66px; padding: 3px 8px; border-radius: 4px;
  font: 600 12.5px var(--mono); color: var(--ink-muted); background: var(--surface-2); border: 1px solid var(--border);
}
.pill.up { background: var(--up-bg); border-color: var(--up-border); color: var(--up); }
.pill.down { background: var(--down-bg); border-color: var(--down-border); color: var(--down); }
.zero { color: var(--ink-dim); }

/* ---------- Open Orders ---------- */
.orders-summary {
  padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
}
.orders-summary-stats { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.summary-chip {
  font-size: 12.5px; color: var(--ink-muted); padding: 4px 10px; border-radius: 4px;
  background: var(--surface-2); border: 1px solid var(--border);
}
.summary-chip b { color: var(--ink-strong); font-weight: 600; margin-left: 4px; }
.summary-chip.buy b { color: var(--up); }
.summary-chip.sell b { color: var(--down); }
.orders-err { display: flex; align-items: center; gap: 8px; color: var(--down); font-size: 12.5px; }

.side-badge {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 2px 7px; border-radius: 4px; font: 600 11px var(--sans); letter-spacing: 0.03em;
}
.side-badge.BUY { color: var(--up); background: var(--up-bg); border: 1px solid var(--up-border); }
.side-badge.SELL { color: var(--down); background: var(--down-bg); border: 1px solid var(--down-border); }

.fill-track { width: 112px; height: 3px; border-radius: 2px; background: var(--surface-3); overflow: hidden; margin-top: 2px; }
.fill-bar { display: block; height: 100%; background: var(--accent); }
.status-tag { font: 500 12px var(--sans); color: var(--ink); }
.status-tag.partial { color: var(--accent); }

.empty { padding: 56px 24px; text-align: center; display: grid; gap: 14px; justify-items: center; color: var(--ink-muted); font-size: 14px; }
.footnote { color: var(--ink-dim); font-size: 12px; text-align: center; margin-top: 6px; }

/* ---------- Slide-over Coin Drawer ---------- */
.drawer-backdrop {
  position: fixed; inset: 0; z-index: 20;
  background: rgba(4, 6, 10, 0.65); backdrop-filter: blur(2px);
}
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 21;
  width: min(780px, 100vw);
  background: var(--surface-1); border-left: 1px solid var(--border-strong);
  box-shadow: -20px 0 56px rgba(0, 0, 0, 0.55);
  display: flex; flex-direction: column;
  animation: drawer-in var(--ease);
}
@keyframes drawer-in {
  from { transform: translateX(28px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.drawer-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 20px; border-bottom: 1px solid var(--border); flex: none;
}
.drawer-title-wrap { display: flex; align-items: center; gap: 12px; }
.drawer-name-line { display: flex; align-items: center; gap: 8px; }
.drawer-name-line h2 { font-size: 17px; color: var(--ink-strong); }
.drawer-sub { font-size: 12px; color: var(--ink-muted); margin-top: 2px; }
.drawer-body { padding: 18px 20px 28px; overflow-y: auto; display: grid; gap: 16px; align-content: start; }
.drawer-section { display: grid; gap: 8px; }
.drawer-section h3 { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-muted); }

.detail-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.detail-stats div { padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; min-width: 0; }
.detail-stats dt { font-size: 11.5px; color: var(--ink-muted); }
.detail-stats dd { font: 600 14.5px var(--mono); color: var(--ink-strong); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-stats dd.up { color: var(--up); }
.detail-stats dd.down { color: var(--down); }

.notes { list-style: none; padding: 0; display: grid; gap: 6px; }
.notes:empty { display: none; }
.notes li { padding: 9px 12px; border-radius: 6px; background: var(--warn-bg); border: 1px solid rgba(234, 179, 8, 0.25); color: var(--ink-strong); font-size: 12.5px; }
.notes li.plain { background: var(--surface-2); border-color: var(--border); color: var(--ink); }

/* ---------- Chart & Interactive Tooltip ---------- */
.chart { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; display: grid; gap: 8px; }
.chart-stage { position: relative; }
.chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.chart text { font: 10px var(--mono); fill: var(--ink-muted); }
.chart .grid { stroke: var(--border); stroke-width: 1; }
.chart .avg { fill: none; stroke: var(--accent); stroke-width: 1.75; }
.chart .avg-area { fill: url(#avg-area-grad); }
.chart .now { stroke: var(--ink-muted); stroke-width: 1; stroke-dasharray: 4 4; }
.chart .order-line { stroke-width: 1; stroke-dasharray: 3 3; }
.chart .order-line.order-buy { stroke: var(--up); }
.chart .order-line.order-sell { stroke: var(--down); }
.chart .axis-tag { font-size: 9.5px; font-weight: 600; }
.chart .axis-tag.now-tag { fill: var(--ink-strong); }
.chart .axis-tag.order-buy { fill: var(--up); }
.chart .axis-tag.order-sell { fill: var(--down); }
.chart .crosshair { stroke: var(--border-strong); stroke-width: 1; stroke-dasharray: 2 2; pointer-events: none; }
.chart .buy { fill: var(--up); stroke: var(--bg); stroke-width: 1.5; cursor: pointer; }
.chart .sell { fill: var(--down); stroke: var(--bg); stroke-width: 1.5; cursor: pointer; }
.chart circle:hover, .chart circle:focus { r: 5.5; outline: none; }
.chart-tooltip {
  position: absolute; transform: translate(-50%, -100%); pointer-events: none; z-index: 3;
  min-width: 190px; padding: 8px 10px; border-radius: 6px;
  background: var(--surface-2); border: 1px solid var(--border-strong);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55); font-size: 12px; color: var(--ink-strong);
}
.chart-tooltip .tt-head { font-weight: 600; margin-bottom: 2px; }
.chart-tooltip .tt-row { font-family: var(--mono); font-size: 11.5px; }
.chart-tooltip .tt-sub { font-family: var(--mono); font-size: 11px; color: var(--accent); margin-top: 2px; }
.chart-out-range { font: 11.5px var(--mono); color: var(--accent); background: var(--accent-bg); border: 1px solid var(--accent-border); padding: 4px 8px; border-radius: 4px; width: fit-content; }
.chart figcaption { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11.5px; color: var(--ink-muted); }
.chart figcaption span { display: inline-flex; align-items: center; gap: 6px; }
.key { display: inline-block; width: 14px; height: 2px; background: var(--accent); }
.key.now { background: none; border-top: 1px dashed var(--ink-muted); height: 0; }
.key.ord { background: none; border-top: 1px dashed var(--up); height: 0; }
.key.buy, .key.sell { width: 8px; height: 8px; border-radius: 50%; }
.key.buy { background: var(--up); }
.key.sell { background: var(--down); }

.mini-table th, .mini-table td, #history th, #history td { height: 40px; padding: 0 12px; font-size: 12.5px; }
#history thead th { position: sticky; top: 0; z-index: 1; }
.side-BUY { color: var(--up); font-weight: 600; font-family: var(--sans); }
.side-SELL { color: var(--down); font-weight: 600; font-family: var(--sans); }
.side-FEE { color: var(--ink-muted); font-family: var(--sans); }

/* ---------- dialogs ---------- */
dialog {
  padding: 0; border: 1px solid var(--border-strong); border-radius: 10px;
  background: var(--surface-1); color: var(--ink); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
  max-height: calc(100dvh - 48px);
}
dialog[open] { display: flex; flex-direction: column; }
dialog::backdrop { background: rgba(4, 6, 10, 0.65); }
#settings { width: min(560px, calc(100vw - 32px)); }
#confirm { width: min(420px, calc(100vw - 32px)); }
.dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 14px 20px; border-bottom: 1px solid var(--border); }
.dialog-head h2 { font-size: 16px; color: var(--ink-strong); }
.dialog-body { padding: 18px 20px 22px; overflow: auto; display: grid; gap: 16px; }
.settings section { display: grid; gap: 10px; }
.settings section + section { padding-top: 16px; border-top: 1px solid var(--border); }
.settings h3 { font-size: 13.5px; color: var(--ink-strong); }
.settings .muted { font-size: 12.5px; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row.end { justify-content: flex-end; }
.row input { flex: 1; min-width: 160px; }
code { font: 12.5px var(--mono); padding: 4px 8px; border-radius: 4px; background: var(--surface-2); color: var(--ink-strong); }
.settings code { margin-right: auto; }
.chips { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chips:empty { display: none; }
.chips li { display: inline-flex; align-items: center; gap: 2px; padding: 2px 2px 2px 10px; border-radius: 4px; background: var(--surface-2); border: 1px solid var(--border); font: 600 12px var(--mono); color: var(--ink-strong); }
.chips button { border: 0; background: none; color: var(--ink-muted); cursor: pointer; font: inherit; padding: 2px 6px; }
.chips button:hover { color: var(--down); }
.confirm { padding: 22px; display: grid; gap: 18px; font-size: 14px; color: var(--ink-strong); }

@media (max-width: 1080px) {
  .kpi-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .setup-shell { grid-template-columns: 1fr; }
  .topbar-inner, .page { padding-left: 16px; padding-right: 16px; }
  .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .detail-stats { grid-template-columns: repeat(2, 1fr); }
  #holdings th:nth-child(2), #holdings td:nth-child(2),
  #holdings th:nth-child(4), #holdings td:nth-child(4) { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
```

- [ ] **Step 3: Kiểm tra test hiện có không bị ảnh hưởng và commit HTML/CSS**

Run: `npm test`
Expected: PASS 75 tests.

```bash
git add extension/dashboard.html extension/dashboard.css
git commit -m "feat: redesign dashboard HTML and Obsidian Pro Terminal CSS"
```

---

### Task 6: Nối tầng Render UI & Controller (`extension/ui.js`, `extension/dashboard.js`)

**Files:**
- Modify: `extension/ui.js`
- Modify: `extension/dashboard.js`
- Test: `test/ui.test.js`

**Interfaces:**
- Consumes:
  - `createClient` (`accountBalances`, `openOrders`) từ `./binance.js`
  - `buildOpenOrders`, `summarizeOpenOrders`, `visibleOrders`, `sortNullLast` từ `./orders.js`
  - `renderPriceChart` từ `./chart.js`
  - `buildRows`, `summarize` từ `./portfolio.js`
  - `fmtUsd`, `fmtSignedUsd`, `fmtPrice`, `fmtQty`, `fmtPct`, `fmtTime`, `fmtClock` từ `./format.js`
- Produces:
  - `visibleRows(state)` hỗ trợ `state.holdingsFilter` (`'all' | 'warn' | 'orders'`) và `state.ordersSummary.byAsset`

- [ ] **Step 1: Viết unit test thất bại cho `visibleRows` mới trong `test/ui.test.js`**

Lưu ý: `extension/ui.js` chỉ import `./format.js` và `./chart.js`, không chạm `document` ở top-level ngoài helper `$` chỉ gọi trong hàm, nên import `visibleRows` trực tiếp trong Node được.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleRows } from '../extension/ui.js';

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
  ],
};

test('visibleRows lọc theo holdingsFilter warn và orders', () => {
  assert.deepEqual(visibleRows(baseState).map((r) => r.asset), ['BTC', 'ARB']);
  assert.deepEqual(
    visibleRows({ ...baseState, holdingsFilter: 'warn' }).map((r) => r.asset),
    ['ARB'],
  );
  assert.deepEqual(
    visibleRows({ ...baseState, holdingsFilter: 'orders' }).map((r) => r.asset),
    ['BTC'],
  );
});
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `node --test test/ui.test.js`
Expected: FAIL vì `visibleRows` chưa lọc theo `holdingsFilter`.

- [ ] **Step 3: Viết lại `extension/ui.js`**

```js
// DOM rendering only. State and behaviour live in dashboard.js.
import { fmtUsd, fmtSignedUsd, fmtPrice, fmtQty, fmtPct, fmtTime, fmtClock } from './format.js';
import { renderPriceChart } from './chart.js';
import { sortNullLast } from './orders.js';

const $ = (id) => document.getElementById(id);

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
const dash = () => h('span', { class: 'zero' }, '—');

const BADGES = {
  unknown: (r) => `${fmtQty(r.unknownQty)} chưa rõ vốn`,
  oversold: () => 'Thiếu lịch sử mua',
  unpriced: () => 'Không quy đổi được',
  noprice: () => 'Thiếu giá USDT',
};
const EXPLAIN = {
  unknown: (r) => `${fmtQty(r.unknownQty)} ${r.asset} trong ví không có lệnh mua Spot tương ứng (nạp từ ngoài, Convert, Earn, P2P…). Giá trung bình chỉ tính trên phần mua qua Spot.`,
  oversold: () => 'Lịch sử có lệnh bán nhiều hơn số đã mua qua Spot. Một phần coin đến từ nguồn khác, nên lãi/lỗ đã chốt chỉ tính trên phần có giá mua.',
  unpriced: () => 'Có lệnh dùng cặp không quy đổi được sang USDT. Các lệnh đó bị bỏ khỏi giá vốn.',
  noprice: (r) => `Binance không có cặp ${r.asset}USDT nên không tính được giá trị hiện tại.`,
};
const SIDE = { BUY: 'Mua', SELL: 'Bán', FEE: 'Phí' };

export function visibleRows(state) {
  const q = state.query.trim().toUpperCase();
  const byAsset = state.ordersSummary?.byAsset ?? {};
  return state.rows
    .filter((r) => !q || r.asset.includes(q))
    .filter((r) => !state.hideSmall || (r.value ?? (r.balance > 0 ? Infinity : 0)) >= 1)
    .filter((r) => {
      if (state.holdingsFilter === 'warn') return r.warn.length > 0;
      if (state.holdingsFilter === 'orders') return (byAsset[r.asset]?.length ?? 0) > 0;
      return true;
    })
    .sort((a, b) => sortNullLast(a, b, state.sort.key, state.sort.dir));
}

const PALETTE = ['#e5a93c', '#38bdf8', '#16c784', '#a78bfa', '#fb923c', '#2dd4bf', '#f472b6'];
const OTHER = '#526075';

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
  const parts = top.map((r) => ({ name: r.asset, pct: r.alloc, color: colors.get(r.asset), clickable: true }));
  if (rest > 0) parts.push({ name: 'Khác', pct: rest, color: OTHER, clickable: false });
  $('alloc-bar').replaceChildren(...parts.map((p) =>
    h('i', { style: `width:${p.pct}%;background:${p.color}`, title: `${p.name} ${p.pct.toFixed(1)}%` })));
  $('alloc-legend').replaceChildren(...parts.map((p) => h('li', {}, [
    p.clickable
      ? h('button', { type: 'button', 'data-drawer-asset': p.name }, [
          h('span', { class: 'dot', style: `background:${p.color}` }), h('b', {}, p.name), `${p.pct.toFixed(1)}%`,
        ])
      : h('span', { class: 'legend-static' }, [
          h('span', { class: 'dot', style: `background:${p.color}` }), h('b', {}, p.name), `${p.pct.toFixed(1)}%`,
        ]),
  ])));
}

const movedOut = (r) => r.balance > 0 && r.movedOutQty * (r.price ?? 1) >= 1;
const lastPrice = new Map();
let historyKey = '';
let chartKey = '';

function avatarStyle(color) {
  return `background:${color}22;border-color:${color}55;color:${color}`;
}

function pct24h(price, open) {
  if (price == null || open == null || open <= 0) return null;
  return ((price - open) / open) * 100;
}

function holdingRow(r, state, colors) {
  const prev = lastPrice.get(r.asset);
  const tick = prev == null || r.price == null || prev === r.price ? '' : r.price > prev ? 'tick-up' : 'tick-down';
  const color = colors.get(r.asset) ?? OTHER;
  const locked = state.balancesDetail?.locked?.[r.asset] ?? 0;
  const orderCount = state.ordersSummary?.byAsset?.[r.asset]?.length ?? 0;
  const chg = pct24h(r.price, state.open24h?.[r.asset + 'USDT']);

  const coin = h('div', { class: 'coin' }, [
    h('span', { class: 'avatar', style: avatarStyle(color) }, r.asset.slice(0, 3)),
    h('div', { class: 'coin-meta' }, [
      h('b', {}, r.asset),
      orderCount > 0 ? h('span', { class: 'tag ord' }, `${orderCount} lệnh chờ`) : null,
      ...r.warn.map((w) => h('span', { class: 'tag', title: EXPLAIN[w](r) }, BADGES[w](r))),
      movedOut(r)
        ? h('span', { class: 'tag plain', title: 'Đã rút hoặc chuyển sang Earn/Funding. Giá trung bình không đổi.' }, `chuyển ra ${fmtQty(r.movedOutQty)}`)
        : null,
    ]),
  ]);
  const hasPnl = r.unrealized != null && r.knownQty > 0;
  const held = r.balance > 0;

  return h('tr', { tabindex: '0', 'data-asset': r.asset, 'aria-label': `Xem chi tiết ${r.asset}` }, [
    h('td', { class: 'left' }, coin),
    h('td', { class: held ? '' : 'zero' }, [
      h('div', { class: 'cell-stack' }, [
        h('span', {}, fmtQty(r.balance)),
        locked > 0 ? h('span', { class: 'cell-sub lock' }, `Khóa: ${fmtQty(locked)}`) : null,
      ]),
    ]),
    h('td', {}, [
      h('div', { class: 'cell-stack' }, [
        h('div', { class: 'price-line' }, [
          h('span', { class: 'muted' }, r.avg == null ? '—' : fmtPrice(r.avg)),
          h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
          h('span', { class: 'now ' + tick }, r.price == null ? '—' : fmtPrice(r.price)),
        ]),
        chg != null ? h('span', { class: 'chg-badge ' + tone(chg) }, `24h ${fmtPct(chg)}`) : null,
      ]),
    ]),
    h('td', {}, held && r.value != null ? h('div', { class: 'cell-stack' }, [
      h('span', {}, fmtUsd(r.value)),
      r.alloc != null ? h('span', { class: 'cell-sub' }, `${r.alloc.toFixed(1)}%`) : null,
    ]) : dash()),
    h('td', { class: tone(r.unrealized) }, hasPnl ? fmtSignedUsd(r.unrealized) : dash()),
    h('td', {}, hasPnl ? h('span', { class: 'pill ' + tone(r.unrealized) }, fmtPct(r.unrealizedPct)) : dash()),
  ]);
}

function orderRow(o) {
  const statusLabel = o.status === 'PARTIALLY_FILLED' ? 'Khớp một phần' : 'Chờ khớp';
  return h('tr', { tabindex: '0', 'data-order-asset': o.base, 'aria-label': `Xem coin ${o.base}` }, [
    h('td', { class: 'left' }, fmtTime(o.time)),
    h('td', { class: 'left' }, [
      h('div', { class: 'cell-stack left' }, [
        h('span', {}, `${o.base}/${o.quote || '—'}`),
        h('div', { class: 'coin-meta' }, [
          h('span', { class: 'tag plain' }, o.type),
          o.isOco ? h('span', { class: 'tag oco' }, 'OCO') : null,
        ]),
      ]),
    ]),
    h('td', { class: 'left' }, h('span', { class: `side-badge ${o.side}` }, o.side === 'BUY' ? 'MUA' : 'BÁN')),
    h('td', {}, h('div', { class: 'cell-stack' }, [
      h('span', {}, o.price > 0 ? fmtPrice(o.price) : 'MARKET'),
      o.stopPrice != null ? h('span', { class: 'cell-sub' }, `Kích hoạt: ${fmtPrice(o.stopPrice)}`) : null,
    ])),
    h('td', {}, h('div', { class: 'cell-stack' }, [
      h('span', { class: o.distancePct == null ? 'zero' : tone(o.distancePct) }, o.distancePct == null ? '—' : fmtPct(o.distancePct)),
      o.marketPrice != null ? h('span', { class: 'cell-sub' }, `TT: ${fmtPrice(o.marketPrice)}`) : null,
    ])),
    h('td', {}, h('div', { class: 'cell-stack' }, [
      h('span', {}, `${fmtQty(o.executedQty)} / ${fmtQty(o.origQty)}`),
      h('div', { class: 'fill-track', title: `${o.fillPct.toFixed(1)}%` }, h('span', { class: 'fill-bar', style: `width:${o.fillPct}%` })),
    ])),
    h('td', {}, o.remainingValueUsdt != null ? `${fmtUsd(o.remainingValueUsdt)} USDT` : dash()),
    h('td', { class: 'left' }, h('span', { class: o.status === 'PARTIALLY_FILLED' ? 'status-tag partial' : 'status-tag' }, statusLabel)),
  ]);
}

function setStat(id, text, n, base = 'kpi-val num') {
  const el = $(id);
  el.textContent = text;
  el.className = base + (n == null ? '' : ' ' + tone(n));
}

function renderDrawer(state, colors) {
  const asset = state.drawerAsset;
  const open = Boolean(asset);
  $('drawer-backdrop').hidden = !open;
  $('drawer').hidden = !open;
  if (!open) return;

  const row = state.rows.find((r) => r.asset === asset) ?? {
    asset,
    balance: state.balancesDetail?.total?.[asset] ?? 0,
    avg: null,
    price: state.tickers?.[asset + 'USDT'] ?? null,
    value: null,
    knownQty: 0,
    costHeld: 0,
    unrealized: null,
    unrealizedPct: null,
    realized: 0,
    unknownQty: 0,
    movedOutQty: 0,
    warn: [],
  };
  const pos = state.positions[asset];
  const color = colors.get(asset) ?? OTHER;
  const free = state.balancesDetail?.free?.[asset] ?? row.balance;
  const locked = state.balancesDetail?.locked?.[asset] ?? 0;
  const chg = pct24h(row.price, state.open24h?.[asset + 'USDT']);
  const coinOrders = state.ordersSummary?.byAsset?.[asset] ?? [];

  $('drawer-avatar').textContent = asset.slice(0, 3);
  $('drawer-avatar').setAttribute('style', avatarStyle(color));
  $('drawer-title').textContent = asset;
  $('drawer-price').textContent = row.price != null ? `${fmtPrice(row.price)} USDT` : '—';
  $('drawer-change24h').hidden = chg == null;
  if (chg != null) {
    $('drawer-change24h').textContent = `24h ${fmtPct(chg)}`;
    $('drawer-change24h').className = 'chg-badge num ' + tone(chg);
  }
  $('drawer-balance-sub').textContent = `Tổng: ${fmtQty(row.balance)} · Khả dụng: ${fmtQty(free)} · Khóa lệnh: ${fmtQty(locked)}`;

  $('drawer-avg').textContent = fmtPrice(row.avg);
  $('drawer-now').textContent = fmtPrice(row.price);
  $('drawer-cost').textContent = row.costHeld > 0 ? `${fmtUsd(row.costHeld)} USDT` : '—';
  $('drawer-realized').textContent = fmtSignedUsd(row.realized);
  $('drawer-realized').className = 'num ' + tone(row.realized);

  const notes = row.warn.map((w) => h('li', {}, EXPLAIN[w](row)));
  if (movedOut(row)) {
    notes.push(h('li', { class: 'plain' }, `Đã chuyển ${fmtQty(row.movedOutQty)} ${asset} ra khỏi ví Spot (rút, Earn, Funding). Giá trung bình không đổi.`));
  }
  $('drawer-notes').replaceChildren(...notes);

  const chronological = pos?.history ?? [];
  const nextChartKey = `${asset}:${chronological.length}:${row.price ?? ''}:${coinOrders.map((o) => `${o.orderId}@${o.price}`).join(',')}`;
  if (nextChartKey !== chartKey && !$('drawer-chart').matches(':hover')) {
    chartKey = nextChartKey;
    const chart = renderPriceChart({ history: chronological, currentPrice: row.price, openOrders: coinOrders });
    $('drawer-chart').hidden = !chart;
    $('drawer-chart').replaceChildren(...(chart ?? []));
  }

  $('drawer-orders-section').hidden = coinOrders.length === 0;
  $('drawer-orders-body').replaceChildren(...coinOrders.map((o) => h('tr', {}, [
    h('td', { class: 'left' }, [
      h('span', { class: `side-badge ${o.side}` }, o.side === 'BUY' ? 'MUA' : 'BÁN'),
      ' ',
      o.symbol,
    ]),
    h('td', {}, o.price > 0 ? fmtPrice(o.price) : 'MARKET'),
    h('td', { class: o.distancePct == null ? 'zero' : tone(o.distancePct) }, o.distancePct == null ? '—' : fmtPct(o.distancePct)),
    h('td', {}, `${fmtQty(o.executedQty)} / ${fmtQty(o.origQty)}`),
    h('td', {}, o.remainingValueUsdt != null ? `${fmtUsd(o.remainingValueUsdt)} USDT` : dash()),
  ])));

  const nextHistoryKey = `${asset}:${chronological.length}`;
  if (nextHistoryKey !== historyKey) {
    historyKey = nextHistoryKey;
    const history = [...chronological].reverse();
    $('drawer-history-body').replaceChildren(...(history.length
      ? history.map((x) => h('tr', {}, [
          h('td', { class: 'left' }, fmtTime(x.time)),
          h('td', { class: 'left' }, x.symbol),
          h('td', { class: 'left side-' + x.side }, SIDE[x.side]),
          h('td', {}, fmtPrice(x.price)),
          h('td', {}, fmtQty(x.qty)),
          h('td', { class: 'muted' }, x.fee > 0 ? `${fmtQty(x.fee)} ${x.feeAsset}` : '—'),
          h('td', {}, x.qtyAfter > 0 ? fmtPrice(x.avgAfter) : '—'),
        ]))
      : [h('tr', {}, h('td', { class: 'left muted', colspan: '7' }, 'Chưa có lịch sử khớp lệnh Spot cho coin này.'))]));
  }
}

export function render(state, visibleOrdersFn) {
  for (const s of ['setup', 'locked', 'main']) $('screen-' + s).hidden = state.screen !== s;
  if (state.screen === 'setup') {
    $('key-error').textContent = state.keyError ?? '';
    $('key-error').hidden = !state.keyError;
    $('key-submit').disabled = state.keyBusy;
    $('key-submit').textContent = state.keyBusy ? 'Đang kiểm tra key…' : 'Lưu và đồng bộ';
    $('key-cancel').hidden = !state.hasKey;
    return;
  }
  if (state.screen !== 'main') return;

  const syncing = state.sync != null;
  $('sync-status').textContent = syncing ? 'Đang đồng bộ'
    : state.lastSyncedAt ? `Đồng bộ lúc ${fmtClock(state.lastSyncedAt)}` : 'Chưa đồng bộ';
  $('live-status').textContent = state.live ? 'Trực tiếp' : 'Ngoại tuyến';
  $('live-status').className = 'status-pill ' + (state.live ? 'on' : '');
  $('btn-refresh').disabled = state.demo || syncing || state.refreshing;
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
  const os = state.ordersSummary;
  const allocation = allocate(state.rows);
  renderAlloc(allocation);

  setStat('kpi-value', `${fmtUsd(s.value)} USDT`, null);
  const lockedCount = Object.values(state.balancesDetail?.locked ?? {}).filter((v) => v > 0).length;
  $('kpi-value-sub').textContent = lockedCount > 0
    ? `${state.rows.filter((r) => r.balance > 0).length} coin · ${lockedCount} coin đang khóa lệnh`
    : `${state.rows.filter((r) => r.balance > 0).length} coin đang nắm giữ`;
  setStat('kpi-unrealized', fmtSignedUsd(s.unrealized), s.unrealized);
  $('kpi-unrealized-pct').textContent = fmtPct(s.unrealizedPct);
  $('kpi-unrealized-pct').className = 'pill ' + tone(s.unrealized);
  setStat('kpi-cost', `${fmtUsd(s.costHeld)} USDT`, null);
  const unknownRows = state.rows.filter((r) => r.warn.includes('unknown')).length;
  $('kpi-cost-sub').textContent = unknownRows > 0
    ? `${unknownRows} coin có phần chưa rõ nguồn vốn`
    : 'Giá vốn bình quân gia quyền';
  setStat('kpi-realized', fmtSignedUsd(s.realized), s.realized);
  const net = s.unrealized + s.realized;
  $('kpi-net-sub').textContent = `Tổng ròng: ${fmtSignedUsd(net)} USDT`;
  $('kpi-net-sub').className = 'kpi-sub num ' + tone(net);

  $('kpi-orders').textContent = state.ordersError ? 'Lỗi tải' : `${os.totalCount} lệnh`;
  $('kpi-orders-sub').textContent = state.ordersError
    ? 'Bấm để thử tải lại'
    : `${os.buyCount} Mua · ${os.sellCount} Bán · ≈ ${fmtUsd(os.totalLockedUsdt)} USDT`;

  // Workspace tabs
  $('tab-holdings').classList.toggle('active', state.tab === 'holdings');
  $('tab-holdings').setAttribute('aria-selected', String(state.tab === 'holdings'));
  $('tab-orders').classList.toggle('active', state.tab === 'orders');
  $('tab-orders').setAttribute('aria-selected', String(state.tab === 'orders'));
  $('panel-holdings').hidden = state.tab !== 'holdings';
  $('panel-orders').hidden = state.tab !== 'orders';

  const visibleHoldings = visibleRows(state);
  $('tab-holdings-count').textContent = String(state.rows.length);
  $('tab-orders-count').textContent = String(os.totalCount);
  $('tab-orders-dot').hidden = os.totalCount === 0;

  // Holdings table
  $('search').value = state.query;
  $('hide-small').checked = state.hideSmall;
  for (const btn of $('holdings-filters').querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.hfilter === state.holdingsFilter);
  }
  for (const th of document.querySelectorAll('#holdings thead th')) {
    const key = th.querySelector('button').dataset.sort;
    if (key === state.sort.key) th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }
  $('row-count').textContent = state.rows.length ? `${visibleHoldings.length}/${state.rows.length} coin` : '';
  const focusedHolding = document.activeElement?.closest?.('#holdings-body tr')?.dataset.asset;
  $('holdings-body').replaceChildren(...visibleHoldings.map((r) => holdingRow(r, state, allocation.colors)));
  for (const r of state.rows) lastPrice.set(r.asset, r.price);
  if (focusedHolding) $('holdings-body').querySelector(`tr[data-asset="${CSS.escape(focusedHolding)}"]`)?.focus();
  $('holdings').hidden = visibleHoldings.length === 0;
  $('empty').hidden = visibleHoldings.length > 0;
  const noData = state.rows.length === 0;
  $('empty-text').textContent = noData
    ? 'Chưa có lệnh nào. Bấm Đồng bộ để lấy lịch sử từ Binance.'
    : 'Không có coin nào khớp bộ lọc hiện tại.';
  $('empty-sync').hidden = !noData || syncing || state.demo;

  // Open Orders table
  $('orders-summary-buy').textContent = `${os.buyCount} lệnh (≈ ${fmtUsd(os.buyValueUsdt)} USDT)`;
  $('orders-summary-sell').textContent = `${os.sellCount} lệnh (≈ ${fmtUsd(os.sellValueUsdt)} USDT)`;
  $('orders-error').hidden = !state.ordersError;
  $('orders-error-text').textContent = state.ordersError ?? '';

  $('order-search').value = state.orderQuery;
  for (const btn of $('order-side-filters').querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.oside === state.orderSide);
  }
  for (const btn of $('order-type-filters').querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.otype === state.orderType);
  }
  for (const th of document.querySelectorAll('#open-orders thead th')) {
    const key = th.querySelector('button').dataset.osort;
    if (key === state.orderSort.key) th.setAttribute('aria-sort', state.orderSort.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }

  const filteredOrders = visibleOrdersFn(state.openOrders, {
    query: state.orderQuery,
    side: state.orderSide,
    typeFilter: state.orderType,
    sort: state.orderSort,
  });
  $('order-count').textContent = state.openOrders.length ? `${filteredOrders.length}/${state.openOrders.length} lệnh` : '';
  $('open-orders-body').replaceChildren(...filteredOrders.map(orderRow));
  $('open-orders').hidden = filteredOrders.length === 0;
  $('orders-empty').hidden = filteredOrders.length > 0;
  $('orders-empty-text').textContent = state.ordersError
    ? 'Không tải được danh sách lệnh chờ khớp.'
    : state.openOrders.length === 0
      ? 'Hiện không có lệnh Spot nào đang chờ khớp.'
      : 'Không có lệnh chờ nào khớp bộ lọc hiện tại.';

  renderDrawer(state, allocation.colors);
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

export function askConfirm(text, okLabel, { danger = false } = {}) {
  const dlg = $('confirm');
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  $('confirm-ok').className = 'btn small ' + (danger ? 'danger' : 'primary');
  dlg.returnValue = 'cancel';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}
```

- [ ] **Step 4: Cập nhật `extension/dashboard.js`**

```js
// Page controller: owns state, wires events, runs sync and live refresh.
import { computePositions } from './cost.js';
import { buildRows, summarize } from './portfolio.js';
import { createClient } from './binance.js';
import { pickSymbols, estimateMinutes, syncTrades, syncPrices, makePriceAt, toTrade } from './sync.js';
import { buildOpenOrders, summarizeOpenOrders, visibleOrders } from './orders.js';
import { tradesToCsv, download } from './export.js';
import { openTicker } from './live.js';
import { render, renderSettings, askConfirm } from './ui.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  screen: 'main',
  demo: params.has('demo'),
  tab: 'holdings',
  rows: [],
  summary: summarize([]),
  positions: {},
  balancesDetail: null,
  tickers: {},
  open24h: {},
  rawOpenOrders: [],
  openOrders: [],
  ordersSummary: summarizeOpenOrders([]),
  ordersError: null,
  sync: null,
  refreshing: false,
  lastSyncedAt: null,
  error: null,
  retry: null,
  live: false,
  drawerAsset: null,
  keyWarning: false,
  keyError: null,
  keyBusy: false,
  hasKey: false,
  hideSmall: true,
  holdingsFilter: 'all',
  query: '',
  sort: { key: 'value', dir: 'desc' },
  orderQuery: '',
  orderSide: 'ALL',
  orderType: 'ALL',
  orderSort: { key: 'time', dir: 'desc' },
  apiKey: '',
  extraAssets: [],
  extraError: null,
};

let db = null;
let api = null;
let exchange = null;
let balances = null;
let tickers = null;
let abort = null;
let ticker = null;
let tickerKey = '';
let repaintQueued = false;
let lastFocusEl = null;
const store = globalThis.chrome?.storage?.local;

const update = () => render(state, visibleOrders);

function setError(e, retry = null) {
  console.error(e);
  state.error = e?.kind ? e.message : `Có lỗi xảy ra: ${e?.message ?? e}`;
  state.retry = retry;
}

function recompute(tradeRows, priceRows) {
  state.positions = computePositions(tradeRows.map(toTrade), makePriceAt(priceRows));
  rebuildViews();
  watchPrices();
}

function rebuildViews() {
  const held = balances ?? Object.fromEntries(
    Object.values(state.positions).filter((p) => p.qty > 0).map((p) => [p.asset, p.qty]),
  );
  state.tickers = tickers ?? {};
  state.rows = buildRows(state.positions, held, state.tickers);
  state.summary = summarize(state.rows);
  state.openOrders = buildOpenOrders(state.rawOpenOrders, exchange ?? [], state.tickers);
  state.ordersSummary = summarizeOpenOrders(state.openOrders);
}

function watchPrices() {
  const set = new Set(
    state.rows.filter((r) => r.balance > 0 && r.price != null).map((r) => r.asset + 'USDT'),
  );
  for (const o of state.openOrders) {
    set.add(o.symbol);
    if (o.quote && (tickers?.[o.quote + 'USDT'] != null)) set.add(o.quote + 'USDT');
  }
  const symbols = [...set].sort();
  const key = symbols.join(',');
  if (key === tickerKey) return;
  tickerKey = key;
  ticker?.close();
  ticker = openTicker({
    symbols,
    onStatus: (connected) => { state.live = connected; update(); },
    onPrice: (symbol, price, openPrice) => {
      tickers[symbol] = price;
      if (Number.isFinite(openPrice) && openPrice > 0) state.open24h[symbol] = openPrice;
      if (repaintQueued) return;
      repaintQueued = true;
      setTimeout(() => { repaintQueued = false; rebuildViews(); update(); }, 500);
    },
  });
}

function stopPrices() {
  ticker?.close();
  ticker = null;
  tickerKey = '';
  state.live = false;
}

async function getExchange() {
  exchange ??= await api.exchangeInfo();
  return exchange;
}

async function refreshOpenOrdersOnly() {
  state.ordersError = null;
  try {
    const [raw] = await Promise.all([api.openOrders(), getExchange().catch(() => [])]);
    state.rawOpenOrders = raw;
  } catch (e) {
    console.error(e);
    state.ordersError = e?.kind ? e.message : `Không tải được lệnh chờ: ${e?.message ?? e}`;
  }
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  update();

  const [tradeRows, priceRows] = await Promise.all([db.allTrades(), db.getPrices()]);
  try {
    const [balDetail, latestTickers] = await Promise.all([api.accountBalances(), api.tickerPrices()]);
    state.balancesDetail = balDetail;
    balances = balDetail.total;
    tickers = latestTickers;
    state.error = null;
    state.retry = null;
    await refreshOpenOrdersOnly();
  } catch (e) {
    setError(e, refresh);
  } finally {
    state.refreshing = false;
  }
  recompute(tradeRows, priceRows);
  update();
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
    const skipSyncedSince = full ? Date.now() - 3_600_000 : Infinity;
    await syncTrades({ api, db, symbols, onProgress, signal, skipSyncedSince });
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
    await candidate.account();
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
  $('api-secret').type = 'password';
  $('toggle-secret').textContent = 'Hiện';
  update();
  await runSync(false);
}

async function removeKey() {
  const ok = await askConfirm('Xóa API key khỏi máy này? Lịch sử lệnh đã lưu vẫn được giữ.', 'Xóa key', { danger: true });
  if (!ok) return;
  abort?.abort();
  await store.remove(['apiKey', 'secret', 'keyRisky']);
  api = null;
  stopPrices();
  balances = tickers = null;
  state.balancesDetail = null;
  state.rawOpenOrders = [];
  state.openOrders = [];
  state.ordersSummary = summarizeOpenOrders([]);
  state.drawerAsset = null;
  Object.assign(state, { apiKey: '', hasKey: false, keyWarning: false, screen: 'setup', keyError: null });
  $('settings').close();
  update();
}

// ---------- settings ----------

const settingsView = () => renderSettings({
  apiKeyMasked: state.apiKey ? '••••••••' + state.apiKey.slice(-4) : 'Dữ liệu mẫu',
  extraAssets: state.extraAssets,
  extraError: state.extraError,
  demo: state.demo,
});

async function scanFull() {
  try {
    const n = (await getExchange()).length;
    const ok = await askConfirm(
      `Quét toàn bộ ${n.toLocaleString('en-US')} cặp trên Binance, mất khoảng ${estimateMinutes(n)} phút. ` +
      'Giữ tab này mở trong lúc quét. Nếu bị ngắt, bấm Quét toàn bộ lại trong vòng 1 giờ để chạy tiếp từ chỗ dừng.', 'Quét toàn bộ',
    );
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
    'Xóa dữ liệu', { danger: true },
  );
  if (!ok) return;
  await db.wipe();
  await store.remove('lastSyncedAt');
  state.lastSyncedAt = null;
  $('settings').close();
  await refresh();
}

// ---------- drawer & navigation ----------

function openDrawer(asset, triggerEl = document.activeElement) {
  lastFocusEl = triggerEl;
  state.drawerAsset = asset;
  update();
  $('drawer').focus();
}

function closeDrawer() {
  if (!state.drawerAsset) return;
  state.drawerAsset = null;
  update();
  lastFocusEl?.focus?.();
  lastFocusEl = null;
}

function setTab(tab) {
  state.tab = tab;
  update();
}

// ---------- events ----------

function wire() {
  $('key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveKey($('api-key').value.trim(), $('api-secret').value.trim());
  });
  $('toggle-secret').addEventListener('click', () => {
    const input = $('api-secret');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('toggle-secret').textContent = show ? 'Ẩn' : 'Hiện';
  });
  $('key-cancel').addEventListener('click', () => { state.screen = 'main'; state.keyError = null; update(); });
  $('locked-retry').addEventListener('click', () => location.reload());

  $('btn-refresh').addEventListener('click', refresh);
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
  $('orders-retry').addEventListener('click', async () => {
    await refreshOpenOrdersOnly();
    rebuildViews();
    update();
  });

  $('kpi-orders-card').addEventListener('click', () => setTab('orders'));
  $('tab-holdings').addEventListener('click', () => setTab('holdings'));
  $('tab-orders').addEventListener('click', () => setTab('orders'));

  $('alloc-legend').addEventListener('click', (e) => {
    const asset = e.target.closest('[data-drawer-asset]')?.dataset.drawerAsset;
    if (asset) openDrawer(asset, e.target.closest('button'));
  });

  $('drawer-close').addEventListener('click', closeDrawer);
  $('drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.drawerAsset && !document.querySelector('dialog[open]')) {
      closeDrawer();
    }
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
    if (e.target instanceof HTMLDialogElement && e.target.id !== 'confirm') e.target.close();
  });

  $('search').addEventListener('input', (e) => { state.query = e.target.value; update(); });
  $('holdings-filters').addEventListener('click', (e) => {
    const f = e.target.closest('[data-hfilter]')?.dataset.hfilter;
    if (f) { state.holdingsFilter = f; update(); }
  });
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
    if (tr) openDrawer(tr.dataset.asset, tr);
  });
  $('holdings-body').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr')) {
      e.preventDefault();
      openDrawer(e.target.dataset.asset, e.target);
    }
  });

  $('order-search').addEventListener('input', (e) => { state.orderQuery = e.target.value; update(); });
  $('order-side-filters').addEventListener('click', (e) => {
    const s = e.target.closest('[data-oside]')?.dataset.oside;
    if (s) { state.orderSide = s; update(); }
  });
  $('order-type-filters').addEventListener('click', (e) => {
    const t = e.target.closest('[data-otype]')?.dataset.otype;
    if (t) { state.orderType = t; update(); }
  });
  $('open-orders').querySelector('thead').addEventListener('click', (e) => {
    const key = e.target.closest('button')?.dataset.osort;
    if (!key) return;
    const same = state.orderSort.key === key;
    state.orderSort = { key, dir: same ? (state.orderSort.dir === 'asc' ? 'desc' : 'asc') : key === 'symbol' ? 'asc' : 'desc' };
    update();
  });
  $('open-orders-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (tr) openDrawer(tr.dataset.orderAsset, tr);
  });
  $('open-orders-body').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr')) {
      e.preventDefault();
      openDrawer(e.target.dataset.orderAsset, e.target);
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
  state.balancesDetail = demo.balancesDetail;
  tickers = { ...demo.tickers };
  state.open24h = { ...demo.open24h };
  exchange = demo.exchangeSymbols;
  state.rawOpenOrders = demo.openOrders;
  state.lastSyncedAt = demo.lastSyncedAt;
  recompute(demo.rows, demo.priceRows);

  const view = params.get('state');
  if (view === 'setup' || view === 'locked') state.screen = view;
  if (view === 'syncing') state.sync = { phase: 'trades', done: 12, total: 140, symbol: 'BTCUSDT', newTrades: 3204, stopping: false };
  if (view === 'error') state.error = 'Không kết nối được tới Binance. Kiểm tra mạng rồi thử lại.';
  if (view === 'orders') state.tab = 'orders';
  if (view === 'drawer') state.drawerAsset = 'BTC';
  if (view === 'empty') {
    state.rows = [];
    state.summary = summarize([]);
    state.rawOpenOrders = [];
    state.openOrders = [];
    state.ordersSummary = summarizeOpenOrders([]);
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
```

- [ ] **Step 5: Chạy toàn bộ test suite**

Run: `npm test`
Expected: PASS toàn bộ tests (bao gồm `test/ui.test.js`).

- [ ] **Step 6: Commit**

```bash
git add extension/ui.js extension/dashboard.js test/ui.test.js
git commit -m "feat: wire Pro Terminal UI, open orders tab, and slide-over coin drawer"
```

---

### Task 7: Kiểm thử trực quan trên trình duyệt (`?demo=1`) & Hoàn tất xác minh

**Files:**
- Không sửa code trừ khi phát hiện lỗi visual/runtime trong quá trình kiểm tra.

- [ ] **Step 1: Phục vụ thư mục `extension/` qua HTTP local để load ES modules**

Run (background): `python3 -m http.server 4173 --directory extension`

- [ ] **Step 2: Kiểm tra trực quan bằng Playwright / Chrome ở các trạng thái & độ rộng**

Kiểm tra lần lượt không có lỗi console / JS exception và không bị tràn ngang:
1. `http://localhost:4173/dashboard.html?demo=1` (màn `1440x900` và `1280x800` và `760x900`): kiểm tra Command Bar, 5 ô KPI Strip, Allocation Bar, bảng Holdings (monogram, tag `lệnh chờ`, `Khóa:`, `% 24h`, tỷ trọng `%`, tint-border pills).
2. Chuyển sang Tab `Lệnh chờ khớp` (hoặc `?demo=1&state=orders`): kiểm tra summary chip, bộ lọc Mua/Bán & Limit/Stop, thanh progress bar khớp một phần, cột Cách giá TT.
3. Click 1 coin (hoặc `?demo=1&state=drawer`): kiểm tra Slide-over Drawer mượt, rê chuột vào điểm Mua/Bán trên biểu đồ kiểm tra tooltip nổi, kiểm tra đường nét đứt lệnh chờ khớp trên biểu đồ, bảng Lệnh chờ của coin, bảng Lịch sử, và đóng bằng `Esc`.
4. Kiểm tra các màn hình phụ: `?demo=1&state=setup`, `?demo=1&state=locked`, `?demo=1&state=empty`, `?demo=1&state=error`, `?demo=1&state=syncing`, và mở dialog Cài đặt (`#settings`).

- [ ] **Step 3: Tắt server HTTP local và chạy lại `npm test` lần cuối**

Run: `npm test`
Expected: PASS 100%, working tree sạch.
