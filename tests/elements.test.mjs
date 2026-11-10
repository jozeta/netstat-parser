import { test } from "node:test";
import assert from "node:assert/strict";
import { toElements } from "../js/ui/elements.js";
import { osIcon } from "../js/ui/icons.js";
import { buildModel } from "../js/model/build.js";
import { DEFAULT_SETTINGS } from "../js/model/settings.js";
import { applyFilter, parseQuery } from "../js/model/filter.js";
import { generated, winFile } from "./helpers/net.mjs";

const model = buildModel(generated("small").files, DEFAULT_SETTINGS);
const base = { collapsed: new Set(), visible: null, mode: "fade", dns: {}, labels: true };
const nodesOf = (els, cls) => els.nodes.filter((n) => n.classes.split(" ").includes(cls));

test("expanded: one parent per group, hosts inside, all edges", () => {
  const els = toElements(model, base);
  assert.equal(nodesOf(els, "group").length, model.groups.size);
  assert.ok(nodesOf(els, "internet").length === 1);
  for (const n of nodesOf(els, "host")) assert.equal(n.data.parent, model.hosts.get(n.data.id).groupId);
  assert.equal(els.edges.length, model.edges.size);
});

test("collapsing the Internet merges its hosts and edges", () => {
  const els = toElements(model, { ...base, collapsed: new Set(["g:internet"]) });
  const inet = els.nodes.find((n) => n.data.id === "g:internet");
  assert.ok(inet.classes.includes("collapsed"));
  assert.equal(inet.data.count, model.groups.get("g:internet").hostIds.length);
  assert.ok(!els.nodes.some((n) => n.data.parent === "g:internet"));
  const toInet = els.edges.filter((e) => e.data.target === "g:internet" || e.data.source === "g:internet");
  const modelToInet = [...model.edges.values()].filter((e) => model.hosts.get(e.target).groupId === "g:internet" || model.hosts.get(e.source).groupId === "g:internet");
  assert.equal(toInet.reduce((a, e) => a + e.data.count, 0), modelToInet.length);
  const pairs = new Set(toInet.map((e) => `${e.data.source}|${e.data.target}`));
  assert.equal(pairs.size, toInet.length, "one edge per (endpoint, collapsed group) pair");
  const rank = { vulnerable: 3, exploitable: 2, unclassified: 1, safe: 0 };
  for (const e of toInet) {
    const worst = e.data.members.map((id) => model.edges.get(id).risk).sort((a, b) => rank[b] - rank[a])[0];
    assert.equal(e.data.risk, worst);
    const anyOne = e.data.members.some((id) => model.edges.get(id).seen === "one");
    assert.equal(e.classes.includes("seen-one"), anyOne);
  }
});

test("edges inside one collapsed group are counted, not drawn", () => {
  const all = new Set(model.groups.keys());
  const els = toElements(model, { ...base, collapsed: all });
  assert.ok(els.edges.every((e) => e.data.source !== e.data.target));
  const internal = els.nodes.reduce((a, n) => a + (n.data.internal ?? 0), 0);
  assert.equal(internal + els.edges.reduce((a, e) => a + e.data.count, 0), model.edges.size);
});

test("host classes and badge label", () => {
  const els = toElements(model, base);
  for (const n of nodesOf(els, "host")) {
    const h = model.hosts.get(n.data.id);
    assert.equal(n.classes.includes("seen-only"), !h.collected);
    assert.ok(n.classes.includes(`os-${h.os}`) && n.classes.includes(`role-${h.role}`));
    assert.ok(n.data.icon.startsWith("data:image/svg+xml"));
  }
  const dc = els.nodes.find((n) => n.data.id === "h:dc01");
  assert.match(dc.data.label, /^DC01\n(\d+ ){3}\d+ \+\d+$/);
  assert.equal(dc.data.border, "exploitable");
});

test("fade vs hide", () => {
  const visible = applyFilter(model, parseQuery("port:445"));
  const faded = toElements(model, { ...base, visible });
  assert.ok(faded.nodes.some((n) => n.classes.includes("faded")));
  assert.equal(faded.edges.length, model.edges.size);
  const hidden = toElements(model, { ...base, visible, mode: "hide" });
  const ids = new Set(hidden.nodes.map((n) => n.data.id));
  assert.ok(hidden.nodes.every((n) => !n.classes.includes("faded")));
  assert.ok(hidden.edges.every((e) => ids.has(e.data.source) && ids.has(e.data.target)));
  assert.ok(hidden.edges.every((e) => e.data.members.every((id) => visible.edges.has(id))));
  for (const n of hidden.nodes) if (n.data.parent) assert.ok(ids.has(n.data.parent));
});

test("DNS names label Internet hosts", () => {
  const ip = model.groups.get("g:internet").hostIds[0].slice(3);
  const els = toElements(model, { ...base, dns: { [ip]: "cdn.example.net" } });
  const n = els.nodes.find((x) => x.data.id === `ip:${ip}`);
  assert.match(n.data.label, /^cdn\.example\.net/);
  assert.equal(n.data.ip, ip);
});

test("hostile hostnames stay plain data", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const m = buildModel([winFile(evil, [["TCP", "10.0.0.1:50000", "10.0.0.2:445", "ESTABLISHED"]])], DEFAULT_SETTINGS);
  const els = toElements(m, base);
  const n = els.nodes.find((x) => x.data.label?.startsWith("<img"));
  assert.ok(n);
  assert.ok(!n.classes.includes("<"));
  const other = JSON.stringify({ ...n, data: { ...n.data, label: "", id: "" } });
  assert.ok(!other.includes("onerror"), other);
});

test("osIcon gives an SVG data URI per OS", () => {
  for (const os of ["windows", "linux", "macos", "unknown"]) assert.match(osIcon(os), /^data:image\/svg\+xml,/);
  assert.notEqual(osIcon("windows"), osIcon("linux"));
});
