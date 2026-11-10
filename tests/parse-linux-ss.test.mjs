import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLinuxSs } from "../js/parse/linux-ss.js";

const res = parseLinuxSs(readFileSync(new URL("./fixtures/linux-ss-tunap.txt", import.meta.url), "utf8"));
const r = res.records;

test("all lines parse", () => {
  assert.equal(r.length, 10);
  assert.deepEqual(res.unparsed, []);
  assert.deepEqual(res.unknownStates, []);
});

test("ESTAB with users:(...) process", () => {
  assert.deepEqual(r[6], { proto: "tcp", family: 4, localIp: "10.10.20.5", localPort: 22,
    remoteIp: "10.10.1.30", remotePort: 51544, state: "ESTABLISHED", pid: 1201, process: "sshd" });
});

test("bracketed IPv6 wildcard listen without process", () => {
  assert.deepEqual(r[4], { proto: "tcp", family: 6, localIp: "*", localPort: 80, remoteIp: "*", remotePort: null, state: "LISTEN" });
});

test("UNCONN with interface suffix → BOUND", () => {
  assert.equal(r[1].state, "BOUND");
  assert.equal(r[1].localIp, "*");
  assert.equal(r[1].localPort, 68);
  assert.equal(r[2].localIp, "fe80::1");
});

test("IPv4-mapped brackets → IPv4; first process wins", () => {
  assert.equal(r[7].family, 4);
  assert.equal(r[7].localIp, "10.10.20.5");
  assert.equal(r[7].remoteIp, "10.10.10.21");
  assert.equal(r[7].pid, 900);
});

test("dashed states", () => {
  assert.equal(r[8].state, "TIME_WAIT");
  assert.equal(r[9].state, "SYN_SENT");
});
