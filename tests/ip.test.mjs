import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeIp, splitEndpoint, isWildcard, isLoopback } from "../js/lib/ip.js";
import { STATES } from "../js/parse/types.js";

test("normalizeIp: IPv4", () => {
  assert.deepEqual(normalizeIp("10.0.0.5"), { ip: "10.0.0.5", family: 4 });
});

test("normalizeIp: IPv6 canonical (RFC 5952)", () => {
  assert.deepEqual(normalizeIp("FE80:0:0:0:0:0:0:1"), { ip: "fe80::1", family: 6 });
  assert.deepEqual(normalizeIp("2001:db8:0:0:1:0:0:1"), { ip: "2001:db8::1:0:0:1", family: 6 });
  assert.deepEqual(normalizeIp("2001:0db8:0000:0000:0000:ff00:0042:8329"), { ip: "2001:db8::ff00:42:8329", family: 6 });
  assert.deepEqual(normalizeIp("2001:db8:0:1:1:1:1:1"), { ip: "2001:db8:0:1:1:1:1:1", family: 6 });
});

test("normalizeIp: IPv4-mapped IPv6 becomes IPv4", () => {
  assert.deepEqual(normalizeIp("::ffff:10.0.0.5"), { ip: "10.0.0.5", family: 4 });
  assert.deepEqual(normalizeIp("::FFFF:10.0.0.5"), { ip: "10.0.0.5", family: 4 });
});

test("normalizeIp: zone id stripped", () => {
  assert.deepEqual(normalizeIp("fe80::1%eth0"), { ip: "fe80::1", family: 6 });
});

test("normalizeIp: wildcards", () => {
  assert.deepEqual(normalizeIp("0.0.0.0"), { ip: "*", family: 4 });
  assert.deepEqual(normalizeIp("::"), { ip: "*", family: 6 });
  assert.deepEqual(normalizeIp("*"), { ip: "*", family: 4 });
});

test("normalizeIp: rejects garbage", () => {
  for (const bad of ["999.1.1.1", "hello", "1:2:3", "", "1.2.3", "01.2.3.4.5", "1::2::3", "12345::1", ":::"]) {
    assert.equal(normalizeIp(bad), null, bad);
  }
});

test("splitEndpoint: colon forms", () => {
  assert.deepEqual(splitEndpoint("10.0.0.5:445", ":"), { ip: "10.0.0.5", family: 4, port: 445 });
  assert.deepEqual(splitEndpoint("[::]:135", ":"), { ip: "*", family: 6, port: 135 });
  assert.deepEqual(splitEndpoint(":::80", ":"), { ip: "*", family: 6, port: 80 });
  assert.deepEqual(splitEndpoint("*:*", ":"), { ip: "*", family: 4, port: null });
  assert.deepEqual(splitEndpoint("0.0.0.0%eth0:68", ":"), { ip: "*", family: 4, port: 68 });
  assert.deepEqual(splitEndpoint("[fe80::1%eth0]:546", ":"), { ip: "fe80::1", family: 6, port: 546 });
});

test("splitEndpoint: macOS dot forms", () => {
  assert.deepEqual(splitEndpoint("192.168.50.12.52344", "."), { ip: "192.168.50.12", family: 4, port: 52344 });
  assert.deepEqual(splitEndpoint("*.22", "."), { ip: "*", family: 4, port: 22 });
  assert.deepEqual(splitEndpoint("*.*", "."), { ip: "*", family: 4, port: null });
  assert.deepEqual(splitEndpoint("fe80::1%lo0.49152", "."), { ip: "fe80::1", family: 6, port: 49152 });
});

test("splitEndpoint: rejects bad ports and shapes", () => {
  assert.equal(splitEndpoint("10.0.0.5:70000", ":"), null);
  assert.equal(splitEndpoint("10.0.0.5", ":"), null);
  assert.equal(splitEndpoint("10.0.0.5:abc", ":"), null);
});

test("isWildcard and isLoopback", () => {
  assert.ok(isWildcard("*"));
  assert.ok(!isWildcard("10.0.0.1"));
  assert.ok(isLoopback("127.0.0.1"));
  assert.ok(isLoopback("127.5.0.1"));
  assert.ok(isLoopback("::1"));
  assert.ok(!isLoopback("10.0.0.1"));
});

test("STATES lists the canonical states", () => {
  assert.deepEqual(STATES, ["LISTEN", "BOUND", "ESTABLISHED", "SYN_SENT", "SYN_RECEIVED", "FIN_WAIT_1",
    "FIN_WAIT_2", "CLOSE_WAIT", "CLOSING", "LAST_ACK", "TIME_WAIT", "CLOSED"]);
});
