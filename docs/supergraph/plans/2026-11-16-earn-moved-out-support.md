# Kế hoạch hỗ trợ theo dõi Coin đã chuyển sang Simple Earn / Ví ngoài (Earn & Moved-out Holdings Support)

## Environment Context
- Language: Node.js (ES modules, type="module")
- Test Command: `npm test`
- Lint Command: `node --check extension/*.js`
- Format Command: None
- Build Command: None (pure vanilla JS Chrome Extension)
- Branch: `main`
- CBM_PROJECT: `binance-trade`
- Host permissions: `https://api.binance.com/*`

## Architecture & Contracts
### 1. `portfolio.js` - Hỗ trợ `externalQty` / `movedOut` Valuation
- **Vấn đề hiện tại**:
  - Khi coin được mua trên Spot nhưng chuyển 100% sang Simple Earn / Funding / rút ví, `balance = 0`.
  - `knownQty = Math.min(balance, qty) = 0`, khiến `costHeld = 0`, `unrealized = null`, `value = null`.
  - Bảng danh mục và Drawer hiển thị toàn bộ là `—` dù lịch sử mua đầy đủ và người dùng chưa từng bán.
- **Contract mới trong `portfolio.js`**:
  - `r.movedOutQty = Math.max(0, qty - balance)`.
  - `r.movedOutCost = r.movedOutQty * (r.avg ?? 0)`.
  - `r.movedOutValue = price != null ? r.movedOutQty * price : null`.
  - `r.movedOutUnrealized = (r.movedOutValue != null && r.movedOutCost > 0) ? r.movedOutValue - r.movedOutCost : null`.
  - `r.movedOutUnrealizedPct = (r.movedOutCost > 0 && r.movedOutUnrealized != null) ? (r.movedOutUnrealized / r.movedOutCost) * 100 : null`.
  - Khi `balance === 0` và `qty > 0`:
    - `r.hasEarnOrMoved = true`.
    - `r.totalTrackedQty = qty`.
    - `r.totalValue = r.movedOutValue`.
    - `r.totalCost = r.movedOutCost`.
    - `r.totalUnrealized = r.movedOutUnrealized`.
    - `r.totalUnrealizedPct = r.movedOutUnrealizedPct`.

### 2. `ui.js` - Hiển thị minh bạch cho Coin đã chuyển ví / Earn
- **Sửa điều kiện `movedOut(r)`**:
  - Bỏ `r.balance > 0`, chỉ cần `r.movedOutQty * (r.price ?? 1) >= 1` (kể cả khi `balance === 0`).
- **Hiển thị dòng trên bảng danh mục (`holdingRow`)**:
  - Nếu `balance === 0` và `movedOutQty > 0`:
    - Cột Số lượng: `0.00` kèm dòng phụ `(Earn/Ví ngoài: X)`
    - Cột Giá trị: hiển thị giá trị thị trường của lượng coin đã mua với ký hiệu `≈ $...` và chú thích `Earn/Ví ngoài`.
    - Cột Lãi/lỗ & Hiệu suất: hiển thị lãi/lỗ ước tính của lượng coin đang nắm giữ ngoài Spot thay vì để `—`.
    - Thêm tag vàng/xám `Earn / Chuyển ví` cạnh tên coin để người dùng biết ngay lý do.
- **Hiển thị trong Drawer (`renderDrawer`)**:
  - Bổ sung ô `Vốn đã mua (Earn/Chuyển ví)` và `Lãi/lỗ ước tính` khi `balance === 0`.
  - Ghi chú rõ ràng: *"Toàn bộ X coin này đã được chuyển khỏi ví Spot (Simple Earn, Funding hoặc rút ví). Lịch sử mua Spot vẫn ghi nhận đầy đủ giá vốn trung bình là Y USDT."*

---

## Task 1: Bổ sung định giá vị thế chuyển ví / Earn trong `portfolio.js`
Wave: 1
Status: completed
Risk: low
Dependencies: none
Model: inherit

