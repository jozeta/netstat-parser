// Reverse DNS (PTR) for Internet addresses via DNS-over-HTTPS JSON APIs. Opt-in only; the UI
// warns first. fetch is injected so this stays testable and never runs on import.

import { ipToBigInt, isLoopback } from "../lib/ip.js";
import { inCidr, DEFAULT_INTERNAL_RANGES } from "../lib/cidr.js";

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

const isInternet = (ip) => !isLoopback(ip) && ip !== "*" && !DEFAULT_INTERNAL_RANGES.some((c) => inCidr(ip, c));
const abortError = () => new DOMException("Aborted", "AbortError");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string[]} ips
 * @param {{resolver: string, fetch: Function, concurrency?: number, delayMs?: number, signal?: AbortSignal,
 *   onProgress?: (done: number, total: number) => void}} opts
 * @returns {Promise<Map<string, string|null>>}
 */
export async function resolvePtrs(ips, { resolver, fetch, concurrency = 4, delayMs = 100, signal, onProgress }) {
  const r = RESOLVERS[resolver];
  if (!Object.hasOwn(RESOLVERS, resolver) || !r) throw new Error("Unknown resolver");
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
      onProgress?.(++done, queue.length);
      if (delayMs) await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, worker));
  if (signal?.aborted) throw abortError();
  return out;
}
