import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMacos } from "../js/parse/macos.js";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const an = parseMacos(fx("macos-netstat-an.txt"));

test("dotted endpoint established", () => {
  assert.deepEqual(an.records[0], { proto: "tcp", family: 4, localIp: "192.168.50.12", localPort: 52344,
    remoteIp: "203.0.113.10", remotePort: 443, state: "ESTABLISHED" });
});

test("tcp46 wildcard listen", () => {
  const r = an.records[3];
  assert.equal(r.localIp, "*"); assert.equal(r.localPort, 22);
  assert.equal(r.remoteIp, "*"); assert.equal(r.remotePort, null);
  assert.equal(r.state, "LISTEN");
});

test("IPv6 link-local with zone", () => {
  const r = an.records[4];
  assert.equal(r.family, 6); assert.equal(r.localIp, "fe80::1"); assert.equal(r.localPort, 49152);
});

test("udp without state", () => {
  assert.equal(an.records[6].state, "BOUND");
  assert.equal(an.records[7].family, 6);
  assert.equal(an.records[8].state, "ESTABLISHED");
  assert.equal(an.records[8].remotePort, 53);
});

test("multipath and UNIX sections skipped; 9 records", () => {
  assert.equal(an.records.length, 9);
  assert.deepEqual(an.unparsed, []);
});

test("-anv: process:pid token", () => {
  const res = parseMacos(fx("macos-netstat-anv.txt"));
  assert.equal(res.records.length, 3);
  assert.deepEqual(res.unparsed, []);
  assert.equal(res.records[0].pid, 412);
  assert.equal(res.records[0].process, "sharingd");
  assert.equal(res.records[2].pid, 1);
  assert.equal(res.records[2].state, "LISTEN");
});
