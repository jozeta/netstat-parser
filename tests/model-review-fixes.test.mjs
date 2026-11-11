import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../js/model/build.js";
import { DEFAULT_SETTINGS } from "../js/model/settings.js";
import { csvCell, targetsFile } from "../js/model/exports.js";
import { resolvePtrs } from "../js/model/dns.js";
import { parseQuery, applyFilter } from "../js/model/filter.js";
import { winFile } from "./helpers/net.mjs";

const S = DEFAULT_SETTINGS;

test("a host with a listening table is the client for ports it does not listen on", () => {
  const ws = winFile("WS", [["TCP", "0.0.0.0:135", "0.0.0.0:0", "LISTENING"], ["TCP", "10.0.0.5:49152", "10.0.0.9:50000", "ESTABLISHED"],
    ["TCP", "10.0.0.5:49153", "10.0.0.9:50000", "ESTABLISHED"]]);
  const m = buildModel([ws], S);
  assert.deepEqual([...m.edges.keys()], ["e:h:ws|ip:10.0.0.9|tcp/50000"]);
  assert.equal(m.hosts.get("h:ws").role, "client");
});

test("traffic to an address the local host itself owns never becomes an edge to another host", () => {
  const a = winFile("A", [["TCP", "172.17.0.1:8080", "0.0.0.0:0", "LISTENING"], ["TCP", "10.0.0.1:445", "0.0.0.0:0", "LISTENING"]]);
  const b = winFile("B", [["TCP", "172.17.0.1:53", "0.0.0.0:0", "LISTENING"], ["TCP", "10.0.0.2:50001", "172.17.0.1:8080", "ESTABLISHED"]]);
  const m = buildModel([a, b], S);
  assert.ok(![...m.edges.values()].some((e) => e.source === "h:b" && e.target === "h:a"), [...m.edges.keys()].join());
});

test("CSV quotes cells with ';' (Swedish Excel list separator)", () => {
  assert.equal(csvCell("x;=1+1"), '"x;=1+1"');
});

test("DNS never sends addresses inside configured internal ranges, multicast or reserved", async () => {
  const sent = [];
  const fetch = async (url) => { sent.push(url); return { ok: true, json: async () => ({ Status: 3 }) }; };
  await resolvePtrs(["93.184.217.7", "93.184.216.10", "224.0.0.251", "240.0.0.1", "0.1.2.3", "ff02::fb"],
    { resolver: "google", fetch, delayMs: 0, internalRanges: ["93.184.217.0/24"] });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /10\.216\.184\.93/);
});

test("ip: filter is exact unless it ends in '.', ':' or '*'", () => {
  const ws = winFile("WS", [["TCP", "10.0.0.1:50000", "10.0.0.10:445", "ESTABLISHED"]]);
  const m = buildModel([ws], S);
  const hosts = (q) => [...applyFilter(m, parseQuery(q)).hosts].sort();
  assert.deepEqual(hosts("ip:10.0.0.1"), ["h:ws"]);
  assert.deepEqual(hosts("ip:10.0.0.1*"), ["h:ws", "ip:10.0.0.10"]);
  assert.deepEqual(hosts("ip:10.0.0."), ["h:ws", "ip:10.0.0.10"]);
});

test("targets skip link-local hosts", () => {
  const ws = winFile("WS", [["TCP", "[fe80::1]:50000", "[fe80::5]:445", "ESTABLISHED"], ["TCP", "10.0.0.1:50001", "169.254.3.4:445", "ESTABLISHED"]]);
  const lines = targetsFile(buildModel([ws], S)).split("\n").filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(lines, []);
});
