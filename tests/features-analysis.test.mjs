// Process filter, CSV processes, saved filters, path finding, neighbourhood scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseQuery, applyFilter } from "../js/model/filter.js";
import { buildModel } from "../js/model/build.js";
import { connectionsCsv } from "../js/model/exports.js";
import { DEFAULT_SETTINGS, validateSettings, mergeSessionSettings } from "../js/model/settings.js";
import { findPath, neighbourhood } from "../js/model/paths.js";
import { toElements } from "../js/ui/elements.js";
import { parseFile } from "../js/parse/index.js";
import { winFile } from "./helpers/net.mjs";

// LNX (10.10.20.5): sshd serves 10.10.1.30, nginx serves 10.10.10.21, curl goes out to 140.82.113.4
const lnx = parseFile("LNX01_netstat.txt", readFileSync(new URL("./fixtures/linux-ss-tunap.txt", import.meta.url), "utf8"));
const ws = winFile("WS-1", [["TCP", "10.10.10.21:50122", "10.10.20.5:443", "ESTABLISHED"]]);
const m = buildModel([lnx, ws], DEFAULT_SETTINGS);
const hostByIp = (ip) => [...m.hosts.values()].find((h) => h.ips.includes(ip)).id;
const LNX = hostByIp("10.10.20.5"), WS = hostByIp("10.10.10.21"), SSHC = hostByIp("10.10.1.30");
// (the fixture shows nginx on 443 without a LISTEN line, so the model takes WS-1 as that server)
const edge = (s, t, port) => [...m.edges.values()].find((e) => e.source === s && e.target === t && e.port === port);

// ---------- 1. process ----------
test("process: matches connections whose files show that process (part of the name, any case)", () => {
  const r = applyFilter(m, parseQuery("process:SSH"));
  assert.deepEqual([...r.edges], [edge(SSHC, LNX, 22).id]);
  const n = applyFilter(m, parseQuery("process:nginx"));
  assert.equal(n.edges.size, 1);
  assert.ok(!n.edges.has(edge(SSHC, LNX, 22).id));
});

test("process: matches the host that runs it (listening or connected), not its peers", () => {
  const r = applyFilter(m, parseQuery("process:node_exporter"));
  assert.ok(r.hosts.has(LNX), "listening only");
  const s = applyFilter(m, parseQuery("process:sshd"));
  assert.ok(s.hosts.has(LNX));
  assert.ok(!s.hosts.has(SSHC), "the client did not run sshd");
  assert.equal(applyFilter(m, parseQuery("-process:curl")).hosts.has(LNX), false);
});

test("free text also finds process names", () => {
  assert.ok(applyFilter(m, parseQuery("curl")).edges.size >= 1);
});

test("connections CSV: the process seen at each end", () => {
  const lines = connectionsCsv(m).trimEnd().split("\n");
  const head = lines[0].split(",");
  assert.deepEqual(head.slice(-2), ["source_process", "destination_process"]);
  const ssh = lines.find((l) => l.includes(",22,"));
  assert.match(ssh, /^10\.10\.1\.30,.*,,sshd$/, "the client has no file; the server end ran sshd");
  const out = lines.find((l) => l.includes("140.82.113.4"));
  assert.match(out, /,curl,$/, "the client end ran curl; the Internet end has no file");
});

// ---------- 4. saved filters (a setting) ----------
test("saved filters: validated, trimmed, unique names, capped", () => {
  assert.deepEqual(DEFAULT_SETTINGS.savedFilters, []);
  const s = validateSettings({ savedFilters: [
    { name: " Red SMB ", query: " risk:red port:445 " }, { name: "", query: "x" }, { name: "x", query: "" },
    { name: "Red SMB", query: "dup" }, { name: 5, query: "x" }, "junk", { name: "y".repeat(41), query: "q" }] });
  assert.deepEqual(s.savedFilters, [{ name: "Red SMB", query: "risk:red port:445" }]);
  const many = validateSettings({ savedFilters: Array.from({ length: 80 }, (_, i) => ({ name: `f${i}`, query: "q" })) });
  assert.equal(many.savedFilters.length, 50);
  assert.equal(validateSettings({ savedFilters: [{ name: "n", query: "q".repeat(1001) }] }).savedFilters.length, 0);
});

