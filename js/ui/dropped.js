// Walk folders dropped on the page (DataTransferItem.webkitGetAsEntry() entries). Takes the entry
// objects as given, so it can be tested with plain fakes.
import { isCandidate } from "../lib/inputs.js";

const isZipName = (name) => /\.zip$/i.test(name);

/**
 * All entries of a directory: readEntries() returns them in batches until an empty one.
 * Never rejects: a read error keeps the batches read so far and sets failed.
 * @returns {Promise<{entries: object[], failed: boolean}>}
 */
function readAll(dirEntry) {
  return new Promise((resolve) => {
    const all = [];
    const fail = () => resolve({ entries: all, failed: true });
    try {
      const reader = dirEntry.createReader();
      const next = () => {
        try {
          reader.readEntries((batch) => {
            if (!batch || !batch.length) resolve({ entries: all, failed: false });
            else { all.push(...batch); next(); }
          }, fail);
        } catch { fail(); }
      };
      next();
    } catch { fail(); }
  });
}

/** The File of an entry, or null when it cannot be read (permissions, file gone). */
const fileOf = (entry) => new Promise((resolve) => {
  try { entry.file(resolve, () => resolve(null)); } catch { resolve(null); }
});

/**
 * One unreadable file or folder does not stop the walk: it is counted in skipped and unreadable.
 * @param {object[]} entries top-level entries (files the user dropped are always taken)
 * @param {{maxFiles?: number, maxDepth?: number}} [opts]
 * @returns {Promise<{files: File[], skipped: number, truncated: boolean, unreadable: number}>}
 *   unreadable: files and folders that could not be read (also included in skipped)
 */
export async function walkEntries(entries, { maxFiles = 10_000, maxDepth = 20 } = {}) {
  const files = [];
  let skipped = 0, unreadable = 0, truncated = false;
  const cannotRead = () => { skipped++; unreadable++; };
  async function visit(list, depth) {
    for (const e of list) {
      if (truncated) return;
      if (!e) continue;
      if (files.length >= maxFiles) { truncated = true; return; }
      if (e.isDirectory) {
        if (depth >= maxDepth || e.name === "__MACOSX") { skipped++; continue; }
        const { entries: children, failed } = await readAll(e);
        if (failed) cannotRead();
        await visit(children, depth + 1);
      } else if (e.isFile) {
        if (depth === 0 || isZipName(e.name) || isCandidate(e.name)) {
          const f = await fileOf(e);
          if (f) files.push(f);
          else cannotRead();
        } else skipped++;
      }
    }
  }
  await visit(entries, 0);
  return { files, skipped, truncated, unreadable };
}
