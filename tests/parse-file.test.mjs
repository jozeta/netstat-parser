import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectFormat } from "../js/parse/detect.js";
import { parseFile } from "../js/parse/index.js";
import { parseWindows } from "../js/parse/windows.js";
import { decodeBytes } from "../js/parse/decode.js";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const HEADER = "### netstat-parser v1\nhostname: DC01\nos: Windows Server 2022\ncollected: 2026-11-10T20:41:00Z\naddresses: 10.10.1.10/24\n### netstat\n";

test("detectFormat recognises every fixture", () => {
  const expect = {
    "windows-en-ano.txt": "windows", "windows-sv-ano.txt": "windows", "windows-de-ano.txt": "windows",
    "windows-anob.txt": "windows", "linux-netstat-tunap.txt": "linux-netstat",
    "linux-netstat-tuna-nonroot.txt": "linux-netstat", "linux-ss-tunap.txt": "linux-ss",
    "macos-netstat-an.txt": "macos", "macos-netstat-anv.txt": "macos",
  };
  for (const [file, fmt] of Object.entries(expect)) assert.equal(detectFormat(fx(file)), fmt, file);
});

test("detectFormat does not need English (or any) header lines", () => {
  for (const f of ["windows-sv-ano.txt", "windows-de-ano.txt"]) {
    const noHeader = fx(f).split("\n").filter((l) => !/Prot|anslutningar|Verbindungen/.test(l)).join("\n");
    assert.equal(detectFormat(noHeader), "windows", f);
  }
});

test("parseFile with header", () => {
  const text = HEADER + fx("windows-en-ano.txt");
  const pf = parseFile("DC01_netstat.txt", text);
  assert.equal(pf.hostname, "DC01");
  assert.equal(pf.hostnameSource, "header");
  assert.equal(pf.format, "windows");
  assert.equal(pf.header.os, "Windows Server 2022");
  assert.deepEqual(pf.records, parseWindows(fx("windows-en-ano.txt")).records);
  assert.equal(pf.warnings.notRecognised, false);
});

test("parseFile without header uses the file name", () => {
  const pf = parseFile("web-02_netstat.txt", fx("linux-ss-tunap.txt"));
  assert.equal(pf.hostname, "web-02");
  assert.equal(pf.hostnameSource, "filename");
  assert.equal(pf.header, null);
  assert.equal(pf.format, "linux-ss");
  assert.equal(pf.records.length, 10);
});

test("not netstat at all: ipconfig text and random bytes", () => {
  const ipconfig = "Windows IP Configuration\n\nEthernet adapter Ethernet:\n   IPv4 Address. . . . . . . . . . . : 10.0.0.5\n";
  let seed = 7;
  const bytes = Uint8Array.from({ length: 2048 }, () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255);
  for (const text of [ipconfig, decodeBytes(bytes), ""]) {
    const pf = parseFile("x.txt", text);
    assert.equal(pf.format, null);
    assert.deepEqual(pf.records, []);
    assert.equal(pf.warnings.notRecognised, true);
  }
});

test("unparsed samples are capped at 5, count is complete", () => {
  const bad = Array.from({ length: 9 }, () => "  TCP    garbage").join("\n");
  const pf = parseFile("h.txt", fx("windows-en-ano.txt") + bad);
  assert.equal(pf.warnings.unparsedCount, 9);
  assert.equal(pf.warnings.unparsedSamples.length, 5);
  assert.equal(pf.records.length, 11);
});

test("unknown states surface in warnings", () => {
  const pf = parseFile("h.txt", "  TCP    0.0.0.0:445   0.0.0.0:0   LYSSNAR_X   4\n");
  assert.deepEqual(pf.warnings.unknownStates, ["LYSSNAR_X"]);
  assert.equal(pf.records[0].state, "LISTEN");
});
