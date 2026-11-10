// Builds a synthetic but realistic corporate network and, for every collected host, the exact
// socket records its netstat file must parse to. Deterministic for a given (size, seed).
// Public addresses come only from documentation ranges (RFC 5737 / RFC 3849).

import { createRng } from "./random.js";

const SIZES = { small: [20, 40], medium: [150, 250], large: [300, 400] };

const PUBLIC = {
  web: ["203.0.113.10", "203.0.113.25", "198.51.100.20", "203.0.113.61", "192.0.2.15"],
  http: ["198.51.100.7", "192.0.2.80"],
  mail: ["198.51.100.30"],
  ftp: ["203.0.113.80"],
  cloudSsh: ["192.0.2.44"],
  v6: ["2001:db8:4860::8888", "2001:db8:1f::443"],
  inbound: ["203.0.113.140", "198.51.100.201", "192.0.2.77", "203.0.113.199", "198.51.100.66"],
};

const OS_VERSIONS = {
  winClient: ["Microsoft Windows 11 Pro 10.0.22631", "Microsoft Windows 10 Enterprise 10.0.19045", "Microsoft Windows 11 Enterprise 10.0.26100"],
  winServer: ["Microsoft Windows Server 2022 Standard 10.0.20348", "Microsoft Windows Server 2019 Datacenter 10.0.17763"],
  linux: ["Ubuntu 22.04.4 LTS", "Debian GNU/Linux 12 (bookworm)", "Red Hat Enterprise Linux 9.3 (Plow)", "Ubuntu 24.04.1 LTS"],
  macos: ["macOS 14.6.1 (23G93)", "macOS 15.1 (24B83)", "macOS 13.7 (22H123)"],
};

const BROWSERS = { windows: ["msedge.exe", "chrome.exe", "firefox.exe"], linux: ["firefox", "curl", "python3"], macos: ["Safari", "Google Chrome"] };

/**
 * @param {'small'|'medium'|'large'} size
 * @param {number} seed
 */
