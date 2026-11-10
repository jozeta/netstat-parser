// Details panel content. Everything untrusted is rendered with textContent via el().
import { el } from "./dom.js";

const RISK_TEXT = {
  vulnerable: "Vulnerable: plaintext or known-weak protocol",
  exploitable: "Exploitable / unencrypted: commonly abused or sends data in clear",
  safe: "Safe: encrypted protocol",
  unclassified: "Unclassified: not in the protocol table (Settings)",
};
const ROLE_TEXT = { server: "Server (accepts connections)", client: "Client (only outgoing)", both: "Client and server", unknown: "No connections" };
const OS_TEXT = { windows: "Windows", linux: "Linux", macos: "macOS", unknown: "Unknown" };

const kv = (pairs) => el("dl", { class: "np-kv" }, pairs.filter(([, v]) => v !== null && v !== undefined && v !== "")
  .flatMap(([k, v]) => [el("dt", null, k), el("dd", null, v)]));
const title = (t) => el("h3", { class: "np-section-title" }, t);
const portName = (port, proto, name) => (name === `${port}/${proto}` ? name : `${port}/${proto} ${name}`);
const badge = (text, risk, tip) => el("span", { class: `np-badge np-${risk}`, title: tip ?? null }, text);

function hostButton(model, id, onPick, sub) {
  const h = model.hosts.get(id);
  return el("li", null, el("button", { class: "lg-btn lg-btn-ghost", type: "button", onclick: () => onPick(id) },
    el("span", null, h.label), el("span", { class: "np-sub" }, sub ?? (h.ips[0] ?? ""))));
}

/** @param {{model, host, dns, onPick, conflicts}} ctx */
export function hostDetails({ model, host: h, dns, onPick }) {
  const g = model.groups.get(h.groupId);
  const edges = [...model.edges.values()].filter((e) => e.source === h.id || e.target === h.id);
  const conflicts = model.conflicts.filter((c) => c.hostIds.includes(h.id));
  const name = h.ips.map((ip) => dns[ip]).find(Boolean);
  return [
    el("h2", { class: "lg-subtitle" }, h.label),
    el("p", null, h.collected ? el("span", { class: "lg-chip lg-ok" }, "Collected") : el("span", { class: "lg-chip lg-warn" }, "No file: seen in other hosts' files"),
      " ", ...h.tags.map((t) => el("span", { class: "lg-chip" }, t))),
    kv([["IP addresses", h.ips.join(", ") || "—"], ["DNS name", name ?? null], ["OS", OS_TEXT[h.os] ?? h.os], ["OS detail", h.osDetail],
      ["Role", ROLE_TEXT[h.role]], ["Subnet", g ? `${g.name}${g.cidr && g.cidr !== g.name ? ` (${g.cidr})` : ""}` : null]]),
    conflicts.length ? el("p", { class: "np-warning" }, `Address conflict: ${conflicts.map((c) => `${c.ip} is also claimed by ${c.hostIds.filter((x) => x !== h.id).map((x) => model.hosts.get(x)?.label ?? x).join(", ")}`).join("; ")}`) : null,
    title(`Listening (${h.listening.length})`),
    h.listening.length
      ? el("div", { class: "np-badges" }, h.listening.slice().sort((a, b) => a.port - b.port).map((l) =>
        badge(portName(l.port, l.proto, l.name), l.risk, `${RISK_TEXT[l.risk]}. Bound to ${l.bindIp}${l.process ? `, ${l.process}` : ""}${l.pid !== undefined ? ` (pid ${l.pid})` : ""}`)))
      : el("p", { class: "lg-muted lg-small" }, h.collected ? "No listening sockets in the file." : "Unknown: no file for this host."),
    title(`Connections (${edges.length})`),
    el("ul", { class: "np-list" }, edges.slice(0, 200).map((e) => {
      const other = e.source === h.id ? e.target : e.source;
      const dir = e.source === h.id ? "→" : "←";
      return el("li", null, el("button", { class: "lg-btn lg-btn-ghost", type: "button", onclick: () => onPick(e.id) },
        el("span", null, `${dir} ${model.hosts.get(other).label}`), badge(portName(e.port, e.proto, e.name), e.risk)));
    })),
    edges.length > 200 ? el("p", { class: "lg-muted lg-small" }, `…and ${edges.length - 200} more (use search to narrow down).`) : null,
    h.files.length ? title("Files") : null,
    h.files.length ? el("ul", { class: "np-list lg-small" }, h.files.map((f) => el("li", null, `${f.fileName} · ${f.format ?? "unknown format"}${f.collected ? ` · ${f.collected}` : ""}`))) : null,
    h.loopback.length ? el("p", { class: "lg-muted lg-small" }, `${h.loopback.length} loopback sockets (not drawn).`) : null,
  ];
}

