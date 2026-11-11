// Settings view: protocol risk table, subnets, internal ranges, role rules, graph and DNS options.
import { el, replace, download } from "./dom.js";
import { validateSettings, DEFAULT_SETTINGS, RISKS } from "../model/settings.js";
import { RESOLVERS } from "../model/dns.js";

const RISK_LABEL = { vulnerable: "Vulnerable (red)", exploitable: "Exploitable / unencrypted (orange)", safe: "Safe", unclassified: "Unclassified" };

const input = (value, attrs = {}) => el("input", { class: "lg-input", value: value ?? "", ...attrs });
const select = (value, options, attrs = {}) => {
  const s = el("select", { class: "lg-input", ...attrs }, options.map(([v, label]) => el("option", { value: v }, label)));
  s.value = value;
  return s;
};
const removeBtn = (row, label) => el("button", { class: "lg-btn lg-btn-ghost", type: "button", "aria-label": label, onclick: () => row.remove() }, "Remove");
const ports = (text) => String(text).split(/[\s,]+/).filter(Boolean).map(Number);

function table(headers, rows) {
  return el("div", { class: "np-table-scroll" }, el("table", { class: "lg-table np-form-table" },
    el("thead", null, el("tr", null, headers.map((h) => el("th", { scope: "col" }, h)))), el("tbody", null, rows)));
}

function protocolRow(p) {
  const tr = el("tr", { class: "np-proto" });
  tr.append(
    el("td", null, input(p.port, { "aria-label": "Port or range", inputmode: "numeric", "data-k": "port" })),
    el("td", null, select(p.proto, [["tcp", "tcp"], ["udp", "udp"], ["any", "any"]], { "aria-label": "Protocol", "data-k": "proto" })),
    el("td", null, input(p.name, { "aria-label": "Name", "data-k": "name" })),
    el("td", null, select(p.risk, RISKS.map((r) => [r, RISK_LABEL[r]]), { "aria-label": "Risk", "data-k": "risk" })),
    el("td", null, removeBtn(tr, `Remove ${p.name || "row"}`)));
  return tr;
}
function subnetRow(s) {
  const tr = el("tr", { class: "np-subnet" });
  tr.append(el("td", null, input(s.cidr, { "aria-label": "CIDR", placeholder: "10.10.1.0/24", "data-k": "cidr" })),
    el("td", null, input(s.name, { "aria-label": "Name", placeholder: "Servers", "data-k": "name" })), el("td", null, removeBtn(tr, "Remove subnet")));
  return tr;
}
function ruleRow(r) {
  const tr = el("tr", { class: "np-rule" });
  tr.append(el("td", null, input(r.tag, { "aria-label": "Tag", "data-k": "tag" })),
    el("td", null, input(r.all.join(", "), { "aria-label": "Requires all of these ports", "data-k": "all" })),
    el("td", null, input(r.any.join(", "), { "aria-label": "Requires any of these ports", "data-k": "any" })), el("td", null, removeBtn(tr, `Remove ${r.tag}`)));
  return tr;
}
const read = (tr) => Object.fromEntries([...tr.querySelectorAll("[data-k]")].map((n) => [n.dataset.k, n.value.trim()]));

/**
 * @param {HTMLElement} root
 * @param {object} settings current (validated)
 * @param {{onSave: (s: object) => void, toast: (t: string, kind?: string) => void}} handlers
 */
