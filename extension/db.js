// Promise wrapper around db-worker.js. openDb() rejects with code 'LOCKED' when another tab holds the database.

const METHODS = [
  'insertTrades', 'allTrades', 'getCursors', 'setCursor', 'getPrices', 'putPrices', 'exportFile', 'wipe',
];

export async function openDb() {
  const worker = new Worker(new URL('./db-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let nextId = 1;

  worker.onmessage = ({ data: { id, result, error } }) => {
    const { resolve, reject } = pending.get(id);
    pending.delete(id);
    if (error) reject(Object.assign(new Error(error.message), { code: error.code }));
    else resolve(result);
  };

  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, args });
    });

  try {
    await call('init');
  } catch (e) {
    worker.terminate();
    throw e;
  }
  return Object.fromEntries(METHODS.map((m) => [m, (...args) => call(m, ...args)]));
}
