import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, validateSettings, mergeSessionSettings } from "../js/model/settings.js";
import { resolveButton, shouldAutoResolve, loadChoice } from "../js/model/policy.js";
import { resolvePtrs } from "../js/model/dns.js";

const S = (dns = {}, load) => validateSettings({ dns, ...(load ? { load } : {}) });

test("DNS and loading defaults", () => {
  assert.deepEqual(DEFAULT_SETTINGS.dns, { enabled: false, resolver: null, acknowledged: false, auto: false });
  assert.deepEqual(DEFAULT_SETTINGS.load, { onMore: "ask", keepJob: true });
});

test("DNS settings: enabling needs a resolver, not the acknowledgement; auto needs both", () => {
  assert.deepEqual(S({ enabled: true, resolver: "google" }).dns, { enabled: true, resolver: "google", acknowledged: false, auto: false });
  assert.equal(S({ enabled: true, resolver: null }).dns.enabled, false);
  assert.equal(S({ enabled: true, resolver: "google", acknowledged: true, auto: true }).dns.auto, true);
  assert.equal(S({ enabled: true, resolver: "google", acknowledged: false, auto: true }).dns.auto, false);
  assert.equal(S({ enabled: false, resolver: "google", acknowledged: true, auto: true }).dns.auto, false);
  assert.equal(S({ enabled: true, resolver: "google", acknowledged: "yes" }).dns.acknowledged, false);
});

test("settings saved before the acknowledgement was stored: enabled implied it", () => {
  assert.equal(validateSettings({ dns: { enabled: true, resolver: "quad9" } }).dns.acknowledged, false);
  assert.equal(validateSettings({ dns: { enabled: true, resolver: "quad9" } }, { legacy: true }).dns.acknowledged, true);
});

test("load.onMore accepts ask, merge, new only", () => {
  for (const v of ["ask", "merge", "new"]) assert.equal(S({}, { onMore: v }).load.onMore, v);
  assert.equal(S({}, { onMore: "replace" }).load.onMore, "ask");
});

test("load.keepJob is a boolean, on unless explicitly false", () => {
  assert.equal(S({}, { onMore: "ask", keepJob: false }).load.keepJob, false);
  assert.equal(S({}, { onMore: "ask", keepJob: "no" }).load.keepJob, true);
  assert.equal(S({}, { onMore: "merge" }).load.keepJob, true);
  assert.equal(S({}, { keepJob: false }).load.keepJob, false); // without onMore
});

test("a session never changes the user's DNS or loading preferences", () => {
  const current = S({ enabled: true, resolver: "google", acknowledged: true, auto: true }, { onMore: "merge", keepJob: false });
  const fromSession = S({ enabled: false }, { onMore: "new", keepJob: true });
  const m = mergeSessionSettings(current, fromSession);
  assert.deepEqual(m.dns, current.dns);
  assert.deepEqual(m.load, current.load);
});

test("per-host resolve button: disabled until DNS lookup is enabled; warns until acknowledged", () => {
  assert.deepEqual(resolveButton(S()), { disabled: true, warn: true });
  assert.deepEqual(resolveButton(S({ enabled: true, resolver: "google" })), { disabled: false, warn: true });
  assert.deepEqual(resolveButton(S({ enabled: true, resolver: "google", acknowledged: true })), { disabled: false, warn: false });
});

test("automatic lookup after loading only when enabled, acknowledged and switched on", () => {
  assert.equal(shouldAutoResolve(S({ enabled: true, resolver: "google", acknowledged: true, auto: true })), true);
  assert.equal(shouldAutoResolve(S({ enabled: true, resolver: "google", acknowledged: true })), false);
  assert.equal(shouldAutoResolve(S()), false);
});

test("loading more files: nothing loaded → just load; otherwise the setting decides", () => {
  assert.equal(loadChoice(S({}, { onMore: "new" }), 0), "merge");
  assert.equal(loadChoice(S({}, { onMore: "ask" }), 3), "ask");
  assert.equal(loadChoice(S({}, { onMore: "merge" }), 3), "merge");
  assert.equal(loadChoice(S({}, { onMore: "new" }), 3), "new");
});

test("documentation and benchmark addresses are never sent to a resolver", async () => {
  const asked = [];
  const fetch = async (url) => { asked.push(url); return { ok: true, json: async () => ({ Status: 3 }) }; };
  await resolvePtrs(["192.0.2.1", "198.51.100.2", "203.0.113.3", "198.18.0.9", "2001:db8::1", "8.8.8.8"], { resolver: "google", fetch, delayMs: 0 });
  assert.equal(asked.length, 1);
  assert.match(asked[0], /8\.8\.8\.8\.in-addr\.arpa/);
});
