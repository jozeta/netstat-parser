// Findings from collecting over real SSH from Linux containers (Debian with ss, Debian with
// net-tools only, Alpine/busybox) on 2026-11-12.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHeader } from "../js/parse/header.js";
import { buildModel } from "../js/model/build.js";
import { DEFAULT_SETTINGS } from "../js/model/settings.js";
import { winFile } from "./helpers/net.mjs";

const hdr = (addresses) => parseHeader(`### netstat-parser v1\nhostname: x\naddresses: ${addresses}\n### netstat\n`).header.addresses;

test("header: an IPv4 address with a dotted netmask gets its prefix", () => {
  assert.deepEqual(hdr("172.18.0.3/255.255.0.0, 10.1.2.3/255.255.255.128"),
    [{ ip: "172.18.0.3", prefix: 16 }, { ip: "10.1.2.3", prefix: 25 }]);
});

test("header: a non-contiguous netmask keeps the address without a prefix", () => {
  assert.deepEqual(hdr("172.18.0.3/255.0.255.0"), [{ ip: "172.18.0.3", prefix: null }]);
});

test("groups: a host without a prefix joins the subnet another host's header reported", () => {
  const a = winFile("A", [["TCP", "172.18.0.2:22", "172.18.0.1:50000", "ESTABLISHED"]], { addresses: "172.18.0.2/16" });
  const b = winFile("B", [["TCP", "172.18.0.3:22", "172.18.0.1:50001", "ESTABLISHED"]], { addresses: "172.18.0.3" });
  const m = buildModel([a, b], DEFAULT_SETTINGS);
  assert.equal(m.hosts.get("h:a").groupId, "g:172.18.0.0/16");
  assert.equal(m.hosts.get("h:b").groupId, "g:172.18.0.0/16");
  assert.equal(m.hosts.get("ip:172.18.0.1").groupId, "g:172.18.0.0/16"); // seen only
  assert.deepEqual([...m.groups.keys()], ["g:172.18.0.0/16"]);
});

test("groups: a reported subnet wider than /16 does not pull in other hosts", () => {
  const a = winFile("A", [["TCP", "10.0.0.5:22", "10.9.9.9:50000", "ESTABLISHED"]], { addresses: "10.0.0.5/8" });
  const m = buildModel([a], DEFAULT_SETTINGS);
  assert.equal(m.hosts.get("h:a").groupId, "g:10.0.0.0/8"); // its own prefix still counts
  assert.equal(m.hosts.get("ip:10.9.9.9").groupId, "g:10.9.9.0/24");
});

// ---- collect.sh: the addresses line falls back to ifconfig where there is no `ip` ----
const SH = readFileSync(new URL("../collector/npcollect/collect.sh", import.meta.url), "utf8");
const linuxAddrLine = SH.split("\n").filter((l) => l.trim().startsWith('echo "addresses:')).pop().trim();
const NETTOOLS = `eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
        inet 172.18.0.3  netmask 255.255.0.0  broadcast 172.18.255.255
        inet6 fd00::3  prefixlen 64  scopeid 0x0<global>
        inet6 fe80::1  prefixlen 64  scopeid 0x20<link>
lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536
        inet 127.0.0.1  netmask 255.0.0.0
        inet6 ::1  prefixlen 128  scopeid 0x10<host>
`;
const BUSYBOX = `eth0      Link encap:Ethernet  HWaddr BA:65:DD:43:80:4A
          inet addr:172.18.0.4  Bcast:172.18.255.255  Mask:255.255.0.0
          inet6 addr: fd00::4/64 Scope:Global
lo        Link encap:Local Loopback
          inet addr:127.0.0.1  Mask:255.0.0.0
          inet6 addr: ::1/128 Scope:Host
`;

function runAddrLine(ifconfigOut) {
  const dir = mkdtempSync(join(tmpdir(), "np-addr-"));
  try {
    for (const tool of ["awk", "paste", "sed", "cat"]) {
      const real = execFileSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
      symlinkSync(real, join(dir, tool));
    }
    writeFileSync(join(dir, "ifconfig"), `#!/bin/sh\ncat <<'EOF'\n${ifconfigOut}EOF\n`);
    chmodSync(join(dir, "ifconfig"), 0o755);
    return execFileSync("/bin/sh", ["-c", linuxAddrLine], { encoding: "utf8", env: { PATH: dir } }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("collect.sh: without `ip`, net-tools ifconfig gives addresses with prefixes", () => {
  const line = runAddrLine(NETTOOLS);
  assert.equal(line, "addresses: 172.18.0.3/255.255.0.0, fd00::3/64");
  assert.deepEqual(hdr(line.slice("addresses: ".length)), [{ ip: "172.18.0.3", prefix: 16 }, { ip: "fd00::3", prefix: 64 }]);
});

test("collect.sh: without `ip`, busybox ifconfig gives addresses with prefixes", () => {
  assert.equal(runAddrLine(BUSYBOX), "addresses: 172.18.0.4/255.255.0.0, fd00::4/64");
});
