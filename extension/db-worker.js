// Owns the only SQLite connection. The page talks to it through db.js: { id, method, args } -> { id, result | error }.
import sqlite3InitModule from './vendor/sqlite/index.mjs';

const FILE = '/spot.sqlite3';
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS trades(
    symbol TEXT NOT NULL, id INTEGER NOT NULL, order_id INTEGER,
    base TEXT NOT NULL, quote TEXT NOT NULL,
    price TEXT NOT NULL, qty TEXT NOT NULL, quote_qty TEXT NOT NULL,
    commission TEXT NOT NULL, commission_asset TEXT NOT NULL,
    time INTEGER NOT NULL, is_buyer INTEGER NOT NULL, is_maker INTEGER NOT NULL,
    PRIMARY KEY(symbol, id));
  CREATE INDEX IF NOT EXISTS trades_time ON trades(time, id);
  CREATE TABLE IF NOT EXISTS symbols(
    symbol TEXT PRIMARY KEY, base TEXT NOT NULL, quote TEXT NOT NULL,
    last_trade_id INTEGER, last_synced_at INTEGER);
  CREATE TABLE IF NOT EXISTS prices(
    symbol TEXT NOT NULL, minute INTEGER NOT NULL, close REAL,
    PRIMARY KEY(symbol, minute));
`;
const TRADE_COLS = [
  'symbol', 'id', 'order_id', 'base', 'quote', 'price', 'qty', 'quote_qty',
  'commission', 'commission_asset', 'time', 'is_buyer', 'is_maker',
];

let pool;
let db;

const rows = (sql, bind) => db.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' });

function insertMany(sql, list, toBind) {
  db.transaction(() => {
    const stmt = db.prepare(sql);
    try {
      for (const item of list) stmt.bind(toBind(item)).stepReset();
    } finally {
      stmt.finalize();
    }
  });
}

const methods = {
  async init() {
    const sqlite3 = await sqlite3InitModule();
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'spot' });
    } catch (e) {
      // The pool takes exclusive OPFS handles; failure almost always means another tab holds them.
      throw Object.assign(new Error(e.message), { code: 'LOCKED' });
    }
    db = new pool.OpfsSAHPoolDb(FILE);
    db.exec(SCHEMA);
  },

  insertTrades(list) {
    insertMany(
      `INSERT OR IGNORE INTO trades(${TRADE_COLS.join(',')}) VALUES(${TRADE_COLS.map(() => '?').join(',')})`,
      list, (t) => TRADE_COLS.map((c) => t[c]));
  },

  allTrades: () => rows('SELECT * FROM trades ORDER BY time, id'),

  getCursors: () => rows('SELECT * FROM symbols'),

  setCursor(symbol, base, quote, lastTradeId) {
    db.exec({
      sql: `INSERT INTO symbols(symbol, base, quote, last_trade_id, last_synced_at) VALUES(?,?,?,?,?)
            ON CONFLICT(symbol) DO UPDATE SET last_trade_id = excluded.last_trade_id, last_synced_at = excluded.last_synced_at`,
      bind: [symbol, base, quote, lastTradeId, Date.now()],
    });
  },

  getPrices: () => rows('SELECT symbol, minute, close FROM prices'),

  putPrices(list) {
    insertMany('INSERT OR REPLACE INTO prices(symbol, minute, close) VALUES(?,?,?)',
      list, (p) => [p.symbol, p.minute, p.close]);
  },

  exportFile: () => pool.exportFile(FILE),

  wipe() {
    db.exec('DELETE FROM trades; DELETE FROM symbols; DELETE FROM prices; VACUUM;');
  },
};

self.onmessage = async ({ data: { id, method, args } }) => {
  try {
    self.postMessage({ id, result: await methods[method](...args) });
  } catch (e) {
    self.postMessage({ id, error: { message: e.message, code: e.code ?? null } });
  }
};
