import { test } from "node:test";
import assert from "node:assert/strict";
import { ptrName, parsePtrAnswer, resolvePtrs, RESOLVERS } from "../js/model/dns.js";

test("ptrName", () => {
  assert.equal(ptrName("203.0.113.10"), "10.113.0.203.in-addr.arpa");
  assert.equal(ptrName("2001:db8::1"), "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa");
});

test("parsePtrAnswer accepts clean names only", () => {
  assert.equal(parsePtrAnswer({ Status: 0, Answer: [{ type: 12, data: "web.example.com." }] }), "web.example.com");
  assert.equal(parsePtrAnswer({ Status: 3 }), null);
  assert.equal(parsePtrAnswer({ Status: 0, Answer: [{ type: 5, data: "x.example." }] }), null);
  assert.equal(parsePtrAnswer({ Status: 0, Answer: [{ type: 12, data: "<script>.x." }] }), null);
  assert.equal(parsePtrAnswer({ Status: 0, Answer: [{ type: 12, data: "a\u0007b.example." }] }), null);
  assert.equal(parsePtrAnswer({ Status: 0, Answer: [{ type: 12, data: "a".repeat(254) + "." }] }), null);
  assert.equal(parsePtrAnswer(null), null);
});

function fakeFetch(log, { fail = new Set(), delay = 5 } = {}) {
  let active = 0;
  log.maxActive = 0;
  return async (url, opts) => {
    log.push({ url, opts });
    active++; log.maxActive = Math.max(log.maxActive, active);
    await new Promise((r) => setTimeout(r, delay));
    active--;
    if ([...fail].some((f) => url.includes(f))) throw new Error("network");
    return { ok: true, json: async () => ({ Status: 0, Answer: [{ type: 12, data: "host.example.net." }] }) };
  };
}

test("resolvePtrs: URLs, headers, concurrency, progress, errors", async () => {
  const log = [];
  const progress = [];
  const ips = ["93.184.216.10", "93.184.217.7", "93.184.218.15", "93.184.216.25", "93.184.216.61", "10.10.1.10"];
  const res = await resolvePtrs(ips, { resolver: "google", fetch: fakeFetch(log, { fail: new Set(["7.217.184.93"]) }), concurrency: 2, delayMs: 0, onProgress: (d, t) => progress.push([d, t]) });
  assert.equal(log[0].url, "https://dns.google/resolve?name=10.216.184.93.in-addr.arpa&type=PTR");
  assert.ok(log.length === 5, "private IP is never sent");
  assert.ok(log.maxActive <= 2);
  assert.equal(res.get("93.184.216.10"), "host.example.net");
  assert.equal(res.get("93.184.217.7"), null);
  assert.equal(res.has("10.10.1.10"), false);
  assert.deepEqual(progress.at(-1), [5, 5]);
});

test("resolvePtrs: cloudflare header and quad9 URL", async () => {
  const log = [];
  await resolvePtrs(["93.184.216.10"], { resolver: "cloudflare", fetch: fakeFetch(log), delayMs: 0 });
  assert.equal(log[0].url, "https://cloudflare-dns.com/dns-query?name=10.216.184.93.in-addr.arpa&type=PTR");
  assert.equal(log[0].opts.headers.accept, "application/dns-json");
  const log2 = [];
  await resolvePtrs(["93.184.216.10"], { resolver: "quad9", fetch: fakeFetch(log2), delayMs: 0 });
  assert.ok(log2[0].url.startsWith("https://dns.quad9.net:5053/dns-query?name="));
  assert.deepEqual(Object.keys(RESOLVERS).sort(), ["cloudflare", "google", "quad9"]);
});

test("resolvePtrs: abort and unknown resolver", async () => {
  const ac = new AbortController();
  const ips = Array.from({ length: 20 }, (_, i) => `93.184.216.${i + 1}`);
  const p = resolvePtrs(ips, { resolver: "google", fetch: fakeFetch([], { delay: 20 }), concurrency: 1, delayMs: 0, signal: ac.signal });
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(p, { name: "AbortError" });
  await assert.rejects(resolvePtrs(["93.184.216.1"], { resolver: "evil", fetch: fakeFetch([]) }), /Unknown resolver/);
});