export function buildNetwork(size, seed) {
  if (!SIZES[size]) throw new Error(`unknown size ${size}`);
  const rng = createRng(seed * 7919 + Object.keys(SIZES).indexOf(size));
  const [lo, hi] = SIZES[size];
  const total = rng.int(lo, hi);
  const k = { small: 1, medium: 2, large: 3 }[size];

  // ---- subnets and address allocation ----
  const subnets = [
    { cidr: "10.10.0.0/24", name: "Network devices", next: 2 },
    { cidr: "10.10.1.0/24", name: "Servers", next: 10 },
    { cidr: "172.16.5.0/24", name: "DMZ", next: 10 },
    { cidr: "192.168.50.0/24", name: "Dev / Mac", next: 20 },
  ];
  const byName = (n) => subnets.find((s) => s.name === n);
  let clientVlan = null;
  const clientSubnet = () => {
    if (!clientVlan || clientVlan.next >= 70) {
      const i = subnets.filter((s) => s.name.startsWith("Clients")).length;
      clientVlan = { cidr: `10.10.${10 + i}.0/24`, name: `Clients ${i + 1}`, next: 10 };
      subnets.push(clientVlan);
    }
    return clientVlan;
  };
  const allocIp = (subnet) => `${subnet.cidr.split(".").slice(0, 3).join(".")}.${subnet.next++}`;

  // ---- hosts ----
  const hosts = [];
  const counters = {};
  const nameFor = (prefix, width) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}${String(counters[prefix]).padStart(width, "0")}`;
  };
  const add = (role, os, subnet, prefix, width, extra = {}) => {
    const ip = allocIp(subnet);
    const h = {
      hostname: nameFor(prefix, width), os,
      osVersion: os === "device" ? null : rng.pick(os === "windows" ? (role === "client" ? OS_VERSIONS.winClient : OS_VERSIONS.winServer) : OS_VERSIONS[os]),
      format: null, locale: null, withHeader: false, collected: os !== "device", role,
      addresses: [{ ip, prefix: 24 }], sockets: [], ...extra,
    };
    hosts.push(h);
    return h;
  };

  const servers = byName("Servers"), dmz = byName("DMZ"), dev = byName("Dev / Mac"), devNet = byName("Network devices");
  const dcs = Array.from({ length: k }, () => add("dc", "windows", servers, "DC", 2));
  const files = Array.from({ length: Math.min(k, 2) }, () => add("file", "windows", servers, "FS", 2));
  const dbKinds = ["mssql", "postgres", "mysql"];
  const dbs = Array.from({ length: k }, (_, i) => add("db", i === 0 ? "windows" : "linux", servers, "DB", 2, { dbKind: dbKinds[i] }));
  const webs = Array.from({ length: k }, () => add("web", "linux", dmz, "WEB", 2));
  const jump = add("jump", "windows", servers, "JUMP", 2);
  const mon = add("monitor", "linux", servers, "MON", 2);
  const apps = Array.from({ length: { small: 0, medium: 2, large: 4 }[size] }, () => add("app", "linux", servers, "APP", 2));
  const deviceCount = Math.max(2, Math.round(total * 0.05));
  const devices = Array.from({ length: deviceCount }, (_, i) =>
    add("device", "device", devNet, i % 2 === 0 ? "SW-" : "PRN-", 2, { deviceKind: i % 2 === 0 ? "switch" : "printer" }));

  const clientTotal = total - hosts.length;
  const macCount = Math.max(2, Math.round(clientTotal * 0.18));
  const linuxCount = Math.max(1, Math.round(clientTotal * 0.1));
  const macs = Array.from({ length: macCount }, () => add("client", "macos", dev, "MAC-", 3));
  macs.forEach((m, i) => m.addresses.push({ ip: `fd10:50::${(0x20 + i).toString(16)}`, prefix: 64 }));
  const linuxClients = Array.from({ length: linuxCount }, () => add("client", "linux", dev, "LNX-", 3));
  const winClients = Array.from({ length: clientTotal - macCount - linuxCount }, () => add("client", "windows", clientSubnet(), "WS-", 4));

  // ---- who was collected ----
  const forced = new Set([dcs[0], files[0], dbs[0], webs[0], jump, mon, macs[0], linuxClients[0], winClients[0]]);
  for (const h of hosts) {
    if (h.os === "device" || forced.has(h)) continue;
    h.collected = !rng.chance(h.role === "client" ? 0.14 : 0.08);
  }
  const flippable = [...winClients, ...macs, ...linuxClients].filter((h) => !forced.has(h));
  const frac = () => hosts.filter((h) => !h.collected).length / hosts.length;
  for (const h of flippable) { if (frac() >= 0.12) break; h.collected = false; }
  for (const h of flippable) { if (frac() <= 0.22) break; h.collected = true; }

  // ---- formats ----
  const collected = hosts.filter((h) => h.collected);
  collected.filter((h) => h.os === "windows").forEach((h, i) => {
    h.format = "windows";
    h.locale = i < 3 ? ["en", "sv", "de"][i] : (rng.chance(0.6) ? "en" : rng.chance(0.6) ? "sv" : "de");
  });
  collected.filter((h) => h.os === "linux").forEach((h, i) => {
    h.format = i < 2 ? ["linux-netstat", "linux-ss"][i] : rng.pick(["linux-netstat", "linux-ss"]);
  });
  collected.filter((h) => h.os === "macos").forEach((h) => { h.format = "macos"; });
  collected.forEach((h, i) => { h.withHeader = i === 0 ? false : i === 1 ? true : rng.chance(0.75); });

  // ---- sockets ----
  const used = new Map(hosts.map((h) => [h, new Set()]));
  const pids = new Map(hosts.map((h) => [h, new Map()]));
  const root = new Map(hosts.map((h) => [h, h.os === "linux" && rng.chance(0.7)]));
  const ipOf = (h, family = 4) => h.addresses.find((a) => (family === 6) === a.ip.includes(":")).ip;
  const eph = (h) => {
    const [a, b] = h.os === "linux" ? [32768, 60999] : [49152, 65535];
    let p;
    do p = rng.int(a, b); while (used.get(h).has(p));
    used.get(h).add(p);
    return p;
  };
  const pidFor = (h, name) => {
    const m = pids.get(h);
    if (name === "System") return 4;
    if (!m.has(name)) m.set(name, rng.int(300, 9800));
    return m.get(name);
  };
  const push = (h, rec, proc) => {
    if (!h.collected) return;
    if (h.os === "windows") rec.pid = rec.state === "TIME_WAIT" ? 0 : pidFor(h, proc);
    else if (h.os === "linux" && root.get(h)) { rec.pid = pidFor(h, proc); rec.process = proc; }
    h.sockets.push(rec);
  };
  const listen = (h, port, proto, proc, { v6 = true, bindIp = "*" } = {}) => {
    const remotePort = null; // a wildcard remote has no port (Windows prints it as :0)
    const state = proto === "tcp" ? "LISTEN" : "BOUND";
    push(h, { proto, family: 4, localIp: bindIp, localPort: port, remoteIp: "*", remotePort, state }, proc);
    if (v6 && bindIp === "*") push(h, { proto, family: 6, localIp: "*", localPort: port, remoteIp: "*", remotePort, state }, proc);
  };
  let unmirroredForced = false;
  const connect = (client, server, serverIpArg, port, { proto = "tcp", family = 4, proc, allowTimeWait = true } = {}) => {
    const serverIp = server ? ipOf(server, family) : serverIpArg;
    const clientIp = ipOf(client, family);
    const cport = eph(client);
    const state = proto === "tcp" && allowTimeWait && rng.chance(0.08) ? "TIME_WAIT" : "ESTABLISHED";
    push(client, { proto, family, localIp: clientIp, localPort: cport, remoteIp: serverIp, remotePort: port, state }, proc ?? rng.pick(BROWSERS[client.os]));
    if (!server || !server.collected || proto !== "tcp" || state !== "ESTABLISHED") return;
    let mirror = rng.chance(0.93);
    if (client.collected && !unmirroredForced) { mirror = false; unmirroredForced = true; }
    if (mirror) push(server, { proto, family, localIp: serverIp, localPort: port, remoteIp: clientIp, remotePort: cport, state }, serviceProc(server, port));
  };
  const inbound = (server, clientIp, port) => {
    push(server, { proto: "tcp", family: 4, localIp: ipOf(server), localPort: port, remoteIp: clientIp, remotePort: rng.int(49152, 65535), state: "ESTABLISHED" }, serviceProc(server, port));
  };
  const dbPort = (db) => ({ mssql: 1433, postgres: 5432, mysql: 3306 })[db.dbKind];

  // services (listening) per role
  const WIN_SVC = { 53: "dns.exe", 88: "lsass.exe", 135: "svchost.exe", 139: "System", 389: "lsass.exe", 445: "System", 464: "lsass.exe",
    636: "lsass.exe", 3268: "lsass.exe", 3269: "lsass.exe", 3389: "svchost.exe", 1433: "sqlservr.exe", 21: "FileZilla Server.exe",
    123: "svchost.exe", 137: "System", 500: "svchost.exe", 5353: "svchost.exe", 5040: "svchost.exe", 7680: "svchost.exe" };
  const LNX_SVC = { 22: "sshd", 80: "nginx", 443: "nginx", 8080: "java", 5432: "postgres", 3306: "mysqld", 9100: "node_exporter",
    3000: "grafana", 53: "systemd-resolve", 68: "dhclient", 631: "cupsd", 5353: "avahi-daemon" };
  function serviceProc(h, port) {
    return (h.os === "windows" ? WIN_SVC[port] : LNX_SVC[port]) ?? (h.os === "windows" ? "svchost.exe" : "daemon");
  }
  const listenAll = (h, tcp, udp = []) => {
    for (const p of tcp) listen(h, p, "tcp", serviceProc(h, p));
    for (const p of udp) listen(h, p, "udp", serviceProc(h, p));
  };
  const loopback = (h) => {
    if (h.os === "windows") {
      const a = eph(h), b = eph(h);
      push(h, { proto: "tcp", family: 4, localIp: "127.0.0.1", localPort: a, remoteIp: "127.0.0.1", remotePort: b, state: "ESTABLISHED" }, "svchost.exe");
      push(h, { proto: "tcp", family: 4, localIp: "127.0.0.1", localPort: b, remoteIp: "127.0.0.1", remotePort: a, state: "ESTABLISHED" }, "svchost.exe");
    } else if (h.os === "linux") {
      listen(h, 53, "tcp", "systemd-resolve", { bindIp: "127.0.0.53" });
      listen(h, 53, "udp", "systemd-resolve", { bindIp: "127.0.0.53" });
    } else {
      listen(h, 631, "tcp", "cupsd", { bindIp: "127.0.0.1" });
    }
  };

  for (const h of dcs) listenAll(h, [53, 88, 135, 389, 445, 464, 636, 3268, 3269, 3389], [53, 88, 123, 389]);
  for (const h of files) listenAll(h, [21, 135, 445, 3389], [123]);
  for (const h of dbs) listenAll(h, h.os === "windows" ? [135, 445, 1433, 3389] : [22, dbPort(h), 9100], h.os === "windows" ? [123] : [68]);
  for (const h of webs) listenAll(h, [22, 80, 443, 8080, 9100], [68]);
  listenAll(jump, [135, 445, 3389], [123]);
  listenAll(mon, [22, 3000, 9100], [68]);
  for (const h of apps) listenAll(h, [22, 8080, 9100], [68]);
  for (const h of winClients) {
    listenAll(h, [135, 445, 5040, 7680], [123, 500, 5353]);
    listen(h, 139, "tcp", "System", { bindIp: ipOf(h) });
    listen(h, 137, "udp", "System", { bindIp: ipOf(h) });
  }
  for (const h of macs) listenAll(h, rng.chance(0.3) ? [22] : [5000], [5353]);
  for (const h of linuxClients) listenAll(h, [22], [68, 5353]);
  for (const h of hosts) if (h.collected) loopback(h);

  // ---- traffic ----
  const linuxServers = [...dbs.filter((d) => d.os === "linux"), ...webs, mon, ...apps];
  const winServers = [...dcs, ...files, ...dbs.filter((d) => d.os === "windows")];
  const switches = devices.filter((d) => d.deviceKind === "switch");

  winClients.forEach((c, i) => {
    const dc = rng.pick(dcs), fs = rng.pick(files);
    connect(c, dc, null, 445, { proc: "System" });
    connect(c, dc, null, 389, { proc: "lsass.exe" });
    if (rng.chance(0.5)) connect(c, dc, null, 88, { proc: "lsass.exe" });
    if (rng.chance(0.3)) connect(c, dc, null, 135, { proc: "svchost.exe" });
    connect(c, fs, null, 445, { proc: "System" });
    if (rng.chance(0.08)) connect(c, fs, null, 21, { proc: "explorer.exe" });
    for (let n = rng.int(1, 4); n > 0; n--) connect(c, null, rng.pick(PUBLIC.web), 443);
    if (i === 0 || rng.chance(0.3)) connect(c, null, rng.pick(PUBLIC.http), 80, { allowTimeWait: false });
    if (rng.chance(0.2)) connect(c, null, PUBLIC.mail[0], 587, { proc: "OUTLOOK.EXE" });
    if (rng.chance(0.25)) connect(c, rng.pick(webs), null, 443);
    if (rng.chance(0.1)) connect(c, rng.pick(webs), null, 8080);
    if (rng.chance(0.08)) connect(c, dbs[0], null, dbPort(dbs[0]), { proc: "excel.exe" });
    if (i < 2) connect(c, jump, null, 3389, { proc: "mstsc.exe" });
  });
  macs.forEach((c, i) => {
    for (let n = rng.int(1, 3); n > 0; n--) connect(c, null, rng.pick(PUBLIC.web), 443);
    if (i === 0 || rng.chance(0.5)) connect(c, null, rng.pick(PUBLIC.v6), 443, { family: 6 });
    if (rng.chance(0.4)) connect(c, rng.pick(linuxServers), null, 22, { proc: "ssh" });
    if (rng.chance(0.3)) connect(c, rng.pick(files), null, 445, { proc: "smbd" });
    if (rng.chance(0.2)) connect(c, rng.pick(webs), null, 80);
    if (rng.chance(0.3)) connect(c, rng.pick(dcs), null, 53, { proto: "udp", proc: "mDNSResponder" });
  });
  for (const c of linuxClients) {
    connect(c, rng.pick(linuxServers), null, 22, { proc: "ssh" });
    const ldb = dbs.find((d) => d.os === "linux");
    if (ldb && rng.chance(0.4)) connect(c, ldb, null, dbPort(ldb), { proc: "psql" });
    connect(c, null, rng.pick(PUBLIC.web), 443);
    if (rng.chance(0.3)) connect(c, null, PUBLIC.cloudSsh[0], 22, { proc: "ssh" });
  }
  for (const w of webs) {
    const db = rng.pick(dbs);
    connect(w, db, null, dbPort(db), { proc: "java", allowTimeWait: false });
    for (const ip of PUBLIC.inbound.slice(0, rng.int(2, 4))) inbound(w, ip, 443);
    if (rng.chance(0.5)) connect(w, null, rng.pick(PUBLIC.web), 443, { proc: "curl" });
  }
  for (const s of winServers.slice(0, 4)) connect(jump, s, null, 3389, { proc: "mstsc.exe", allowTimeWait: false });
  for (const s of linuxServers.slice(0, 3)) connect(jump, s, null, 22, { proc: "putty.exe", allowTimeWait: false });
  for (const sw of switches) connect(jump, sw, null, 23, { proc: "putty.exe", allowTimeWait: false });
  for (const s of linuxServers) if (s !== mon) connect(mon, s, null, 9100, { proc: "prometheus", allowTimeWait: false });
  for (const d of devices) connect(mon, d, null, 161, { proto: "udp", proc: "snmpd" });
  connect(mon, null, rng.pick(PUBLIC.web), 443, { proc: "curl" });
  for (let i = 0; i + 1 < dcs.length; i++) {
    connect(dcs[i], dcs[i + 1], null, 389, { proc: "lsass.exe", allowTimeWait: false });
    connect(dcs[i], dcs[i + 1], null, 135, { proc: "svchost.exe", allowTimeWait: false });
  }
  connect(files[0], null, PUBLIC.ftp[0], 21, { proc: "ftp.exe", allowTimeWait: false });
  for (const a of apps) {
    const db = rng.pick(dbs);
    connect(a, db, null, dbPort(db), { proc: "java" });
  }

  for (const h of hosts) { delete h.dbKind; delete h.deviceKind; }
  return { size, seed, subnets: subnets.map(({ cidr, name }) => ({ cidr, name })), hosts };
}
