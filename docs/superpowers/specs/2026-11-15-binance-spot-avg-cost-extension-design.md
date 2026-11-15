# Extension Chrome: giá vốn trung bình Binance Spot — Thiết kế

Ngày: 2026-11-15

## Mục đích

Người dùng trade Spot trên Binance, muốn biết **giá vốn trung bình của số coin đang giữ** sau tất cả các lần mua bán. Binance không hiển thị con số này đáng tin cậy. Extension kéo toàn bộ lịch sử lệnh Spot bằng API key của người dùng, lưu cục bộ vào SQLite, rồi tính.

## Mục tiêu

- Kéo toàn bộ lịch sử khớp lệnh Spot của tài khoản, lưu SQLite cục bộ, đồng bộ tăng dần ở các lần sau.
- Với mỗi coin: số lượng đang giữ, giá vốn trung bình (USDT), giá hiện tại, lãi/lỗ chưa chốt, lãi/lỗ đã chốt.
- Xem lịch sử lệnh từng coin kèm giá trung bình chạy theo từng lệnh.
- Giao diện tiếng Việt, gọn, rõ, dùng được ngay không cần đọc hướng dẫn.

## Ngoài phạm vi

- Convert, P2P, nạp/rút, Earn, đổi bụi, Futures, Margin. (Người dùng chốt: chỉ Spot.)
- Đặt lệnh, hủy lệnh, bất kỳ thao tác ghi nào lên Binance.
- Đồng bộ nền khi tab đóng, nhiều tài khoản, báo cáo thuế, biểu đồ giá.

## Điều phải tránh

- Key rời khỏi máy người dùng, hoặc gửi tới bất kỳ host nào khác `api.binance.com`.
- Hiển thị giá trung bình sai mà không cảnh báo (xem "Coin không rõ nguồn").
- Bị Binance khóa IP vì vượt rate limit.

## Ràng buộc đã kiểm chứng

- `GET /api/v3/myTrades`: bắt buộc `symbol`; `limit` tối đa 1000; `fromId` trả lệnh có id >= giá trị đó; weight 20 mỗi lần gọi. Không có endpoint lấy lệnh của mọi symbol.
- Trường trả về: `id, orderId, price, qty, quoteQty, commission, commissionAsset, time, isBuyer, isMaker`.
- SQLite WASM chính thức (`@sqlite.org/sqlite-wasm`) có VFS `opfs-sahpool`: lưu bền vào OPFS, chạy trong Worker, không cần SharedArrayBuffer hay header COOP/COEP. Đổi lại: chỉ một kết nối tại một thời điểm, nên chỉ một tab dashboard được mở. `exportFile()` trả về bytes của file DB.
- Manifest V3 cần CSP `script-src 'self' 'wasm-unsafe-eval'` để chạy WASM.

## Các cách dựng đã cân nhắc

1. **Dashboard mở thành tab riêng (đã chọn).** Bấm icon mở trang full màn hình. Đủ chỗ cho bảng danh mục và lịch sử lệnh; đồng bộ dài không bị ngắt.
2. Side panel cạnh trang Binance. Tiện liếc nhưng hẹp, bảng lệnh nhiều cột bị bóp.
3. Popup. Chật, tự đóng khi click ra ngoài làm đứt đồng bộ. Loại.

Stack (quyết định của người viết thiết kế, người dùng giao phần "làm thế nào"): JS thuần, ES modules, không build step, không framework. SQLite WASM tải sẵn vào `vendor/`. Lý do: load thẳng thư mục vào Chrome là chạy, ít thứ để hỏng.

## Kiến trúc

```
manifest.json          MV3; permissions: storage, unlimitedStorage; host: https://api.binance.com/*
background.js          bấm icon: mở dashboard, nếu đã mở thì focus tab cũ
dashboard.html/.css    giao diện
dashboard.js           điều phối UI, đồng bộ
binance.js             ký HMAC-SHA256 (WebCrypto), gọi API, giới hạn tốc độ
db-worker.js           Worker giữ kết nối SQLite (opfs-sahpool), nhận lệnh qua postMessage
cost.js                hàm thuần: danh sách lệnh -> vị thế từng coin
vendor/sqlite/         sqlite3.mjs + sqlite3.wasm
test/cost.test.js      node --test
```

Đồng bộ chạy trong trang dashboard (không chạy trong service worker vì MV3 tắt worker khi rảnh). Đóng tab giữa chừng thì lần sau chạy tiếp từ chỗ dừng.

## Dữ liệu (SQLite)

