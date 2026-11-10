// User settings: protocol risk table, subnet names, internal ranges, role rules, graph and DNS
// options. Stored in localStorage by the UI; imports are untrusted, so validateSettings rebuilds
// everything field by field and never throws.

import { parseCidr } from "../lib/cidr.js";
import { cleanText } from "../parse/header.js";

export const RISKS = ["vulnerable", "exploitable", "safe", "unclassified"];
export const RESOLVER_IDS = ["cloudflare", "google", "quad9"];

const P = (port, proto, name, risk) => ({ port, proto, name, risk });

const DEFAULT_PROTOCOLS = [
  // vulnerable
  P(21, "tcp", "FTP", "vulnerable"), P(23, "tcp", "Telnet", "vulnerable"), P(69, "udp", "TFTP", "vulnerable"),
  P(512, "tcp", "rexec", "vulnerable"), P(513, "tcp", "rlogin", "vulnerable"), P(514, "tcp", "rsh", "vulnerable"),
  P(161, "udp", "SNMP", "vulnerable"), P(162, "udp", "SNMP trap", "vulnerable"),
  // exploitable / unencrypted
  P(80, "tcp", "HTTP", "exploitable"), P(8080, "tcp", "HTTP-alt", "exploitable"), P(8000, "tcp", "HTTP-alt", "exploitable"),
  P(445, "tcp", "SMB", "exploitable"), P("137-138", "udp", "NetBIOS", "exploitable"), P(139, "tcp", "NetBIOS", "exploitable"),
  P(3389, "any", "RDP", "exploitable"), P(389, "any", "LDAP", "exploitable"), P(88, "any", "Kerberos", "exploitable"),
  P(135, "tcp", "MSRPC", "exploitable"), P(5985, "tcp", "WinRM-HTTP", "exploitable"), P("5900-5903", "tcp", "VNC", "exploitable"),
  P(1433, "tcp", "MSSQL", "exploitable"), P(3306, "tcp", "MySQL", "exploitable"), P(5432, "tcp", "PostgreSQL", "exploitable"),
  P(6379, "tcp", "Redis", "exploitable"), P(5555, "tcp", "ADB", "exploitable"), P(53, "any", "DNS", "exploitable"),
  P(25, "tcp", "SMTP", "exploitable"), P(110, "tcp", "POP3", "exploitable"), P(143, "tcp", "IMAP", "exploitable"),
  // safe
  P(22, "tcp", "SSH", "safe"), P(443, "tcp", "HTTPS", "safe"), P(8443, "tcp", "HTTPS-alt", "safe"),
  P(636, "tcp", "LDAPS", "safe"), P(3269, "tcp", "GC-SSL", "safe"), P(5986, "tcp", "WinRM-HTTPS", "safe"),
  P(993, "tcp", "IMAPS", "safe"), P(995, "tcp", "POP3S", "safe"), P(465, "tcp", "SMTPS", "safe"), P(587, "tcp", "Submission", "safe"),
];

export const DEFAULT_SETTINGS = Object.freeze({
  protocols: DEFAULT_PROTOCOLS,
  subnets: [],
  internalRanges: [],
  roleRules: [
    { tag: "DC", all: [88, 389, 445], any: [] },
    { tag: "DB", all: [], any: [1433, 3306, 5432] },
    { tag: "Web", all: [], any: [80, 443] },
    { tag: "RDP", all: [], any: [3389] },
  ],
  graph: { collapseThreshold: 150, labels: true },
  dns: { enabled: false, resolver: null },
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const isPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;

function portRange(port) {
  if (isPort(port)) return [port, port];
  if (typeof port === "string") {
    const m = /^(\d{1,5})-(\d{1,5})$/.exec(port.trim());
    if (m && isPort(+m[1]) && isPort(+m[2]) && +m[1] <= +m[2]) return [+m[1], +m[2]];
  }
  return null;
}

function validProtocol(p) {
  if (!p || typeof p !== "object") return null;
  const range = portRange(p.port);
  const proto = ["tcp", "udp", "any"].includes(p.proto) ? p.proto : null;
  const name = typeof p.name === "string" ? cleanText(p.name, 32) : "";
  const risk = RISKS.includes(p.risk) ? p.risk : null;
  if (!range || !proto || !name || !risk) return null;
  return { port: range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`, proto, name, risk };
}

const portList = (a) => (Array.isArray(a) ? a.filter(isPort).slice(0, 32) : []);

/**
 * @param {unknown} input
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function validateSettings(input) {
  const d = clone(DEFAULT_SETTINGS);
  if (!input || typeof input !== "object") return d;
  const out = d;
  if (Array.isArray(input.protocols)) {
    const list = input.protocols.slice(0, 2000).map(validProtocol).filter(Boolean);
    out.protocols = input.protocols.length === 0 || list.length ? list : d.protocols;
  }
  if (Array.isArray(input.subnets)) {
    out.subnets = input.subnets.slice(0, 1000).map((s) => {
      const c = s && typeof s.cidr === "string" ? parseCidr(s.cidr) : null;
      if (!c) return null;
      const name = typeof s.name === "string" ? cleanText(s.name, 64) : "";
      return { cidr: `${c.ip}/${c.prefix}`, name };
    }).filter(Boolean);
  }
  if (Array.isArray(input.internalRanges)) {
    out.internalRanges = input.internalRanges.slice(0, 200).map((t) => parseCidr(String(t))).filter(Boolean).map((c) => `${c.ip}/${c.prefix}`);
  }
  if (Array.isArray(input.roleRules)) {
    const rules = input.roleRules.slice(0, 100).map((r) => {
      if (!r || typeof r.tag !== "string") return null;
      const tag = cleanText(r.tag, 24);
      const rule = { tag, all: portList(r.all), any: portList(r.any) };
      return tag && (rule.all.length || rule.any.length) ? rule : null;
    }).filter(Boolean);
    out.roleRules = input.roleRules.length === 0 || rules.length ? rules : d.roleRules;
  }
  if (input.graph && typeof input.graph === "object") {
    const t = input.graph.collapseThreshold;
    if (Number.isInteger(t) && t >= 10 && t <= 100000) out.graph.collapseThreshold = t;
    if (typeof input.graph.labels === "boolean") out.graph.labels = input.graph.labels;
  }
  if (input.dns && typeof input.dns === "object") {
    const resolver = RESOLVER_IDS.includes(input.dns.resolver) ? input.dns.resolver : null;
    out.dns = { enabled: input.dns.enabled === true && resolver !== null, resolver };
  }
  return out;
}

/**
 * @param {number} port
 * @param {'tcp'|'udp'} proto
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {{name: string, risk: string}}
 */
export function classify(port, proto, settings) {
  for (const p of settings.protocols) {
    if (p.proto !== "any" && p.proto !== proto) continue;
    const [lo, hi] = portRange(p.port) ?? [0, -1];
    if (port >= lo && port <= hi) return { name: p.name, risk: p.risk };
  }
  return { name: `${port}/${proto}`, risk: "unclassified" };
}
