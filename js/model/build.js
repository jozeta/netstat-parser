// ParsedFile[] → graph model (hosts, subnet / Internet groups, edges). Pure and deterministic;
// rebuilt on every change. IDs are stable so the UI can keep positions and collapse state.

import { parseCidr, inCidr, networkOf } from "../lib/cidr.js";
import { isLoopback } from "../lib/ip.js";

const INTERNAL_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "fe80::/10", "fc00::/7"].map(parseCidr);
const LINK_LOCAL = ["169.254.0.0/16", "fe80::/10"].map(parseCidr);

const isLinkLocal = (ip) => LINK_LOCAL.some((c) => inCidr(ip, c));
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
  const internalRanges = [...INTERNAL_RANGES, ...settings.internalRanges.map(parseCidr).filter(Boolean)];
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
  for (const f of files) {
    if (f.warnings?.notRecognised && f.records.length === 0) continue;
    const id = `h:${f.hostname.toLowerCase()}`;
    let h = hosts.get(id);
    if (!h) { h = newHost(id, { hostname: f.hostname, collected: true, internal: true }); hosts.set(id, h); }
    fileHost.set(f, id);
    h.files.push({ fileName: f.fileName, format: f.format, collected: f.header?.collected ?? null });
    if (!h.osDetail && f.header?.os) h.osDetail = f.header.os;
    if (h.os === "unknown" || f.header?.os) h.os = osFrom(h.osDetail, f.format);
    const own = [];
    for (const a of f.header?.addresses ?? []) { own.push(a.ip); prefixHint.set(a.ip, a.prefix); }
    for (const r of f.records) if (usable(r.localIp)) own.push(r.localIp);
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

  // ---- seen-only hosts and loopback ----
  const hostForIp = (ip) => {
    const owner = ipOwner.get(ip);
    if (owner) return owner;
    const id = `ip:${ip}`;
    if (!hosts.has(id)) hosts.set(id, newHost(id, { ip, collected: false, internal: isInternal(ip) }));
    return id;
  };
  for (const f of files) {
    const hid = fileHost.get(f);
    if (!hid) continue;
    for (const r of f.records) {
      if (isLoopback(r.localIp) || isLoopback(r.remoteIp)) { hosts.get(hid).loopback.push(r); continue; }
      if (usable(r.remoteIp)) hostForIp(r.remoteIp);
    }
  }

  // ---- groups ----
  const groups = new Map();
  const groupFor = (h) => {
    const primary = h.ips.find((ip) => !isLinkLocal(ip) && !ip.includes(":")) ?? h.ips.find((ip) => !isLinkLocal(ip)) ?? h.ips[0];
    if (!primary) return { id: "g:none", kind: "subnet", cidr: null, name: "No address" };
    if (!isInternal(primary)) return { id: "g:internet", kind: "internet", cidr: null, name: "Internet" };
    const hit = named.find((s) => inCidr(primary, s.cidr));
    if (hit) {
      const cidr = `${hit.cidr.ip}/${hit.cidr.prefix}`;
      return { id: `g:${cidr}`, kind: "subnet", cidr, name: hit.name || cidr };
    }
    const cidr = networkOf(primary, prefixHint.get(primary) ?? (primary.includes(":") ? 64 : 24));
    return { id: `g:${cidr}`, kind: "subnet", cidr, name: cidr };
  };
  for (const h of hosts.values()) {
    const g = groupFor(h);
    if (!groups.has(g.id)) groups.set(g.id, { ...g, hostIds: [] });
    groups.get(g.id).hostIds.push(h.id);
    h.groupId = g.id;
  }

  return { hosts, groups, edges: new Map(), conflicts: [...conflicts.values()] };
}
