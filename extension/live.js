// Live prices over Binance's public market-data WebSocket. No API key is sent on this connection.

const ENDPOINT = 'wss://stream.binance.com:9443/stream?streams=';

/**
 * @param symbols  ['BTCUSDT', ...]
 * @param onPrice  (symbol, lastPrice, open24h) => void, roughly once a second per symbol
 * @param onStatus (connected: boolean) => void
 * @returns { close() }
 */
export function openTicker({
  symbols, onPrice, onStatus,
  WebSocketImpl = globalThis.WebSocket, setTimer = setTimeout, retryMs = 3000,
}) {
  let ws = null;
  let stopped = false;

  function connect() {
    ws = new WebSocketImpl(ENDPOINT + symbols.map((s) => s.toLowerCase() + '@miniTicker').join('/'));
    ws.onopen = () => onStatus?.(true);
    ws.onmessage = (event) => {
      let tick;
      try {
        tick = JSON.parse(event.data).data;
      } catch {
        return;
      }
      const price = Number(tick?.c);
      if (tick?.s && Number.isFinite(price)) onPrice(tick.s, price, Number(tick.o));
    };
    // Binance drops every connection after 24h, and networks drop them sooner: always reconnect.
    ws.onclose = () => {
      onStatus?.(false);
      if (!stopped) setTimer(connect, retryMs);
    };
    ws.onerror = () => ws.close();
  }

  if (symbols.length > 0) connect();
  return {
    close() {
      stopped = true;
      ws?.close();
    },
  };
}
