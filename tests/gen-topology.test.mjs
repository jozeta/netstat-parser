import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNetwork } from "../scripts/gen/topology.js";
import { createRng } from "../scripts/gen/random.js";

const RANGES = { small: [20, 40], medium: [150, 250], large: [300, 400] };
const nets = Object.fromEntries(Object.keys(RANGES).map((s) => [s, buildNetwork(s, 1)]));
const isPublic = (ip) => /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|2001:db8:)/.test(ip);
const isLoop = (ip) => ip === "::1" || ip.startsWith("127.");

test("createRng is deterministic", () => {
  const a = createRng(5), b = createRng(5);
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
  const r = createRng(1);
  for (let i = 0; i < 200; i++) { const n = r.int(3, 7); assert.ok(n >= 3 && n <= 7); }
});

for (const [size, [lo, hi]] of Object.entries(RANGES)) {
  const net = nets[size];
  const collected = net.hosts.filter((h) => h.collected);
  const byIp = new Map(net.hosts.flatMap((h) => h.addresses.map((a) => [a.ip, h])));

  test(`${size}: internal computer count in ${lo}-${hi}`, () => {
    assert.ok(net.hosts.length >= lo && net.hosts.length <= hi, String(net.hosts.length));
    assert.ok(net.hosts.every((h) => h.addresses.every((a) => !isPublic(a.ip))));
  });

  test(`${size}: every role present, devices never collected`, () => {
    for (const role of ["dc", "file", "db", "web", "jump", "client", "device"]) {
      assert.ok(net.hosts.some((h) => h.role === role), role);
    }
    assert.ok(net.hosts.filter((h) => h.role === "device").every((h) => !h.collected && h.os === "device"));
  });

  test(`${size}: 10-25% uncollected`, () => {
    const frac = 1 - collected.length / net.hosts.length;
    assert.ok(frac >= 0.1 && frac <= 0.25, String(frac));
    assert.ok(net.hosts.filter((h) => !h.collected).every((h) => h.sockets.length === 0));
  });

  test(`${size}: all formats, locales and header variants among collected hosts`, () => {
    for (const f of ["windows", "linux-netstat", "linux-ss", "macos"]) assert.ok(collected.some((h) => h.format === f), f);
    for (const l of ["en", "sv", "de"]) assert.ok(collected.some((h) => h.locale === l), l);
    assert.ok(collected.some((h) => h.withHeader) && collected.some((h) => !h.withHeader));
  });

  test(`${size}: most connections between collected hosts are seen from both ends, not all`, () => {
    let pairs = 0, mirrored = 0;
    for (const h of collected) {
      for (const r of h.sockets) {
        if (r.proto !== "tcp" || r.state !== "ESTABLISHED" || isLoop(r.remoteIp)) continue;
        const peer = byIp.get(r.remoteIp);
        if (!peer || !peer.collected || peer === h) continue;
        pairs++;
        if (peer.sockets.some((p) => p.proto === "tcp" && p.localIp === r.remoteIp && p.localPort === r.remotePort
          && p.remoteIp === r.localIp && p.remotePort === r.localPort)) mirrored++;
      }
    }
    assert.ok(pairs > 0);
    assert.ok(mirrored / pairs >= 0.85, `${mirrored}/${pairs}`);
    assert.ok(mirrored < pairs, "at least one one-sided connection");
  });

  test(`${size}: risky and safe traffic exists`, () => {
    const all = collected.flatMap((h) => h.sockets);
    const has = (port, proto = "tcp") => all.some((r) => r.proto === proto && r.remotePort === port && r.state !== "LISTEN");
    for (const p of [23, 21, 445, 3389, 80, 22, 443]) assert.ok(has(p), `port ${p}`);
    assert.ok(has(1433) || has(3306), "db");
    assert.ok(has(161, "udp"), "snmp");
  });

  test(`${size}: online services in documentation ranges only, incl. IPv6`, () => {
    const remotes = collected.flatMap((h) => h.sockets.map((r) => r.remoteIp)).filter((ip) => ip !== "*" && !isLoop(ip) && !byIp.has(ip));
    assert.ok(remotes.length > 0);
    for (const ip of remotes) assert.ok(isPublic(ip), ip);
    assert.ok(remotes.some((ip) => ip.includes(":")), "an IPv6 online service");
  });

  test(`${size}: every collected host listens and has loopback traffic`, () => {
    for (const h of collected) {
      assert.ok(h.sockets.some((r) => r.state === "LISTEN"), h.hostname);
      assert.ok(h.sockets.some((r) => isLoop(r.localIp)), h.hostname);
    }
  });

  test(`${size}: client ports are ephemeral for the OS`, () => {
    for (const h of collected) {
      const [lo2, hi2] = h.os === "linux" ? [32768, 60999] : [49152, 65535];
      for (const r of h.sockets) {
        if (r.state === "LISTEN" || r.state === "BOUND" || isLoop(r.localIp) || r.remotePort === null) continue;
        if (r.remotePort <= 9999) assert.ok(r.localPort >= lo2 && r.localPort <= hi2, `${h.hostname} ${r.localPort}`);
      }
    }
  });

  test(`${size}: hostnames unique`, () => {
    const names = net.hosts.map((h) => h.hostname.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  });
}

test("same seed → same network; different seed → different", () => {
  assert.deepEqual(buildNetwork("medium", 1), nets.medium);
  assert.notDeepEqual(buildNetwork("medium", 2), nets.medium);
});