test("a session never replaces the user's saved filters", () => {
  const current = validateSettings({ savedFilters: [{ name: "mine", query: "risk:red" }] });
  const other = validateSettings({ savedFilters: [{ name: "theirs", query: "x" }] });
  assert.deepEqual(mergeSessionSettings(current, other).savedFilters, current.savedFilters);
});

// ---------- 5. paths ----------
// tiny hand-made model: a → b → c → d, a → d (safe), e isolated; b → c is the only risky hop
const H = (id) => [id, { id, groupId: "g:x", ips: [id] }];
const E = (s, t, risk = "safe", port = 445) => [`e:${s}|${t}`, { id: `e:${s}|${t}`, source: s, target: t, risk, port, proto: "tcp" }];
const toy = { hosts: new Map(["a", "b", "c", "d", "e"].map(H)), groups: new Map(),
  edges: new Map([E("a", "b", "exploitable"), E("b", "c", "vulnerable"), E("c", "d", "exploitable"), E("a", "d")]) };

test("findPath: fewest hops along the direction connections were made", () => {
  assert.deepEqual(findPath(toy, "a", "d"), { hosts: ["a", "d"], edges: ["e:a|d"] });
  assert.deepEqual(findPath(toy, "a", "c"), { hosts: ["a", "b", "c"], edges: ["e:a|b", "e:b|c"] });
  assert.equal(findPath(toy, "d", "a"), null, "against the direction");
  assert.equal(findPath(toy, "a", "e"), null);
  assert.deepEqual(findPath(toy, "a", "a"), { hosts: ["a"], edges: [] });
  assert.equal(findPath(toy, "a", "nope"), null);
});

test("findPath: risky only uses red and orange connections; any direction ignores direction", () => {
  assert.deepEqual(findPath(toy, "a", "d", { riskyOnly: true }), { hosts: ["a", "b", "c", "d"], edges: ["e:a|b", "e:b|c", "e:c|d"] });
  assert.deepEqual(findPath(toy, "d", "a", { directed: false }), { hosts: ["d", "a"], edges: ["e:a|d"] });
});

test("findPath on a real model: client to server", () => {
  assert.deepEqual(findPath(m, SSHC, LNX).hosts, [SSHC, LNX]);
  assert.equal(findPath(m, LNX, SSHC), null);
});

// ---------- 14. neighbourhood ----------
test("neighbourhood: hosts within N hops (any direction) and the connections among them", () => {
  const one = neighbourhood(toy, ["b"], 1);
  assert.deepEqual([...one.hosts].sort(), ["a", "b", "c"]);
  assert.deepEqual([...one.edges].sort(), ["e:a|b", "e:b|c"]);
  const two = neighbourhood(toy, ["b"], 2);
  assert.deepEqual([...two.hosts].sort(), ["a", "b", "c", "d"]);
  assert.ok(two.edges.has("e:a|d") && two.edges.has("e:c|d"));
  assert.deepEqual([...neighbourhood(toy, ["e"], 2).hosts], ["e"]);
  assert.deepEqual([...neighbourhood(toy, ["b", "d"], 0).hosts].sort(), ["b", "d"]);
});

test("toElements scope: only in-scope hosts, their groups and connections are drawn", () => {
  const scope = neighbourhood(m, [WS], 1);
  const els = toElements(m, { collapsed: new Set(), visible: null, mode: "fade", dns: {}, labels: true, scope });
  const hostIds = els.nodes.filter((n) => n.classes.includes("host")).map((n) => n.data.id).sort();
  assert.deepEqual(hostIds, [...scope.hosts].sort());
  const groups = new Set(els.nodes.filter((n) => n.classes.includes("group")).map((n) => n.data.id));
  assert.deepEqual(groups, new Set(hostIds.map((id) => m.hosts.get(id).groupId)));
  assert.ok(els.edges.every((e) => scope.edges.has(e.data.id)));
  // collapsed group: still shown when a host inside is in scope
  const g = m.hosts.get(LNX).groupId;
  const c = toElements(m, { collapsed: new Set([g]), visible: null, mode: "fade", dns: {}, labels: true, scope });
  assert.ok(c.nodes.some((n) => n.data.id === g));
});
