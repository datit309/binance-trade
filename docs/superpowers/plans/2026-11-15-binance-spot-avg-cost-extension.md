# Extension giá vốn trung bình Binance Spot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extension Chrome kéo toàn bộ lịch sử khớp lệnh Spot bằng API key của người dùng, lưu SQLite cục bộ, hiện giá vốn trung bình và lãi/lỗ từng coin.

**Architecture:** Trang dashboard (tab riêng) điều phối mọi thứ. Logic thuần (`cost.js`, `portfolio.js`, `sync.js`, `binance.js`) không đụng DOM hay `chrome.*`, nhận phụ thuộc qua tham số nên test được bằng Node. SQLite chạy trong một module Worker với VFS `opfs-sahpool`; trang nói chuyện với Worker qua RPC `postMessage`.

**Tech Stack:** Manifest V3, JS thuần ES modules, không build step. `@sqlite.org/sqlite-wasm` 3.54.1-build1 (vendored). WebCrypto cho HMAC. Test: `node --test` (Node 24).

**Spec:** `docs/superpowers/specs/2026-11-15-binance-spot-avg-cost-extension-design.md`

## Global Constraints

- Host mạng duy nhất: `https://api.binance.com`. Không script từ xa, không analytics.
- Chỉ gọi endpoint đọc. Không có code đặt/hủy lệnh.
- API key + secret chỉ nằm trong `chrome.storage.local`, không vào SQLite, không vào log, secret không hiện lại sau khi lưu.
- Không dependency runtime ngoài SQLite WASM. Không framework, không bundler.
- Toàn bộ chữ trên giao diện là tiếng Việt. Số định dạng `en-US` (`12,430.50`), căn phải, `font-variant-numeric: tabular-nums`.
- Stablecoin = `USDT, USDC, FDUSD, BUSD, TUSD, DAI`, tính 1 = 1 USDT, không là vị thế.
- Số trong DB lưu TEXT đúng chuỗi Binance trả; đổi sang `Number` khi tính.
- Mã extension nằm trong `extension/`; test trong `test/`; `package.json` ở gốc repo với `"type": "module"`.
- Giao diện: nền tối mặc định theo `prefers-color-scheme`, có bản sáng; mọi thao tác dùng được bằng bàn phím, focus nhìn thấy rõ; không cuộn ngang ở bề rộng ≥ 900px.

## Review Focus

1. **Bụi số thực sau khi bán hết** (còn `1e-17` coin): phải hiện là 0, không thành một dòng "đang giữ". Test ở Task 1.
2. **Hai lệnh cùng mili-giây, hoặc lệnh trên cặp stable/stable (`USDCUSDT`)**: thứ tự xác định theo `(time, id)`; cặp stable/stable không tạo vị thế, không lỗi. Test ở Task 1.
3. **Đồng hồ máy lệch** (lỗi `-1021`): tự lấy lại lệch giờ và gọi lại một lần, người dùng không thấy lỗi. Test ở Task 3.
4. **Key sai, hết hạn, hoặc bị giới hạn IP** (`-2014`, `-2015`): thông báo tiếng Việt dễ hiểu ngay tại form, không phải JSON thô. Test ở Task 3.
5. **Đóng tab hoặc rớt mạng giữa lúc đồng bộ**: chạy lại không mất, không trùng lệnh, tiếp từ trang đang dở. Test ở Task 4.

---

### Task 1: Bộ tính giá vốn (`cost.js`)

**Files:**
- Create: `package.json`, `extension/cost.js`
- Test: `test/cost.test.js`

**Interfaces:**
- Produces:
  ```js
  export const STABLES            // Set<string>
  // trade: { symbol, id, base, quote, qty, quoteQty, commission, commissionAsset, time, isBuyer }  (số là Number)
  // priceAt(asset, time) -> number | null     giá USDT của 1 đơn vị asset tại thời điểm đó
  export function computePositions(trades, priceAt)  // -> { [asset]: Position }
  // Position: { asset, qty, cost, avg, realized, oversold, unpriced, history }
  // history[i]: { time, symbol, tradeId, side: 'BUY'|'SELL'|'FEE', qty, usdt, price, qtyAfter, avgAfter, fee, feeAsset }
  ```

- [ ] **Step 1: Tạo `package.json`**

`{"private": true, "type": "module", "scripts": {"test": "node --test"}}`

- [ ] **Step 2: Viết test thất bại** trong `test/cost.test.js`

Dùng helper `t(symbol, base, quote, isBuyer, qty, quoteQty, extra)` tự tăng `id` và `time`. `priceAt` mặc định trả `null`. So sánh số bằng sai số `1e-9`.

