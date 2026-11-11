// Keeps the current job in this browser's IndexedDB so a reload does not lose it (Settings →
// "Keep the current job in this browser"). One record, overwritten on every save. Every call
// resolves (never rejects): storage can be missing or blocked (private mode, disabled site data),
// and the app works without it. What comes back is untrusted; model/saved-job.js validates it.

const DB = "netstat-parser", STORE = "job", KEY = "current";

function open() {
  return new Promise((resolve) => {
    let req;
    try { req = globalThis.indexedDB?.open(DB, 1); } catch { resolve(null); return; }
    if (!req) { resolve(null); return; }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function run(mode, fn) {
  const db = await open();
  if (!db) return { ok: false };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve({ ok: true, value: req?.result }); };
      tx.onerror = tx.onabort = () => { db.close(); resolve({ ok: false, error: tx.error }); };
    } catch (error) {
      db.close();
      resolve({ ok: false, error });
    }
  });
}

/** @returns {Promise<unknown>} the stored record, or undefined */
export const readJob = async () => (await run("readonly", (s) => s.get(KEY))).value;
/** @returns {Promise<{ok: boolean, error?: unknown}>} not ok when full (QuotaExceededError) or unavailable */
export const writeJob = (record) => run("readwrite", (s) => s.put(record, KEY));
export const clearJob = () => run("readwrite", (s) => s.delete(KEY));
