// CSV and collector-targets exports. Cells are escaped against CSV/formula injection.

import { parseCidr, inCidr } from "../lib/cidr.js";

const FORMULA = /^[=+\-@\t\r]/;
const LINK_LOCAL = ["fe80::/10", "169.254.0.0/16"].map(parseCidr);

/** @param {unknown} v */
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  // ';' too: Swedish (and other) Excel locales use it as the list separator
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (cells) => cells.map(csvCell).join(",");
const firstIp = (h) => h.ips[0] ?? "";

/** @param {object} model */
export function connectionsCsv(model) {
  const lines = [row(["source_host", "source_ip", "destination_host", "destination_ip", "port", "proto", "protocol", "risk", "states", "seen", "source_files"])];
  for (const e of model.edges.values()) {
    const s = model.hosts.get(e.source), t = model.hosts.get(e.target);
    const files = [...new Set(e.observations.map((o) => o.fileName))].join(" ");
    lines.push(row([s.label, firstIp(s), t.label, firstIp(t), e.port, e.proto, e.name, e.risk, e.states.join(" "), e.seen, files]));
  }
  return lines.join("\n") + "\n";
}

/** @param {object} model */
export function hostsCsv(model) {
  const lines = [row(["hostname", "ips", "os", "role", "tags", "subnet", "collected", "listening_ports"])];
  for (const h of model.hosts.values()) {
    const g = model.groups.get(h.groupId);
    const ports = [...new Set(h.listening.map((l) => `${l.port}/${l.proto}`))].join(" ");
    lines.push(row([h.label, h.ips.join(" "), h.os, h.role, h.tags.join(" "), g?.name ?? "", h.collected ? "yes" : "no", ports]));
  }
  return lines.join("\n") + "\n";
}

const TARGETS_HEADER = `# netstat-parser collector targets
# One target per line: <host> <method> [key=value ...]
#   methods: ssh|winrm
#   keys:    user port key password-env domain
# Passwords are never stored here: use password-env=NAME or answer the prompt.
# Generated from hosts that appear in collected files but have no file of their own.
# The method is a guess from the ports the host serves; check it before running.
`;

const WINDOWS_PORTS = [445, 135, 139, 3389];

/** @param {object} model */
export function targetsFile(model) {
  const served = new Map();
  for (const e of model.edges.values()) {
    if (!served.has(e.target)) served.set(e.target, new Set());
    served.get(e.target).add(e.port);
  }
  const lines = [];
  for (const h of model.hosts.values()) {
    if (h.collected || !h.internal || !h.ips.length) continue;
    if (LINK_LOCAL.some((c) => inCidr(h.ips[0], c))) continue; // unusable without a scope id
    const p = served.get(h.id) ?? new Set();
    const ip = h.ips[0];
    if (p.has(5985) || p.has(5986)) lines.push(`${ip} winrm user=CHANGEME${p.has(5986) && !p.has(5985) ? " port=5986" : ""}`);
    else if (p.has(22)) lines.push(`${ip} ssh user=CHANGEME`);
    else if (WINDOWS_PORTS.some((x) => p.has(x))) lines.push(`${ip} winrm user=CHANGEME  # Windows ports seen; WinRM must be enabled`);
    else lines.push(`${ip} ssh user=CHANGEME  # method unknown`);
  }
  return TARGETS_HEADER + lines.join("\n") + (lines.length ? "\n" : "");
}