| Test | Lệnh | Kỳ vọng |
|---|---|---|
| mua hai lần | mua 1 BTC = 100 USDT; mua 1 BTC = 200 | BTC `qty 2, cost 300, avg 150, realized 0` |
| bán một phần | như trên + bán 1 BTC = 250 | `qty 1, cost 150, avg 150, realized 100` |
| bán hết rồi mua lại | mua 1 = 100; bán 1 = 130; mua 2 = 100 | `qty 2, avg 50, realized 30` |
| phí bằng base | mua 10 ALT = 100 USDT, phí `0.01 ALT` | `qty 9.99, cost 100` |
| phí bằng quote stable khi bán | mua 10 ALT = 100; bán 5 = 100, phí `0.1 USDT` | `qty 5, cost 50, realized 49.9` |
| phí bằng BNB | mua 1 BNB = 300; mua 100 ALT = 100 USDT, phí `0.001 BNB`, `priceAt('BNB') = 400` | ALT `cost 100.4`; BNB `qty 0.999, cost 299.7, realized 0.1` |
| quote là BTC | mua 1 BTC = 50000 USDT; mua 1000 ALT trên `ALTBTC`, `quoteQty 0.1`, `priceAt('BTC') = 60000` | ALT `cost 6000, avg 6`; BTC `qty 0.9, cost 45000, realized 1000` |
| bán vượt | mua 2 ALT = 20; bán 5 = 100 | `qty 0, cost 0, realized 20, oversold true` |
| bán khi chưa có gì | bán 5 ALT = 100 | `qty 0, realized 0, oversold true` |
| không quy đổi được | mua 10 ALT trên `ALTXYZ`, `priceAt` trả `null` | ALT `qty 0, unpriced true`; XYZ `unpriced true` |
| bụi số thực | mua 0.1 ba lần (mỗi lần 1 USDT); bán 0.3 = 6 | `qty === 0`, `cost === 0` (đúng bằng 0) |
| cùng mili-giây | truyền ngược thứ tự: bán (id 2) trước mua (id 1), cùng `time` | kết quả như mua trước bán sau, `oversold false` |
| cặp stable/stable | mua 100 USDC trên `USDCUSDT` | object trả về rỗng |
| lịch sử | mua 1 = 100; mua 1 = 200 | BTC `history.length 2`, phần tử 2: `side 'BUY', price 200, qtyAfter 2, avgAfter 150` |

- [ ] **Step 3: Chạy test, xác nhận thất bại**

Run: `npm test` → FAIL (không tìm thấy `extension/cost.js`).

- [ ] **Step 4: Viết `computePositions` trong `extension/cost.js`**

Thuật toán (chữ ký và test chưa xác định hết, nên ghi rõ):

```
sắp xếp bản sao trades theo (time, id)
acquire(asset, qty, usdt):   bỏ qua nếu asset là stable;  p.qty += qty;  p.cost += usdt
dispose(asset, qty, usdt):   bỏ qua nếu asset là stable
    known = min(qty, p.qty);  nếu qty > p.qty * (1 + 1e-9) thì p.oversold = true
    avg = p.qty > 0 ? p.cost / p.qty : 0
    p.realized += usdt * (qty > 0 ? known / qty : 0) - avg * known
    p.cost -= avg * known;  p.qty -= known
    nếu p.qty < 1e-12 thì p.qty = 0, p.cost = 0

với mỗi trade:
    quoteUsdt = quote là stable ? quoteQty : quoteQty * priceAt(quote, time)
    nếu priceAt trả null: gắn unpriced cho base và quote, bỏ qua trade
    feeInBase = commissionAsset == base ? commission : 0
    feeUsdt = 0
    nếu commission > 0 và commissionAsset != base:
        feeUsdt = asset phí là stable ? commission : commission * priceAt(commissionAsset, time)
        nếu null: feeUsdt = 0, gắn unpriced cho base và asset phí
    mua:  acquire(base, qty - feeInBase, quoteUsdt + feeUsdt);  dispose(quote, quoteQty, quoteUsdt)
    bán:  dispose(base, qty + feeInBase, quoteUsdt - feeUsdt);  acquire(quote, quoteQty, quoteUsdt)
    nếu feeUsdt > 0 và asset phí không stable:  dispose(asset phí, commission, feeUsdt)   // side 'FEE'
```

Mỗi `acquire`/`dispose` đẩy một dòng vào `history` của asset đó. `avg` cuối = `qty > 0 ? cost / qty : 0`. Chỉ trả về asset từng có `acquire`/`dispose` hoặc bị gắn cờ.

