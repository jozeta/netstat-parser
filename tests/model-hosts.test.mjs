import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../js/model/build.js";
import { DEFAULT_SETTINGS, validateSettings } from "../js/model/settings.js";
import { parseFile } from "../js/parse/index.js";
import { generated, winFile } from "./helpers/net.mjs";

const dc = winFile("DC01", [["TCP", "0.0.0.0:445", "0.0.0.0:0", "LISTENING"], ["TCP", "10.10.1.10:445", "10.10.10.99:50000", "ESTABLISHED"]],
  { os: "Microsoft Windows Server 2022 Standard", addresses: "10.10.1.10/24, fe80::1/64" });

test("collected host from header", () => {
  const m = buildModel([dc], DEFAULT_SETTINGS);
  const h = m.hosts.get("h:dc01");
  assert.equal(h.collected, true);
  assert.equal(h.hostname, "DC01");
  assert.equal(h.label, "DC01");
  assert.ok(h.ips.includes("10.10.1.10"));
  assert.equal(h.os, "windows");
  assert.equal(h.osDetail, "Microsoft Windows Server 2022 Standard");
  assert.equal(h.groupId, "g:10.10.1.0/24");
  assert.deepEqual(h.files.map((f) => f.fileName), ["DC01_netstat.txt"]);
  assert.equal(m.groups.get("g:10.10.1.0/24").kind, "subnet");
});

test("no header: own IPs from local addresses, OS from format", () => {
  const text = "Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\ntcp ESTAB 0 0 10.10.20.5:22 10.10.1.30:51544\ntcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n";
  const m = buildModel([parseFile("web-01_netstat.txt", text)], DEFAULT_SETTINGS);
  const h = m.hosts.get("h:web-01");
  assert.deepEqual(h.ips, ["10.10.20.5"]);
  assert.equal(h.os, "linux");
  assert.equal(h.osDetail, null);
});

test("same hostname in two files (any case) merges, keeping both IPs", () => {
  const a = winFile("ws-1", [["TCP", "10.10.10.5:50000", "10.10.1.10:445", "ESTABLISHED"]]);
  const b = winFile("WS-1", [["TCP", "10.10.10.6:50001", "10.10.1.10:445", "ESTABLISHED"]]);
  const m = buildModel([a, b], DEFAULT_SETTINGS);
  const h = m.hosts.get("h:ws-1");
  assert.deepEqual(h.ips.sort(), ["10.10.10.5", "10.10.10.6"]);
  assert.equal(h.files.length, 2);
  assert.equal([...m.hosts.values()].filter((x) => x.collected).length, 1);
});

test("two hostnames claiming one IP → conflict, first wins", () => {
  const a = winFile("A", [["TCP", "10.10.10.5:50000", "10.10.1.10:445", "ESTABLISHED"]]);
  const b = winFile("B", [["TCP", "10.10.10.5:50001", "10.10.1.10:445", "ESTABLISHED"]]);
  const m = buildModel([a, b], DEFAULT_SETTINGS);
  assert.deepEqual(m.conflicts, [{ ip: "10.10.10.5", hostIds: ["h:a", "h:b"] }]);
});

test("seen-only internal and Internet hosts", () => {
  const ws = winFile("WS-2", [["TCP", "10.10.10.7:50000", "203.0.113.10:443", "ESTABLISHED"]]);
  const m = buildModel([dc, ws], DEFAULT_SETTINGS);
  const seen = m.hosts.get("ip:10.10.10.99");
  assert.equal(seen.collected, false);
  assert.equal(seen.os, "unknown");
  assert.equal(seen.label, "10.10.10.99");
  assert.equal(seen.groupId, "g:10.10.10.0/24");
  const pub = m.hosts.get("ip:203.0.113.10");
  assert.equal(pub.internal, false);
  assert.equal(pub.groupId, "g:internet");
  assert.equal(m.groups.get("g:internet").kind, "internet");
  assert.ok(m.groups.get("g:internet").hostIds.includes("ip:203.0.113.10"));
});

test("configured subnet wins and carries its name", () => {
  const ws = winFile("WS-3", [["TCP", "10.10.10.8:50000", "10.10.1.10:445", "ESTABLISHED"]]);
  const s = validateSettings({ subnets: [{ cidr: "10.10.0.0/16", name: "Corp" }] });
  const m = buildModel([ws], s);
  assert.equal(m.hosts.get("h:ws-3").groupId, "g:10.10.0.0/16");
  assert.equal(m.groups.get("g:10.10.0.0/16").name, "Corp");
  assert.equal(m.hosts.get("ip:10.10.1.10").groupId, "g:10.10.0.0/16");
});

test("loopback goes to host.loopback and creates no hosts", () => {
  const ws = winFile("WS-4", [["TCP", "127.0.0.1:50000", "127.0.0.1:50001", "ESTABLISHED"], ["TCP", "10.10.10.9:139", "0.0.0.0:0", "LISTENING"]]);
  const m = buildModel([ws], DEFAULT_SETTINGS);
  assert.equal(m.hosts.size, 1);
  assert.equal(m.hosts.get("h:ws-4").loopback.length, 1);
});

test("link-local addresses never claim ownership", () => {
  const b = winFile("DC02", [["TCP", "10.10.1.11:445", "0.0.0.0:0", "LISTENING"]], { addresses: "10.10.1.11/24, fe80::1/64" });
  const m = buildModel([dc, b], DEFAULT_SETTINGS);
  assert.deepEqual(m.conflicts, []);
});

test("generated small: hosts and groups line up with the generator", () => {
  const { net, files } = generated("small");
  const m = buildModel(files, DEFAULT_SETTINGS);
  for (const g of net.hosts.filter((h) => h.collected)) assert.ok(m.hosts.has(`h:${g.hostname.toLowerCase()}`), g.hostname);
  const cidrs = new Set(net.subnets.map((s) => `g:${s.cidr}`));
  for (const id of m.groups.keys()) assert.ok(id === "g:internet" || cidrs.has(id) || id.startsWith("g:fd10:50::"), id);
});

test("a header address without prefix uses the default /24 grouping", () => {
  const text = "### netstat-parser v1\nhostname: MAC-1\naddresses: 192.168.50.12\n### netstat\nActive Internet connections\ntcp4 0 0 192.168.50.12.50000 203.0.113.10.443 ESTABLISHED\n";
  const m = buildModel([parseFile("MAC-1_netstat.txt", text)], DEFAULT_SETTINGS);
  assert.equal(m.hosts.get("h:mac-1").groupId, "g:192.168.50.0/24");
});
