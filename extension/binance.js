// Read-only Binance Spot client. Talks to api.binance.com only; no order endpoints exist here on purpose.

const BASE = 'https://api.binance.com';
const WEIGHT_PAUSE_AT = 4800; // of 6000 per minute per IP; leaves headroom for other apps on the same IP
const AUTH_CODES = new Set([-2008, -2014, -2015, -1022]);

export class BinanceError extends Error {
  constructor(message, { kind = 'other', code = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'BinanceError';
    this.kind = kind; // 'auth' | 'ratelimit' | 'network' | 'other'
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function sign(secret, queryString) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(queryString));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createClient({
  apiKey,
  secret,
  fetch = globalThis.fetch.bind(globalThis),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  let timeOffset = null; // server time - local time
  let pauseMs = 0; // set when the last response reported weight near the limit

  async function syncTime() {
    const { serverTime } = await request('/api/v3/time');
    timeOffset = serverTime - now();
  }

  async function request(path, params = {}, { signed = false } = {}, attempt = {}) {
    if (pauseMs > 0) {
      const wait = pauseMs;
      pauseMs = 0;
      await sleep(wait);
    }

    const query = new URLSearchParams(params);
    const headers = {};
    if (signed) {
      if (timeOffset === null) await syncTime();
      query.set('recvWindow', '10000');
      query.set('timestamp', String(now() + timeOffset));
      query.set('signature', await sign(secret, query.toString()));
      headers['X-MBX-APIKEY'] = apiKey;
    }
    const qs = query.toString();

    let res;
    try {
      res = await fetch(BASE + path + (qs ? '?' + qs : ''), { headers });
    } catch {
      throw new BinanceError('Không kết nối được tới Binance. Kiểm tra mạng rồi thử lại.', { kind: 'network' });
    }

    const used = Number(res.headers.get('x-mbx-used-weight-1m'));
    if (used >= WEIGHT_PAUSE_AT) pauseMs = 60_000 - (now() % 60_000) + 1000;

    if (res.status === 429 || res.status === 418) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 60;
      // 418 is an IP ban: never retry. 429: back off once, then give up rather than risk a ban.
      if (res.status === 429 && !attempt.backedOff) {
        await sleep((retryAfter + 1) * 1000);
        return request(path, params, { signed }, { ...attempt, backedOff: true });
      }
      throw new BinanceError(`Binance yêu cầu chờ ${retryAfter} giây rồi thử lại.`, { kind: 'ratelimit', retryAfter });
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.code === -1021 && signed && !attempt.resynced) {
        await syncTime();
        return request(path, params, { signed }, { ...attempt, resynced: true });
      }
      if (res.status === 401 || AUTH_CODES.has(body.code)) {
        throw new BinanceError('API key không hợp lệ, đã hết hạn, hoặc bị giới hạn IP.', { kind: 'auth', code: body.code });
      }
      throw new BinanceError(`Binance báo lỗi: ${body.msg ?? 'HTTP ' + res.status}`, { code: body.code ?? null });
    }

    return res.json();
  }

  return {
    async exchangeInfo() {
      const { symbols } = await request('/api/v3/exchangeInfo');
      return symbols.map((s) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));
    },

    async account() {
      const { balances } = await request('/api/v3/account', { omitZeroBalances: 'true' }, { signed: true });
      const out = {};
      for (const b of balances) {
        const total = Number(b.free) + Number(b.locked);
        if (total > 0) out[b.asset] = total;
      }
      return out;
    },

    async apiRestrictions() {
      const r = await request('/sapi/v1/account/apiRestrictions', {}, { signed: true });
      return { canTrade: Boolean(r.enableSpotAndMarginTrading), canWithdraw: Boolean(r.enableWithdrawals) };
    },

    myTrades(symbol, fromId) {
      return request('/api/v3/myTrades', { symbol, fromId: String(fromId), limit: '1000' }, { signed: true });
    },

    async tickerPrices() {
      const list = await request('/api/v3/ticker/price');
      return Object.fromEntries(list.map((t) => [t.symbol, Number(t.price)]));
    },

    async klines(symbol, startTime, limit) {
      const rows = await request('/api/v3/klines', {
        symbol, interval: '1m', startTime: String(startTime), limit: String(limit),
      });
      return rows.map((k) => ({ minute: k[0], close: Number(k[4]) }));
    },
  };
}
