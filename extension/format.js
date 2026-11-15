// Display formatting. en-US digits (12,430.50) to match what traders see on Binance; U+2212 for minus.

const DASH = '—';
const MINUS = '−';
const nf = (opts) => new Intl.NumberFormat('en-US', opts);
const usd = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const priceMid = nf({ minimumFractionDigits: 2, maximumFractionDigits: 4 });
const priceSmall = nf({ maximumSignificantDigits: 6, maximumFractionDigits: 12 });
const qty = nf({ maximumFractionDigits: 8 });
const pct = nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 });

const withMinus = (n, fmt) => (n < 0 ? MINUS : '') + fmt.format(Math.abs(n));

export function fmtUsd(n) {
  return n == null ? DASH : withMinus(n, usd);
}

export function fmtSignedUsd(n) {
  if (n == null) return DASH;
  const text = usd.format(Math.abs(n));
  if (text === '0.00') return text;
  return (n > 0 ? '+' : MINUS) + text;
}

export function fmtPrice(n) {
  if (n == null) return DASH;
  const abs = Math.abs(n);
  return withMinus(n, abs >= 1000 ? usd : abs >= 1 ? priceMid : priceSmall);
}

export function fmtQty(n) {
  return n == null ? DASH : withMinus(n, qty);
}

export function fmtPct(n) {
  if (n == null) return DASH;
  const text = pct.format(Math.abs(n));
  if (text === '0.0') return '0.0%';
  return (n > 0 ? '+' : MINUS) + text + '%';
}

export function fmtTime(ms) {
  const d = new Date(ms);
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtClock(ms) {
  const d = new Date(ms);
  const p = (v) => String(v).padStart(2, '0');
  const today = new Date().toDateString() === d.toDateString();
  return today ? `${p(d.getHours())}:${p(d.getMinutes())}` : fmtTime(ms);
}
