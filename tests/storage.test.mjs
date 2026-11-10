import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, saveSettings, SETTINGS_KEY } from "../js/ui/storage.js";
import { DEFAULT_SETTINGS } from "../js/model/settings.js";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };

test("round trip through storage, validated", () => {
  const st = memory();
  const s = structuredClone(DEFAULT_SETTINGS);
  s.subnets = [{ cidr: "10.10.1.0/24", name: "Servers" }];
  assert.equal(saveSettings(st, s), true);
  assert.equal(SETTINGS_KEY, "netstat-parser.settings.v1");
  assert.deepEqual(loadSettings(st).subnets, [{ cidr: "10.10.1.0/24", name: "Servers" }]);
});

test("missing, corrupt or throwing storage → defaults, no throw", () => {
  assert.deepEqual(loadSettings(memory()), DEFAULT_SETTINGS);
  const st = memory(); st.setItem(SETTINGS_KEY, "{not json");
  assert.deepEqual(loadSettings(st), DEFAULT_SETTINGS);
  assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS);
  assert.equal(saveSettings(broken, DEFAULT_SETTINGS), false);
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
});