export function renderSettings(root, settings, { onSave, toast, current = () => settings }) {
  const protoBody = settings.protocols.map(protocolRow);
  const protoTable = table(["Port", "Proto", "Name", "Risk", ""], protoBody);
  const subnetTable = table(["CIDR", "Name", ""], settings.subnets.map(subnetRow));
  const ruleTable = table(["Tag", "All of ports", "Any of ports", ""], settings.roleRules.map(ruleRow));
  const internal = el("textarea", { class: "lg-input", id: "internal-ranges", rows: 3, placeholder: "203.0.113.0/24" });
  internal.value = settings.internalRanges.join("\n");
  const threshold = input(settings.graph.expandUpTo, { type: "number", min: 0, max: 100000, id: "expand-up-to" });
  const labels = el("input", { type: "checkbox", class: "lg-toggle", id: "labels-toggle" });
  labels.checked = settings.graph.labels;
  const dnsOn = el("input", { type: "checkbox", class: "lg-toggle", id: "dns-enabled" });
  dnsOn.checked = settings.dns.enabled;
  const resolver = select(settings.dns.resolver ?? "", [["", "Choose a resolver…"], ...Object.entries(RESOLVERS).map(([k, r]) => [k, r.label])], { id: "dns-resolver" });
  const ack = el("input", { type: "checkbox", id: "dns-ack" });
  ack.checked = settings.dns.enabled;

  const tbody = (t) => t.querySelector("tbody");

  function collect() {
    for (const n of root.querySelectorAll(".np-invalid")) n.classList.remove("np-invalid");
    let bad = 0;
    const mark = (tr) => { bad++; for (const i of tr.querySelectorAll("input")) i.classList.add("np-invalid"); };
    const protocols = [...tbody(protoTable).rows].map((tr) => {
      const v = read(tr);
      const p = { port: /^\d+$/.test(v.port) ? Number(v.port) : v.port, proto: v.proto, name: v.name, risk: v.risk };
      if (validateSettings({ protocols: [p] }).protocols.length !== 1) { mark(tr); return null; }
      return p;
    }).filter(Boolean);
    const subnets = [...tbody(subnetTable).rows].map((tr) => {
      const v = read(tr);
      if (validateSettings({ subnets: [v] }).subnets.length !== 1) { mark(tr); return null; }
      return v;
    }).filter(Boolean);
    const roleRules = [...tbody(ruleTable).rows].map((tr) => {
      const v = read(tr);
      const r = { tag: v.tag, all: ports(v.all), any: ports(v.any) };
      if (validateSettings({ roleRules: [r] }).roleRules.length !== 1) { mark(tr); return null; }
      return r;
    }).filter(Boolean);
    const ranges = internal.value.split(/\s+/).filter(Boolean);
    const okRanges = validateSettings({ internalRanges: ranges }).internalRanges;
    if (okRanges.length !== ranges.length) { bad++; internal.classList.add("np-invalid"); }
    const t = Number(threshold.value);
    if (!(Number.isInteger(t) && t >= 0 && t <= 100000)) { bad++; threshold.classList.add("np-invalid"); }
    if (dnsOn.checked && (!resolver.value || !ack.checked)) { bad++; resolver.classList.add("np-invalid"); }
    return { bad, next: { protocols, subnets, internalRanges: okRanges, roleRules, graph: { expandUpTo: t, labels: labels.checked },
      dns: { enabled: dnsOn.checked, resolver: resolver.value || null } } };
  }

  const save = () => {
    const { bad, next } = collect();
    if (bad) { toast(`${bad} setting${bad > 1 ? "s are" : " is"} invalid (marked in red). Nothing was saved.`, "bad"); return; }
    onSave(validateSettings(next));
    toast("Settings saved.");
  };
  const importInput = el("input", { type: "file", accept: ".json,application/json", class: "np-visually-hidden", id: "settings-import" });
  importInput.addEventListener("change", async () => {
    const f = importInput.files[0];
    if (!f) return;
    try {
      const s = validateSettings(JSON.parse(await f.text()));
      onSave(s);
      renderSettings(root, s, { onSave, toast, current });
      toast("Settings imported.");
    } catch { toast("That file is not valid settings JSON.", "bad"); }
  });

  replace(root,
    el("section", { class: "lg-card lg-stack", "aria-labelledby": "s-proto" },
      el("h2", { class: "lg-subtitle", id: "s-proto" }, "Protocols and risk"),
      el("p", { class: "lg-muted lg-small" }, "Connections are coloured by the service port. The first matching row wins; a range such as 5900-5903 is allowed."),
      protoTable,
      el("button", { class: "lg-btn", type: "button", onclick: () => tbody(protoTable).append(protocolRow({ port: "", proto: "tcp", name: "", risk: "exploitable" })) }, "Add protocol")),
    el("section", { class: "lg-card lg-stack", "aria-labelledby": "s-subnets" },
      el("h2", { class: "lg-subtitle", id: "s-subnets" }, "Subnets"),
      el("p", { class: "lg-muted lg-small" }, "Name your subnets. Hosts are grouped by the most specific matching range; otherwise by the prefix in the file header, or /24 and /64."),
      subnetTable,
      el("button", { class: "lg-btn", type: "button", onclick: () => tbody(subnetTable).append(subnetRow({ cidr: "", name: "" })) }, "Add subnet"),
      el("div", { class: "lg-field" }, el("label", { for: "internal-ranges" }, "Extra internal ranges (one CIDR per line)"),
        el("p", { class: "lg-muted lg-small" }, "Private, link-local, CGNAT and ULA ranges are always internal. Add public ranges the client owns so they are not drawn in the Internet cloud and are never sent to a DNS resolver."),
        internal)),
    el("section", { class: "lg-card lg-stack", "aria-labelledby": "s-roles" },
      el("h2", { class: "lg-subtitle", id: "s-roles" }, "Role tags"),
      el("p", { class: "lg-muted lg-small" }, "A host gets the tag when it listens on (or serves) all ports in the first column and any port in the second."),
      ruleTable,
      el("button", { class: "lg-btn", type: "button", onclick: () => tbody(ruleTable).append(ruleRow({ tag: "", all: [], any: [] })) }, "Add tag")),
    el("section", { class: "lg-card lg-stack", "aria-labelledby": "s-graph" },
      el("h2", { class: "lg-subtitle", id: "s-graph" }, "Graph"),
      el("div", { class: "lg-field" }, el("label", { for: "expand-up-to" }, "Expand subnets with up to this many hosts"), threshold,
        el("span", { class: "lg-small lg-muted" }, "Larger subnets (and a larger Internet group) start collapsed. 0 collapses all.")),
      el("label", { class: "np-inline", for: "labels-toggle" }, labels, "Show labels and port badges on nodes")),
    el("section", { class: "lg-card lg-stack", "aria-labelledby": "s-dns" },
      el("h2", { class: "lg-subtitle", id: "s-dns" }, "DNS lookup (optional)"),
      el("p", { class: "np-warning" }, "Reverse DNS for Internet addresses uses DNS-over-HTTPS. The public IP addresses you resolve are sent to the provider you choose. This is the only time the app talks to another server. Internal addresses are never sent."),
      el("label", { class: "np-inline", for: "dns-enabled" }, dnsOn, "Enable DNS lookup"),
      el("div", { class: "lg-field" }, el("label", { for: "dns-resolver" }, "Resolver"), resolver),
      el("label", { class: "np-inline", for: "dns-ack" }, ack, "I understand that public IP addresses are sent to this provider.")),
    el("div", { class: "lg-row np-settings-actions" },
      el("button", { class: "lg-btn lg-btn-primary", type: "button", onclick: save }, "Save settings"),
      el("button", { class: "lg-btn", type: "button", onclick: () => { onSave(validateSettings(DEFAULT_SETTINGS)); renderSettings(root, validateSettings(DEFAULT_SETTINGS), { onSave, toast, current }); toast("Settings reset to defaults."); } }, "Reset to defaults"),
      el("button", { class: "lg-btn", type: "button", onclick: () => download("netstat-parser-settings.json", JSON.stringify(current(), null, 2), "application/json") }, "Export settings"),
      el("label", { class: "lg-btn", for: "settings-import" }, "Import settings"), importInput));
}
