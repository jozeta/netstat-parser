// ParsedFile[] → graph model (hosts, subnet / Internet groups, edges). Pure and deterministic;
// rebuilt on every change. IDs are stable so the UI can keep positions and collapse state.

import { parseCidr, inCidr, networkOf, DEFAULT_INTERNAL_RANGES } from "../lib/cidr.js";
import { isLoopback, normalizeIp } from "../lib/ip.js";
import { classify } from "./settings.js";

const LINK_LOCAL = ["169.254.0.0/16", "fe80::/10"].map(parseCidr);
// Docker's default bridge: every Docker host has 172.17.0.1 and its own 172.17.0.x containers
const DOCKER_BRIDGE = parseCidr("172.17.0.0/16");

const shortName = (name) => (normalizeIp(name) ? name : name.split(".")[0]).toLowerCase();
const isLinkLocal = (ip) => LINK_LOCAL.some((c) => inCidr(ip, c));
const isDockerBridge = (ip) => inCidr(ip, DOCKER_BRIDGE);
const usable = (ip) => ip && ip !== "*" && !isLoopback(ip);

/** "Microsoft Windows Server 2022" → windows; falls back to the netstat format. */
function osFrom(detail, format) {
  if (detail) {
    if (/windows/i.test(detail)) return "windows";
    if (/mac ?os|darwin|os x/i.test(detail)) return "macos";
    if (/linux|ubuntu|debian|red hat|rhel|centos|fedora|suse|alma|rocky/i.test(detail)) return "linux";
  }
  if (format === "windows") return "windows";
  if (format === "macos") return "macos";
  if (format === "linux-netstat" || format === "linux-ss") return "linux";
  return "unknown";
}

function newHost(id, { hostname = null, ip = null, collected, internal }) {
  return {
    id, label: hostname ?? ip, hostname, ips: ip ? [ip] : [], internal, collected,
    files: [], os: "unknown", osDetail: null, role: "unknown", tags: [], listening: [], loopback: [],
    groupId: null, warnings: [],
  };
}

/**
 * @param {import('../parse/types.js').ParsedFile[]} files
 * @param {object} settings validated settings
 */
