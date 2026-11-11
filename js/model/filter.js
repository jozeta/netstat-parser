// Search and filter: "port:445 subnet:\"Office VLAN\" risk:red -os:linux process:sshd dc01".
// Hosts match on their own attributes and their incident edges (free text included); edges match on their own
// attributes and either endpoint's host attributes. Bad input never throws; it matches nothing.

const FIELDS = new Set(["ip", "host", "port", "proto", "risk", "os", "subnet", "state", "role", "tag", "collected", "seen", "process"]);
const RISK_ALIASES = {
  red: "vulnerable", vulnerable: "vulnerable", orange: "exploitable", yellow: "exploitable", exploitable: "exploitable",
  unencrypted: "exploitable", safe: "safe", green: "safe", none: "unclassified", unclassified: "unclassified", unknown: "unclassified",
};
const YES = new Set(["yes", "true", "1", "y"]);
const NO = new Set(["no", "false", "0", "n"]);

/**
 * @param {string} text
 * @returns {{field: string|null, value: string, negate: boolean}[]}
 */
export function parseQuery(text) {
  const terms = [];
  const re = /(-?)(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/gi;
  const s = String(text ?? "").slice(0, 1000);
  let m;
  while ((m = re.exec(s))) {
    if (m[0] === "") { re.lastIndex++; continue; }
    const field = m[2]?.toLowerCase();
    const value = m[3] ?? m[4] ?? "";
    if (field && FIELDS.has(field)) terms.push({ field, value, negate: m[1] === "-" });
    else terms.push({ field: null, value: field ? `${m[2]}:${value}` : value, negate: m[1] === "-" });
  }
  return terms;
}

const lc = (s) => String(s ?? "").toLowerCase();
const has = (hay, needle) => lc(hay).includes(needle);

function hostAttr(h, model, field, v) {
  const g = model.groups.get(h.groupId);
  switch (field) {
    case "ip": {
      // exact, or a prefix when it ends in '.', ':' or '*'
      const prefix = v.endsWith("*") ? v.slice(0, -1) : /[.:]$/.test(v) ? v : null;
      return h.ips.some((ip) => (prefix !== null ? ip.startsWith(prefix) : ip === v));
    }
    case "host": return has(h.label, v) || has(h.hostname, v);
    case "os": return h.os === v || has(h.osDetail, v);
    case "subnet": return has(g?.name, v) || has(g?.cidr, v);
    case "role": return h.role === v;
    case "tag": return h.tags.some((t) => lc(t) === v);
    case "collected": return YES.has(v) ? h.collected : NO.has(v) ? !h.collected : false;
    case null: return has(h.label, v) || h.ips.some((ip) => ip.includes(v)) || has(h.osDetail, v)
      || h.tags.some((t) => has(t, v)) || has(g?.name, v);
    default: return undefined; // not a host attribute
  }
}

function edgeAttr(e, field, v) {
  switch (field) {
    case "port": return /^\d{1,5}$/.test(v) && e.port === Number(v);
    case "proto": return e.proto === v || lc(e.name) === v;
    case "risk": return RISK_ALIASES[v] !== undefined && e.risk === RISK_ALIASES[v];
    case "state": return e.states.some((s) => lc(s) === v.replace(/-/g, "_"));
    case "seen": return e.seen === v;
    case "process": return e.observations.some((o) => has(o.process, v));
    default: return undefined;
  }
}

function listenAttr(l, field, v) {
  switch (field) {
    case "port": return /^\d{1,5}$/.test(v) && l.port === Number(v);
    case "proto": return l.proto === v || lc(l.name) === v;
    case "risk": return RISK_ALIASES[v] !== undefined && l.risk === RISK_ALIASES[v];
    case "state": return v === "listen" || v === "bound";
    case "process": return has(l.process, v);
    default: return false;
  }
}

/**
 * @param {object} model from buildModel
 * @param {ReturnType<typeof parseQuery>} terms
 * @returns {{hosts: Set<string>, edges: Set<string>}}
 */
export function applyFilter(model, terms) {
  if (!terms.length) return { hosts: new Set(model.hosts.keys()), edges: new Set(model.edges.keys()) };
  const incident = new Map();
  for (const e of model.edges.values()) {
    for (const id of [e.source, e.target]) {
      if (!incident.has(id)) incident.set(id, []);
      incident.get(id).push(e);
    }
  }
  const norm = terms.map((t) => ({ ...t, value: lc(t.value).trim() }));

  // a process belongs to the host whose file shows it, never to the peer at the other end
  const runs = (h, v) => h.listening.some((l) => has(l.process, v))
    || (incident.get(h.id) ?? []).some((e) => e.observations.some((o) => o.hostId === h.id && has(o.process, v)));
  const hostMatches = (h, t) => {
    if (!t.value) return false;
    if (t.field === "process") return runs(h, t.value);
    if (t.field === null && runs(h, t.value)) return true;
    const direct = hostAttr(h, model, t.field, t.value);
    if (t.field === null) {
      // free text also finds a host through its connections and listening ports ("445", "smb");
      // processes are covered by runs() above, so a peer's process does not count
      return direct || (incident.get(h.id) ?? []).some((e) => has(e.name, t.value) || String(e.port) === t.value)
        || h.listening.some((l) => has(l.name, t.value) || String(l.port) === t.value);
    }
    if (direct !== undefined) return direct;
    return (incident.get(h.id) ?? []).some((e) => edgeAttr(e, t.field, t.value)) || h.listening.some((l) => listenAttr(l, t.field, t.value));
  };
  const edgeMatches = (e, t) => {
    if (!t.value) return false;
    const own = edgeAttr(e, t.field, t.value);
    if (own !== undefined) return own;
    const ends = [model.hosts.get(e.source), model.hosts.get(e.target)];
    const viaHost = ends.some((h) => hostAttr(h, model, t.field, t.value));
    return t.field === null ? viaHost || has(e.name, t.value) || String(e.port) === t.value || edgeAttr(e, "process", t.value) : viaHost;
  };

  const hosts = new Set(), edges = new Set();
  for (const h of model.hosts.values()) if (norm.every((t) => hostMatches(h, t) !== t.negate)) hosts.add(h.id);
  for (const e of model.edges.values()) if (norm.every((t) => edgeMatches(e, t) !== t.negate)) edges.add(e.id);
  return { hosts, edges };
}
