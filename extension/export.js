const COLS = ['time', 'symbol', 'side', 'price', 'qty', 'quote_qty', 'commission', 'commission_asset', 'trade_id', 'order_id'];

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
};

/** DB trade rows -> RFC 4180 CSV. */
export function tradesToCsv(tradeRows) {
  const lines = [COLS.join(',')];
  for (const r of tradeRows) {
    lines.push([
      new Date(r.time).toISOString(), r.symbol, r.is_buyer ? 'BUY' : 'SELL', r.price, r.qty, r.quote_qty,
      r.commission, r.commission_asset, r.id, r.order_id,
    ].map(cell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function download(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
