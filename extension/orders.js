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
