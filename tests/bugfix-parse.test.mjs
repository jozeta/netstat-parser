// Regression tests for parser, archive and folder-walk bugs found in the 2026-11-11 bug check.
// All data is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { parseFile } from "../js/parse/index.js";
import { detectFormat } from "../js/parse/detect.js";
import { hostnameFromFileName } from "../js/parse/header.js";
import { isCandidate } from "../js/lib/inputs.js";
import { unzip } from "../js/lib/zip.js";
import { walkEntries } from "../js/ui/dropped.js";

const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/**
 * Hand-built zip. locals: [{name: Uint8Array, body, method, usize}]; centrals: [{name, local (index), flags}].
 * Several central entries may point at the same local entry.
 */
function rawZip(locals, centrals) {
  const parts = [], offsets = [];
  let off = 0;
  for (const l of locals) {
    offsets.push(off);
    const head = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(l.method), ...u16(0), ...u16(0), ...u32(0),
      ...u32(l.body.length), ...u32(l.usize), ...u16(l.name.length), ...u16(0)]);
    parts.push(head, l.name, l.body);
    off += head.length + l.name.length + l.body.length;
  }
  const cdStart = off;
  for (const c of centrals) {
    const l = locals[c.local];
    const head = Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(c.flags ?? 0), ...u16(l.method), ...u16(0), ...u16(0),
      ...u32(0), ...u32(l.body.length), ...u32(l.usize), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offsets[c.local])]);
    parts.push(head, c.name);
    off += head.length + c.name.length;
  }
  parts.push(Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(centrals.length), ...u16(centrals.length),
    ...u32(off - cdStart), ...u32(cdStart), ...u16(0)]));
  return concat(parts);
}
const enc = (s) => new TextEncoder().encode(s);

// A: overlapping-entry zip bomb
test("A: central entries sharing one local entry are skipped, not inflated again and again", async () => {
  const body = new Uint8Array(deflateRawSync(new Uint8Array(4 * 1024 * 1024)));
  const locals = [{ name: enc("a.txt"), body, method: 8, usize: 1000 }];
  const centrals = Array.from({ length: 400 }, (_, i) => ({ name: enc(`h${i}.txt`), local: 0 }));
  const t0 = performance.now();
  const r = await unzip(rawZip(locals, centrals), { maxEntry: 1024 * 1024, maxTotal: 8 * 1024 * 1024 });
  const ms = performance.now() - t0;
  assert.ok(r.entries.length <= 1, `entries ${r.entries.length}`);
  assert.ok(r.skipped.filter((s) => /overlap|same data/i.test(s.reason)).length >= 399);
  assert.ok(ms < 2000, `${ms} ms`);
});

test("A: bytes inflated by entries that turn out too large count toward the total limit", async () => {
  const body = new Uint8Array(deflateRawSync(new Uint8Array(2 * 1024 * 1024)));
  const locals = Array.from({ length: 50 }, (_, i) => ({ name: enc(`h${i}.txt`), body, method: 8, usize: 1000 }));
  const centrals = locals.map((l, i) => ({ name: l.name, local: i }));
  const r = await unzip(rawZip(locals, centrals), { maxEntry: 1024 * 1024, maxTotal: 5 * 1024 * 1024 });
  assert.match(r.error ?? "", /more than 5 MB/);
  assert.ok(r.entries.length < 10, `entries ${r.entries.length}`);
});

// K: CP437 entry names
test("K: entry names without the UTF-8 flag that are not UTF-8 are read as CP437", async () => {
  const name = Uint8Array.from([...enc("V"), 0x99, ...enc("ster_netstat.txt")]); // "Öster" in CP437
  const locals = [{ name, body: enc("x"), method: 0, usize: 1 }];
  const r = await unzip(rawZip(locals, [{ name, local: 0 }]));
  assert.equal(r.entries[0].path, "VÖster_netstat.txt");
  // with bit 11 set, the name is UTF-8
  const u = enc("Väst_netstat.txt");
  const r2 = await unzip(rawZip([{ name: u, body: enc("x"), method: 0, usize: 1 }], [{ name: u, local: 0, flags: 0x800 }]));
  assert.equal(r2.entries[0].path, "Väst_netstat.txt");
  // no flag but valid UTF-8 (many tools) stays UTF-8
  const r3 = await unzip(rawZip([{ name: u, body: enc("x"), method: 0, usize: 1 }], [{ name: u, local: 0 }]));
  assert.equal(r3.entries[0].path, "Väst_netstat.txt");
});

