// Sample account for ?demo=1. Runs through the real cost engine; touches no chrome.* or DB. Prices then follow the live public stream.

const BNB_PRICE = 600;
let nextId = 1;
const rows = [];
const priceRows = [];
const minuteOf = (time) => Math.floor(time / 60_000) * 60_000;

function trade(symbol, base, quote, side, price, qty, [month, day, hour], fee = 'BNB', quoteUsdt = 1) {
  const time = Date.UTC(2026, month - 1, day, hour, 12, 30);
  const quoteQty = price * qty;
  const commission =
    fee === 'BNB' ? (quoteQty * quoteUsdt * 0.00075) / BNB_PRICE
    : fee === base ? qty * 0.001
    : quoteQty * 0.001;
  if (fee === 'BNB') priceRows.push({ symbol: 'BNBUSDT', minute: minuteOf(time), close: BNB_PRICE });
  if (quote === 'BTC') priceRows.push({ symbol: 'BTCUSDT', minute: minuteOf(time), close: quoteUsdt });
  rows.push({
    symbol, id: nextId, order_id: 5000 + nextId, base, quote,
    price: String(price), qty: String(qty), quote_qty: String(quoteQty),
    commission: commission.toFixed(8), commission_asset: fee,
    time, is_buyer: side === 'BUY' ? 1 : 0, is_maker: nextId % 3 === 0 ? 1 : 0,
  });
  nextId += 1;
}

trade('BNBUSDT', 'BNB', 'USDT', 'BUY', 560, 2, [2, 3, 9], 'BNB');
trade('BTCUSDT', 'BTC', 'USDT', 'BUY', 58200, 0.05, [2, 10, 8]);
trade('BTCUSDT', 'BTC', 'USDT', 'BUY', 61400, 0.08, [3, 2, 14]);
trade('BTCUSDT', 'BTC', 'USDT', 'BUY', 64900, 0.06, [4, 18, 21]);
trade('BTCUSDT', 'BTC', 'USDT', 'SELL', 69800, 0.03, [5, 27, 10]);
trade('BTCFDUSD', 'BTC', 'FDUSD', 'BUY', 59100, 0.04, [7, 6, 7], 'BTC');
trade('BTCUSDT', 'BTC', 'USDT', 'SELL', 66200, 0.02, [9, 14, 16]);
trade('ETHUSDT', 'ETH', 'USDT', 'BUY', 3120, 0.8, [2, 21, 11]);
trade('ETHUSDT', 'ETH', 'USDT', 'BUY', 2890, 1.2, [3, 30, 19]);
trade('ETHUSDT', 'ETH', 'USDT', 'SELL', 3350, 0.5, [5, 12, 13]);
trade('ETHUSDT', 'ETH', 'USDT', 'BUY', 2540, 1.0, [8, 8, 9]);
trade('SOLUSDT', 'SOL', 'USDT', 'BUY', 96.4, 6, [2, 26, 15]);
trade('SOLUSDT', 'SOL', 'USDT', 'BUY', 118.2, 5, [4, 9, 12]);
trade('SOLBTC', 'SOL', 'BTC', 'BUY', 0.00212, 4, [6, 20, 20], 'BNB', 63500);
trade('SOLUSDT', 'SOL', 'USDT', 'SELL', 171.5, 3, [7, 29, 18]);
trade('SOLUSDT', 'SOL', 'USDT', 'BUY', 128.9, 2.2, [10, 3, 8]);
trade('ARBUSDT', 'ARB', 'USDT', 'BUY', 0.94, 400, [3, 15, 10]);
trade('ARBUSDT', 'ARB', 'USDT', 'BUY', 0.66, 300, [8, 22, 22]);
trade('DOGEUSDT', 'DOGE', 'USDT', 'BUY', 0.118, 9000, [3, 5, 6], 'DOGE');
trade('DOGEUSDT', 'DOGE', 'USDT', 'BUY', 0.141, 5000, [4, 1, 17]);
trade('DOGEUSDT', 'DOGE', 'USDT', 'SELL', 0.203, 8000, [5, 20, 9], 'USDT');
trade('DOGEUSDT', 'DOGE', 'USDT', 'SELL', 0.176, 5991, [6, 11, 14], 'USDT');
trade('LINKUSDT', 'LINK', 'USDT', 'BUY', 14.2, 30, [4, 24, 13]);
trade('LINKUSDT', 'LINK', 'USDT', 'BUY', 12.6, 25, [6, 2, 8]);
trade('LINKUSDT', 'LINK', 'USDT', 'SELL', 17.9, 20, [9, 30, 19]);
trade('NEWTUSDT', 'NEWT', 'USDT', 'BUY', 0.42, 500, [10, 12, 11]);
trade('BNBUSDT', 'BNB', 'USDT', 'BUY', 588, 0.5, [8, 15, 10], 'BNB');
trade('PEPEUSDT', 'PEPE', 'USDT', 'SELL', 0.0000121, 20000000, [7, 2, 9], 'USDT');
trade('ETHUSDT', 'ETH', 'USDT', 'SELL', 2610, 0.4, [11, 2, 15]);
trade('BTCUSDT', 'BTC', 'USDT', 'BUY', 62850, 0.012, [11, 9, 7]);

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