- [ ] **Step 5: Chạy test, xác nhận qua**

Run: `npm test` → PASS toàn bộ 14 test.

- [ ] **Step 6: Commit** — `feat: weighted-average cost engine`

---

### Task 2: Ghép vị thế với số dư và giá (`portfolio.js`)

**Files:**
- Create: `extension/portfolio.js`
- Test: `test/portfolio.test.js`

**Interfaces:**
- Consumes: `computePositions` output, `STABLES` (Task 1).
- Produces:
  ```js
  // balances: { [asset]: number }  (free + locked);  tickers: { [symbol]: number }
  export function buildRows(positions, balances, tickers)  // -> Row[]
  // Row: { asset, balance, avg, price, value, knownQty, costHeld, unrealized, unrealizedPct,
  //        realized, unknownQty, movedOutQty, warn }      warn: string[] thuộc 'unknown'|'oversold'|'unpriced'|'noprice'
  export function summarize(rows)  // -> { costHeld, value, unrealized, unrealizedPct, realized }
  ```

- [ ] **Step 1: Viết test thất bại**

| Test | Đầu vào | Kỳ vọng |
|---|---|---|
| khớp hoàn toàn | BTC `qty 1, cost 100`; số dư 1; `BTCUSDT 150` | `balance 1, avg 100, price 150, value 150, knownQty 1, costHeld 100, unrealized 50, unrealizedPct 50, warn []` |
| số dư lớn hơn | BTC `qty 1, cost 100`; số dư 3; giá 150 | `value 450, knownQty 1, costHeld 100, unrealized 50, unknownQty 2, warn ['unknown']` |
| chênh lệch bụi | BTC `qty 1`; số dư 1.000001; giá 150 | `warn []` (phần chưa rõ < 1 USDT) |
| số dư nhỏ hơn | BTC `qty 3, cost 300`; số dư 1; giá 150 | `knownQty 1, costHeld 100, unrealized 50, movedOutQty 2, warn []` |
| không có giá | ALT `qty 5, cost 10`; số dư 5; không ticker | `price null, value null, unrealized null, warn ['noprice']` |
| có số dư, không có lệnh | số dư ARB 10; giá 1 | `avg null, knownQty 0, unknownQty 10, warn ['unknown']` |
| bỏ stablecoin | số dư USDT 500 | không có dòng USDT |
| đã bán hết | BTC `qty 0, realized 30`; không số dư | có dòng, `balance 0, realized 30` |
| tổng | hai dòng trên (khớp hoàn toàn + đã bán hết) | `costHeld 100, value 150, unrealized 50, unrealizedPct 50, realized 30` |

- [ ] **Step 2: Chạy test, xác nhận thất bại** — `npm test`

- [ ] **Step 3: Viết `buildRows` và `summarize`**

Quy tắc: `price = tickers[asset + 'USDT'] ?? null`. `knownQty = min(balance, position.qty)`. `costHeld = knownQty * avg`. `unrealized = knownQty * price - costHeld`. `unknownQty = max(0, balance - qty)`, `movedOutQty = max(0, qty - balance)`. Cờ `'unknown'` khi `unknownQty * price >= 1` (hoặc `price` là `null` và `unknownQty > 0`). Cờ `'oversold'`/`'unpriced'` lấy từ position. `summarize.value = costHeld + unrealized` (chỉ phần có giá vốn rõ); dòng có `price null` không cộng vào `value`/`unrealized`. Sắp xếp mặc định theo `value` giảm dần, `null` cuối.

- [ ] **Step 4: Chạy test, xác nhận qua** — `npm test`

- [ ] **Step 5: Commit** — `feat: merge positions with balances and prices`

---

### Task 3: Client Binance (`binance.js`)

**Files:**
- Create: `extension/binance.js`
- Test: `test/binance.test.js`

**Interfaces:**
- Produces:
  ```js
  export async function sign(secret, queryString)   // -> chuỗi hex HMAC-SHA256
  export class BinanceError extends Error { code; kind; retryAfter }   // kind: 'auth'|'ratelimit'|'network'|'other'
  export function createClient({ apiKey, secret, fetch = globalThis.fetch, sleep, now = Date.now })
  // -> { exchangeInfo(), account(), apiRestrictions(), myTrades(symbol, fromId),
  //      tickerPrices(), klines(symbol, startTime, limit) }
  ```
  - `exchangeInfo()` → `[{ symbol, base, quote }]`
  - `account()` → `{ [asset]: number }` (free + locked, chỉ số dư > 0)
  - `apiRestrictions()` → `{ canTrade: boolean, canWithdraw: boolean }`
  - `myTrades(symbol, fromId)` → mảng thô của Binance, `limit=1000`
  - `tickerPrices()` → `{ [symbol]: number }`
  - `klines(symbol, startTime, limit)` → `[{ minute, close }]`, interval `1m`