export function buildModel(files, settings) {
  // ranges the user named under Subnets are theirs too, so they count as internal
  const internalRanges = [...DEFAULT_INTERNAL_RANGES, ...[...settings.internalRanges, ...settings.subnets.map((s) => s.cidr)].map(parseCidr).filter(Boolean)];
  const named = settings.subnets.map((s) => ({ cidr: parseCidr(s.cidr), name: s.name })).filter((s) => s.cidr)
    .sort((a, b) => b.cidr.prefix - a.cidr.prefix);
  const isInternal = (ip) => internalRanges.some((c) => inCidr(ip, c));

  /** @type {Map<string, any>} */
  const hosts = new Map();
  const ipOwner = new Map();
  const prefixHint = new Map(); // ip → prefix from a header
  const conflicts = new Map();
  const fileHost = new Map(); // ParsedFile → host id

  // ---- collected hosts ----
  const counted = files.filter((f) => !(f.warnings?.notRecognised && f.records.length === 0));
  // "dc01.corp.local" (header) and "DC01" (file name) are one machine: key on the short name, unless
  // two different FQDNs share it (web01.prod.corp, web01.dev.corp): then each FQDN is its own host
  const fqdns = new Map(); // short name → Set of lower-cased FQDNs
  for (const f of counted) {
    if (normalizeIp(f.hostname) || !f.hostname.includes(".")) continue;
    const short = shortName(f.hostname);
    if (!fqdns.has(short)) fqdns.set(short, new Set());
    fqdns.get(short).add(f.hostname.toLowerCase());
  }
  const hostKey = (name) => {
    const short = shortName(name);
    const qualified = !normalizeIp(name) && name.includes(".");
    return qualified && (fqdns.get(short)?.size ?? 0) > 1 ? name.toLowerCase() : short;
  };
  const useCount = new Map(); // host id → Map(local ip → records using it)
  const headerIps = new Map(); // host id → header addresses
  for (const f of counted) {
    const id = `h:${hostKey(f.hostname)}`;
    let h = hosts.get(id);
    if (!h) { h = newHost(id, { hostname: f.hostname, collected: true, internal: true }); hosts.set(id, h); }
    else if (f.hostname.includes(".") && !h.hostname.includes(".") && !normalizeIp(f.hostname)) { h.hostname = f.hostname; h.label = f.hostname; }
    fileHost.set(f, id);
    h.files.push({ fileName: f.fileName, format: f.format, collected: f.header?.collected ?? null });
    if (!h.osDetail && f.header?.os) h.osDetail = f.header.os;
    if (h.os === "unknown" || f.header?.os) h.os = osFrom(h.osDetail, f.format);
    const own = [];
    const uses = useCount.get(id) ?? new Map();
    useCount.set(id, uses);
    const hdr = headerIps.get(id) ?? [];
    headerIps.set(id, hdr);
    for (const a of f.header?.addresses ?? []) { own.push(a.ip); hdr.push(a.ip); if (a.prefix !== null) prefixHint.set(a.ip, a.prefix); }
    for (const r of f.records) {
      if (!usable(r.localIp)) continue;
      own.push(r.localIp);
      uses.set(r.localIp, (uses.get(r.localIp) ?? 0) + 1);
    }
    for (const ip of own) {
      if (!h.ips.includes(ip)) h.ips.push(ip);
      if (isLinkLocal(ip)) continue;
      const owner = ipOwner.get(ip);
      if (!owner) ipOwner.set(ip, id);
      else if (owner !== id) {
        const c = conflicts.get(ip) ?? { ip, hostIds: [owner] };
        if (!c.hostIds.includes(id)) c.hostIds.push(id);
        conflicts.set(ip, c);
      }
    }
  }
  for (const h of hosts.values()) h.internal = h.ips.length === 0 || h.ips.some(isInternal);

  // primary address (group, first in ips): a header address if any, else the most-used local address;
  // never a Docker bridge address or one that several hosts claim, unless nothing else is left
  const primaryOf = new Map();
  for (const h of hosts.values()) {
    const fit = (ip) => !isLinkLocal(ip) && !isDockerBridge(ip) && !conflicts.has(ip);
    const uses = useCount.get(h.id), hdr = headerIps.get(h.id) ?? [];
    const rank = (ip) => [ip.includes(":") ? 1 : 0, hdr.includes(ip) ? 0 : 1, -(uses?.get(ip) ?? 0), h.ips.indexOf(ip)];
    const cmp = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
    const best = h.ips.filter(fit).sort(cmp)[0];
    if (!best) continue;
    primaryOf.set(h.id, best);
    h.ips = [best, ...h.ips.filter((ip) => ip !== best)];
  }
  // ---- seen-only hosts and loopback ----
  const hostForIp = (ip, observer) => {
    const owner = ipOwner.get(ip);
    if (owner) return owner;
    const id = remoteId(ip, observer);
    if (!hosts.has(id)) {
      const h = newHost(id, { ip, collected: false, internal: isInternal(ip) });
      if (id !== `ip:${ip}`) h.localTo = observer; // a container on that host's bridge, not a shared node
      hosts.set(id, h);
    }
    return id;
  };
  for (const f of files) {
    const hid = fileHost.get(f);
    if (!hid) continue;
    const self = hosts.get(hid);
    for (const r of f.records) {
      if (isLoopback(r.localIp) || isLoopback(r.remoteIp)) { self.loopback.push(r); continue; }
      // its own address (e.g. fe80::1, which ipOwner skips) is not another host
      if (usable(r.remoteIp) && !self.ips.includes(r.remoteIp)) hostForIp(r.remoteIp, hid);
    }
  }

  // ---- groups ----
  const groups = new Map();
  // subnets that headers reported (no wider than /16, or /48 for IPv6, so one host with a wide
  // netmask cannot pull a whole network into one group), most specific first: an address with no
  // prefix of its own joins one of these before falling back to a guessed /24 or /64
  const reported = [...new Set([...prefixHint].filter(([ip, p]) => p >= (ip.includes(":") ? 48 : 16)).map(([ip, p]) => networkOf(ip, p)))]
    .map(parseCidr).sort((a, b) => b.prefix - a.prefix || (a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : 0));
  const guessPrefix = (ip) => reported.find((c) => inCidr(ip, c))?.prefix ?? (ip.includes(":") ? 64 : 24);
  const groupFor = (h) => {
    const primary = primaryOf.get(h.id) ?? h.ips.find((ip) => !isLinkLocal(ip) && !ip.includes(":")) ?? h.ips.find((ip) => !isLinkLocal(ip)) ?? h.ips[0];
    if (!primary) return { id: "g:none", kind: "subnet", cidr: null, name: "No address" };
    if (!isInternal(primary)) return { id: "g:internet", kind: "internet", cidr: null, name: "Internet" };
    const hit = named.find((s) => inCidr(primary, s.cidr));
    if (hit) {
      const cidr = `${hit.cidr.ip}/${hit.cidr.prefix}`;
      return { id: `g:${cidr}`, kind: "subnet", cidr, name: hit.name || cidr };
    }
    const cidr = networkOf(primary, prefixHint.get(primary) ?? guessPrefix(primary));
    return { id: `g:${cidr}`, kind: "subnet", cidr, name: cidr };
  };
  for (const h of hosts.values()) {
    const g = groupFor(h);
    if (!groups.has(g.id)) groups.set(g.id, { ...g, hostIds: [] });
    groups.get(g.id).hostIds.push(h.id);
    h.groupId = g.id;
  }

  for (const c of conflicts.values()) {
    for (const id of c.hostIds) {
      const others = c.hostIds.filter((x) => x !== id).map((x) => hosts.get(x).label).join(", ");
      hosts.get(id).warnings.push(`Address ${c.ip} is also claimed by ${others}`);
    }
  }
  const edges = buildEdges(files, fileHost, hosts, ipOwner, settings);
  assignRolesAndTags(hosts, edges, settings);
  return { hosts, groups, edges, conflicts: [...conflicts.values()] };
}