// B: blank lines must not make the names-not-numbers check quadratic
test("B: a file of 200k blank lines parses in well under a second", () => {
  const t0 = performance.now();
  parseFile("x.txt", "\n".repeat(200_000) + "x");
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${ms} ms`);
  assert.equal(parseFile("n.txt", "tcp 0 0 web01:ssh 10.0.0.9:5000 ESTABLISHED\n").warnings.namesNotNumbers, true);
});

// C: very long lines must not make shape matching quadratic
test("C: a very long colon-filled line detects quickly", () => {
  const line = "tcp X 0 0 " + "a:".repeat(80_000) + " bbbb";
  let t0 = performance.now();
  assert.equal(detectFormat(line), null);
  assert.ok(performance.now() - t0 < 500);
  t0 = performance.now();
  parseFile("x.txt", "TCP " + "a:".repeat(80_000) + "\n" + line);
  assert.ok(performance.now() - t0 < 500, `${performance.now() - t0} ms`);
});

// D: host names from file names
test("D: file names keep their dots unless the extension is a known text one", () => {
  assert.equal(hostnameFromFileName("10.0.0.5"), "10.0.0.5");
  assert.equal(hostnameFromFileName("10.0.0.5.txt"), "10.0.0.5");
  assert.equal(hostnameFromFileName("web01.corp.local"), "web01.corp.local");
  assert.equal(hostnameFromFileName("web01.corp.local.LOG"), "web01.corp.local");
  assert.equal(hostnameFromFileName("dir/DC01_netstat.out"), "DC01");
  assert.equal(hostnameFromFileName("DC01_netstat.txt"), "DC01");
  assert.equal(hostnameFromFileName("capture.log"), "capture");
});

test("D: extension-less names with dots are candidates in folders; binaries and documents are not", () => {
  for (const n of ["case/10.0.0.5", "case/web01.corp.local", "case/fe80--1", "x/DC01.out"]) assert.ok(isCandidate(n), n);
  for (const n of ["a/shot.png", "a/b.JPG", "a/r.pdf", "a/t.exe", "a/l.dll", "a/d.docx", "a/s.xlsx", "a/p.pptx", "a/j.json",
    "a/c.csv", "a/i.html", "a/s.js", "a/s.css", "a/.DS_Store", "a/._x.txt", "__MACOSX/h.txt", "a/Thumbs.db"]) assert.ok(!isCandidate(n), n);
});

// E: one unreadable entry must not lose the whole folder
test("E: unreadable files and folders are counted, the readable ones are kept", async () => {
  const file = (name, fail) => ({ isFile: true, name, file: (ok, bad) => (fail ? bad(new Error("NotReadableError")) : ok({ name })) });
  const dir = (name, kids, fail) => ({
    isDirectory: true, name,
    createReader: () => { let done = false; return { readEntries: (ok, bad) => { if (fail) return bad(new Error("denied")); const d = done; done = true; ok(d ? [] : kids); } }; },
  });
  const r = await walkEntries([dir("case", [file("a.txt"), file("bad.txt", true), dir("locked", [], true), file("c.txt")])]);
  assert.deepEqual(r.files.map((f) => f.name), ["a.txt", "c.txt"]);
  assert.equal(r.unreadable, 2);
  assert.equal(r.skipped, 2);
  assert.equal(r.truncated, false);
});

// F: BSD netstat without -W cuts IPv6 addresses to 16 characters
test("F: macOS IPv6 hosts of exactly 16 characters are flagged as possibly truncated", () => {
  const r = parseFile("m.txt", [
    "tcp6 0 0 2001:db8::12:345.443 2001:db8::9.50000 ESTABLISHED", // 16 characters, valid but maybe cut
    "tcp6 0 0 2001:db8:123:567.443 2001:db8::9.50002 ESTABLISHED", // 16 characters, cut to an invalid address
    "tcp6 0 0 2001:db8::5.22 2001:db8::9.50001 ESTABLISHED",
    "tcp4 0 0 192.168.100.100.22 10.0.0.9.5000 ESTABLISHED"].join("\n"));
  assert.equal(r.format, "macos");
  assert.equal(r.records.length, 3);
  assert.equal(r.warnings.truncatedAddresses, 2);
  assert.equal(r.warnings.unparsedCount, 0);
});

// G: netstat -tunae / -tunaep (User and Inode columns)
test("G: Linux netstat -tunaep keeps state, PID and program around the User and Inode columns", () => {
  const text = ["Proto Recv-Q Send-Q Local Address           Foreign Address         State       User       Inode      PID/Program name",
    "tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      0          21345      1001/sshd",
    "tcp        0      0 10.0.0.5:22             10.0.0.9:50000          ESTABLISHED 0          33333      1201/sshd: root@pts/0",
    "udp        0      0 0.0.0.0:68              0.0.0.0:*                           0          12345      600/dhclient",
    "udp        0      0 127.0.0.53:53           0.0.0.0:*                           systemd-resolve 2222 700/systemd-resolve",
    "udp        0      0 0.0.0.0:5353            0.0.0.0:*                           101        4444       -"].join("\n");
  const r = parseFile("e.txt", text);
  assert.equal(r.format, "linux-netstat");
  assert.deepEqual(r.warnings.unknownStates, []);
  assert.deepEqual(r.records.map((x) => [x.proto, x.localPort, x.state, x.pid, x.process]), [
    ["tcp", 22, "LISTEN", 1001, "sshd"],
    ["tcp", 22, "ESTABLISHED", 1201, "sshd: root@pts/0"],
    ["udp", 68, "BOUND", 600, "dhclient"],
    ["udp", 53, "BOUND", 700, "systemd-resolve"],
    ["udp", 5353, "BOUND", undefined, undefined],
  ]);
});

// H: ss single-protocol forms have no Netid column
test("H: ss -tanp (no Netid column) is detected and parsed as TCP", () => {
  const text = ["State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process",
    'LISTEN 0      128    0.0.0.0:22          0.0.0.0:*         users:(("sshd",pid=1001,fd=3))',
    'ESTAB  0      0      10.0.0.5:22         10.0.0.9:50000    users:(("sshd",pid=1201,fd=4))',
    "TIME-WAIT 0   0      10.0.0.5:44000      10.0.0.7:443"].join("\n");
  const r = parseFile("ss.txt", text);
  assert.equal(r.format, "linux-ss");
  assert.deepEqual(r.records.map((x) => [x.proto, x.localPort, x.remotePort, x.state, x.pid, x.process]), [
    ["tcp", 22, null, "LISTEN", 1001, "sshd"],
    ["tcp", 22, 50000, "ESTABLISHED", 1201, "sshd"],
    ["tcp", 44000, 443, "TIME_WAIT", undefined, undefined],
  ]);
});

test("H: ss -uanp (no Netid column) is parsed as UDP", () => {
  const text = ["State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process",
    'UNCONN 0      0      0.0.0.0%eth0:68     0.0.0.0:*         users:(("dhclient",pid=600,fd=6))',
    'ESTAB  0      0      10.0.0.5:41000      10.0.0.1:53       users:(("resolver",pid=700,fd=9))'].join("\n");
  const r = parseFile("ssu.txt", text);
  assert.equal(r.format, "linux-ss");
  assert.deepEqual(r.records.map((x) => [x.proto, x.localPort, x.state, x.pid]), [
    ["udp", 68, "BOUND", 600],
    ["udp", 41000, "ESTABLISHED", 700],
  ]);
});

// I: netstat -anot adds an Offload State column
test("I: Windows netstat -anot offload column is ignored", () => {
  const text = ["  Proto  Local Address          Foreign Address        State           PID      Offload State",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1032     InHost",
    "  TCP    10.0.0.5:445           10.0.0.9:50000         ESTABLISHED     4        Offloaded",
    "  UDP    0.0.0.0:123            *:*                                    1456"].join("\r\n");
  const r = parseFile("w.txt", text);
  assert.equal(r.format, "windows");
  assert.equal(r.warnings.unparsedCount, 0);
  assert.deepEqual(r.records.map((x) => [x.proto, x.localPort, x.state, x.pid]), [
    ["tcp", 135, "LISTEN", 1032], ["tcp", 445, "ESTABLISHED", 4], ["udp", 123, "BOUND", 1456]]);
});

// J: macOS -anv process names with spaces
test("J: macOS netstat -anv keeps process names that contain spaces", () => {
  const text = ["tcp4       0      0  192.168.1.5.52344    203.0.113.10.443       ESTABLISHED  131072  131328  Google Chrome He:1234  00102 00000000",
    "tcp4       0      0  *.22                 *.*                    LISTEN       131072  131072  launchd:1  00000 00000000"].join("\n");
  const r = parseFile("m.txt", text);
  assert.deepEqual(r.records.map((x) => [x.pid, x.process]), [[1234, "Google Chrome He"], [1, "launchd"]]);
});
