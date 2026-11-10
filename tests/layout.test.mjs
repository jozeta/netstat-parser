import { test } from "node:test";
import assert from "node:assert/strict";
import { groupedLayout } from "../js/ui/layout.js";
import { toElements } from "../js/ui/elements.js";
import { buildModel } from "../js/model/build.js";
import { DEFAULT_SETTINGS } from "../js/model/settings.js";
import { generated } from "./helpers/net.mjs";

const model = buildModel(generated("medium").files, DEFAULT_SETTINGS);
const opts = { collapsed: new Set(), visible: null, mode: "fade", dns: {}, labels: true };

function boxes(els, pos) {
  const byParent = new Map();
  for (const n of els.nodes) if (n.data.parent) {
    const p = pos[n.data.id];
    const b = byParent.get(n.data.parent) ?? { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    b.x1 = Math.min(b.x1, p.x); b.y1 = Math.min(b.y1, p.y); b.x2 = Math.max(b.x2, p.x); b.y2 = Math.max(b.y2, p.y);
    byParent.set(n.data.parent, b);
  }
  for (const n of els.nodes) if (n.classes.includes("collapsed")) { const p = pos[n.data.id]; byParent.set(n.data.id, { x1: p.x, y1: p.y, x2: p.x, y2: p.y }); }
  return [...byParent.values()];
}

test("every leaf node gets a position; groups never overlap", () => {
  for (const collapsed of [new Set(), new Set(["g:internet"]), new Set(model.groups.keys())]) {
    const els = toElements(model, { ...opts, collapsed });
    const pos = groupedLayout(els);
    const leaves = els.nodes.filter((n) => !els.nodes.some((m) => m.data.parent === n.data.id));
    for (const n of leaves) assert.ok(pos[n.data.id] && Number.isFinite(pos[n.data.id].x), n.data.id);
    const bs = boxes(els, pos);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      const overlap = a.x1 - 40 < b.x2 + 40 && b.x1 - 40 < a.x2 + 40 && a.y1 - 40 < b.y2 + 40 && b.y1 - 40 < a.y2 + 40;
      assert.ok(!overlap, `groups ${i} and ${j} overlap`);
    }
  }
});

test("no two hosts share a position, and it is deterministic", () => {
  const els = toElements(model, opts);
  const a = groupedLayout(els), b = groupedLayout(els);
  assert.deepEqual(a, b);
  const keys = new Set(Object.values(a).map((p) => `${p.x},${p.y}`));
  assert.equal(keys.size, Object.keys(a).length);
});