- [ ] **Step 1: Viết test thất bại** (fetch giả trả `Response`, `sleep` giả ghi lại số ms)

| Test | Kỳ vọng |
|---|---|
| `sign` vector của Binance | secret `NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j`, query `symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559` → `c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71` (đối chiếu trước bằng `openssl dgst -sha256 -hmac`) |
| request có ký | `myTrades('BTCUSDT', 5)` gọi URL bắt đầu `https://api.binance.com/api/v3/myTrades?`, có `symbol=BTCUSDT`, `fromId=5`, `limit=1000`, `timestamp=`, `signature=`; header `X-MBX-APIKEY` |
| request công khai không ký | `tickerPrices()` không có `signature`, không có header key |
| lệch giờ | `/api/v3/time` trả `serverTime = now + 5000` → `timestamp` gửi đi = `now + 5000` |
| `-1021` tự sửa | lần 1 trả 400 `{code:-1021}`, lần 2 trả 200 → kết quả trả về bình thường, `/api/v3/time` được gọi lại đúng 1 lần |
| key sai | 401 `{code:-2015}` → ném `BinanceError` `kind 'auth'`, `message` = `API key không hợp lệ, đã hết hạn, hoặc bị giới hạn IP.` |
| gần ngưỡng weight | response có `x-mbx-used-weight-1m: 4900` → request kế tiếp chờ `sleep` trước khi gọi |
| 429 | lần 1 trả 429 `Retry-After: 7`, lần 2 trả 200 → `sleep(8000)` rồi thành công |
| 418 | trả 418 `Retry-After: 120` → ném `kind 'ratelimit'`, `retryAfter 120`, không gọi lại |
| 429 hai lần liền | ném `kind 'ratelimit'` |
| mạng lỗi | fetch ném `TypeError` → `kind 'network'`, `message` = `Không kết nối được tới Binance. Kiểm tra mạng rồi thử lại.` |

- [ ] **Step 2: Chạy test, xác nhận thất bại** — `npm test`

- [ ] **Step 3: Viết `binance.js`**

Endpoint: `/api/v3/time`, `/api/v3/exchangeInfo`, `/api/v3/account?omitZeroBalances=true`, `/sapi/v1/account/apiRestrictions` (`enableSpotAndMarginTrading` → `canTrade`, `enableWithdrawals` → `canWithdraw`), `/api/v3/myTrades`, `/api/v3/ticker/price`, `/api/v3/klines`. Ngưỡng nghỉ: weight đã dùng ≥ 4800 thì `sleep` đến hết phút hiện tại + 1 giây. `recvWindow=10000`. Lệch giờ lấy lười ở request có ký đầu tiên. Dùng `crypto.subtle` (có sẵn cả trong Node 24 lẫn Chrome).

- [ ] **Step 4: Chạy test, xác nhận qua** — `npm test`

- [ ] **Step 5: Commit** — `feat: signed Binance client with rate-limit handling`

---

### Task 4: Đồng bộ lệnh và giá quy đổi (`sync.js`)

**Files:**
- Create: `extension/sync.js`
- Test: `test/sync.test.js`

**Interfaces:**
- Consumes: client của Task 3; `STABLES` của Task 1; `db` có các method ở Task 5 (trong test dùng object giả cùng tên method).
- Produces:
  ```js
  export function pickSymbols({ exchangeSymbols, balances, knownSymbols, extraAssets, full })  // -> [{symbol, base, quote}]
  export function estimateMinutes(symbolCount)          // ceil(symbolCount * 20 / 4800)
  export async function syncTrades({ api, db, symbols, onProgress, signal })   // -> số lệnh mới
  export function neededPrices(trades, exchangeSymbols)  // -> [{ symbol, minute, inverse }]
  export async function syncPrices({ api, db, trades, exchangeSymbols, onProgress, signal })
  export function makePriceAt(priceRows)                 // -> (asset, time) => number | null
  export function toTrade(row)                           // dòng DB (TEXT) -> trade cho computePositions
  ```
  `onProgress({ phase: 'trades'|'prices', done, total, symbol, newTrades })`.

- [ ] **Step 1: Viết test thất bại**

