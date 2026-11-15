# Thiết kế lại giao diện Pro Trading Terminal & Tích hợp Lệnh chờ khớp (Open Orders)

Ngày: 2026-11-15

## Mục đích

Nâng cấp toàn diện giao diện và trải nghiệm người dùng của extension **Quản lý vốn (Binance Spot)** theo hướng **Pro Trading Terminal** sắc nét, mật độ dữ liệu rõ ràng, đồng thời tích hợp tính năng theo dõi các **lệnh Spot đang đặt chờ khớp (Open Orders)** bằng chính API Key chỉ đọc (`Enable Reading`).

## Phạm vi

- Làm mới toàn bộ hệ thống thị giác và bố cục cho tất cả màn hình hiện có: Setup (nhập key), Tổng quan danh mục, Chi tiết coin (chuyển thành Slide-over Drawer), Cài đặt, Trạng thái đồng bộ, Empty, Locked và Error.
- Bổ sung lấy và hiển thị **Lệnh đang chờ khớp** từ `GET /api/v3/openOrders`: KPI tổng hợp, tab `Lệnh chờ khớp`, badge số lượng và số dư `locked` trên bảng Danh mục, đồng thời vẽ các mức giá đặt chờ lên biểu đồ chi tiết coin.
- **Giữ nguyên các ràng buộc cốt lõi:**
  - Chrome Manifest V3, JavaScript ES modules thuần, vanilla HTML + vanilla CSS, không build step, không framework.
  - Không thêm script, font hoặc tài nguyên từ CDN bên ngoài; chỉ kết nối tới `https://api.binance.com/*` và WebSocket công khai `wss://stream.binance.com:9443/stream`.
  - Tuyệt đối **chỉ đọc**: không bổ sung endpoint đặt lệnh, hủy lệnh hay sửa lệnh.

---

## 1. Hệ thống thị giác (Obsidian Pro Terminal)

### Bảng màu & Bề mặt
Thay bảng màu `#0b0e11` / `#181a20` và vàng `#fcd535` cũ bằng dải Obsidian Slate lạnh đồng nhất, phân tầng bằng độ sáng bề mặt và viền hairline `1px`:

| Token | Giá trị | Vai trò |
|---|---|---|
| `--bg` | `#090b0f` | Nền trang chính (kèm radial ambient nhẹ `rgba(56, 189, 248, 0.045)` ở đỉnh) |
| `--surface-1` | `#0e1218` | KPI cards, vỏ bảng dữ liệu, nền Slide-over Drawer, Settings dialog |
| `--surface-2` | `#151b23` | Hover row, ô nhập liệu, control phụ, nền tooltip |
| `--surface-3` | `#1c2430` | Tab/pill đang chọn, trạng thái pressed |
| `--border` | `#1f2733` | Viền hairline phân tách bảng, card, header |
| `--border-strong` | `#2e394a` | Viền hover, viền drawer và dialog |
| `--ink-strong` | `#f1f5f9` | Tiêu đề, số liệu chính |
| `--ink` | `#b6c2d2` | Nội dung bảng, mô tả |
| `--ink-muted` | `#748399` | Nhãn cột, chú thích phụ |
| `--ink-dim` | `#4c586b` | Ký tự gạch ngang `—`, đường chia phụ |
| `--accent` | `#e5a93c` | Accent chính (CTA, tab/sort active, đường giá TB trên chart); `--accent-ink: #0c1015` |
| `--up` / `--up-bg` / `--up-border` | `#16c784` / `12%` / `28%` | Lãi, giá tăng, chiều MUA |
| `--down` / `--down-bg` / `--down-border` | `#ea3943` / `12%` / `28%` | Lỗ, giá giảm, chiều BÁN |
| `--warn` / `--warn-bg` | `#eab308` / `11%` | Cảnh báo thiếu dữ liệu giá vốn |
| `--info` / `--info-bg` | `#38bdf8` / `10%` | Banner demo, thông tin trạng thái |

