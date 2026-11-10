// CIDR parsing and membership. Pure.

import { ipToBigInt, bigIntToIp } from "./ip.js";

const BITS = { 4: 32, 6: 128 };

function mask(prefix, family) {
  const bits = BigInt(BITS[family]);
  const p = BigInt(prefix);
  return ((1n << bits) - 1n) ^ ((1n << (bits - p)) - 1n);
}

/**
 * @param {string} text e.g. "10.10.1.0/24"
 * @returns {{ip: string, prefix: number, family: 4|6} | null} network address canonicalised
 */
export function parseCidr(text) {
  if (typeof text !== "string") return null;
  const m = /^\s*([^/\s]+)\/(\d{1,3})\s*$/.exec(text);
  if (!m) return null;
  const addr = ipToBigInt(m[1]);
  const prefix = Number(m[2]);
  if (!addr || prefix > BITS[addr.family]) return null;
  return { ip: bigIntToIp(addr.value & mask(prefix, addr.family), addr.family), prefix, family: addr.family };
}

/**
 * @param {string} ip canonical address
 * @param {{ip: string, prefix: number, family: 4|6}} cidr
 */
export function inCidr(ip, cidr) {
  const a = ipToBigInt(ip);
  if (!a || !cidr || a.family !== cidr.family) return false;
  const m = mask(cidr.prefix, cidr.family);
  return (a.value & m) === (ipToBigInt(cidr.ip).value & m);
}

/** "10.10.1.77", 24 → "10.10.1.0/24" */
export function networkOf(ip, prefix) {
  const a = ipToBigInt(ip);
  if (!a) return null;
  return `${bigIntToIp(a.value & mask(prefix, a.family), a.family)}/${prefix}`;
}
