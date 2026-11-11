// The current job as kept in this browser between reloads (IndexedDB, see ui/job-db.js). It is the
// session file format plus the "unsaved changes" flag, and it is read back through the same
// untrusted-input checks as an opened session file: browser storage can be edited by anyone.

import { createSession, parseSession } from "./session.js";
import { mergeSessionSettings } from "./settings.js";

export const SAVED_JOB_VERSION = 1;

/**
 * @param {{files: object[], settings: object, dns: object, positions: object, collapsed: Iterable<string>, dirty: boolean}} job
 * @returns {{version: number, session: string, dirty: boolean, savedAt: string}}
 */
export function toSaved({ files, settings, dns, positions, collapsed, dirty }) {
  const session = createSession({ files, settings, dns, positions, collapsed: [...collapsed] });
  return { version: SAVED_JOB_VERSION, session: JSON.stringify(session), dirty: dirty === true, savedAt: new Date().toISOString() };
}

/**
 * @param {unknown} record what storage returned
 * @param {object} currentSettings the user's settings (DNS and loading preferences are kept)
 * @returns {{files: object[], settings: object, dns: object, positions: object, collapsed: Set<string>, dirty: boolean}|null}
 *   null when there is nothing (valid) to restore
 */
export function fromSaved(record, currentSettings) {
  if (!record || typeof record !== "object" || record.version !== SAVED_JOB_VERSION || typeof record.session !== "string") return null;
  let s;
  try { s = parseSession(record.session); } catch { return null; }
  if (!s.files.length) return null;
  return { files: s.files, settings: mergeSessionSettings(currentSettings, s.settings), dns: s.dns, positions: s.positions,
    collapsed: new Set(s.collapsed), dirty: record.dirty === true };
}