```sql
trades(symbol, id, order_id, base, quote, price, qty, quote_qty,
       commission, commission_asset, time, is_buyer, is_maker,
       PRIMARY KEY(symbol, id))
symbols(symbol PRIMARY KEY, base, quote, last_trade_id, last_synced_at)
prices(symbol, minute, close, PRIMARY KEY(symbol, minute))   -- cache giá quy đổi
```

Số lưu dạng TEXT đúng như Binance trả. Vị thế không lưu bảng: tính lại trong bộ nhớ từ `trades` mỗi lần mở hoặc sau đồng bộ.

API key và secret lưu ở `chrome.storage.local`, không nằm trong file SQLite (để file xuất ra không lộ key).

## Đồng bộ

1. Lấy lệch giờ từ `/api/v3/time`. Lấy `exchangeInfo` để biết base/quote của mọi symbol.
2. Chọn symbol cần quét:
   - **Quét nhanh (mặc định):** mọi symbol có base là coin đang có số dư Spot > 0, cộng mọi symbol đã có trong DB.
   - **Quét toàn bộ (nút riêng):** mọi symbol của sàn. Bắt được coin đã bán hết. Chậm, khoảng 10–15 phút; hiện rõ thời gian ước tính trước khi chạy.
   - Người dùng thêm tay được một coin để quét.
3. Mỗi symbol: gọi `myTrades` với `fromId = last_trade_id + 1` (lần đầu `fromId = 0`), `limit = 1000`, lặp đến khi trả về ít hơn 1000. Ghi `INSERT OR IGNORE`, cập nhật `last_trade_id` sau mỗi trang.
4. Giới hạn tốc độ: đọc header `X-MBX-USED-WEIGHT-1M`, tạm nghỉ khi gần ngưỡng; gặp 429/418 thì dừng theo `Retry-After`, không thử lại sớm.
5. Hiện tiến trình: symbol thứ mấy / tổng, số lệnh đã lấy. Có nút dừng.

## Cách tính giá vốn (`cost.js`)

Phương pháp bình quân gia quyền, đơn vị USDT. Duyệt mọi lệnh theo thứ tự thời gian:

- **Mua** BASE: `qty += lượng`, `cost += giá trị USDT`. Giá trung bình = `cost / qty`.
- **Bán** BASE: lãi đã chốt `+= tiền thu − avg × lượng`; `cost −= avg × lượng`; `qty −= lượng`. Giá trung bình không đổi.
- **Quote là stablecoin** (USDT, USDC, FDUSD, BUSD, TUSD, DAI): tính 1 = 1 USDT, không theo dõi như một vị thế.
- **Quote không phải stablecoin** (ví dụ mua ALT bằng BTC): giá trị USDT = `quoteQty × giá đóng nến 1 phút của QUOTEUSDT tại thời điểm lệnh` (cache vào `prices`). Phía quote cũng được ghi nhận: mua ALT bằng BTC là bán BTC; bán ALT lấy BTC là mua BTC.
- **Phí:**
  - bằng chính coin base: trừ vào `qty` (giá vốn giữ nguyên, giá trung bình tăng tương ứng);
  - bằng stablecoin quote: cộng vào giá vốn khi mua, trừ vào tiền thu khi bán;
  - bằng coin thứ ba (thường là BNB): giá trị USDT của phí = `lượng phí × giá đóng nến 1 phút của coin đó tại thời điểm lệnh`. Cộng giá trị này vào giá vốn (mua) hoặc trừ vào tiền thu (bán). Coin trả phí bị coi là bán đi lượng đó ở giá thị trường: `qty` giảm, `cost` giảm theo giá trung bình của nó, chênh lệch vào lãi đã chốt. *(Quyết định của người viết thiết kế: nhất quán với cách xử lý phía quote.)*
- **Lãi/lỗ đã chốt trên đầu trang** gồm cả phần chốt ở phía quote và phía phí (ví dụ BTC dùng để mua ALT). *(Quyết định của người viết thiết kế.)*

### Không tìm được giá quy đổi

Thứ tự tra giá cho coin X tại thời điểm lệnh: nến `XUSDT`; không có thì nến `USDTX` lấy nghịch đảo (các cặp fiat như TRY, EUR); vẫn không có thì lệnh đó bị đánh dấu "không quy đổi được", không đưa vào giá vốn, và coin liên quan được gắn cờ. Không đoán giá. *(Quyết định của người viết thiết kế.)*

### Coin không rõ nguồn

Vì chỉ đọc Spot, coin đến từ nạp/Convert/Earn không có giá mua.