| Test | Kỳ vọng |
|---|---|
| `pickSymbols` nhanh | sàn có `BTCUSDT, BTCFDUSD, ETHUSDT, ETHBTC, SOLUSDT`; số dư `{BTC:1}`; `knownSymbols ['SOLUSDT']`; `extraAssets ['ETH']` → `BTCUSDT, BTCFDUSD, ETHUSDT, ETHBTC, SOLUSDT` |
| `pickSymbols` nhanh, không extra | như trên, `extraAssets []` → `BTCUSDT, BTCFDUSD, SOLUSDT` |
| `pickSymbols` toàn bộ | `full: true` → cả 5 symbol |
| `estimateMinutes` | `estimateMinutes(3000) === 13` |
| phân trang | api trả 1000 lệnh (id 0..999) rồi 3 lệnh (id 1000..1002) → gọi `myTrades` với `fromId 0` rồi `1000`; `db.insertTrades` nhận tổng 1003 dòng; con trỏ lưu `1002` |
| chạy tiếp | con trỏ đang là `1002` → lần gọi đầu có `fromId 1003` |
| symbol chưa có lệnh | api trả `[]` → `db.setCursor(symbol, …, null)` vẫn được gọi (ghi `last_synced_at`), `fromId` lần sau vẫn là `0` |
| dừng giữa chừng | `signal` abort sau trang 1 → dừng, con trỏ = id cuối của trang 1, không ném lỗi |
| lỗi giữa chừng | api ném lỗi ở trang 2 → lỗi được ném ra, con trỏ = id cuối của trang 1 |
| `neededPrices` | lệnh `ALTBTC` + lệnh `ALTUSDT` phí BNB + lệnh `ALTTRY`; sàn có `BTCUSDT, BNBUSDT, USDTTRY` → `BTCUSDT`, `BNBUSDT` (`inverse false`), `USDTTRY` (`inverse true`), `minute` = `time` làm tròn xuống 60000 |
| `neededPrices` không có cặp | quote `XYZ`, sàn không có `XYZUSDT`/`USDTXYZ` → không có phần tử nào cho XYZ |
| `syncPrices` gộp | 2 phút cần giá cách nhau 10 phút, cùng symbol → 1 lần gọi `klines(symbol, phútĐầu, 1000)`; chỉ lưu 2 dòng |
| `syncPrices` bỏ qua giá đã có | phút đã có trong `db.getPrices()` → không gọi `klines` |
| `syncPrices` thiếu nến | `klines` trả mảng không có phút cần → lưu dòng `close: null`; lần sau không gọi lại |
| `makePriceAt` | dòng `BTCUSDT@m = 60000` → `priceAt('BTC', m + 30000) === 60000`; dòng `USDTTRY@m = 40` → `priceAt('TRY', m) === 0.025`; không có dòng hoặc `close null` → `null` |

- [ ] **Step 2: Chạy test, xác nhận thất bại** — `npm test`

- [ ] **Step 3: Viết `sync.js`**

`pickSymbols` không lọc theo `status`. `syncTrades`: mỗi symbol lặp `myTrades(symbol, (cursor ?? -1) + 1)` đến khi trang < 1000 dòng; sau mỗi trang gọi `db.insertTrades` rồi `db.setCursor` (theo thứ tự đó, để rớt giữa chừng không tạo khoảng trống). `syncPrices`: với mỗi symbol, lấy phút nhỏ nhất còn thiếu, gọi `klines(symbol, phút, 1000)`, lưu các phút cần nằm trong khoảng trả về, lặp lại.

- [ ] **Step 4: Chạy test, xác nhận qua** — `npm test`

- [ ] **Step 5: Commit** — `feat: incremental trade and price sync`

---

### Task 5: Vỏ extension và SQLite

**Files:**
- Create: `extension/manifest.json`, `extension/background.js`, `extension/db-worker.js`, `extension/db.js`, `extension/dashboard.html`, `extension/dashboard.js` (tạm), `extension/vendor/sqlite/{index.mjs,sqlite3.wasm,sqlite3-opfs-async-proxy.js,VERSION}`, `extension/icons/{icon.svg,16.png,48.png,128.png}`

**Interfaces:**
- Produces:
  ```js
  // db.js
  export async function openDb()   // -> db;  ném Error code 'LOCKED' nếu tab khác đang giữ DB
  db.insertTrades(rows)            // INSERT OR IGNORE; rows theo cột bảng trades
  db.allTrades()                   // -> mọi dòng, ORDER BY time, id
  db.getCursors()                  // -> [{ symbol, base, quote, last_trade_id, last_synced_at }]
  db.setCursor(symbol, base, quote, lastTradeId)   // lastTradeId null = đã quét, chưa có lệnh
  db.getPrices()                   // -> [{ symbol, minute, close }]
  db.putPrices(rows)
  db.exportFile()                  // -> Uint8Array
  db.wipe()                        // xóa mọi dòng của 3 bảng
  ```
  Schema đúng như spec, mục "Dữ liệu (SQLite)". File DB: `/spot.sqlite3`.

