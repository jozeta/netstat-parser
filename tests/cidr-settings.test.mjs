import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCidr, inCidr, networkOf } from "../js/lib/cidr.js";
import { DEFAULT_SETTINGS, validateSettings, classify } from "../js/model/settings.js";

test("parseCidr canonicalises the network address", () => {
  assert.deepEqual(parseCidr("10.10.1.77/24"), { ip: "10.10.1.0", prefix: 24, family: 4 });
  assert.deepEqual(parseCidr("fd10:50::20/64"), { ip: "fd10:50::", prefix: 64, family: 6 });
  assert.deepEqual(parseCidr("0.0.0.0/0"), { ip: "0.0.0.0", prefix: 0, family: 4 });
  assert.equal(parseCidr("10.0.0.0/33"), null);
  assert.equal(parseCidr("x"), null);
  assert.equal(parseCidr("10.0.0.0"), null);
});

test("inCidr", () => {
  const net = parseCidr("10.10.0.0/16");
  assert.equal(inCidr("10.10.1.5", net), true);
  assert.equal(inCidr("10.11.0.1", net), false);
  assert.equal(inCidr("fd10::1", net), false);
  assert.equal(inCidr("fe80::1", parseCidr("fe80::/10")), true);
  assert.equal(inCidr("febf::1", parseCidr("fe80::/10")), true);
  assert.equal(inCidr("fec0::1", parseCidr("fe80::/10")), false);
  assert.equal(inCidr("*", net), false);
});

test("networkOf", () => {
  assert.equal(networkOf("10.10.1.77", 24), "10.10.1.0/24");
  assert.equal(networkOf("fd10:50::20", 64), "fd10:50::/64");
});

test("classify with defaults", () => {
  const S = DEFAULT_SETTINGS;
  assert.deepEqual(classify(445, "tcp", S), { name: "SMB", risk: "exploitable" });
  assert.deepEqual(classify(23, "tcp", S), { name: "Telnet", risk: "vulnerable" });
  assert.deepEqual(classify(443, "tcp", S), { name: "HTTPS", risk: "safe" });
  assert.deepEqual(classify(161, "udp", S), { name: "SNMP", risk: "vulnerable" });
  assert.equal(classify(161, "tcp", S).risk, "unclassified");
  assert.deepEqual(classify(40000, "tcp", S), { name: "40000/tcp", risk: "unclassified" });
  assert.equal(classify(513, "tcp", S).risk, "vulnerable");
  assert.equal(classify(5901, "tcp", S).name, "VNC");
});

test("validateSettings falls back per field and sanitises", () => {
  const s = validateSettings({ protocols: [{ port: "x" }], subnets: [{ cidr: "10.0.0.0/8", name: "<b>A</b>" + "x".repeat(100) }], graph: { collapseThreshold: -5 } });
  assert.deepEqual(s.protocols, DEFAULT_SETTINGS.protocols);
  assert.equal(s.subnets.length, 1);
  assert.equal(s.subnets[0].cidr, "10.0.0.0/8");
  assert.ok(s.subnets[0].name.startsWith("<b>A</b>"));
  assert.equal(s.subnets[0].name.length, 64);
  assert.equal(s.graph.collapseThreshold, 150);
  assert.deepEqual(validateSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(validateSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS))), DEFAULT_SETTINGS);
  assert.equal(validateSettings({ dns: { enabled: true, resolver: "evil" } }).dns.resolver, null);
  assert.equal(validateSettings({ dns: { enabled: true, resolver: "quad9" } }).dns.enabled, true);
});

test("DEFAULT_SETTINGS role rules", () => {
  assert.deepEqual(DEFAULT_SETTINGS.roleRules, [
    { tag: "DC", all: [88, 389, 445], any: [] },
    { tag: "DB", all: [], any: [1433, 3306, 5432] },
    { tag: "Web", all: [], any: [80, 443] },
    { tag: "RDP", all: [], any: [3389] },
  ]);
});
