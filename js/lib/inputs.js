// Which files from a folder or archive are worth parsing, and expanding .zip files in a batch.
// Files picked one by one are always parsed; this filter is for folders and archives only.
import { unzip } from "./zip.js";

const TEXT_EXTENSIONS = new Set(["txt", "log", "out"]);
const baseName = (path) => String(path).split(/[\\/]/).pop();

/** @param {string} path a name or a path inside a folder or archive */
export function isCandidate(path) {
  if (!path || /[\\/]$/.test(path)) return false;
  if (/(^|[\\/])__MACOSX([\\/]|$)/i.test(path)) return false; // macOS resource forks
  const base = baseName(path);
  if (!base || base.startsWith(".")) return false; // .DS_Store, ._* forks, hidden files
  if (/^(thumbs\.db|desktop\.ini)$/i.test(base)) return false;
  const dot = base.lastIndexOf(".");
  return dot < 1 || TEXT_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

/** @param {string} name @param {Uint8Array} bytes */
export function isZip(name, bytes) {
  return /\.zip$/i.test(name) || (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
}

/**
 * Replace each .zip in a batch with the likely netstat files inside it.
 * @param {{name: string, bytes: Uint8Array, tooLarge?: boolean}[]} batch
 * @param {object} [limits] passed to unzip
 * @returns {Promise<{files: {name: string, bytes: Uint8Array, tooLarge?: boolean}[], notes: {skipped: number, archives: number, problems: string[]}}>}
 */
export async function expandArchives(batch, limits) {
  const files = [], problems = [];
  let skipped = 0, archives = 0;
  for (const f of batch) {
    if (!isZip(f.name, f.bytes)) { files.push(f); continue; }
    archives++;
    if (f.tooLarge) { problems.push(`${f.name}: archive is too large to open`); continue; }
    const r = await unzip(f.bytes, limits);
    for (const e of r.entries) {
      if (isZip(e.path, e.bytes)) { skipped++; problems.push(`${f.name}: ${e.path}: zip inside a zip (unpack it first)`); continue; }
      if (!isCandidate(e.path)) { skipped++; continue; }
      files.push({ name: baseName(e.path), bytes: e.bytes, tooLarge: e.tooLarge === true });
    }
    for (const s of r.skipped) { skipped++; problems.push(`${f.name}: ${s.path}: ${s.reason}`); }
    if (r.error) problems.push(`${f.name}: ${r.error}`);
  }
  return { files, notes: { skipped, archives, problems } };
}
