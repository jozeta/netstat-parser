import { test } from "node:test";
import assert from "node:assert/strict";
import { readTheme, writeTheme, THEME_KEY, THEMES } from "../js/ui/theme.js";

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const broken = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };

test("theme preference: system by default, garbage ignored, storage errors survived", () => {
  assert.deepEqual(THEMES, ["system", "dark", "light"]);
  const st = mem();
  assert.equal(readTheme(st), "system");
  writeTheme(st, "dark");
  assert.equal(st.getItem(THEME_KEY), "dark");
  assert.equal(readTheme(st), "dark");
  st.setItem(THEME_KEY, "<script>");
  assert.equal(readTheme(st), "system");
  writeTheme(st, "system");
  assert.equal(st.getItem(THEME_KEY), null);
  assert.equal(readTheme(broken), "system");
  assert.doesNotThrow(() => writeTheme(broken, "light"));
  assert.equal(readTheme(null), "system");
});