- [ ] **Step 1: Vendor SQLite WASM**

`npm pack @sqlite.org/sqlite-wasm@3.54.1-build1` vào thư mục tạm, chép `package/dist/{index.mjs,sqlite3.wasm,sqlite3-opfs-async-proxy.js}` vào `extension/vendor/sqlite/`, ghi phiên bản vào `VERSION`. Không thêm vào `package.json`.

- [ ] **Step 2: Viết `manifest.json`**

`manifest_version 3`; `name "Giá vốn Spot"`; `version "0.1.0"`; `action.default_title "Mở Giá vốn Spot"`; `background.service_worker "background.js"`; `permissions ["storage", "unlimitedStorage"]`; `host_permissions ["https://api.binance.com/*"]`; `content_security_policy.extension_pages "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`; `icons` 16/48/128.

- [ ] **Step 3: Icon**

Vẽ `icon.svg` (biểu tượng đơn giản, đọc được ở 16px), xuất PNG 16/48/128 bằng `qlmanage -t -s <size>` hoặc `sips`. Nếu công cụ không xuất được PNG đúng, bỏ khóa `icons` khỏi manifest và ghi lại trong báo cáo.

- [ ] **Step 4: Viết `background.js`**

`chrome.action.onClicked`: tìm tab có URL `chrome.runtime.getURL('dashboard.html')`; có thì focus tab và cửa sổ đó, không thì `chrome.tabs.create`.

- [ ] **Step 5: Viết `db-worker.js` và `db.js`**

Worker kiểu module: `sqlite3InitModule()` → `installOpfsSAHPoolVfs({ name: 'spot' })` → `new pool.OpfsSAHPoolDb('/spot.sqlite3')` → tạo bảng `IF NOT EXISTS`. Cài VFS thất bại thì trả lỗi `code 'LOCKED'`. RPC: `{ id, method, args }` → `{ id, result }` hoặc `{ id, error }`. `insertTrades`/`putPrices` chạy trong một transaction.

- [ ] **Step 6: Trang kiểm tra tạm**

`dashboard.html` + `dashboard.js` tạm: mở DB, chèn 1 lệnh mẫu, đọc lại, in số dòng ra trang.

- [ ] **Step 7: Kiểm tay trong Chrome**

`chrome://extensions` → Developer mode → Load unpacked → chọn `extension/`. Kỳ vọng: không lỗi manifest; bấm icon mở dashboard; bấm lần nữa focus tab cũ, không mở tab mới; tải lại trang vẫn thấy dòng đã chèn (dữ liệu bền); mở tab dashboard thứ hai bằng URL thì thấy lỗi `LOCKED`, không treo; console không có lỗi CSP/WASM.

- [ ] **Step 8: Commit** — `feat: extension shell and SQLite storage`

---

### Task 6: Giao diện dashboard (dựng bằng dữ liệu mẫu)

**Files:**
- Create: `extension/dashboard.css`, `extension/ui.js`, `extension/format.js`, `extension/demo-data.js`
- Modify: `extension/dashboard.html`, `extension/dashboard.js` (thay bản tạm)
- Test: `test/format.test.js`

**Interfaces:**
- Consumes: `computePositions` (Task 1), `buildRows`, `summarize` (Task 2).
- Produces:
  ```js
  // format.js
  export function fmtUsd(n)     // 12430.5 -> '12,430.50';  null -> '—'
  export function fmtPrice(n)   // >= 1000: 2 số lẻ; >= 1: 4 số lẻ; < 1: 6 chữ số có nghĩa
  export function fmtQty(n)     // tối đa 8 số lẻ, bỏ số 0 thừa
  export function fmtPct(n)     // 11.87 -> '+11.9%';  -6.2 -> '−6.2%' (dấu trừ U+2212)
  export function fmtTime(ms)   // 'DD/MM/YYYY HH:mm' giờ máy
  // ui.js
  export function render(state)  // vẽ lại toàn trang từ state
  // state: { screen: 'setup'|'main'|'locked', rows, summary, positions, sync: null | { phase, done, total, symbol, newTrades },
  //          lastSyncedAt, error: string | null, keyWarning: string | null, hideSmall: boolean, query: string, sort: { key, dir } }
  ```
  `dashboard.js` với `?demo=1`: dựng `state` từ `demo-data.js` qua `computePositions` + `buildRows` thật, không chạm `chrome.*`, DB, mạng.

