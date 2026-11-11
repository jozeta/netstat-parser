// Builds real .zip archives for tests (stored or deflate entries), with Node's zlib.
import { deflateRawSync } from "node:zlib";

const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/**
 * @param {{name: string, data?: string|Uint8Array, method?: 0|8, flags?: number, size?: number, dir?: boolean}[]} entries
 *   size overrides the declared uncompressed size (to fake a lying header)
 */
export function makeZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const raw = typeof e.data === "string" ? new TextEncoder().encode(e.data) : (e.data ?? new Uint8Array(0));
    const method = e.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const size = e.size ?? raw.length;
    const flags = e.flags ?? 0;
    const head = [...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0), ...u32(0),
      ...u32(body.length), ...u32(size), ...u16(name.length), ...u16(0)];
    local.push(Uint8Array.from(head), name, body);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0),
      ...u32(0), ...u32(body.length), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(e.dir ? 0x10 : 0), ...u32(offset)]), name);
    offset += head.length + name.length + body.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
