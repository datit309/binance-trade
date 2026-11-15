// Temporary storage check (Task 5); replaced by the real dashboard in Task 6.
import { openDb } from './db.js';

const out = document.getElementById('out');
try {
  const db = await openDb();
  window.db = db;
  out.textContent = `OK trades=${(await db.allTrades()).length}`;
} catch (e) {
  out.textContent = `ERR ${e.code} ${e.message}`;
}
