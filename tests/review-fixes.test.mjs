import { test } from "node:test";
import assert from "node:assert/strict";
import { splitEndpoint } from "../js/lib/ip.js";
import { parseLinuxSs } from "../js/parse/linux-ss.js";
import { parseLinuxNetstat } from "../js/parse/linux-netstat.js";
import { parseFile } from "../js/parse/index.js";
import { cleanText } from "../js/parse/header.js";

test("ss: interface scope outside brackets and on a bare wildcard", () => {
  assert.deepEqual(splitEndpoint("[fe80::5054:ff:fe12:3456]%eth0:546", ":"), { ip: "fe80::5054:ff:fe12:3456", family: 6, port: 546 });
  assert.deepEqual(splitEndpoint("*%eth0:68", ":"), { ip: "*", family: 4, port: 68 });
  const res = parseLinuxSs("udp   UNCONN 0  0  [fe80::5054:ff:fe12:3456]%eth0:546   [::]:*\nudp   UNCONN 0  0  *%eth0:68  *:*\n");
  assert.equal(res.records.length, 2);
  assert.deepEqual(res.unparsed, []);
});

test("linux netstat without -W: a full-width IPv6 endpoint is flagged as possibly truncated", () => {
  const line = "tcp6       0      0 2001:db8::1234:56:51544 2001:db8::99:443        ESTABLISHED -";
  const res = parseLinuxNetstat(line + "\n");
  assert.equal(res.records.length, 1);
  assert.ok(res.truncated >= 1);
  const pf = parseFile("x_netstat.txt", "Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name\n" + line + "\n");
  assert.equal(pf.warnings.truncatedAddresses, 1);
  const wide = parseFile("y.txt", "tcp6  0  0 2001:db8::1234:5678:51544  2001:db8::99:443  ESTABLISHED -\n");
  assert.equal(wide.warnings.truncatedAddresses, 0);
});

test("cleanText strips bidi and zero-width characters; fileName is cleaned and capped", () => {
  assert.equal(cleanText("a‮b​c⁦d﻿", 50), "abcd");
  const pf = parseFile("\u0007" + "n".repeat(5000) + "_netstat.txt", "");
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(pf.fileName, /[\u0000-\u001f]/);
  assert.ok(pf.fileName.length <= 255);
});
