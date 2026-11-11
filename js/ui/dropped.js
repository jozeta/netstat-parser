// Walk folders dropped on the page (DataTransferItem.webkitGetAsEntry() entries). Takes the entry
// objects as given, so it can be tested with plain fakes.
import { isCandidate } from "../lib/inputs.js";

const isZipName = (name) => /\.zip$/i.test(name);

/** All entries of a directory: readEntries() returns them in batches until an empty one. */
function readAll(dirEntry) {
  return new Promise((resolve, reject) => {
    const reader = dirEntry.createReader();
    const all = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) resolve(all);
      else { all.push(...batch); next(); }
    }, reject);
    next();
  });
}

const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

/**
 * @param {object[]} entries top-level entries (files the user dropped are always taken)
 * @param {{maxFiles?: number, maxDepth?: number}} [opts]
 * @returns {Promise<{files: File[], skipped: number, truncated: boolean}>}
 */
export async function walkEntries(entries, { maxFiles = 10_000, maxDepth = 20 } = {}) {
  const files = [];
  let skipped = 0, truncated = false;
  async function visit(list, depth) {
    for (const e of list) {
      if (truncated) return;
      if (!e) continue;
      if (files.length >= maxFiles) { truncated = true; return; }
      if (e.isDirectory) {
        if (depth >= maxDepth || e.name === "__MACOSX") { skipped++; continue; }
        await visit(await readAll(e), depth + 1);
      } else if (e.isFile) {
        if (depth === 0 || isZipName(e.name) || isCandidate(e.name)) files.push(await fileOf(e));
        else skipped++;
      }
    }
  }
  await visit(entries, 0);
  return { files, skipped, truncated };
}
