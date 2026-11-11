// Reverse DNS (PTR) for Internet addresses via DNS-over-HTTPS JSON APIs. Opt-in only; the UI
// warns first. fetch is injected so this stays testable and never runs on import.

import { ipToBigInt, isLoopback } from "../lib/ip.js";
import { inCidr, parseCidr, DEFAULT_INTERNAL_RANGES } from "../lib/cidr.js";

export const RESOLVERS = Object.freeze({
  cloudflare: { label: "Cloudflare", url: (q) => `https://cloudflare-dns.com/dns-query?name=${q}&type=PTR`, headers: { accept: "application/dns-json" } },
  google: { label: "Google", url: (q) => `https://dns.google/resolve?name=${q}&type=PTR`, headers: {} },
  quad9: { label: "Quad9", url: (q) => `https://dns.quad9.net:5053/dns-query?name=${q}&type=PTR`, headers: {} },
});

const NAME = /^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)(\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/i;

/** @param {string} ip canonical address */
export function ptrName(ip) {
  const a = ipToBigInt(ip);
  if (!a) throw new Error("Not an IP address");
  if (a.family === 4) return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
  const hex = a.value.toString(16).padStart(32, "0");
  return `${hex.split("").reverse().join(".")}.ip6.arpa`;
}

/** @returns {string|null} */
export function parsePtrAnswer(json) {
  if (!json || typeof json !== "object" || json.Status !== 0 || !Array.isArray(json.Answer)) return null;
  const ans = json.Answer.find((a) => a && a.type === 12 && typeof a.data === "string");
  if (!ans) return null;
  const name = ans.data.replace(/\.$/, "");
  return NAME.test(name) ? name.toLowerCase() : null;
}

// never resolvable on the public Internet, or not unicast
// plus IPv6 forms that embed an IPv4 address (NAT64, 6to4, Teredo), which may hide a private one
// plus documentation (TEST-NET, 2001:db8::/32) and benchmark ranges, which never have names
const NOT_PUBLIC = ["0.0.0.0/8", "224.0.0.0/4", "240.0.0.0/4", "ff00::/8", "64:ff9b::/96", "64:ff9b:1::/48", "2002::/16", "2001::/32",
  "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "198.18.0.0/15", "2001:db8::/32", "192.0.0.0/24", "192.88.99.0/24"].map(parseCidr);
// IPv6 outside global unicast (IPv4-compatible ::a.b.c.d, IPv4-translated, site-local, discard...) is never sent
const GLOBAL_UNICAST6 = parseCidr("2000::/3");
const abortError = () => new DOMException("Aborted", "AbortError");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string[]} ips
 * @param {{resolver: string, fetch: Function, concurrency?: number, delayMs?: number, signal?: AbortSignal,
 *   onProgress?: (done: number, total: number) => void, onResult?: (ip: string, name: string|null) => void,
 *   internalRanges?: string[]}} opts
 * @returns {Promise<Map<string, string|null>>}
 */
export async function resolvePtrs(ips, { resolver, fetch, concurrency = 4, delayMs = 100, signal, onProgress, onResult, internalRanges = [] }) {
  const r = RESOLVERS[resolver];
  if (!Object.hasOwn(RESOLVERS, resolver) || !r) throw new Error("Unknown resolver");
  // Privacy: only public addresses ever leave the browser (settings' internal ranges included).
  const blocked = [...DEFAULT_INTERNAL_RANGES, ...NOT_PUBLIC, ...internalRanges.map(parseCidr).filter(Boolean)];
  const isInternet = (ip) => !isLoopback(ip) && ip !== "*" && (!ip.includes(":") || inCidr(ip, GLOBAL_UNICAST6))
    && !blocked.some((c) => inCidr(ip, c));
  const queue = [...new Set(ips)].filter(isInternet);
  const out = new Map();
  let done = 0, next = 0;
  const worker = async () => {
    while (next < queue.length) {
      if (signal?.aborted) throw abortError();
      const ip = queue[next++];
      let name = null;
      try {
        const res = await fetch(r.url(ptrName(ip)), { headers: { ...r.headers }, signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (res.ok) name = parsePtrAnswer(await res.json());
      } catch (e) {
        if (signal?.aborted || e?.name === "AbortError") throw abortError();
      }
      out.set(ip, name);
      onResult?.(ip, name); // reported as it arrives, so a cancelled run keeps what it got
      onProgress?.(++done, queue.length);
      if (delayMs) await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, worker));
  if (signal?.aborted) throw abortError();
  return out;
}
