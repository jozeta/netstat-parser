import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWindows } from "../js/parse/windows.js";
import { parseFile } from "../js/parse/index.js";
import { decodeBytes } from "../js/parse/decode.js";
import { parseHeader } from "../js/parse/header.js";
import { buildModel } from "../js/model/build.js";
import { DEFAULT_SETTINGS, validateSettings } from "../js/model/settings.js";
import { resolvePtrs } from "../js/model/dns.js";
import { createSession, parseSession } from "../js/model/session.js";
import { uniqueFileNames } from "../js/model/files.js";
import { winFile } from "./helpers/net.mjs";

test("A: a wildcard remote has port null on every OS (Windows 0.0.0.0:0 too)", () => {
  const r = parseWindows("  TCP    0.0.0.0:445   0.0.0.0:0   LISTENING   4\n  TCP    [::]:135   [::]:0   LISTENING   4\n").records;
  assert.equal(r[0].remotePort, null);
  assert.equal(r[1].remotePort, null);
});

test("B: unparsed lines keep at most 50 samples but count them all", () => {
  const text = "  TCP    10.0.0.1:445   0.0.0.0:0   LISTENING   4\n" + Array.from({ length: 5000 }, () => "  TCP    garbage").join("\n");
  const res = parseWindows(text);
  assert.equal(res.unparsedCount, 5000);
  assert.ok(res.unparsed.length <= 50);
  assert.equal(parseFile("x.txt", text).warnings.unparsedCount, 5000);
});

test("C: UTF-16LE and UTF-16BE without a BOM are detected", () => {
  const line = "  TCP    0.0.0.0:135   0.0.0.0:0   LISTENING   1012\r\n";
  const le = new Uint8Array(line.length * 2), be = new Uint8Array(line.length * 2);
  for (let i = 0; i < line.length; i++) { le[2 * i] = line.charCodeAt(i); be[2 * i + 1] = line.charCodeAt(i); }
  assert.equal(decodeBytes(le), line.replace("\r\n", "\n"));
  assert.equal(decodeBytes(be), line.replace("\r\n", "\n"));
});

test("D: parseHeader accepts CRLF and lone CR line endings", () => {
  for (const nl of ["\r\n", "\r"]) {
    const { header, body } = parseHeader(["### netstat-parser v1", "hostname: H1", "### netstat", "x"].join(nl));
    assert.equal(header.hostname, "H1");
    assert.equal(body.trim(), "x");
  }
});

test("E: output with service names instead of numbers (no -n) gets a hint", () => {
  const text = "Proto Recv-Q Send-Q Local Address  Foreign Address  State\ntcp  0  0 web01:ssh  10.0.0.5:51544  ESTABLISHED\ntcp 0 0 web01.corp:https host7:50122 ESTABLISHED\n";
  const pf = parseFile("w_netstat.txt", text);
  assert.equal(pf.warnings.namesNotNumbers, true);
  assert.equal(parseFile("x.txt", "tcp 0 0 10.0.0.1:22 10.0.0.5:51544 ESTABLISHED\n").warnings.namesNotNumbers, false);
});

test("F: an FQDN header and a short file name are the same host", () => {
  const a = parseFile("x_netstat.txt", "### netstat-parser v1\nhostname: dc01.corp.local\n### netstat\n  TCP    10.10.1.10:445   0.0.0.0:0   LISTENING   4\n");
  const b = winFile("DC01", [["TCP", "10.10.1.10:389", "0.0.0.0:0", "LISTENING"]]);
  const m = buildModel([a, b], DEFAULT_SETTINGS);
  assert.ok(m.hosts.has("h:dc01"));
  assert.equal(m.hosts.get("h:dc01").files.length, 2);
  assert.equal(m.hosts.get("h:dc01").label, "dc01.corp.local");
  assert.deepEqual(m.conflicts, []);
});

test("G: host.warnings carries address conflicts", () => {
  const a = winFile("A", [["TCP", "10.10.10.5:50000", "10.10.1.10:445", "ESTABLISHED"]]);
  const b = winFile("B", [["TCP", "10.10.10.5:50001", "10.10.1.10:445", "ESTABLISHED"]]);
  const m = buildModel([a, b], DEFAULT_SETTINGS);
  assert.match(m.hosts.get("h:b").warnings[0], /10\.10\.10\.5.*also claimed by A/);
  assert.match(m.hosts.get("h:a").warnings[0], /10\.10\.10\.5.*also claimed by B/);
});

test("J: duplicate file names get a numbered suffix; sessions too", () => {
  assert.deepEqual(uniqueFileNames(["b.txt", "a.txt", "b.txt", "b.txt"]), ["b.txt", "a.txt", "b.txt (2)", "b.txt (3)"]);
  const f = parseFile("H_netstat.txt", "  TCP    10.0.0.1:445   0.0.0.0:0   LISTENING   4\n");
  const s = parseSession(JSON.stringify(createSession({ files: [f, f], settings: DEFAULT_SETTINGS, dns: {}, positions: {}, collapsed: [] })));
  assert.deepEqual(s.files.map((x) => x.fileName), ["H_netstat.txt", "H_netstat.txt (2)"]);
});

test("M: named subnets count as internal; DNS never sends them, nor NAT64/6to4/Teredo", async () => {
  const s = validateSettings({ subnets: [{ cidr: "198.51.100.0/24", name: "Client DMZ" }] });
  const ws = winFile("WS", [["TCP", "10.0.0.1:50000", "198.51.100.7:443", "ESTABLISHED"]]);
  const m = buildModel([ws], s);
  assert.equal(m.hosts.get("ip:198.51.100.7").internal, true);
  assert.equal(m.hosts.get("ip:198.51.100.7").groupId, "g:198.51.100.0/24");
  const sent = [];
  const fetch = async (u) => { sent.push(u); return { ok: true, json: async () => ({ Status: 3 }) }; };
  await resolvePtrs(["64:ff9b::a00:1", "2002:a00:1::1", "2001:0:4136:e378::1", "198.51.100.7", "203.0.113.9"],
    { resolver: "google", fetch, delayMs: 0, internalRanges: s.subnets.map((x) => x.cidr) });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /9\.113\.0\.203/);
});
