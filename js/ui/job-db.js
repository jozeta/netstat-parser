// Keeps the current job in this browser's IndexedDB so a reload does not lose it (Settings →
// "Keep the current job in this browser"). Every call resolves (never rejects): storage can be
// missing or blocked (private mode, disabled site data), and the app works without it. What comes
// back is untrusted; model/saved-job.js validates it.
//
// One record per browser tab, so two tabs with two clients' jobs never overwrite or restore each
// other's job:
// - A tab gets a random id kept in sessionStorage. It survives a reload (and a reopened closed
//   tab), and is unique per tab; a duplicated tab copies it and so shares the record.
// - Each tab holds a Web Lock named after its record for as long as it is open. On start a tab
//   restores its own record; a tab without one takes over the newest record of a CLOSED tab (its
//   lock is free), so closing the tab and opening the app again brings the job back, while a job
//   in another open tab is never taken. Without Web Locks a new tab restores nothing.
// - Migration: the single "current" record of earlier versions is restored once, by the first tab
//   that finds it, and moved to that tab's key.
// - Other tabs' records not saved for 30 days are deleted when a tab starts.
// - Without sessionStorage the id lives in memory only: the job is kept for this page load but a
//   reload starts empty (the record is pruned after 30 days).

import { LEGACY_KEY, keysToPrune, orphanToAdopt, tabLockName, tabRecordKey, validTabId } from "../model/job-guard.js";

const DB = "netstat-parser", STORE = "job", TAB_ID = "netstat-parser.tab";

function newId() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* fall through */ }
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

let ownKey = null;
function key() {
  if (ownKey) return ownKey;
  let id = null;
  try {
    id = globalThis.sessionStorage?.getItem(TAB_ID);
    if (!validTabId(id)) { id = newId(); globalThis.sessionStorage?.setItem(TAB_ID, id); }
  } catch { if (!validTabId(id)) id = newId(); }
  ownKey = tabRecordKey(id);
  return ownKey;
}

let lockTaken = false;
/** Hold this tab's lock until the tab closes; resolves once it is held (or cannot be). */
function holdLock() {
  const locks = globalThis.navigator?.locks;
  if (lockTaken || !locks?.request) return Promise.resolve();
  lockTaken = true;
  return new Promise((held) => {
    try {
      locks.request(tabLockName(key()), () => { held(); return new Promise(() => {}); }).catch(() => held());
    } catch { held(); }
  });
}
/** Names of the locks held right now, or null when that cannot be known. */
async function heldLocks() {
  try {
    const q = await globalThis.navigator?.locks?.query?.();
    return q ? new Set((q.held ?? []).map((l) => l.name)) : null;
  } catch { return null; }
}

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

/** fn(store) may issue several requests and returns a getter for the value to resolve with. */
async function run(mode, fn) {
  const db = await open();
  if (!db) return { ok: false };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const get = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve({ ok: true, value: get?.() }); };
      tx.onerror = tx.onabort = () => { db.close(); resolve({ ok: false, error: tx.error }); };
    } catch (error) {
      db.close();
      resolve({ ok: false, error });
    }
  });
}

/**
 * This tab's record (migrating the legacy shared one if this tab has none); prunes stale records.
 * @returns {Promise<unknown>} the stored record, or undefined
 */
export const readJob = async () => {
  await holdLock();
  const held = await heldLocks();
  return (await run("readwrite", (s) => {
  const own = key();
  let value;
  const entries = [];
  const cursor = s.openCursor();
  cursor.onsuccess = () => {
    const c = cursor.result;
    if (c) { entries.push({ key: c.key, value: c.value }); c.continue(); return; }
    const mine = entries.find((e) => e.key === own);
    const legacy = entries.find((e) => e.key === LEGACY_KEY);
    const orphan = !mine && !legacy ? orphanToAdopt(entries, own, held, Date.now()) : null;
    if (mine) value = mine.value;
    else if (legacy) { value = legacy.value; s.put(legacy.value, own); s.delete(LEGACY_KEY); }
    else if (orphan) { value = entries.find((e) => e.key === orphan).value; s.put(value, own); s.delete(orphan); }
    for (const k of keysToPrune(entries, own, Date.now())) s.delete(k);
  };
  return () => value;
  })).value;
};
/** @returns {Promise<{ok: boolean, error?: unknown}>} not ok when full (QuotaExceededError) or unavailable */
export const writeJob = (record) => run("readwrite", (s) => { s.put(record, key()); });
export const clearJob = () => run("readwrite", (s) => { s.delete(key()); });
