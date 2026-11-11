// Small pure helpers the controller (js/app.js), the Settings page and the browser job store use to
// keep one job's data out of another's, and the user's own settings apart from a job's.

import { validateSettings } from "./settings.js";

/**
 * Settings read from an imported settings file. A file without a savedFilters list keeps the
 * user's current saved filters (they are the user's own searches, not part of a settings profile).
 * @param {unknown} raw the parsed JSON
 * @param {{savedFilters: object[]}} current the settings in use
 */
export function importedSettings(raw, current) {
  const keep = raw && typeof raw === "object" && !Array.isArray(raw) && !Array.isArray(raw.savedFilters);
  return validateSettings(keep ? { ...raw, savedFilters: current.savedFilters } : raw);
}

/**
 * A change to the saved filters. They belong to the user, so they are patched into the user's own
 * settings (the copy that is stored) and mirrored into the job's effective settings, which may hold
 * an opened session's subnet names and protocol table that must never be stored as the user's.
 * @param {object} user the user's own settings
 * @param {object} effective the settings the current job uses
 * @param {{name: string, query: string}[]} list
 * @returns {{user: object, effective: object}}
 */
export function withSavedFilters(user, effective, list) {
  const nextUser = validateSettings({ ...user, savedFilters: list });
  return { user: nextUser, effective: { ...effective, savedFilters: nextUser.savedFilters.map((f) => ({ ...f })) } };
}

/**
 * Queue `task` after `chain` so that a failure is reported once and never blocks later tasks.
 * @param {Promise<unknown>} chain
 * @param {() => unknown} task
 * @param {(err: unknown) => void} onError
 * @returns {Promise<void>} the new chain; it always resolves
 */
export function chainTask(chain, task, onError) {
  return chain.then(task).then(() => undefined, (err) => { try { onError(err); } catch { /* keep the chain usable */ } });
}

// ---------- per-tab job records (see ui/job-db.js) ----------
export const TAB_PREFIX = "tab:";
export const LEGACY_KEY = "current";
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** @param {unknown} id a tab id read from sessionStorage */
export const validTabId = (id) => typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id);
/** @param {string} id */
export const tabRecordKey = (id) => `${TAB_PREFIX}${id}`;

/**
 * Whether a kept job record is old enough (or broken enough) to delete.
 * @param {unknown} record
 * @param {number} now ms since the epoch
 */
export function isStale(record, now, maxAgeMs = MAX_AGE_MS) {
  const t = record && typeof record === "object" && typeof record.savedAt === "string" ? Date.parse(record.savedAt) : NaN;
  return !Number.isFinite(t) || now - t > maxAgeMs;
}

/**
 * The keys to delete when a tab starts: other tabs' records that are stale. This tab's own record
 * and the legacy record (migrated separately) are never pruned here.
 * @param {{key: unknown, value: unknown}[]} entries
 * @param {string} ownKey
 * @param {number} now
 */
export function keysToPrune(entries, ownKey, now, maxAgeMs = MAX_AGE_MS) {
  return entries.filter(({ key, value }) => typeof key === "string" && key.startsWith(TAB_PREFIX) && key !== ownKey && isStale(value, now, maxAgeMs))
    .map(({ key }) => key);
}

/** The Web Lock a tab holds for as long as it is open (see ui/job-db.js). @param {string} recordKey */
export const tabLockName = (recordKey) => `netstat-parser.${recordKey}`;

/**
 * Which other tab's record a tab without its own should take over: the newest record whose tab is
 * closed (its lock is free) and that is not stale. A record whose tab is still open is never taken,
 * so two tabs with two clients' jobs never swap. Without lock information nothing is taken.
 * @param {{key: unknown, value: unknown}[]} entries
 * @param {string} ownKey
 * @param {Set<string>|null} heldLocks names of the locks currently held, or null when unknown
 * @param {number} now ms since the epoch
 * @returns {string|null}
 */
export function orphanToAdopt(entries, ownKey, heldLocks, now, maxAgeMs = MAX_AGE_MS) {
  if (!heldLocks) return null;
  let best = null, bestAt = -Infinity;
  for (const { key, value } of entries) {
    if (typeof key !== "string" || !key.startsWith(TAB_PREFIX) || key === ownKey) continue;
    if (heldLocks.has(tabLockName(key)) || isStale(value, now, maxAgeMs)) continue;
    const t = Date.parse(value.savedAt);
    if (t > bestAt) { best = key; bestAt = t; }
  }
  return best;
}