const LISTENING = new Set(["LISTEN", "BOUND"]);

/** Node id of an address no collected host owns; Docker bridge addresses are per observing host. */
function remoteId(ip, observer) {
  return isDockerBridge(ip) ? `ip:${ip}@${observer}` : `ip:${ip}`;
}

function buildEdges(files, fileHost, hosts, ipOwner, settings) {
  // listening sockets per collected host
  const listens = new Map();
  for (const f of files) {
    const hid = fileHost.get(f);
    if (!hid) continue;
    const h = hosts.get(hid);
    const set = listens.get(hid) ?? new Set();
    listens.set(hid, set);
    for (const r of f.records) {
      if (!LISTENING.has(r.state) || isLoopback(r.localIp) || r.localPort === null) continue;
      const key = `${r.proto}/${r.localPort}`;
      if (h.listening.some((l) => l.proto === r.proto && l.port === r.localPort && l.bindIp === r.localIp)) { set.add(key); continue; }
      set.add(key);
      const { name, risk } = classify(r.localPort, r.proto, settings);
      const entry = { proto: r.proto, port: r.localPort, bindIp: r.localIp };
      if (r.pid !== undefined) entry.pid = r.pid;
      if (r.process !== undefined) entry.process = r.process;
      h.listening.push(Object.assign(entry, { name, risk }));
    }
  }
  const listensOn = (hid, proto, port) => listens.get(hid)?.has(`${proto}/${port}`) ?? false;

  const edges = new Map();
  for (const f of files) {
    const hid = fileHost.get(f);
    if (!hid) continue;
    for (const r of f.records) {
      if (LISTENING.has(r.state) || !usable(r.remoteIp) || isLoopback(r.localIp)) continue;
      if (r.localPort === null || r.remotePort === null) continue;
      const rid = ipOwner.get(r.remoteIp) ?? remoteId(r.remoteIp, hid);
      // own address (e.g. a Docker bridge IP that another host also has) → not an edge
      if (rid === hid || hosts.get(hid).ips.includes(r.remoteIp)) continue;
      const localServes = listensOn(hid, r.proto, r.localPort);
      const remoteServes = listensOn(rid, r.proto, r.remotePort);
      // "known" = we have that host's listening table, so "not listed" means "not listening"
      const localKnown = (listens.get(hid)?.size ?? 0) > 0;
      const remoteKnown = (listens.get(rid)?.size ?? 0) > 0;
      let localIsServer;
      if (localServes !== remoteServes) localIsServer = localServes;
      else if (!localServes && localKnown !== remoteKnown) localIsServer = !localKnown;
      else localIsServer = r.localPort < r.remotePort;
      const [source, target, port] = localIsServer ? [rid, hid, r.localPort] : [hid, rid, r.remotePort];
      const id = `e:${source}|${target}|${r.proto}/${port}`;
      let e = edges.get(id);
      if (!e) {
        const { name, risk } = classify(port, r.proto, settings);
        e = { id, source, target, proto: r.proto, port, name, risk, seen: "one", bothCollected: false, states: [], observations: [] };
        edges.set(id, e);
      }
      const obs = { fileName: f.fileName, hostId: hid, localIp: r.localIp, localPort: r.localPort, remoteIp: r.remoteIp, remotePort: r.remotePort, state: r.state };
      if (r.pid !== undefined) obs.pid = r.pid;
      if (r.process !== undefined) obs.process = r.process;
      e.observations.push(obs);
      if (!e.states.includes(r.state)) e.states.push(r.state);
    }
  }
  for (const e of edges.values()) {
    const seenBy = new Set(e.observations.map((o) => o.hostId));
    // "both": each host's own file shows this service connection (not necessarily the same socket pair:
    // netstat is a snapshot, and ephemeral client ports differ between observations)
    e.seen = seenBy.has(e.source) && seenBy.has(e.target) ? "both" : "one";
    e.bothCollected = hosts.get(e.source).collected && hosts.get(e.target).collected;
    e.states.sort();
  }
  return edges;
}

function assignRolesAndTags(hosts, edges, settings) {
  const inbound = new Map(), outbound = new Map(), served = new Map();
  for (const e of edges.values()) {
    outbound.set(e.source, true);
    inbound.set(e.target, true);
    const s = served.get(e.target) ?? new Set();
    s.add(e.port);
    served.set(e.target, s);
  }
  for (const h of hosts.values()) {
    const i = inbound.has(h.id), o = outbound.has(h.id);
    h.role = i && o ? "both" : i ? "server" : o ? "client" : "unknown";
    const ports = new Set([...(served.get(h.id) ?? []), ...h.listening.map((l) => l.port)]);
    h.tags = settings.roleRules
      .filter((r) => (r.all.length === 0 || r.all.every((p) => ports.has(p))) && (r.any.length === 0 || r.any.some((p) => ports.has(p))))
      .map((r) => r.tag);
  }
}
