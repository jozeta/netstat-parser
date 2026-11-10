import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePtrs } from "../js/model/dns.js";
import { mergeSessionSettings, validateSettings, DEFAULT_SETTINGS } from "../js/model/settings.js";

test("DNS: results are reported as they arrive, so a cancel keeps what was resolved", async () => {
  const ac = new AbortController();
  const got = new Map();
  const fetch = async () => { await new Promise((r) => setTimeout(r, 15)); return { ok: true, json: async () => ({ Status: 0, Answer: [{ type: 12, data: "h.example.net." }] }) }; };
  const ips = Array.from({ length: 20 }, (_, i) => `203.0.113.${i + 1}`);
  const p = resolvePtrs(ips, { resolver: "google", fetch, concurrency: 1, delayMs: 0, signal: ac.signal, onResult: (ip, name) => got.set(ip, name) });
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(p, { name: "AbortError" });
  assert.ok(got.size >= 2 && got.size < 20, String(got.size));
  assert.equal([...got.values()][0], "h.example.net");
});

test("opening a session never turns on DNS or drops the user's own internal ranges", () => {
  const current = validateSettings({ internalRanges: ["198.51.100.0/24"], dns: { enabled: false, resolver: null } });
  const fromSession = validateSettings({ internalRanges: ["203.0.113.0/24"], dns: { enabled: true, resolver: "google" }, subnets: [{ cidr: "10.0.0.0/8", name: "Corp" }] });
  const m = mergeSessionSettings(current, fromSession);
  assert.deepEqual(m.dns, { enabled: false, resolver: null });
  assert.deepEqual(m.internalRanges.sort(), ["198.51.100.0/24", "203.0.113.0/24"]);
  assert.deepEqual(m.subnets, [{ cidr: "10.0.0.0/8", name: "Corp" }]);
  assert.deepEqual(mergeSessionSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS), validateSettings(null));
});
