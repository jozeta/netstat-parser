import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildNetwork } from "../scripts/gen/topology.js";
import { renderFile } from "../scripts/gen/render.js";
import { parseFile } from "../js/parse/index.js";
import { parseWindows } from "../js/parse/windows.js";
import { parseLinuxSs } from "../js/parse/linux-ss.js";
import { parseLinuxNetstat } from "../js/parse/linux-netstat.js";
import { parseMacos } from "../js/parse/macos.js";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const AT = "2026-11-10T20:41:00Z";
const key = (r) => JSON.stringify([r.proto, r.family, r.localIp, r.localPort, r.remoteIp, r.remotePort, r.state, r.pid ?? null, r.process ?? null]);
const sorted = (rs) => rs.map(key).sort();
const tiny = (format, locale, sockets) => ({ hostname: "T1", os: "x", osVersion: "x", format, locale, withHeader: false,
  collected: true, role: "client", addresses: [{ ip: "10.0.0.1", prefix: 24 }], sockets });

for (const size of ["small", "medium", "large"]) {
  test(`${size}: every generated file parses back to the generator's ground truth`, () => {
    const net = buildNetwork(size, 1);
    for (const h of net.hosts.filter((x) => x.collected)) {
      const { fileName, text } = renderFile(h, AT);
      assert.equal(fileName, `${h.hostname}_netstat.txt`);
      const pf = parseFile(fileName, text);
      assert.equal(pf.format, h.format, h.hostname);
      assert.equal(pf.hostname, h.hostname);
      assert.equal(pf.hostnameSource, h.withHeader ? "header" : "filename");
      assert.equal(pf.warnings.unparsedCount, 0, h.hostname);
      assert.deepEqual(pf.warnings.unknownStates, []);
      assert.deepEqual(sorted(pf.records), sorted(h.sockets), h.hostname);
    }
  });
}

test("localized Windows output uses the translated state words", () => {
  const net = buildNetwork("small", 1);
  const sv = net.hosts.find((h) => h.collected && h.locale === "sv");
  const de = net.hosts.find((h) => h.collected && h.locale === "de");
  assert.match(renderFile(sv, AT).text, /LYSSNAR/);
  assert.match(renderFile(de, AT).text, /ABHÖREN/);
});

test("header is written when withHeader", () => {
  const net = buildNetwork("small", 1);
  const h = net.hosts.find((x) => x.collected && x.withHeader);
  const { text } = renderFile(h, AT);
  assert.ok(text.startsWith(`### netstat-parser v1\nhostname: ${h.hostname}\nos: ${h.osVersion}\ncollected: ${AT}\naddresses: `));
});

test("Windows rendering matches the hand-written fixtures exactly", () => {
  for (const [file, locale] of [["windows-en-ano.txt", "en"], ["windows-sv-ano.txt", "sv"], ["windows-de-ano.txt", "de"]]) {
    const ref = fx(file);
    assert.equal(renderFile(tiny("windows", locale, parseWindows(ref).records), AT).text, ref, file);
  }
});

const socketLines = (text) => text.split("\n").filter((l) => /^\s*(tcp|udp)/i.test(l));
const tokens = (l, drop) => l.trim().split(/\s+/).filter((_, i) => !drop.includes(i));

test("macOS rendering matches the fixture's socket lines", () => {
  const ref = fx("macos-netstat-an.txt");
  const keep = socketLines(ref).filter((l) => !l.includes("%")); // zone ids are not stored
  const out = renderFile(tiny("macos", null, parseMacos(keep.join("\n")).records), AT).text;
  // tcp46 is written as tcp6 by the generator; otherwise identical text
  assert.deepEqual(socketLines(out).map((l) => l.trimEnd()), keep.map((l) => l.trimEnd().replace(/^tcp46 /, "tcp6  ")));
});

test("Linux netstat and ss rendering match the fixtures token for token", () => {
  const skip = (l) => /ffff|%|\*:9100|\),\(/.test(l);
  const nref = fx("linux-netstat-tunap.txt");
  const nKeep = socketLines(nref).filter((l) => !skip(l));
  const nOut = socketLines(renderFile(tiny("linux-netstat", null, parseLinuxNetstat(nKeep.join("\n")).records), AT).text);
  assert.deepEqual(nOut.map((l) => tokens(l, [1, 2])), nKeep.map((l) => tokens(l, [1, 2])));

  const sref = fx("linux-ss-tunap.txt");
  const sKeep = socketLines(sref).filter((l) => !skip(l));
  const sOut = socketLines(renderFile(tiny("linux-ss", null, parseLinuxSs(sKeep.join("\n")).records), AT).text);
  const norm = (l) => tokens(l, [2, 3]).map((t) => t.replace(/fd=\d+/, "fd=N"));
  assert.deepEqual(sOut.map(norm), sKeep.map(norm));
});

test("performance: parsing every large file takes < 3 s", () => {
  const files = buildNetwork("large", 1).hosts.filter((h) => h.collected).map((h) => renderFile(h, AT));
  const t0 = performance.now();
  for (const f of files) parseFile(f.fileName, f.text);
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `${ms} ms`);
});

test("CLI writes manifest + one file per collected host for each size", () => {
  const out = mkdtempSync(join(tmpdir(), "nsp-gen-"));
  try {
    const script = new URL("../scripts/generate-datasets.js", import.meta.url).pathname;
    const log = execFileSync(process.execPath, [script, "--seed", "1", "--out", out], { encoding: "utf8" });
    for (const size of ["small", "medium", "large"]) {
      const files = readdirSync(join(out, size));
      const manifest = JSON.parse(readFileSync(join(out, size, "manifest.json"), "utf8"));
      const collected = buildNetwork(size, 1).hosts.filter((h) => h.collected).length;
      assert.equal(files.filter((f) => f.endsWith("_netstat.txt")).length, collected);
      assert.equal(manifest.hosts.length, buildNetwork(size, 1).hosts.length);
      assert.ok(manifest.hosts.every((h) => !("sockets" in h)));
      assert.match(log, new RegExp(`${size}: \\d+ hosts, ${collected} files`));
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
