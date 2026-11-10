import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWindows } from "../js/parse/windows.js";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const en = fx("windows-en-ano.txt");

test("established IPv4 line", () => {
  const r = parseWindows(en).records;
  assert.deepEqual(r[2], { proto: "tcp", family: 4, localIp: "10.10.10.21", localPort: 49712,
    remoteIp: "10.10.1.10", remotePort: 445, state: "ESTABLISHED", pid: 4 });
});

test("IPv6 listening line", () => {
  const r = parseWindows(en).records;
  assert.deepEqual(r[6], { proto: "tcp", family: 6, localIp: "*", localPort: 135,
    remoteIp: "*", remotePort: 0, state: "LISTEN", pid: 1012 });
});

test("UDP line with empty state column", () => {
  const r = parseWindows(en).records;
  assert.deepEqual(r[8], { proto: "udp", family: 4, localIp: "*", localPort: 123,
    remoteIp: "*", remotePort: null, state: "BOUND", pid: 1456 });
  assert.equal(r[10].family, 6);
});

test("whole English fixture: 11 records, nothing unparsed", () => {
  const res = parseWindows(en);
  assert.equal(res.records.length, 11);
  assert.deepEqual(res.unparsed, []);
  assert.deepEqual(res.unknownStates, []);
  assert.equal(res.records[4].state, "TIME_WAIT");
});

test("Swedish and German give the same records as English", () => {
  const ref = parseWindows(en).records;
  assert.deepEqual(parseWindows(fx("windows-sv-ano.txt")).records, ref);
  assert.deepEqual(parseWindows(fx("windows-de-ano.txt")).records, ref);
});

test("-anob: process names attach to the record before them; extra lines are not unparsed", () => {
  const res = parseWindows(fx("windows-anob.txt"));
  assert.equal(res.records.length, 4);
  assert.equal(res.records[0].process, "svchost.exe");
  assert.equal(res.records[1].process, undefined);
  assert.equal(res.records[2].process, "msedge.exe");
  assert.equal(res.records[3].process, "svchost.exe");
  assert.deepEqual(res.unparsed, []);
});

test("unknown state word: wildcard remote → LISTEN, otherwise UNKNOWN; word reported", () => {
  const res = parseWindows("  TCP    0.0.0.0:445   0.0.0.0:0   ZUHÖREN_X   4\n  TCP    10.0.0.1:5000   10.0.0.2:80   BLAH   4\n");
  assert.equal(res.records[0].state, "LISTEN");
  assert.equal(res.records[1].state, "UNKNOWN");
  assert.deepEqual(res.unknownStates.sort(), ["BLAH", "ZUHÖREN_X"]);
});

test("crlf and no final newline", () => {
  const crlf = en.trimEnd().replace(/\n/g, "\r\n");
  const res = parseWindows(crlf);
  assert.deepEqual(res.records, parseWindows(en).records);
  assert.deepEqual(res.unparsed, []);
});

test("broken candidate line is reported with its 1-based line number", () => {
  const res = parseWindows("Active Connections\n  TCP    garbage\n");
  assert.deepEqual(res.unparsed, [{ lineNo: 2, line: "  TCP    garbage" }]);
  assert.equal(res.records.length, 0);
});
