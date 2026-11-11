// Regression tests for model-layer bugs found in the 2026-11-11 bug check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../js/model/build.js";
import { validateSettings, mergeSessionSettings, DEFAULT_SETTINGS } from "../js/model/settings.js";
import { parseSession } from "../js/model/session.js";
import { resolvePtrs } from "../js/model/dns.js";
import { parseQuery, applyFilter } from "../js/model/filter.js";
import { winFile } from "./helpers/net.mjs";

test("dns: private and reserved addresses in IPv6 form are never sent to a resolver", async () => {
  const sent = [];
  const fetch = async (u) => { sent.push(decodeURIComponent(u)); return { ok: false }; };
  const blocked = ["::a00:5", "fec0::1", "::ffff:0:a00:1", "100::1", "192.0.0.8", "192.88.99.1", "4000::1", "2001:db8::1", "2002:a00:1::1", "2001:0:a00:1::1", "64:ff9b::a00:1"];
  await resolvePtrs([...blocked, "8.8.8.8", "2001:4860:4860::8888"], { resolver: "google", delayMs: 0, fetch });
  assert.equal(sent.length, 2, sent.join("\n"));
  assert.ok(sent.some((u) => u.includes("8.8.8.8.in-addr.arpa")));
  assert.ok(sent.some((u) => u.includes("ip6.arpa") && u.endsWith("type=PTR")));
});

test("filter: a plain port or protocol term matches the hosts on that connection", () => {
  const ws = winFile("WS-1", [["TCP", "10.0.0.1:50000", "10.0.0.2:445", "ESTABLISHED"], ["TCP", "10.0.0.1:50001", "10.0.0.3:22", "ESTABLISHED"]]);
  const m = buildModel([ws], DEFAULT_SETTINGS);
  for (const q of ["445", "smb"]) {
    const r = applyFilter(m, parseQuery(q));
    assert.deepEqual([...r.hosts].sort(), ["h:ws-1", "ip:10.0.0.2"], q);
    assert.equal(r.edges.size, 1, q);
  }
  // a listening entry counts too
  const srv = winFile("SRV", [["TCP", "0.0.0.0:3389", "0.0.0.0:0", "LISTENING"]]);
  assert.deepEqual([...applyFilter(buildModel([srv], DEFAULT_SETTINGS), parseQuery("3389")).hosts], ["h:srv"]);
});

test("build: same short name in two domains stays two hosts; an unqualified name joins a single FQDN", () => {
  const f1 = { ...winFile("x", [["TCP", "10.1.0.5:50000", "10.1.0.9:445", "ESTABLISHED"]]), hostname: "web01.prod.corp" };
  const f2 = { ...winFile("y", [["TCP", "10.2.0.5:50000", "10.2.0.9:445", "ESTABLISHED"]]), hostname: "web01.dev.corp" };
  const m = buildModel([f1, f2], DEFAULT_SETTINGS);
  const coll = [...m.hosts.values()].filter((h) => h.collected);
  assert.equal(coll.length, 2);
  assert.deepEqual(coll.map((h) => h.label).sort(), ["web01.dev.corp", "web01.prod.corp"]);
  // file name WEB02 + header web02.corp.local: one host
  const g1 = { ...winFile("WEB02", [["TCP", "10.3.0.5:50000", "10.3.0.9:445", "ESTABLISHED"]]), hostname: "WEB02" };
  const g2 = { ...winFile("y", [["TCP", "10.3.0.5:50001", "10.3.0.9:445", "ESTABLISHED"]]), hostname: "web02.corp.local" };
  for (const files of [[g1, g2], [g2, g1]]) {
    const m2 = buildModel(files, DEFAULT_SETTINGS);
    const c2 = [...m2.hosts.values()].filter((h) => h.collected);
    assert.equal(c2.length, 1);
    assert.equal(c2[0].id, "h:web02");
    assert.equal(c2[0].label, "web02.corp.local");
  }
});

test("build: a Docker bridge listed first does not decide the group; container IPs are per host", () => {
  const a = winFile("A", [["TCP", "172.17.0.1:50000", "172.17.0.2:5432", "ESTABLISHED"], ["TCP", "10.0.0.1:50001", "10.0.0.9:443", "ESTABLISHED"],
    ["TCP", "10.0.0.1:50002", "10.0.0.9:80", "ESTABLISHED"]]);
  const b = winFile("B", [["TCP", "172.17.0.1:50000", "172.17.0.2:5432", "ESTABLISHED"], ["TCP", "10.0.5.1:50001", "10.0.0.9:443", "ESTABLISHED"]]);
  const m = buildModel([a, b], DEFAULT_SETTINGS);
  assert.equal(m.hosts.get("h:a").groupId, "g:10.0.0.0/24");
  assert.equal(m.hosts.get("h:b").groupId, "g:10.0.5.0/24");
  assert.equal(m.hosts.get("h:a").ips[0], "10.0.0.1");
  const containers = [...m.hosts.values()].filter((h) => h.ips[0] === "172.17.0.2");
  assert.equal(containers.length, 2);
  assert.notEqual(containers[0].id, containers[1].id);
  for (const c of containers) assert.ok(c.localTo);
});

test("mergeSessionSettings keeps the user's own subnets protected from DNS", () => {
  const cur = validateSettings({ subnets: [{ cidr: "85.10.20.0/24", name: "Client DMZ" }] });
  const merged = mergeSessionSettings(cur, validateSettings({}));
  assert.ok(merged.internalRanges.includes("85.10.20.0/24"));
  const twice = mergeSessionSettings(validateSettings({ internalRanges: ["85.10.20.0/24"], subnets: [{ cidr: "85.10.20.0/24", name: "x" }] }), validateSettings({}));
  assert.equal(twice.internalRanges.filter((c) => c === "85.10.20.0/24").length, 1);
});

test("session: an IPv4 header address with a prefix above 32 is dropped", () => {
  const sess = JSON.stringify({ format: "netstat-parser-session", version: 1, files: [{ hostname: "a", fileName: "a.txt", format: "windows",
    header: { addresses: [{ ip: "10.0.0.5", prefix: 64 }, { ip: "10.0.0.6", prefix: 24 }, { ip: "fd00::1", prefix: 64 }] },
    records: [{ proto: "tcp", family: 4, localIp: "10.0.0.5", localPort: 50000, remoteIp: "10.0.0.9", remotePort: 445, state: "ESTABLISHED" }] }] });
  const s = parseSession(sess);
  assert.deepEqual(s.files[0].header.addresses, [{ ip: "10.0.0.6", prefix: 24 }, { ip: "fd00::1", prefix: 64 }]);
});

test("build: a connection to the host's own link-local address makes no phantom node", () => {
  const ll = winFile("L", [["TCP", "[fe80::1]:50000", "[fe80::1]:445", "ESTABLISHED"], ["TCP", "10.0.0.1:50000", "10.0.0.2:445", "ESTABLISHED"]]);
  const m = buildModel([ll], DEFAULT_SETTINGS);
  assert.deepEqual([...m.hosts.keys()].sort(), ["h:l", "ip:10.0.0.2"]);
});
