import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../js/model/build.js";
import { DEFAULT_SETTINGS } from "../js/model/settings.js";
import { generated, winFile } from "./helpers/net.mjs";

const S = DEFAULT_SETTINGS;
const ws = winFile("WS-1", [["TCP", "10.10.10.21:49712", "10.10.1.10:445", "ESTABLISHED"]]);
const dc = winFile("DC01", [["TCP", "0.0.0.0:445", "0.0.0.0:0", "LISTENING"], ["TCP", "0.0.0.0:88", "0.0.0.0:0", "LISTENING"],
  ["TCP", "0.0.0.0:389", "0.0.0.0:0", "LISTENING"], ["TCP", "10.10.1.10:445", "10.10.10.21:49712", "ESTABLISHED"]]);

test("edge seen from both ends", () => {
  const m = buildModel([ws, dc], S);
  const e = m.edges.get("e:h:ws-1|h:dc01|tcp/445");
  assert.ok(e, [...m.edges.keys()].join());
  assert.equal(e.seen, "both");
  assert.equal(e.bothCollected, true);
  assert.equal(e.risk, "exploitable");
  assert.equal(e.name, "SMB");
  assert.equal(e.observations.length, 2);
  assert.deepEqual(e.states, ["ESTABLISHED"]);
});

test("edge seen from one end, server not collected", () => {
  const m = buildModel([ws], S);
  const e = m.edges.get("e:h:ws-1|ip:10.10.1.10|tcp/445");
  assert.equal(e.seen, "one");
  assert.equal(e.bothCollected, false);
});

test("both collected, only one file shows it", () => {
  const dcNoConn = winFile("DC01", [["TCP", "10.10.1.10:445", "0.0.0.0:0", "LISTENING"]]);
  const e = buildModel([ws, dcNoConn], S).edges.get("e:h:ws-1|h:dc01|tcp/445");
  assert.equal(e.seen, "one");
  assert.equal(e.bothCollected, true);
});

test("service port: lower-port rule, then listening knowledge wins", () => {
  const c = winFile("C", [["TCP", "10.0.0.5:1025", "10.0.0.9:8443", "ESTABLISHED"]]);
  assert.ok(buildModel([c], S).edges.has("e:ip:10.0.0.9|h:c|tcp/1025"));
  const srv = winFile("SRV", [["TCP", "10.0.0.9:8443", "0.0.0.0:0", "LISTENING"]]);
  const m = buildModel([c, srv], S);
  assert.ok(m.edges.has("e:h:c|h:srv|tcp/8443"), [...m.edges.keys()].join());
});

test("DC↔DC both directions → two edges, no self-loops", () => {
  const a = winFile("DC1", [["TCP", "10.10.1.10:389", "0.0.0.0:0", "LISTENING"], ["TCP", "10.10.1.10:50000", "10.10.1.11:389", "ESTABLISHED"],
    ["TCP", "10.10.1.10:389", "10.10.1.11:50001", "ESTABLISHED"], ["TCP", "10.10.1.10:50002", "10.10.1.10:445", "ESTABLISHED"]]);
  const b = winFile("DC2", [["TCP", "10.10.1.11:389", "0.0.0.0:0", "LISTENING"]]);
  const m = buildModel([a, b], S);
  assert.ok(m.edges.has("e:h:dc1|h:dc2|tcp/389"));
  assert.ok(m.edges.has("e:h:dc2|h:dc1|tcp/389"));
  assert.ok([...m.edges.values()].every((e) => e.source !== e.target));
});

test("listening ports, roles and tags", () => {
  const m = buildModel([ws, dc], S);
  const d = m.hosts.get("h:dc01");
  assert.deepEqual(d.listening.map((l) => l.port).sort((x, y) => x - y), [88, 389, 445]);
  assert.deepEqual(d.listening.find((l) => l.port === 445), { proto: "tcp", port: 445, bindIp: "*", pid: 4, name: "SMB", risk: "exploitable" });
  assert.equal(d.role, "server");
  assert.ok(d.tags.includes("DC"));
  assert.equal(m.hosts.get("h:ws-1").role, "client");
  const db = winFile("APP", [["TCP", "10.0.0.2:50000", "10.0.0.3:1433", "ESTABLISHED"]]);
  const m2 = buildModel([db], S);
  assert.ok(m2.hosts.get("ip:10.0.0.3").tags.includes("DB"));
  assert.equal(m2.hosts.get("ip:10.0.0.3").role, "server");
});

test("generated medium: both-ends ratio, risk levels, endpoints exist", () => {
  const { files } = generated("medium");
  const m = buildModel(files, S);
  const between = [...m.edges.values()].filter((e) => e.bothCollected && e.proto === "tcp" && e.states.includes("ESTABLISHED"));
  const both = between.filter((e) => e.seen === "both").length;
  assert.ok(both / between.length >= 0.85, `${both}/${between.length}`);
  for (const r of ["vulnerable", "exploitable", "safe"]) assert.ok([...m.edges.values()].some((e) => e.risk === r), r);
  for (const e of m.edges.values()) { assert.ok(m.hosts.has(e.source)); assert.ok(m.hosts.has(e.target)); }
  const roles = new Set([...m.hosts.values()].map((h) => h.role));
  assert.ok(roles.has("server") && roles.has("client"));
});

test("performance: large builds in < 2 s", () => {
  const { files } = generated("large");
  const t0 = performance.now();
  const m = buildModel(files, S);
  const ms = performance.now() - t0;
  assert.ok(m.edges.size > 500);
  assert.ok(ms < 2000, `${ms} ms`);
});