- [ ] **Step 1: Test thất bại cho `format.js`**, đúng các ví dụ trong khối Interfaces, cộng `fmtPrice(67450) === '67,450.00'`, `fmtPrice(148.3) === '148.3000'`, `fmtPrice(0.00001234) === '0.00001234'`, `fmtQty(0.15200000) === '0.152'`, `fmtPct(null) === '—'`.

- [ ] **Step 2: Viết `format.js`, chạy `npm test` đến khi qua.**

- [ ] **Step 3: Viết `demo-data.js`**

Khoảng 30 lệnh trên 6 coin, phủ mọi trạng thái: lãi, lỗ, coin có cờ `unknown`, coin đã bán hết, coin không có giá, lệnh quote BTC, phí BNB. Kèm `balances`, `tickers`, `priceRows`.

- [ ] **Step 4: Dựng `dashboard.html`, `dashboard.css`, `ui.js`**

Bố cục theo sơ đồ trong spec, mục "Giao diện". Các màn hình và trạng thái phải có:

| Thành phần | Yêu cầu |
|---|---|
| Thanh trên | tên "Giá vốn Spot"; "Đồng bộ lúc HH:mm" hoặc "Chưa đồng bộ"; nút chính **Đồng bộ**; nút **Cài đặt** (icon + `aria-label`) |
| 4 ô tổng | "Vốn đang giữ", "Giá trị hiện tại", "Lãi/lỗ chưa chốt" (số + %), "Lãi/lỗ đã chốt"; lãi màu xanh, lỗ màu đỏ, luôn kèm dấu `+`/`−` (không chỉ dựa vào màu) |
| Thanh lọc | ô tìm coin; checkbox "Ẩn coin dưới 1 USDT" (mặc định bật) |
| Bảng danh mục | `<table>` thật; cột Coin, Số lượng, Giá TB, Giá hiện tại, Giá trị, Lãi/lỗ; tiêu đề cột là `<button>` sắp xếp, có `aria-sort`; đầu bảng dính khi cuộn; dòng bấm được và mở bằng Enter |
| Nhãn cảnh báo | `unknown`: "N coin không rõ giá vốn"; `oversold`: "Thiếu lịch sử mua"; `unpriced`: "Có lệnh không quy đổi được"; `noprice`: "Không có giá USDT". Giải thích đầy đủ trong `title` và trong bảng chi tiết |
| Ghi chú chuyển ra | `movedOutQty > 0`: dòng chữ nhỏ "đã chuyển ra N" dưới số lượng, màu trung tính |
| Chi tiết coin | `<dialog>`; đầu: tên coin, số lượng, giá TB, lãi/lỗ đã chốt, các cảnh báo viết đủ câu; bảng lệnh: Thời gian, Cặp, Loại (Mua/Bán/Phí), Giá, Lượng, Phí, Giá TB sau lệnh; mới nhất ở trên; đóng bằng Esc và nút Đóng |
| Đang đồng bộ | thanh tiến trình + "Đang lấy lệnh BTCUSDT (12/140) · 3,204 lệnh mới"; nút Đồng bộ đổi thành **Dừng**; vùng `aria-live="polite"` |
| Chưa có dữ liệu | "Chưa có lệnh nào. Bấm Đồng bộ để lấy lịch sử từ Binance." kèm nút |
| Lọc không ra gì | "Không có coin nào khớp." |
| Lỗi | dải thông báo phía trên bảng, có nút "Thử lại" và nút đóng |
| Màn `setup` | chỉ có form: API Key, Secret Key (`type="password"`), nút **Lưu và đồng bộ**; 3 bước tạo key chỉ đọc; dòng "Key lưu trên máy này, không mã hóa trên đĩa, chỉ gửi tới api.binance.com." |
| Màn `locked` | "Dashboard đang mở ở một tab khác. Đóng tab này và dùng tab kia." |
| Cài đặt | `<dialog>`: key hiện tại (che, 4 ký tự cuối) + **Đổi key** + **Xóa key**; **Quét toàn bộ** kèm ước tính phút; ô thêm coin để quét; **Xuất .sqlite**; **Xuất CSV**; **Xóa toàn bộ dữ liệu** (nút màu nguy hiểm, hỏi xác nhận); ghi chú giới hạn cặp đã hủy niêm yết |

Màu định nghĩa bằng biến CSS trên `:root`, bản sáng trong `@media (prefers-color-scheme: light)`. Tương phản chữ thường ≥ 4.5:1. Không thư viện icon: SVG inline.

- [ ] **Step 5: Kiểm bằng trình duyệt**

