import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultCollapsed } from "../js/ui/collapse.js";

const model = { groups: new Map([["g:a", { hostIds: new Array(30) }], ["g:b", { hostIds: new Array(31) }], ["g:internet", { hostIds: new Array(200) }], ["g:c", { hostIds: [] }]]) };

test("groups with more than N hosts start collapsed; up to N start expanded", () => {
  assert.deepEqual([...defaultCollapsed(model, 30)].sort(), ["g:b", "g:internet"]);
  assert.deepEqual([...defaultCollapsed(model, 0)].sort(), ["g:a", "g:b", "g:internet"]);
  assert.deepEqual([...defaultCollapsed(model, 1000)], []);
});

test("only groups not seen before get the default; known groups keep the user's choice", () => {
  assert.deepEqual([...defaultCollapsed(model, 30, new Set(["g:b"]))], ["g:internet"]);
});
