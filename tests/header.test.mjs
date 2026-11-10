import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHeader, hostnameFromFileName, cleanText } from "../js/parse/header.js";

const HEADER = [
  "### netstat-parser v1",
  "hostname: WS-0142",
  "os: Microsoft Windows 11 Pro 10.0.22631",
  "collected: 2026-11-10T20:41:00Z",
  "addresses: 10.0.5.12/24, fe80::1c2a:3bff:fe4d:12/64",
  "### netstat",
].join("\n");
const BODY = "\nActive Connections\n  TCP    0.0.0.0:135   0.0.0.0:0   LISTENING   1012\n";

test("parseHeader: reads every field and returns the body after '### netstat'", () => {
  const { header, body } = parseHeader(HEADER + BODY);
  assert.equal(header.hostname, "WS-0142");
  assert.equal(header.os, "Microsoft Windows 11 Pro 10.0.22631");
  assert.equal(header.collected, "2026-11-10T20:41:00Z");
  assert.deepEqual(header.addresses, [{ ip: "10.0.5.12", prefix: 24 }, { ip: "fe80::1c2a:3bff:fe4d:12", prefix: 64 }]);
  assert.equal(body, BODY.slice(1));
});

test("parseHeader: tolerates a BOM and leading blank lines", () => {
  const { header } = parseHeader("﻿\n\n" + HEADER + BODY);
  assert.equal(header.hostname, "WS-0142");
});

test("parseHeader: no header → body unchanged", () => {
  assert.deepEqual(parseHeader(BODY), { header: null, body: BODY });
});

test("parseHeader: ignores unknown keys and bad addresses", () => {
  const text = "### netstat-parser v1\nhostname: A\nfoo: bar\naddresses: nope/24, 10.0.0.1/99, 10.0.0.2/16\n### netstat\nx";
  const { header, body } = parseHeader(text);
  assert.deepEqual(header.addresses, [{ ip: "10.0.0.2", prefix: 16 }]);
  assert.equal(header.os, null);
  assert.equal(body, "x");
});

test("parseHeader: header without '### netstat' marker → rest is body", () => {
  const { header, body } = parseHeader("### netstat-parser v1\nhostname: B\n  TCP  1.2.3.4:1  5.6.7.8:2  ESTABLISHED  4\n");
  assert.equal(header.hostname, "B");
  assert.ok(body.includes("TCP"));
});

test("hostnameFromFileName", () => {
  assert.equal(hostnameFromFileName("DC01_netstat.txt"), "DC01");
  assert.equal(hostnameFromFileName("web-02_NETSTAT.TXT"), "web-02");
  assert.equal(hostnameFromFileName("capture.log"), "capture");
  assert.equal(hostnameFromFileName("noext"), "noext");
  assert.equal(hostnameFromFileName("dir/sub/SRV1_netstat.txt"), "SRV1");
});

test("hostile hostname is cleaned and capped", () => {
  const evil = "evil\u0007\u001b[31m" + "A".repeat(10000);
  const { header } = parseHeader(`### netstat-parser v1\nhostname: ${evil}\n### netstat\n`);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(header.hostname, /[\u0000-\u001f\u007f-\u009f]/);
  assert.ok(header.hostname.length <= 253);
  assert.ok(hostnameFromFileName("\u0001" + "B".repeat(5000) + "_netstat.txt").length <= 253);
  assert.equal(cleanText("  a\u0000b\u009fc  ", 10), "abc");
});