Chạy `python3 -m http.server 8777 -d extension`, mở `http://localhost:8777/dashboard.html?demo=1`. Chụp màn hình ở 1280×800 và 900×700, cả nền tối và sáng. Kỳ vọng: không cuộn ngang; số căn phải thẳng cột; sắp xếp từng cột chạy đúng; tìm kiếm lọc đúng; bỏ tick "Ẩn coin dưới 1 USDT" hiện coin đã bán hết; bấm dòng mở chi tiết, Esc đóng; đi hết trang bằng Tab thấy rõ focus; console không lỗi. Xem thêm từng trạng thái bằng `?demo=1&state=setup|syncing|empty|error|locked`.

- [ ] **Step 6: Commit** — `feat: dashboard UI`

---

### Task 7: Nối dữ liệu thật

**Files:**
- Modify: `extension/dashboard.js`, `extension/ui.js`
- Create: `extension/export.js`
- Test: `test/export.test.js`

**Interfaces:**
- Consumes: mọi thứ từ Task 1–6.
- Produces:
  ```js
  // export.js
  export function tradesToCsv(tradeRows)   // -> chuỗi CSV, dòng đầu là tên cột, giá trị có dấu phẩy/nháy được bọc nháy kép
  ```
  Khóa `chrome.storage.local`: `apiKey`, `secret`, `extraAssets` (mảng), `lastSyncedAt` (ms), `hideSmall` (boolean).

- [ ] **Step 1: Test thất bại cho `tradesToCsv`**: 2 dòng lệnh → 3 dòng CSV; cột `time,symbol,side,price,qty,quote_qty,commission,commission_asset,trade_id,order_id`; `time` dạng ISO 8601; `side` là `BUY`/`SELL`.

- [ ] **Step 2: Viết `export.js`, chạy `npm test` đến khi qua.**

- [ ] **Step 3: Luồng khởi động trong `dashboard.js`**

Mở DB (lỗi `LOCKED` → màn `locked`). Không có key → màn `setup`. Có key → đọc `db.allTrades()` + `db.getPrices()`, tính `computePositions`, gọi `account()` + `tickerPrices()`, `buildRows`, vẽ màn `main`. Lỗi mạng lúc lấy số dư/giá: vẫn hiện dữ liệu đã lưu kèm dải lỗi.

- [ ] **Step 4: Lưu key**

Gọi `account()` để xác thực trước khi lưu; lỗi `auth` hiện ngay dưới form, không lưu. Sau đó `apiRestrictions()`: `canTrade` hoặc `canWithdraw` → `keyWarning` = "Key này có quyền giao dịch/rút tiền. Extension chỉ cần quyền đọc; nên tạo key chỉ đọc." (lỗi ở bước này bỏ qua, không chặn). Lưu xong tự chạy quét nhanh.

- [ ] **Step 5: Nút Đồng bộ / Dừng / Quét toàn bộ**

`exchangeInfo` → `account` → `pickSymbols` → `syncTrades` → `syncPrices` → tính lại → vẽ lại → ghi `lastSyncedAt`. Dừng bằng `AbortController`. Lỗi `ratelimit`: dải lỗi "Binance yêu cầu chờ N giây rồi thử lại." Quét toàn bộ: hỏi xác nhận kèm `estimateMinutes`. Trong lúc đồng bộ, `beforeunload` cảnh báo.

- [ ] **Step 6: Cài đặt**

Đổi/xóa key; thêm coin (viết hoa, kiểm tra có trong `exchangeInfo`, không có thì báo "Không tìm thấy coin này trên Binance Spot."); xuất `.sqlite` (`db.exportFile()` → Blob → `<a download="binance-spot.sqlite3">`); xuất CSV; xóa toàn bộ dữ liệu (`db.wipe()` + xóa `lastSyncedAt`, giữ key).

- [ ] **Step 7: Kiểm lại bản demo**

Lặp lại Step 5 của Task 6: bản `?demo=1` vẫn chạy, không lỗi console.

- [ ] **Step 8: Kiểm tay với key thật (người dùng làm)**

Load lại extension, nhập key chỉ đọc. Kỳ vọng: quét nhanh chạy xong, bảng hiện coin đang giữ; đối chiếu giá TB một coin với tính tay; bấm Đồng bộ lần hai gần như tức thì, không thêm lệnh trùng; đóng tab giữa lúc quét toàn bộ rồi mở lại, bấm tiếp, chạy tiếp được; file `.sqlite` xuất ra mở được bằng `sqlite3` và không chứa key.

- [ ] **Step 9: Commit** — `feat: wire dashboard to Binance and SQLite`
