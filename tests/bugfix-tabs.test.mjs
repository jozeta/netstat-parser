// A closed tab's kept job is taken over by the next tab; a live tab's job never is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { orphanToAdopt, tabRecordKey, tabLockName, MAX_AGE_MS } from "../js/model/job-guard.js";

const now = Date.parse("2026-11-11T12:00:00Z");
const at = (msAgo) => ({ savedAt: new Date(now - msAgo).toISOString() });
const own = tabRecordKey("aaaaaaaa-own");
const closedNew = tabRecordKey("bbbbbbbb-closed-new"), closedOld = tabRecordKey("cccccccc-closed-old");
const live = tabRecordKey("dddddddd-live"), stale = tabRecordKey("eeeeeeee-stale");
const entries = [
  { key: closedOld, value: at(60_000) },
  { key: closedNew, value: at(1_000) },
  { key: live, value: at(10) }, // newest, but its tab is still open
  { key: stale, value: at(MAX_AGE_MS + 1) },
  { key: "current", value: at(5) },
];

test("the newest record of a closed tab is adopted; open tabs' and stale records are not", () => {
  const held = new Set([tabLockName(own), tabLockName(live)]);
  assert.equal(orphanToAdopt(entries, own, held, now), closedNew);
});

test("nothing to adopt when every other record belongs to an open tab", () => {
  const held = new Set([tabLockName(own), tabLockName(live), tabLockName(closedNew), tabLockName(closedOld)]);
  assert.equal(orphanToAdopt(entries, own, held, now), null);
});

test("without lock information (no Web Locks) nothing is adopted", () => {
  assert.equal(orphanToAdopt(entries, own, null, now), null);
});

test("lock names are derived from the record key", () => {
  assert.equal(tabLockName(own), "netstat-parser.tab:aaaaaaaa-own");
});