- Bán nhiều hơn lượng đã ghi nhận: `qty` chặn ở 0, phần vượt không tính lãi/lỗ, coin đó được gắn cờ.
- Số dư thật lớn hơn `qty` tính được: giá trung bình chỉ áp cho phần đã ghi nhận; hiện "N coin không rõ giá vốn".
- Số dư thật nhỏ hơn `qty` tính được (đã rút hoặc chuyển sang Earn/Funding): giá trung bình giữ nguyên, hiện ghi chú "đã chuyển ra N coin", không coi là lỗi.
- Cờ hiện thành nhãn cảnh báo ngay trên dòng coin, có giải thích khi rê chuột.

### Số nào hiện trên bảng

*(Quyết định của người viết thiết kế.)* `cost.js` chỉ nhận danh sách lệnh, không nhận số dư. Lớp hiển thị ghép với số dư Spot thật:

- **Số lượng** = số dư Spot thật (free + locked).
- **Giá TB** = giá trung bình tính từ lệnh.
- **Giá trị** = số dư thật × giá hiện tại.
- **Vốn đang giữ / Lãi lỗ chưa chốt** = tính trên `min(số dư thật, qty tính được)`, tức phần có giá vốn rõ ràng.

### Cặp đã bị hủy niêm yết

Danh sách symbol lấy từ `exchangeInfo`. Cặp đã bị Binance gỡ hẳn (nhiều cặp BUSD cũ) có thể không còn trong đó, khi ấy lệnh trên cặp đó không lấy được qua API. Hệ quả: coin mua qua cặp đó sẽ hiện thành "không rõ giá vốn" (đã có cờ). Ghi rõ giới hạn này trong phần Cài đặt. Chưa kiểm chứng `exchangeInfo` có trả cặp đã gỡ hay không; người làm kiểm tra khi triển khai, nếu có thì quét luôn.

## Giao diện

Một trang, nền tối mặc định (theo `prefers-color-scheme`), chữ số căn phải, font số đơn cách.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Giá vốn Spot                    Đồng bộ lúc 14:02   [Đồng bộ] [⚙]   │
├──────────────────────────────────────────────────────────────────────┤
│ Vốn đang giữ   Giá trị hiện tại   Lãi/lỗ chưa chốt   Lãi/lỗ đã chốt │
│ 12,430 USDT    13,905 USDT        +1,475 (+11.9%)    +820 USDT      │
├──────────────────────────────────────────────────────────────────────┤
│ [Tìm coin…]                                  ☐ Ẩn coin dưới 1 USDT  │
│ Coin   Số lượng    Giá TB     Giá hiện tại   Giá trị    Lãi/lỗ      │
│ BTC    0.1520      61,200     67,450         10,252     +10.2%      │
│ SOL    14.20       148.3      139.1          1,975      −6.2%       │
│ ARB ⚠  1,200       0.82       0.71           852        −13.4%      │
└──────────────────────────────────────────────────────────────────────┘
```

- Bấm một dòng coin: mở bảng lệnh của coin đó (thời gian, cặp, mua/bán, giá, lượng, phí, giá TB sau lệnh).
- Bấm tiêu đề cột để sắp xếp.
- Lần đầu chưa có key: màn hình chỉ có form nhập key + hướng dẫn 3 bước tạo key chỉ đọc.
- Cài đặt (⚙): đổi/xóa key, quét toàn bộ, thêm coin để quét, xuất `.sqlite`, xuất CSV, xóa toàn bộ dữ liệu (có xác nhận).
- Giá hiện tại lấy từ `/api/v3/ticker/price`, làm mới khi mở trang và khi bấm Đồng bộ.

## Bảo mật

- Sau khi nhập key, gọi `/sapi/v1/account/apiRestrictions`. Nếu key có quyền trade hoặc rút tiền: cảnh báo rõ, khuyên tạo key chỉ đọc. Vẫn cho dùng.
- Secret không bao giờ hiện lại sau khi lưu, không ghi log.
- Không có script từ xa, không analytics, host duy nhất là `api.binance.com`.
- `chrome.storage.local` không mã hóa trên đĩa; ghi rõ điều này cạnh form nhập key.

## Kiểm thử

- `test/cost.test.js` (`node --test`): mua nhiều lần, bán một phần, bán hết rồi mua lại, phí bằng base / quote / BNB, cặp quote BTC, bán vượt lượng ghi nhận.
- Kiểm tay: load extension, nhập key thật chỉ đọc, đồng bộ, đối chiếu một coin với tính tay.

## Để người làm tự quyết

- Chi tiết màu sắc, khoảng cách, hiệu ứng.
- Ngưỡng weight cụ thể để tạm nghỉ.
- Giao thức message giữa trang và `db-worker.js`.
- Định dạng cột CSV.
