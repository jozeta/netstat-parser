import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLinuxNetstat } from "../js/parse/linux-netstat.js";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const root = parseLinuxNetstat(fx("linux-netstat-tunap.txt"));

test("established line with PID/program including spaces", () => {
  assert.deepEqual(root.records[2], { proto: "tcp", family: 4, localIp: "10.10.20.5", localPort: 22,
    remoteIp: "10.10.1.30", remotePort: 51544, state: "ESTABLISHED", pid: 1201, process: "sshd: root@pts/0" });
});

test("tcp6 wildcard listen", () => {
  assert.deepEqual(root.records[5], { proto: "tcp", family: 6, localIp: "*", localPort: 80,
    remoteIp: "*", remotePort: null, state: "LISTEN", pid: 900, process: "nginx: master" });
});

test("IPv4-mapped addresses become IPv4", () => {
  const r = root.records[6];
  assert.equal(r.family, 4);
  assert.equal(r.localIp, "10.10.20.5");
  assert.equal(r.remoteIp, "10.10.10.21");
});

test("udp bound socket", () => {
  const r = root.records[8];
  assert.equal(r.state, "BOUND");
  assert.equal(r.pid, 600);
  assert.equal(r.process, "dhclient");
  assert.equal(root.records[9].family, 6);
});

test("UNIX socket section skipped; 10 records; '-' means no pid", () => {
  assert.equal(root.records.length, 10);
  assert.deepEqual(root.unparsed, []);
  assert.equal(root.records[4].pid, undefined);
  assert.equal(root.records[4].state, "TIME_WAIT");
});

test("non-root output", () => {
  const res = parseLinuxNetstat(fx("linux-netstat-tuna-nonroot.txt"));
  assert.equal(res.records.length, 4);
  assert.deepEqual(res.unparsed, []);
  assert.ok(res.records.every((r) => r.pid === undefined && r.process === undefined));
  assert.equal(res.records[2].remoteIp, "10.10.10.21");
});
