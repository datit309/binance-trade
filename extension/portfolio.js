// Joins computed positions with real Spot balances and current prices for display.
import { STABLES } from './cost.js';

// Binance reports Simple Earn holdings in the Spot account as LD<asset> (LDBTC, LDUSDT). Earn is out of scope,
// so they are dropped; a real coin such as LDO has its own USDT pair and is kept.
function isEarnWrapper(asset, tickers) {
  if (!asset.startsWith('LD') || asset.length < 4 || tickers[asset + 'USDT'] != null) return false;
  const inner = asset.slice(2);
  return STABLES.has(inner) || tickers[inner + 'USDT'] != null;
}

/**
 * @param positions output of computePositions
 * @param balances  { [asset]: free + locked }
 * @param tickers   { [symbol]: price }
 */
export function buildRows(positions, balances, tickers) {
  const assets = new Set([...Object.keys(positions), ...Object.keys(balances)]);
  const rows = [];

  for (const asset of assets) {
    if (STABLES.has(asset)) continue;
    const p = positions[asset];
    if (!p && isEarnWrapper(asset, tickers)) continue;
    const balance = balances[asset] ?? 0;
    const qty = p?.qty ?? 0;
    const realized = p?.realized ?? 0;
    const flagged = Boolean(p?.oversold || p?.unpriced);
    if (balance <= 0 && qty <= 0 && realized === 0 && !flagged) continue;

    const price = tickers[asset + 'USDT'] ?? null;
    const avg = qty > 0 ? p.avg : null;
    // Only the part of the balance that came from recorded Spot trades has a known cost.
    const knownQty = Math.min(balance, qty);
    const costHeld = knownQty * (avg ?? 0);
    const unrealized = price == null ? null : knownQty * price - costHeld;
    const unknownQty = Math.max(0, balance - qty);
    const movedOutQty = Math.max(0, qty - balance);

    const warn = [];
    // Ignore sub-1-USDT gaps: fee dust and rounding, not a missing purchase.
    if (unknownQty > 0 && (price == null || unknownQty * price >= 1)) warn.push('unknown');
    if (p?.oversold) warn.push('oversold');
    if (p?.unpriced) warn.push('unpriced');
    if (price == null) warn.push('noprice');

    rows.push({
      asset, balance, avg, price,
      value: price == null ? null : balance * price,
      knownQty, costHeld, unrealized,
      unrealizedPct: unrealized != null && costHeld > 0 ? (unrealized / costHeld) * 100 : null,
      realized, unknownQty, movedOutQty, warn,
    });
  }

  return rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.asset.localeCompare(b.asset));
}

export function summarize(rows) {
  let costHeld = 0;
  let value = 0;
  let unrealized = 0;
  let realized = 0;
  for (const r of rows) {
    costHeld += r.costHeld;
    value += r.value ?? 0; // whole Spot balance, so it matches the table and the allocation bar
    unrealized += r.unrealized ?? 0;
    realized += r.realized;
  }
  return {
    costHeld,
    value,
    unrealized,
    unrealizedPct: costHeld > 0 ? (unrealized / costHeld) * 100 : null,
    realized,
  };
}
