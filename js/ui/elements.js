// Model → Cytoscape element JSON. Pure (no DOM, no Cytoscape), so it is unit-tested in Node.
// Collapsed groups replace their hosts with one node; edges to them are merged per endpoint pair.

import { osIcon } from "./icons.js";

const RANK = { vulnerable: 3, exploitable: 2, unclassified: 1, safe: 0 };
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);
const MAX_BADGES = 4;

function badgeLine(h) {
  const byPort = new Map();
  for (const l of h.listening) if (!byPort.has(l.port) || RANK[l.risk] > RANK[byPort.get(l.port)]) byPort.set(l.port, l.risk);
  const ports = [...byPort].sort((a, b) => RANK[b[1]] - RANK[a[1]] || a[0] - b[0]).map(([p]) => p);
  if (!ports.length) return { text: "", border: null };
  const shown = ports.slice(0, MAX_BADGES).join(" ");
  const more = ports.length > MAX_BADGES ? ` +${ports.length - MAX_BADGES}` : "";
  return { text: shown + more, border: [...byPort.values()].reduce(worst, "safe") };
}

/**
 * @param {object} model
 * @param {{collapsed: Set<string>, visible: {hosts: Set<string>, edges: Set<string>}|null,
 *   mode: 'fade'|'hide', dns: Record<string, string|null>, labels: boolean,
 *   scope?: {hosts: Set<string>, edges: Set<string>}|null}} opts
 *   scope: the neighbourhood view; anything outside it is not drawn at all (unlike visible/mode)
 * @returns {{nodes: object[], edges: object[]}}
 */
export function toElements(model, { collapsed, visible, mode, dns, labels, scope = null }) {
  const hide = mode === "hide" && visible !== null;
  const inScope = (id) => scope === null || scope.hosts.has(id);
  const hostOn = (id) => visible === null || visible.hosts.has(id);
  const edgeOn = (id) => visible === null || visible.edges.has(id);
  const nodes = [];
  const shownIds = new Set();

  // groups
  for (const g of model.groups.values()) {
    const kind = g.kind === "internet" ? " internet" : "";
    const hostIds = g.hostIds.filter(inScope);
    if (!hostIds.length) continue;
    const anyOn = hostIds.some(hostOn);
    if (hide && !anyOn) continue;
    if (collapsed.has(g.id)) {
      nodes.push({ data: { id: g.id, label: `${g.name}\n${hostIds.length} host${hostIds.length === 1 ? "" : "s"}`, count: hostIds.length, internal: 0, kind: g.kind, groupId: g.id },
        classes: `collapsed group${kind}${anyOn ? "" : " faded"}` });
    } else {
      nodes.push({ data: { id: g.id, label: g.name, kind: g.kind, groupId: g.id }, classes: `group${kind}` });
    }
    shownIds.add(g.id);
  }

  // hosts
  for (const h of model.hosts.values()) {
    if (collapsed.has(h.groupId) || !inScope(h.id)) continue;
    const on = hostOn(h.id);
    if (hide && !on) continue;
    const ip = h.ips[0] ?? "";
    const name = (!h.hostname && dns[ip]) || h.label;
    const badges = badgeLine(h);
    const label = labels ? (badges.text ? `${name}\n${badges.text}` : name) : "";
    nodes.push({
      data: { id: h.id, label, ip, parent: h.groupId, os: h.os, role: h.role, icon: osIcon(h.os), border: badges.border ?? "none" },
      classes: ["host", `os-${h.os}`, `role-${h.role}`, h.collected ? "collected" : "seen-only", on ? "" : "faded"].filter(Boolean).join(" "),
    });
    shownIds.add(h.id);
  }

  // edges
  const endpoint = (hostId) => {
    const g = model.hosts.get(hostId).groupId;
    return collapsed.has(g) ? g : hostId;
  };
  const groupNodes = new Map(nodes.filter((n) => n.classes.includes("collapsed")).map((n) => [n.data.id, n]));
  const merged = new Map();
  const edges = [];
  for (const e of model.edges.values()) {
    if (scope !== null && !scope.edges.has(e.id)) continue;
    const on = edgeOn(e.id);
    if (hide && !on) continue;
    const s = endpoint(e.source), t = endpoint(e.target);
    if (s === t) {
      const g = groupNodes.get(s);
      if (g) g.data.internal++;
      continue;
    }
    if (!shownIds.has(s) || !shownIds.has(t)) continue;
    if (s === e.source && t === e.target) {
      edges.push({ data: { id: e.id, source: s, target: t, risk: e.risk, count: 1, members: [e.id], label: `${e.port}` },
        classes: [`risk-${e.risk}`, e.seen === "one" ? "seen-one" : "", on ? "" : "faded"].filter(Boolean).join(" ") });
      continue;
    }
    const key = `a:${s}|${t}`;
    const m = merged.get(key) ?? { id: key, source: s, target: t, risk: "safe", count: 0, members: [], one: false, on: false };
    m.risk = worst(m.risk, e.risk);
    m.count++;
    m.members.push(e.id);
    m.one ||= e.seen === "one";
    m.on ||= on;
    merged.set(key, m);
  }
  for (const m of merged.values()) {
    edges.push({ data: { id: m.id, source: m.source, target: m.target, risk: m.risk, count: m.count, members: m.members, label: `${m.count}×` },
      classes: [`risk-${m.risk}`, "merged", m.one ? "seen-one" : "", m.on ? "" : "faded"].filter(Boolean).join(" ") });
  }
  return { nodes, edges };
}