### Typography, Hình khối & Chuyển động
- **Font:** `--sans` dùng system sans (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`); `--mono` dùng system monospace (`"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`). Mọi số liệu tài chính, giá, khối lượng, `%`, thời gian đều áp `font-variant-numeric: tabular-nums` để thẳng hàng cột.
- **Kích thước vùng làm việc:** `max-width: 1360px` (thay cho `960px`), padding ngang `24px` (mobile `16px`).
- **Thang bo góc thống nhất:** `4px` cho badge/tag/pill số, `6px` cho nút/input/tab, `8px` cho KPI card/bảng/khối chart, `10px` cho dialog.
- **Iconography:** Inline SVG thống nhất `stroke-width="1.6"`, `stroke-linecap="round"`, `stroke-linejoin="round"`; không dùng emoji trong giao diện điều khiển.
- **Chuyển động:** Transition `150ms cubic-bezier(0.2, 0.8, 0.2, 1)` trên hover/tab/drawer (`transform`, `opacity`, `border-color`); nút nhấn có `transform: scale(0.98)`; giữ flash nền ngắn cho ô giá vừa nhảy tick; tôn trọng `@media (prefers-reduced-motion: reduce)`.

---

## 2. Cấu trúc các màn hình & Thành phần UI

### 2.1 Top Command Bar (`56px`, sticky)
- Cố định ở đỉnh với nền mờ `rgba(9, 11, 15, 0.86)` và `backdrop-filter: blur(10px)` (fallback nền đặc dưới `@supports not`), viền đáy `1px solid var(--border)`.
- **Trái:** Logo extension + tiêu đề `Quản lý vốn` + badge `SPOT`.
- **Phải:**
  - Pill trạng thái Live WebSocket (`Trực tiếp` / `Ngoại tuyến`).
  - Thời điểm đồng bộ gần nhất (`Đồng bộ lúc HH:mm` / `Chưa đồng bộ`).
  - Nút **Làm mới** (`#btn-refresh`): cập nhật nhanh số dư, giá thị trường và lệnh chờ khớp (~1 giây) mà không quét lại lịch sử `myTrades`. Bị vô hiệu hóa khi ở chế độ demo hoặc đang sync.
  - Nút **Đồng bộ** (`#btn-sync`, accent primary): quét thêm lịch sử khớp lệnh mới; đổi sang nút **Dừng** khi đang chạy.
  - Nút **Cài đặt** (`#btn-settings`): biểu tượng bánh răng.

### 2.2 Executive KPI Strip & Allocation Bar
Thay thế phần hero căn giữa cũ bằng dải **5 ô KPI ngang** (CSS Grid `repeat(5, minmax(0, 1fr))` trên desktop, tự gập xuống 3 cột ở `<= 1080px` và 2 cột ở `<= 640px`):
1. **Tổng giá trị Spot** *(ô neo chính)*: Tổng tài sản quy USDT + dòng phụ tách rõ `Khả dụng` và `Đang khóa` (khi có số dư bị khóa trong open orders).
2. **Lãi/lỗ chưa chốt**: Số USDT có dấu + badge `%` tone `--up` / `--down`.
3. **Vốn đang giữ**: Tổng vốn của phần số dư có giá mua rõ ràng + dòng phụ ghi chú nếu có phần coin chưa rõ giá vốn.
4. **Lãi/lỗ đã chốt**: Số USDT đã chốt + dòng phụ `Tổng lãi/lỗ ròng` (`unrealized + realized`).
5. **Lệnh chờ khớp**: Tổng số lệnh đang mở (`M`) + dòng phụ `X Mua · Y Bán` và tổng giá trị USDT còn chờ khớp. Bấm vào ô này chuyển thẳng sang tab `Lệnh chờ khớp`.

Ngay dưới 5 ô KPI là **Allocation Bar Strip** gọn trong 1 panel mỏng: thanh tỷ trọng phân bổ theo top coin + chú giải inline. Click vào một coin trong chú giải sẽ mở trực tiếp Slide-over Drawer của coin đó.

### 2.3 Workspace Tabs
Thanh chuyển tab ngay phía trên bảng dữ liệu, giữ nguyên tab đang chọn khi giá live nhảy hoặc khi bấm Làm mới:
- **`Danh mục nắm giữ`** + bộ đếm số coin (`N`).
- **`Lệnh chờ khớp`** + bộ đếm số lệnh đang mở (`M`) và chấm màu `--accent` khi `M > 0`.

### 2.4 Tab 1: Bảng Danh mục nắm giữ (`#holdings`)
- **Toolbar:**
  - Ô tìm kiếm `Tìm coin…`
  - Nhóm nút lọc nhanh: `Tất cả`, `Có cảnh báo`, `Có lệnh chờ`
  - Checkbox `Ẩn coin dưới 1 USDT` + bộ đếm `x/y coin`
- **Các cột (header sticky, bấm để sort, mũi tên chỉ chiều sort):**
  1. **Coin:** Avatar monogram `28px` (nền pha màu theo bảng màu phân bổ của coin) + mã coin đậm + các tag ngắn (`chưa rõ vốn`, `thiếu lịch sử`, `chuyển ra`, hoặc tag `N lệnh chờ` màu amber nhẹ).
  2. **Số lượng:** Tổng `free + locked`; nếu `locked > 0`, hiển thị thêm dòng phụ `Khóa: <số lượng>` bên dưới.
  3. **Giá TB → Hiện tại:** Xếp gọn 2 vế thẳng cột; bên cạnh giá hiện tại (nhấp nháy `tick-up` / `tick-down` khi giá WebSocket đổi) hiển thị thêm badge `% 24h` nếu có dữ liệu `open24h`.
  4. **Giá trị & Tỷ trọng:** Giá trị USDT + dòng phụ `%` tỷ trọng danh mục.
  5. **Lãi/lỗ:** Giá trị USDT có dấu (`+--` / `−--`).
  6. **Hiệu suất:** Badge phần trăm viền mảnh nền tint (`--up-bg` + `--up-border` / `--down-bg` + `--down-border`).
- **Responsive (`<= 760px`):** Ẩn bớt cột Số lượng và Giá trị để giữ Coin, Giá và Hiệu suất dễ đọc trên màn hẹp.

### 2.5 Tab 2: Bảng Lệnh chờ khớp (`#open-orders`)
- **Summary mini-bar:** Tóm tắt `Mua chờ: X lệnh (≈ Y USDT)` · `Bán chờ: Z lệnh (≈ W USDT)` · cảnh báo lỗi riêng của endpoint open orders (nếu có) kèm nút `Thử lại`.
- **Toolbar lọc:** Ô tìm theo cặp (`BTCUSDT…`) + bộ lọc chiều (`Tất cả`, `Mua`, `Bán`) + bộ lọc loại (`Tất cả`, `Limit`, `Stop / OCO`).
- **Các cột (hỗ trợ sort):**
  1. **Thời gian:** Thời điểm đặt lệnh (`time`).
  2. **Cặp & Loại:** `BTC / USDT` + badge loại (`LIMIT`, `LIMIT_MAKER`, `STOP_LOSS_LIMIT`, `TAKE_PROFIT_LIMIT`, cộng tag `OCO` khi `orderListId !== -1`).
  3. **Chiều:** Badge `MUA` (`--up`) / `BÁN` (`--down`).
  4. **Giá đặt:** `price` (nếu có `stopPrice > 0`, hiện thêm dòng phụ `Kích hoạt: <stopPrice>`).
  5. **Cách giá TT:** Giá thị trường hiện tại (cập nhật live) + `% khoảng cách tới điểm khớp` (`(price - marketPrice) / marketPrice * 100`).
  6. **Khối lượng & Tiến độ:** `executedQty / origQty` kèm thanh progress bar mảnh (`height: 3px`) thể hiện tỷ lệ đã khớp.
  7. **Giá trị còn lại (USDT):** `(origQty - executedQty) × price` quy về USDT (hiển thị `—` nếu quote không quy đổi được sang USDT).
  8. **Trạng thái:** `Chờ khớp` (`NEW`) hoặc `Khớp một phần` (`PARTIALLY_FILLED`).
- **Tương tác:** Bấm vào một dòng lệnh chờ sẽ mở **Slide-over Drawer** của coin `base` tương ứng.
- **Empty state riêng cho Tab Lệnh chờ:** Hiển thị rõ "Hiện không có lệnh Spot nào đang chờ khớp." (kèm nút kiểm tra lại nếu cần), không làm mất bảng Danh mục.

### 2.6 Slide-over Coin Drawer (`#coin-drawer`)
- Trượt vào từ cạnh phải (`width: min(780px, 100vw)`), có backdrop mờ nhẹ, giữ nguyên bảng dữ liệu và vị trí cuộn bên dưới.
- Đóng bằng phím `Esc`, bấm nút `Đóng`, hoặc click ra ngoài backdrop; trả lại focus bàn phím về dòng vừa bấm.
- **Nội dung trong Drawer:**
  1. **Sticky Header:** Monogram + Tên coin + Giá hiện tại live + `% 24h` + nút Đóng.
  2. **4 ô Stats gọn (Grid 4 cột, mobile 2 cột):** `Giá trung bình`, `Giá hiện tại`, `Vốn đang giữ`, `Đã chốt`, kèm dòng phụ `Khả dụng / Đang khóa` dưới phần số dư.
  3. **Ghi chú & Cảnh báo:** Liệt kê chi tiết giải thích nếu coin có phần chưa rõ giá vốn, thiếu lịch sử mua, không quy đổi được, hoặc đã chuyển ra ví khác.
  4. **Biểu đồ SVG Pro:**
     - Đường lưới ngang tinh tế, vùng tô gradient amber mờ dưới step line `Giá trung bình`.
     - Chấm tròn các điểm `Mua` (`--up`) và `Bán` (`--down`).
     - Đường nét đứt ngang cho `Giá hiện tại` và các mức giá **Lệnh chờ khớp** (`BUY` / `SELL`) của coin đó (kèm nhãn giá ở mép phải). Nếu vùng giá lịch sử khớp lệnh là `[baseLo, baseHi]` và một lệnh chờ có giá nằm ngoài khoảng `[baseLo * 0.4, baseHi * 2.5]`, không kéo giãn làm bẹp trục Y mà ghim badge tóm tắt `Lệnh chờ ngoài khung giá: BUY @ …` ngay góc trên biểu đồ.
     - **Crosshair & Tooltip động** theo vị trí chuột trên điểm khớp lệnh (hiển thị Thời gian, Cặp, Loại, Giá, Khối lượng, Giá TB sau lệnh).
  5. **Khối Lệnh đang chờ khớp của coin:** Hiện bảng mini ngay trên lịch sử khớp nếu coin đang có open orders.
  6. **Bảng Lịch sử khớp lệnh:** Rộng rãi (`40px` chiều cao dòng), sticky header khi cuộn trong drawer, badge `Mua / Bán / Phí` sắc nét.

### 2.7 Màn hình Setup, Settings, Locked & Banners
- **Setup Screen (`#screen-setup`):** Split card 2 cột (`max-width: 840px`):
  - Cột trái: Tóm tắt nguyên tắc bảo mật (`API chỉ đọc · Dữ liệu lưu cục bộ bằng SQLite OPFS · Chỉ gọi api.binance.com`) và hướng dẫn 3 bước đánh số tạo API Key.
  - Cột phải: Form nhập `API Key` và `Secret Key` (thêm nút toggle ẩn/hiện Secret), thông báo lỗi inline rõ ràng, CTA `Lưu và đồng bộ`, nút `Hủy` (khi đổi key từ Settings), và link `Xem thử với dữ liệu mẫu`.
- **Settings Dialog (`#settings`, `560px`):** Tổ chức thành 3 phân khu tách viền rõ ràng:
  1. **API Key:** Hiển thị key che (`••••••••xxxx`), nút `Đổi key`, nút `Xóa key`.
  2. **Quét lịch sử:** Mô tả quét nhanh vs quét toàn bộ, nút `Quét toàn bộ`, form thêm/xóa coin quét tay dạng chip, lưu ý cặp đã hủy niêm yết.
  3. **Sao lưu & Dữ liệu:** `Xuất .sqlite`, `Xuất CSV`, `Xóa toàn bộ dữ liệu`, ghi chú lưu cục bộ không chứa key.
- **Progress / Banners / Locked:** Thanh tiến trình sync đặt trong banner gọn phía trên KPI strip để không gây nhảy bố cục; màn hình `Locked` (đang mở ở tab khác) trình bày trong card trung tâm có icon và nút `Thử lại`.

---

## 3. Kiến trúc dữ liệu & Luồng API

### 3.1 Mở rộng `extension/binance.js`
- Giữ nguyên `account()` trả `{ [asset]: total }` để tương thích ngược với luồng `saveKey` và bộ test hiện có.
- Thêm **`accountBalances()`**: gọi `/api/v3/account` với `{ omitZeroBalances: 'true' }` (signed) một lần, trả về:
  ```js
  {
    total: { [asset]: number }, // free + locked (cho tài sản > 0)
    free: { [asset]: number },
    locked: { [asset]: number },
  }
  ```
- Thêm **`openOrders(symbol)`**:
  ```js
  openOrders(symbol) {
    return request('/api/v3/openOrders', symbol ? { symbol } : {}, { signed: true });
  }
  ```
  - Thuộc nhóm `USER_DATA` (chỉ cần quyền `Enable Reading`).
  - Weight: `6` khi truyền `symbol`, `80` khi lấy toàn bộ cặp Spot.

### 3.2 Module thuần `extension/orders.js`
Tách riêng logic xử lý Open Orders để giữ ranh giới module sạch và test được độc lập bằng `node --test`:
- **`buildOpenOrders(rawOrders, exchangeSymbols, tickers)`**:
  - Import `STABLES` từ `./cost.js` (không nhân bản danh sách stablecoin).
  - Tra `base` / `quote` từ `exchangeSymbols`; nếu chưa có trong map, fallback tách theo hậu tố phổ biến (`USDT`, `USDC`, `FDUSD`, `BUSD`, `TUSD`, `DAI`, `BTC`, `ETH`, `BNB`).
  - Tính `price`, `stopPrice`, `origQty`, `executedQty`, `remainingQty = Math.max(0, origQty - executedQty)`, `fillPct = origQty > 0 ? (executedQty / origQty) * 100 : 0`, `isOco = orderListId != null && orderListId !== -1`.
  - Lấy `marketPrice = tickers[symbol] ?? null`; nếu `price > 0 && marketPrice > 0`, tính `distancePct = ((price - marketPrice) / marketPrice) * 100`, ngược lại `null`.
  - Tính `remainingValueUsdt`: lấy `remainingQty * price`, nếu `STABLES.has(quote)` giữ nguyên 1:1; nếu không, nhân `tickers[quote + 'USDT']` hoặc chia `tickers['USDT' + quote]`; không có route trả `null`.
- **`summarizeOpenOrders(orders)`**:
  - Trả về `{ totalCount, buyCount, sellCount, buyValueUsdt, sellValueUsdt, totalLockedUsdt, byAsset }`, trong đó `byAsset` là object `{ [asset]: Order[] }` nhóm các lệnh theo `base` asset để bảng Holdings hiển thị badge số lệnh và Drawer vẽ đường giá đặt.

### 3.3 Điều phối State, Live WebSocket & Refresh (`extension/dashboard.js`)
- **Luồng `refresh()`:**
  - Gọi song song `api.accountBalances()` và `api.tickerPrices()` (bắt buộc để dựng danh mục); riêng `api.openOrders()` chạy độc lập lỗi (kèm `getExchange()` đã cache theo session để lấy map `base`/`quote`). Nếu riêng `openOrders()` lỗi (rate limit / mạng tạm thời), `state.ordersError` được ghi nhận và hiển thị trong khu vực Lệnh chờ kèm nút thử lại, không làm hỏng bảng Danh mục.
  - Không lưu `openOrders` vào SQLite vì lệnh chờ biến động tức thời; dữ liệu luôn được làm mới khi mở dashboard, khi bấm **Làm mới**, hoặc ngay sau khi **Đồng bộ** hoàn tất.
- **Mở rộng `watchPrices()`:**
  - Subscribe `@miniTicker` cho hợp nhất của các cặp `asset + 'USDT'` đang nắm giữ, tất cả `symbol` đang có trong `openOrders`, và cặp quy đổi `quote + 'USDT'` (nếu có trong `tickers` và `quote` không phải stablecoin).
  - Cập nhật cả `tickers[symbol]` lẫn `open24h[symbol]` từ tham số thứ 3 của callback `onPrice(symbol, price, open24h)` trong `extension/live.js`, giúp hiển thị `% 24h` và cập nhật `% cách giá khớp` theo thời gian thực.
- **Cập nhật `extension/demo-data.js`:**
  - Bổ sung `balancesDetail` (`free`, `locked`), `open24h`, và `openOrders` mẫu (gồm lệnh `BUY LIMIT`, `SELL LIMIT`, `PARTIALLY_FILLED`, `STOP_LOSS_LIMIT` và 1 cặp OCO) để chế độ `?demo=1` phản ánh đầy đủ toàn bộ UI mới, đồng thời hỗ trợ `?demo=1&state=orders` và `?demo=1&state=drawer` phục vụ kiểm tra nhanh.

### 3.4 Tách gọn tầng UI (`extension/ui.js` & `extension/chart.js`)
- Tách phần dựng biểu đồ SVG và tooltip tương tác sang `extension/chart.js` để `extension/ui.js` gọn, chỉ phụ trách render các bảng, KPI strip, tabs, drawer và dialogs.
- Dọn sạch các selector CSS cũ không còn dùng trong `extension/dashboard.css`.

---

## 4. Xử lý lỗi & Các trường hợp biên

- **Coin chưa có số dư nhưng đang đặt lệnh Mua:** Coin có thể có `balance = 0` nhưng có Open Order `BUY` chờ khớp; Drawer khi mở từ tab `Lệnh chờ khớp` vẫn hiển thị đầy đủ giá hiện tại, lệnh chờ đang đặt và lịch sử cũ (nếu có).
- **Lệnh không có giá hoặc chưa có ticker:** `MARKET` hoặc lệnh có `price === 0` / thiếu `tickers[symbol]` trả `distancePct = null` và hiển thị `—`, không chia cho 0.
- **Tài khoản có rất nhiều cặp hoặc 0 lệnh chờ:** Nếu `openOrders` trả `[]`, badge hiển thị `0`, KPI hiển thị `0 lệnh`, tab Lệnh chờ hiển thị empty state gọn.
- **Khóa bàn phím & A11y:** Drawer dùng `role="dialog"`, `aria-modal="true"`, hỗ trợ `Esc` đóng drawer và khôi phục focus về dòng đang chọn; giữ focus khi bảng tự repaint theo tick WebSocket.

---

## 5. Kiểm thử & Xác minh

- **Unit test (`node --test`):**
  - Mở rộng `test/binance.test.js`: test `accountBalances()` (tách `free`/`locked`/`total`) và `openOrders()` (cả trường hợp truyền `symbol` và bỏ trống `symbol`, xác minh ký HMAC).
  - Tạo `test/orders.test.js`: test `buildOpenOrders` và `summarizeOpenOrders` (tính `distancePct`, `fillPct`, `isOco`, quy đổi USDT cho quote stablecoin và non-stablecoin, nhóm `byAsset`, edge cases giá = 0 / thiếu ticker).
  - Giữ toàn bộ test hiện có (`cost`, `portfolio`, `export`, `format`, `live`, `sync`) pass 100%.
- **Kiểm tra giao diện trực quan:**
  - Chạy chế độ `?demo=1` qua trình duyệt kiểm tra các trạng thái: Tổng quan (Holdings), Tab Lệnh chờ khớp, Slide-over Drawer + hover tooltip biểu đồ, Setup, Settings, Empty, Locked, Error ở các độ rộng `1440px`, `1280px` và `760px`.
