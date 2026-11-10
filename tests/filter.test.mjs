import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, applyFilter } from "../js/model/filter.js";
import { buildModel } from "../js/model/build.js";
import { DEFAULT_SETTINGS } from "../js/model/settings.js";
import { winFile } from "./helpers/net.mjs";

test("parseQuery: fields, quotes, negation, free text", () => {
  assert.deepEqual(parseQuery('port:445 subnet:"Office VLAN" risk:red -os:linux dc01'), [
    { field: "port", value: "445", negate: false }, { field: "subnet", value: "Office VLAN", negate: false },
    { field: "risk", value: "red", negate: false }, { field: "os", value: "linux", negate: true },
    { field: null, value: "dc01", negate: false }]);
  assert.deepEqual(parseQuery('subnet:"unterminated'), [{ field: "subnet", value: "unterminated", negate: false }]);
  assert.deepEqual(parseQuery("   "), []);
  assert.deepEqual(parseQuery("Port:22"), [{ field: "port", value: "22", negate: false }]);
  assert.deepEqual(parseQuery("foo:bar"), [{ field: null, value: "foo:bar", negate: false }]);
});

const ws = winFile("WS-1", [["TCP", "10.10.10.21:49712", "10.10.1.10:445", "ESTABLISHED"], ["TCP", "10.10.10.21:49800", "203.0.113.10:443", "ESTABLISHED"],
  ["TCP", "10.10.10.21:49801", "10.10.0.5:23", "ESTABLISHED"]]);
const dc = winFile("DC01", [["TCP", "0.0.0.0:445", "0.0.0.0:0", "LISTENING"], ["TCP", "10.10.1.10:445", "10.10.10.21:49712", "ESTABLISHED"]]);
const m = buildModel([ws, dc], DEFAULT_SETTINGS);
const run = (q) => applyFilter(m, parseQuery(q));

test("empty query keeps everything", () => {
  const r = run("");
  assert.equal(r.hosts.size, m.hosts.size);
  assert.equal(r.edges.size, m.edges.size);
});

test("port keeps the edge, its endpoints and hosts listening on it", () => {
  const r = run("port:445");
  assert.deepEqual([...r.edges], ["e:h:ws-1|h:dc01|tcp/445"]);
  assert.ok(r.hosts.has("h:ws-1") && r.hosts.has("h:dc01"));
  assert.ok(!r.hosts.has("ip:203.0.113.10"));
});

test("collected, seen, text, ip prefix, protocol name, risk aliases and negation", () => {
  assert.deepEqual([...run("collected:no").hosts].sort(), ["ip:10.10.0.5", "ip:203.0.113.10"]);
  assert.ok(!run("seen:one").edges.has("e:h:ws-1|h:dc01|tcp/445"));
  assert.ok(run("seen:both").edges.has("e:h:ws-1|h:dc01|tcp/445"));
  assert.ok(run("dc0").hosts.has("h:dc01"));
  assert.ok(run("ip:10.10.1.").hosts.has("h:dc01"));
  assert.deepEqual([...run("proto:smb").edges], ["e:h:ws-1|h:dc01|tcp/445"]);
  assert.deepEqual([...run("risk:red").edges], ["e:h:ws-1|ip:10.10.0.5|tcp/23"]);
  assert.deepEqual([...run("risk:vulnerable").edges], ["e:h:ws-1|ip:10.10.0.5|tcp/23"]);
  assert.ok(!run("-risk:safe").edges.has("e:h:ws-1|ip:203.0.113.10|tcp/443"));
  assert.ok(run("subnet:internet").hosts.has("ip:203.0.113.10"));
  assert.ok(run("os:windows").hosts.has("h:dc01"));
  assert.ok(run("role:server").hosts.has("h:dc01"));
});

test("typos never throw and match nothing", () => {
  for (const q of ["port:abc", "risk:purple", 'host:"', "seen:maybe"]) {
    const r = run(q);
    assert.equal(r.edges.size, 0, q);
    assert.equal(r.hosts.size, 0, q);
  }
});
