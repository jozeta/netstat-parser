import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, connectionsCsv, hostsCsv, targetsFile } from "../js/model/exports.js";
import { createSession, parseSession, SESSION_VERSION } from "../js/model/session.js";
import { buildModel } from "../js/model/build.js";
import { DEFAULT_SETTINGS } from "../js/model/settings.js";
import { generated, winFile } from "./helpers/net.mjs";

test("csvCell escapes formulas and quotes", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-cmd"), "'-cmd");
  assert.equal(csvCell("@x"), "'@x");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(null), "");
});

const ws = winFile("WS-1", [["TCP", "10.10.10.21:49712", "10.10.1.10:445", "ESTABLISHED"], ["TCP", "10.10.10.21:49800", "10.10.10.99:22", "ESTABLISHED"],
  ["TCP", "10.10.10.21:49801", "10.10.10.98:5985", "ESTABLISHED"], ["TCP", "10.10.10.21:49802", "10.10.10.97:9999", "ESTABLISHED"],
  ["TCP", "10.10.10.21:49803", "203.0.113.10:443", "ESTABLISHED"]]);
const m = buildModel([ws], DEFAULT_SETTINGS);

test("CSV headers and row counts", () => {
  const c = connectionsCsv(m).trimEnd().split("\n");
  assert.equal(c[0], "source_host,source_ip,destination_host,destination_ip,port,proto,protocol,risk,states,seen,source_files");
  assert.equal(c.length - 1, m.edges.size);
  assert.ok(c.some((l) => l.startsWith("WS-1,10.10.10.21,10.10.1.10,10.10.1.10,445,tcp,SMB,exploitable,ESTABLISHED,one,WS-1_netstat.txt")), c.join("\n"));
  const h = hostsCsv(m).trimEnd().split("\n");
  assert.equal(h[0], "hostname,ips,os,role,tags,subnet,collected,listening_ports");
  assert.equal(h.length - 1, m.hosts.size);
});

test("targets file: seen-only internal hosts with a method guess", () => {
  const t = targetsFile(m);
  const lines = t.split("\n").filter((l) => l && !l.startsWith("#"));
  assert.ok(t.startsWith("#"));
  assert.match(t, /<host> <method> \[key=value \.\.\.\]/);
  assert.match(t, /methods: ssh\|winrm\n/);
  assert.doesNotMatch(t, /smb|hash/i);
  assert.deepEqual(lines.sort(), [
    "10.10.1.10 winrm user=CHANGEME  # Windows ports seen; WinRM must be enabled",
    "10.10.10.97 ssh user=CHANGEME  # method unknown",
    "10.10.10.98 winrm user=CHANGEME",
    "10.10.10.99 ssh user=CHANGEME",
  ]);
});

test("session round trip", () => {
  const { files } = generated("small");
  const x = { files, settings: DEFAULT_SETTINGS, dns: { "203.0.113.10": "cdn.example.net" }, positions: { "h:dc01": { x: 10.5, y: -3 } }, collapsed: ["g:10.10.1.0/24"] };
  const s = createSession(x);
  assert.equal(s.format, "netstat-parser-session");
  assert.equal(s.version, SESSION_VERSION);
  const back = parseSession(JSON.stringify(s));
  assert.deepEqual(back, x);
});

test("session rejects foreign and future files with clear messages", () => {
  assert.throws(() => parseSession("nope"), /Not a netstat-parser session file/);
  assert.throws(() => parseSession('{"a":1}'), /Not a netstat-parser session file/);
  assert.throws(() => parseSession('{"format":"netstat-parser-session","version":99}'), /Unsupported session version 99/);
});

test("session sanitises hostile content without throwing", () => {
  const { files } = generated("small");
  const s = createSession({ files: files.slice(0, 1), settings: DEFAULT_SETTINGS, dns: {}, positions: {}, collapsed: [] });
  const f = s.files[0];
  const before = f.records.length;
  f.records.push({ ...f.records[0], localPort: 1e9 });
  f.records.push({ ...f.records[0], process: "p".repeat(10000) });
  const raw = JSON.stringify(s).replace('"positions":{}', '"positions":{"__proto__":{"polluted":1},"h:x":{"x":"1","y":2}}');
  const back = parseSession(raw);
  assert.equal(back.files[0].records.length, before + 1);
  assert.ok(back.files[0].records.at(-1).process.length <= 128);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(back.positions, {});
});
