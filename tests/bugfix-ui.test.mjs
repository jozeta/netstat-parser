import { test } from "node:test";
import assert from "node:assert/strict";
import { importedSettings, withSavedFilters, chainTask, isStale, keysToPrune, validTabId, tabRecordKey, LEGACY_KEY, MAX_AGE_MS } from "../js/model/job-guard.js";
import { validateSettings, mergeSessionSettings, DEFAULT_SETTINGS } from "../js/model/settings.js";

const filters = [{ name: "RDP", query: "port:3389" }];
const user = validateSettings({ ...DEFAULT_SETTINGS, savedFilters: filters });

test("#14 importing a settings file without savedFilters keeps the current saved filters", () => {
  const s = importedSettings({ graph: { expandUpTo: 5, labels: true } }, user);
  assert.deepEqual(s.savedFilters, filters);
  assert.equal(s.graph.expandUpTo, 5);
});

test("#14 a settings file with its own savedFilters (even empty) replaces them", () => {
  assert.deepEqual(importedSettings({ savedFilters: [] }, user).savedFilters, []);
  assert.deepEqual(importedSettings({ savedFilters: [{ name: "x", query: "risk:red" }] }, user).savedFilters, [{ name: "x", query: "risk:red" }]);
});

test("#14 a non-object import falls back to defaults without throwing", () => {
  assert.deepEqual(importedSettings(null, user), validateSettings(null));
  assert.deepEqual(importedSettings([1, 2], user).savedFilters, []);
});

test("#7 a saved-filter change stores the user's settings, not an opened session's tables", () => {
  const session = validateSettings({ ...DEFAULT_SETTINGS, subnets: [{ cidr: "10.9.0.0/16", name: "Client LAN" }], protocols: [] });
  const effective = mergeSessionSettings(user, session);
  assert.equal(effective.subnets.length, 1);
  const list = [...filters, { name: "SMB", query: "port:445" }];
  const r = withSavedFilters(user, effective, list);
  assert.deepEqual(r.user.subnets, user.subnets, "the session's subnet names are not in the stored copy");
  assert.deepEqual(r.user.protocols, user.protocols);
  assert.deepEqual(r.user.savedFilters, list);
  assert.deepEqual(r.effective.savedFilters, list, "the job sees the new filters too");
  assert.deepEqual(r.effective.subnets, effective.subnets, "the job keeps the session's tables");
  assert.deepEqual(r.effective.protocols, []);
});

test("#17 a failing save does not block later saves and is reported", async () => {
  const errors = [], ran = [];
  let chain = Promise.resolve();
  chain = chainTask(chain, () => { ran.push(1); throw new RangeError("Invalid string length"); }, (e) => errors.push(e));
  chain = chainTask(chain, async () => { ran.push(2); }, (e) => errors.push(e));
  chain = chainTask(chain, async () => { ran.push(3); return Promise.reject(new Error("again")); }, (e) => errors.push(e));
  chain = chainTask(chain, () => { ran.push(4); }, () => { throw new Error("handler threw"); });
  await chain;
  assert.deepEqual(ran, [1, 2, 3, 4]);
  assert.equal(errors.length, 2);
  assert.ok(errors[0] instanceof RangeError);
});

test("#27 per-tab job records: ids, keys and pruning of other tabs' stale records", () => {
  assert.ok(validTabId("3f2b8c1e-1234-4abc-9def-0123456789ab"));
  for (const bad of [null, "", "short", "a".repeat(65), "x<script>yy", 42]) assert.equal(validTabId(bad), false);
  const now = Date.parse("2026-11-11T12:00:00Z");
  const old = new Date(now - MAX_AGE_MS - 1000).toISOString(), fresh = new Date(now - 1000).toISOString();
  assert.equal(isStale({ savedAt: fresh }, now), false);
  assert.equal(isStale({ savedAt: old }, now), true);
  assert.equal(isStale({ savedAt: "nonsense" }, now), true);
  assert.equal(isStale(undefined, now), true);
  const own = tabRecordKey("aaaaaaaa-own");
  const entries = [
    { key: own, value: { savedAt: old } }, // this tab's own record is never pruned here
    { key: tabRecordKey("bbbbbbbb-old"), value: { savedAt: old } },
    { key: tabRecordKey("cccccccc-new"), value: { savedAt: fresh } },
    { key: tabRecordKey("dddddddd-bad"), value: "junk" },
    { key: LEGACY_KEY, value: { savedAt: old } }, // migrated, not pruned
    { key: 7, value: null },
  ];
  assert.deepEqual(keysToPrune(entries, own, now), [tabRecordKey("bbbbbbbb-old"), tabRecordKey("dddddddd-bad")]);
});