Files:
- Modify: extension/portfolio.js
- Test: test/portfolio.test.js

Blast radius:
- extension/portfolio.js
- test/portfolio.test.js

Acceptance:
- `buildRows` tính toán đầy đủ `movedOutCost`, `movedOutValue`, `movedOutUnrealized`, `movedOutUnrealizedPct` cho lượng coin đã mua trên Spot nhưng không còn nằm ở ví Spot.
- Khi `balance === 0` nhưng `qty > 0`, các giá trị định giá này không bị mất.
- Toàn bộ test trong `test/portfolio.test.js` pass.

TDD:
- Behavior: `buildRows` tính giá trị và PnL cho coin đã chuyển sang Earn khi balance = 0.
- Test file: test/portfolio.test.js
- Test name: coin chuyển hết sang Earn (balance = 0, qty > 0) vẫn tính được movedOutValue và movedOutUnrealized
- 🔴 RED command: npm test
- Expected 🔴 RED failure: r.movedOutValue undefined hoặc r.movedOutUnrealized undefined
- Minimal 🟢 GREEN change: Thêm các trường `movedOutValue`, `movedOutCost`, `movedOutUnrealized`, `movedOutUnrealizedPct` trong `buildRows`.
- Refactor candidates: Giữ logic gọn gàng, tương thích ngược với summarize.
- Mocking: none

Steps:
1. 🔴 RED: Viết test case cho coin `balance = 0, qty > 0` trong `test/portfolio.test.js`.
   Command: npm test
   Expected: FAIL
2. 🟢 GREEN: Cập nhật `buildRows` trong `extension/portfolio.js`.
   Command: npm test
   Expected: PASS
3. REFACTOR: Kiểm tra syntax và assertions.
4. VERIFY:
   - npm test
   - node --check extension/portfolio.js

Checkpoint:
- Files: extension/portfolio.js test/portfolio.test.js
- Commit: feat: calculate moved-out valuation and unrealized PnL in portfolio

---

## Task 2: Cập nhật giao diện bảng danh mục và Drawer (`ui.js`)
Wave: 2
Status: completed
Risk: low
Dependencies: Task 1
Model: inherit

Files:
- Modify: extension/ui.js
- Test: test/ui.test.js

Blast radius:
- extension/ui.js
- test/ui.test.js

Acceptance:
- Sửa hàm `movedOut(r)` để nhận diện cả khi `balance === 0`.
- Hiển thị tag và dòng phụ `(Earn: X)` trong cột Số lượng khi coin có `balance === 0` nhưng `movedOutQty > 0`.
- Hiển thị Giá trị và Lãi/lỗ ước tính thay vì dấu gạch ngang `—` vô nghĩa.
- Drawer hiển thị ghi chú và thẻ thống kê lãi/lỗ ước tính cho lượng coin ngoài Spot.
- Toàn bộ test suite pass.

TDD:
- Behavior: `holdingRow` hiển thị đúng giá trị và PnL cho coin Earn/chuyển ví khi balance = 0.
- Test file: test/ui.test.js
- Test name: holdingRow hiển thị thông tin Earn khi balance = 0 và qty > 0
- 🔴 RED command: npm test
- Expected 🔴 RED failure: Hiển thị dash() thay vì giá trị ước tính
- Minimal 🟢 GREEN change: Cập nhật `movedOut`, `holdingRow` và `renderDrawer` trong `extension/ui.js`.
- Refactor candidates: None
- Mocking: DOM mock

Steps:
1. 🔴 RED: Viết test case trong `test/ui.test.js`.
   Command: npm test
   Expected: FAIL
2. 🟢 GREEN: Cập nhật `extension/ui.js`.
   Command: npm test
   Expected: PASS
3. REFACTOR: Kiểm tra hiển thị và CSS class.
4. VERIFY:
   - npm test
   - node --check extension/ui.js

Checkpoint:
- Files: extension/ui.js test/ui.test.js
- Commit: feat: display estimated value and PnL for Earn and moved-out assets
