import { test } from "node:test";
import assert from "node:assert/strict";
import { toSaved, fromSaved, SAVED_JOB_VERSION } from "../js/model/saved-job.js";
import { validateSettings, DEFAULT_SETTINGS } from "../js/model/settings.js";
import { generated } from "./helpers/net.mjs";

const files = generated("small").files;
const job = {
  files,
  settings: validateSettings({ ...DEFAULT_SETTINGS, internalRanges: ["203.0.113.0/24"] }),
  dns: { "8.8.8.8": "dns.google", "1.1.1.1": null },
  positions: { "h:10.0.0.1": { x: 10, y: 20 } },
  collapsed: new Set(["g:internet"]),
  dirty: true,
};

test("a saved job comes back with its files, DNS, positions, collapsed groups and unsaved flag", () => {
  const back = fromSaved(structuredClone(toSaved(job)), DEFAULT_SETTINGS);
  assert.equal(back.files.length, files.length);
  assert.deepEqual(back.files.map((f) => f.fileName), files.map((f) => f.fileName));
  assert.deepEqual(back.dns, job.dns);
  assert.deepEqual(back.positions, job.positions);
  assert.deepEqual([...back.collapsed], ["g:internet"]);
  assert.equal(back.dirty, true);
  assert.ok(back.settings.internalRanges.includes("203.0.113.0/24"), "the job's tables come back");
});

test("restoring keeps the user's current DNS and loading preferences", () => {
  const current = validateSettings({ dns: { enabled: true, resolver: "google", acknowledged: true }, load: { onMore: "merge" } });
  const back = fromSaved(toSaved(job), current);
  assert.deepEqual(back.settings.dns, current.dns);
  assert.deepEqual(back.settings.load, current.load);
});

test("the stored record is plain data with a version", () => {
  const r = toSaved(job);
  assert.equal(r.version, SAVED_JOB_VERSION);
  assert.equal(typeof r.session, "string");
  assert.equal(typeof r.savedAt, "string");
});

test("storage is untrusted: anything malformed is refused, never thrown", () => {
  for (const bad of [null, undefined, 42, "x", {}, { version: 99, session: "{}" }, { version: SAVED_JOB_VERSION, session: "not json" },
    { version: SAVED_JOB_VERSION, session: JSON.stringify({ format: "other" }) }, { version: SAVED_JOB_VERSION, session: 5 }]) {
    assert.equal(fromSaved(bad, DEFAULT_SETTINGS), null, JSON.stringify(bad));
  }
});

test("an empty job is not worth restoring", () => {
  assert.equal(fromSaved(toSaved({ ...job, files: [] }), DEFAULT_SETTINGS), null);
});
