// Minimal, defensive .zip reader for untrusted archives: stored and deflate entries only, inflated
// with the platform's DecompressionStream (browser and Node), so no library and no network.
// Limits are enforced while unpacking, so a zip bomb or a lying size header stops at the limit.

export const ZIP_LIMITS = Object.freeze({ maxEntry: 50 * 1024 * 1024, maxTotal: 500 * 1024 * 1024, maxEntries: 10_000 });

const size = (n) => (n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} MB` : `${n} bytes`);
const names = new TextDecoder("utf-8");

/**
 * Inflate raw deflate data, giving up once the output passes cap bytes.
 * @returns {Promise<{data?: Uint8Array, over?: boolean, broken?: boolean}>}
 */
async function inflate(body, cap) {
  const ds = new globalThis.DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(body).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > cap) { reader.cancel().catch(() => {}); return { over: true }; }
      chunks.push(value);
    }
  } catch {
    return { broken: true };
  }
  const data = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) { data.set(c, at); at += c.length; }
  return { data };
}

/**
 * @param {Uint8Array} bytes the whole archive
 * @param {Partial<typeof ZIP_LIMITS>} [limits]
 * @returns {Promise<{entries: {path: string, bytes: Uint8Array, tooLarge?: boolean}[],
 *   skipped: {path: string, reason: string}[], error?: string}>}
 *   error: the archive could not be read (fully); entries read before it are kept
 */
export async function unzip(bytes, limits = {}) {
  const L = { ...ZIP_LIMITS, ...limits };
  const entries = [], skipped = [];
  const fail = (error) => ({ entries, skipped, error });
  const len = bytes.length;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);

  // the end-of-central-directory record sits in the last 22 + 65535 (comment) bytes
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) if (u32(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return fail("not a zip archive, or a damaged one");
  const count = u16(eocd + 10), cdSize = u32(eocd + 12), cdOff = u32(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) return fail("Zip64 archives are not supported");
  if (count > L.maxEntries) return fail(`more than ${L.maxEntries} entries; not unpacked`);
  if (cdOff + cdSize > len) return fail("damaged archive (central directory out of range)");

  let p = cdOff, total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > len || u32(p) !== 0x02014b50) return fail("damaged archive (central directory)");
    const flags = u16(p + 8), method = u16(p + 10), csize = u32(p + 20), usize = u32(p + 24);
    const nlen = u16(p + 28), xlen = u16(p + 30), clen = u16(p + 32), loff = u32(p + 42);
    if (p + 46 + nlen > len) return fail("damaged archive (entry name)");
    const path = names.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (path.endsWith("/") || path.endsWith("\\")) continue; // a folder
    if (flags & 1) { skipped.push({ path, reason: "encrypted (password-protected)" }); continue; }
    if (method !== 0 && method !== 8) { skipped.push({ path, reason: `unsupported compression method ${method}` }); continue; }
    if (csize === 0xffffffff || usize === 0xffffffff) { skipped.push({ path, reason: "Zip64 entry" }); continue; }
    if (loff + 30 > len || u32(loff) !== 0x04034b50) { skipped.push({ path, reason: "damaged entry" }); continue; }
    const start = loff + 30 + u16(loff + 26) + u16(loff + 28);
    if (start + csize > len) { skipped.push({ path, reason: "damaged entry (truncated)" }); continue; }
    const body = bytes.subarray(start, start + csize);
    if (usize > L.maxEntry) { entries.push({ path, bytes: new Uint8Array(0), tooLarge: true }); continue; }

    const room = L.maxTotal - total;
    let data;
    if (method === 0) {
      if (body.length > L.maxEntry) { entries.push({ path, bytes: new Uint8Array(0), tooLarge: true }); continue; }
      if (body.length > room) return fail(`unpacks to more than ${size(L.maxTotal)}; stopped`);
      data = body.slice();
    } else {
      // never trust the declared size: inflate with a hard cap
      const r = await inflate(body, Math.min(L.maxEntry, room));
      if (r.broken) { skipped.push({ path, reason: "damaged compressed data" }); continue; }
      if (r.over) {
        if (L.maxEntry <= room) { entries.push({ path, bytes: new Uint8Array(0), tooLarge: true }); continue; }
        return fail(`unpacks to more than ${size(L.maxTotal)}; stopped`);
      }
      data = r.data;
    }
    total += data.length;
    entries.push({ path, bytes: data });
  }
  return { entries, skipped };
}