export function groupDetails({ model, group: g, collapsed, onToggle, onPick }) {
  const hosts = g.hostIds.map((id) => model.hosts.get(id));
  const degree = new Map();
  for (const e of model.edges.values()) for (const id of [e.source, e.target]) if (g.hostIds.includes(id)) degree.set(id, (degree.get(id) ?? 0) + 1);
  const top = [...degree].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return [
    el("h2", { class: "lg-subtitle" }, g.name),
    kv([["Range", g.cidr ?? (g.kind === "internet" ? "Public addresses" : "—")], ["Hosts", String(hosts.length)],
      ["Collected", String(hosts.filter((h) => h.collected).length)], ["Without file", String(hosts.filter((h) => !h.collected).length)]]),
    el("button", { class: "lg-btn", type: "button", onclick: () => onToggle(g.id) }, collapsed ? "Expand group" : "Collapse group"),
    title("Top talkers"),
    el("ul", { class: "np-list" }, top.map(([id, n]) => hostButton(model, id, onPick, `${n} connections`))),
  ];
}

export function edgeDetails({ model, edge: e, onPick }) {
  const s = model.hosts.get(e.source), t = model.hosts.get(e.target);
  return [
    el("h2", { class: "lg-subtitle" }, portName(e.port, e.proto, e.name)),
    el("p", null, badge(e.risk, e.risk, RISK_TEXT[e.risk]), " ",
      el("span", { class: `lg-chip ${e.seen === "both" ? "lg-ok" : "lg-warn"}` }, e.seen === "both" ? "Seen from both ends" : "Seen from one end")),
    el("p", { class: "lg-small lg-muted" }, RISK_TEXT[e.risk]),
    e.seen === "one" && e.bothCollected ? el("p", { class: "np-warning lg-small" }, "Both hosts were collected, but only one file shows this connection (netstat is a snapshot).") : null,
    kv([["Client", s.label], ["Server", t.label], ["States", e.states.join(", ")]]),
    el("div", { class: "lg-row" }, el("button", { class: "lg-btn", type: "button", onclick: () => onPick(s.id) }, `Show ${s.label}`),
      el("button", { class: "lg-btn", type: "button", onclick: () => onPick(t.id) }, `Show ${t.label}`)),
    title(`Observations (${e.observations.length})`),
    el("div", { class: "np-table-scroll" }, el("table", { class: "lg-table lg-small" },
      el("thead", null, el("tr", null, ["File", "Local", "Remote", "State", "Process"].map((c) => el("th", { scope: "col" }, c)))),
      el("tbody", null, e.observations.slice(0, 300).map((o) => el("tr", null,
        el("td", null, o.fileName), el("td", null, `${o.localIp}:${o.localPort}`), el("td", null, `${o.remoteIp}:${o.remotePort}`),
        el("td", null, o.state), el("td", null, [o.process, o.pid !== undefined ? `pid ${o.pid}` : null].filter(Boolean).join(" ") || "—")))))),
  ];
}

export function mergedDetails({ model, ids, label, onPick }) {
  const edges = ids.map((id) => model.edges.get(id)).filter(Boolean);
  return [
    el("h2", { class: "lg-subtitle" }, label),
    el("p", { class: "lg-muted" }, `${edges.length} connections merged because a group is collapsed.`),
    el("ul", { class: "np-list" }, edges.slice(0, 300).map((e) => el("li", null, el("button", { class: "lg-btn lg-btn-ghost", type: "button", onclick: () => onPick(e.id) },
      el("span", null, `${model.hosts.get(e.source).label} → ${model.hosts.get(e.target).label}`), badge(portName(e.port, e.proto, e.name), e.risk))))),
  ];
}

export function hostsList({ model, visible, onPick }) {
  const hosts = [...model.hosts.values()].filter((h) => !visible || visible.hosts.has(h.id)).sort((a, b) => Number(b.collected) - Number(a.collected) || a.label.localeCompare(b.label));
  return [
    el("p", { class: "lg-muted lg-small" }, `${hosts.length} hosts${visible ? " matching the search" : ""}.`),
    el("ul", { class: "np-list" }, hosts.slice(0, 1500).map((h) => hostButton(model, h.id, onPick, `${h.ips[0] ?? ""}${h.collected ? "" : " · no file"}`))),
  ];
}

export function filesList({ files, onRemove }) {
  if (!files.length) return [el("p", { class: "lg-muted" }, "No files loaded.")];
  return [el("ul", { class: "np-list" }, files.map((f) => {
    const w = f.warnings;
    const notes = [
      f.format ? `${f.format}, ${f.records.length} sockets` : "not recognised as netstat output",
      w.tooLarge ? "too large (over 50 MB)" : null,
      w.unparsedCount ? `${w.unparsedCount} lines not understood` : null,
      w.unknownStates.length ? `unknown states: ${w.unknownStates.join(", ")}` : null,
      w.truncatedAddresses ? `${w.truncatedAddresses} IPv6 addresses truncated by netstat (Linux: re-run with -W; macOS shortens scoped link-local addresses even with -W)` : null,
    ].filter(Boolean);
    return el("li", { class: "lg-row" },
      el("div", { class: "np-grow" }, el("strong", null, f.fileName), el("div", { class: `lg-small ${w.notRecognised || w.unparsedCount ? "np-warning" : "lg-muted"}` }, `${f.hostname} · ${notes.join(" · ")}`),
        w.unparsedSamples.length ? el("pre", { class: "lg-code lg-small np-sample" }, w.unparsedSamples.map((u) => `${u.lineNo}: ${u.line}`).join("\n")) : null),
      el("button", { class: "lg-btn lg-btn-ghost", type: "button", onclick: () => onRemove(f.fileName), "aria-label": `Remove ${f.fileName}` }, "Remove"));
  }))];
}
