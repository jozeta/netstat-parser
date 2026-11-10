// netstat-parser controller. Owns the job state, wires the DOM, and re-renders from pure modules.
// Untrusted data reaches the DOM only through textContent (see js/ui/dom.js).

import { buildModel } from "./model/build.js";
import { parseQuery, applyFilter } from "./model/filter.js";
import { connectionsCsv, hostsCsv, targetsFile } from "./model/exports.js";
import { createSession, parseSession } from "./model/session.js";
import { resolvePtrs, RESOLVERS } from "./model/dns.js";
import { toElements } from "./ui/elements.js";
import { createGraph } from "./ui/graph.js";
import { hostDetails, groupDetails, edgeDetails, mergedDetails, hostsList, filesList } from "./ui/panel.js";
import { el, replace, download } from "./ui/dom.js";
import { loadSettings, saveSettings } from "./ui/storage.js";
import { renderSettings } from "./ui/settings-view.js";
import { renderCollect } from "./ui/collect-view.js";

const $ = (id) => document.getElementById(id);
const storage = (() => { try { return window.localStorage; } catch { return null; } })();

const state = {
  files: [], // ParsedFile[]
  settings: loadSettings(storage),
  dns: {},
  positions: {},
  collapsed: new Set(),
  dirty: false,
  selected: null,
  query: "",
  hide: false,
  model: null,
  visible: null,
};
let graph = null;
let dnsAbort = null;

// ---------- small UI helpers ----------
function toast(text, kind = "ok", ms = 6000) {
  const t = el("div", { class: `lg-toast lg-${kind}`, role: kind === "bad" ? "alert" : "status" }, el("div", null, text));
  $("toasts").append(t);
  setTimeout(() => t.remove(), ms);
}

function confirmDialog(text, okLabel = "Continue") {
  return new Promise((resolve) => {
    const d = $("dialog");
    $("dialog-text").textContent = text;
    $("dialog-ok").textContent = okLabel;
    d.hidden = false;
    $("dialog-ok").focus();
    const done = (v) => { d.hidden = true; $("dialog-ok").onclick = $("dialog-cancel").onclick = null; document.removeEventListener("keydown", esc); resolve(v); };
    const esc = (ev) => { if (ev.key === "Escape") done(false); };
    document.addEventListener("keydown", esc);
    $("dialog-ok").onclick = () => done(true);
    $("dialog-cancel").onclick = () => done(false);
  });
}

function setDirty(v = true) { state.dirty = v && state.files.length > 0; }
window.addEventListener("beforeunload", (ev) => { if (state.dirty) { ev.preventDefault(); ev.returnValue = ""; } });

// ---------- views ----------
function showView() {
  const view = (location.hash.replace("#", "") || "graph").split("/")[0];
  const known = ["graph", "collect", "settings"].includes(view) ? view : "graph";
  for (const v of ["graph", "collect", "settings"]) $(`view-${v}`).hidden = v !== known;
  for (const a of document.querySelectorAll(".lg-nav a")) a.toggleAttribute("aria-current", a.dataset.view === known);
  for (const a of document.querySelectorAll(".lg-nav a[aria-current]")) a.setAttribute("aria-current", "page");
  if (known === "settings") renderSettings($("settings-content"), state.settings, { onSave: applySettings, toast });
  if (known === "collect") renderCollect($("collect-content"), { toast });
  if (known === "graph") requestAnimationFrame(() => graph?.resize());
}
window.addEventListener("hashchange", showView);

function applySettings(next) {
  state.settings = next;
  if (!saveSettings(storage, next)) toast("Settings could not be stored in this browser (private mode?). They apply until you reload.", "warn");
  $("dns-btn").hidden = !next.dns.enabled;
  setDirty();
  rebuild();
}

// ---------- model + render ----------
function rebuild({ relayout = false } = {}) {
  state.model = buildModel(state.files, state.settings);
  refresh({ relayout });
  renderFiles();
  const hosts = state.model.hosts.size, edges = state.model.edges.size;
  $("job-summary").textContent = state.files.length ? `${state.files.length} files · ${hosts} hosts · ${edges} connections` : "No files loaded";
  $("empty").hidden = state.files.length > 0;
}

function refresh({ relayout = false } = {}) {
  graph.resize();
  const terms = parseQuery(state.query);
  state.visible = terms.length ? applyFilter(state.model, terms) : null;
  const els = toElements(state.model, { collapsed: state.collapsed, visible: state.visible, mode: state.hide ? "hide" : "fade", dns: state.dns, labels: state.settings.graph.labels });
  graph.render(els, state.positions, { relayout, fit: relayout });
  renderHosts();
  if (state.selected) showDetails(state.selected);
}

function pick(id) {
  // a host inside a collapsed group: expand it first
  const h = state.model.hosts.get(id);
  if (h && state.collapsed.has(h.groupId)) { state.collapsed.delete(h.groupId); refresh(); }
  state.selected = id;
  graph.select(id);
  showDetails(id);
  selectTab("details");
}

function showDetails(id) {
  const m = state.model;
  const pane = $("pane-details");
  if (!id) { replace(pane, el("p", { class: "lg-muted" }, "Click a host, group or connection to see its details.")); return; }
  if (m.hosts.has(id)) replace(pane, hostDetails({ model: m, host: m.hosts.get(id), dns: state.dns, onPick: pick }));
  else if (m.groups.has(id)) replace(pane, groupDetails({ model: m, group: m.groups.get(id), collapsed: state.collapsed.has(id), onToggle: toggleGroup, onPick: pick }));
  else if (m.edges.has(id)) replace(pane, edgeDetails({ model: m, edge: m.edges.get(id), onPick: pick }));
  else {
    const e = graph.cy.getElementById(id);
    if (e.nonempty() && e.isEdge()) {
      const label = `${e.source().data("label").split("\n")[0]} → ${e.target().data("label").split("\n")[0]}`;
      replace(pane, mergedDetails({ model: m, ids: e.data("members"), label, onPick: pick }));
    } else replace(pane, el("p", { class: "lg-muted" }, "Nothing selected."));
  }
}

function toggleGroup(id) {
  if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
  setDirty();
  refresh();
}

function renderHosts() { replace($("pane-hosts"), hostsList({ model: state.model, visible: state.visible, onPick: pick })); }
function renderFiles() { replace($("pane-files"), filesList({ files: state.files, onRemove: removeFile })); }

function removeFile(name) {
  state.files = state.files.filter((f) => f.fileName !== name);
  setDirty();
  rebuild();
}

function selectTab(name) {
  for (const t of ["details", "hosts", "files"]) {
    const on = t === name;
    $(`tab-${t}`).setAttribute("aria-selected", String(on));
    $(`tab-${t}`).tabIndex = on ? 0 : -1;
    $(`pane-${t}`).hidden = !on;
  }
}

// ---------- loading ----------
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let jobId = 0;

function parseInWorker(fileList) {
  const id = ++jobId;
  return Promise.all([...fileList].map((f) => f.arrayBuffer().then((buffer) => ({ name: f.name, buffer }))))
    .then((files) => new Promise((resolve, reject) => {
      $("progress").hidden = false;
      const onMsg = (ev) => {
        if (ev.data.id !== id) return;
        if (ev.data.type === "progress") $("progress-text").textContent = `Parsing ${ev.data.done} / ${ev.data.total}…`;
        else {
          worker.removeEventListener("message", onMsg);
          $("progress").hidden = true;
          if (ev.data.type === "done") resolve(ev.data.parsed); else reject(new Error(ev.data.message));
        }
      };
      worker.addEventListener("message", onMsg);
      worker.postMessage({ id, files }, files.map((f) => f.buffer));
    }));
}

async function loadFiles(fileList) {
  if (!fileList?.length) return;
  const wasEmpty = state.files.length === 0;
  let parsed;
  try { parsed = await parseInWorker(fileList); } catch (e) { toast(`Could not read the files: ${e.message}`, "bad"); return; }
  const byName = new Map(state.files.map((f) => [f.fileName, f]));
  for (const p of parsed) byName.set(p.fileName, p); // same name → replaced
  state.files = [...byName.values()];
  const model = buildModel(state.files, state.settings);
  if (wasEmpty && model.hosts.size > state.settings.graph.collapseThreshold) state.collapsed = new Set(model.groups.keys());
  setDirty();
  rebuild();
  const bad = parsed.filter((p) => p.warnings.notRecognised).length;
  toast(`${parsed.length} files read: ${model.hosts.size} hosts, ${model.edges.size} connections.${bad ? ` ${bad} not recognised (see Files).` : ""}`, bad ? "warn" : "ok");
}

// ---------- exports / sessions ----------
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

async function doExport(kind) {
  if (!state.files.length) { toast("Load some files first.", "warn"); return; }
  const m = state.model;
  if (kind === "session") {
    const s = createSession({ files: state.files, settings: state.settings, dns: state.dns, positions: state.positions, collapsed: [...state.collapsed] });
    download(`netstat-session-${stamp()}.json`, JSON.stringify(s), "application/json");
    setDirty(false);
  } else if (kind === "png-view" || kind === "png-full") {
    download(`netstat-graph-${stamp()}.png`, await graph.png(kind === "png-full"));
  } else if (kind === "connections") download(`connections-${stamp()}.csv`, connectionsCsv(m), "text/csv;charset=utf-8");
  else if (kind === "hosts") download(`hosts-${stamp()}.csv`, hostsCsv(m), "text/csv;charset=utf-8");
  else if (kind === "targets") download(`targets-${stamp()}.txt`, targetsFile(m));
}

async function openSession(file) {
  if (!file) return;
  if (state.files.length && !(await confirmDialog("Opening a session replaces the current job. Unsaved changes are lost.", "Open session"))) return;
  try {
    const s = parseSession(await file.text());
    Object.assign(state, { files: s.files, settings: s.settings, dns: s.dns, positions: s.positions, collapsed: new Set(s.collapsed), selected: null });
    saveSettings(storage, s.settings);
    $("dns-btn").hidden = !s.settings.dns.enabled;
    setDirty(false);
    rebuild();
    toast(`Session opened: ${s.files.length} files.`);
  } catch (e) {
    toast(e.message, "bad");
  }
}

// ---------- DNS ----------
async function runDns() {
  if (dnsAbort) { dnsAbort.abort(); return; }
  const { resolver, enabled } = state.settings.dns;
  if (!enabled || !resolver) { toast("Enable DNS lookup in Settings first.", "warn"); return; }
  const sel = state.selected && state.model.hosts.get(state.selected);
  const hosts = sel && !sel.internal ? [sel] : [...state.model.hosts.values()].filter((h) => !h.internal);
  const ips = hosts.map((h) => h.ips[0]).filter((ip) => ip && !(ip in state.dns));
  if (!ips.length) { toast("No unresolved Internet hosts."); return; }
  dnsAbort = new AbortController();
  $("dns-label").textContent = "Cancel DNS";
  $("progress").hidden = false;
  const partial = new Map();
  try {
    const res = await resolvePtrs(ips, { resolver, fetch: (u, o) => window.fetch(u, o), signal: dnsAbort.signal, internalRanges: state.settings.internalRanges,
      onProgress: (d, t) => { $("progress-text").textContent = `${RESOLVERS[resolver].label} DNS ${d} / ${t}…`; } });
    for (const [ip, name] of res) partial.set(ip, name);
    toast(`Resolved ${[...res.values()].filter(Boolean).length} of ${res.size} addresses via ${RESOLVERS[resolver].label}.`);
  } catch (e) {
    toast(e.name === "AbortError" ? "DNS lookup cancelled." : `DNS lookup failed: ${e.message}`, "warn");
  } finally {
    for (const [ip, name] of partial) state.dns[ip] = name;
    dnsAbort = null;
    $("dns-label").textContent = "Resolve DNS";
    $("progress").hidden = true;
    setDirty();
    refresh();
  }
}

// ---------- wiring ----------
function init() {
  graph = createGraph($("graph"), {
    onSelect: (id) => { state.selected = id; showDetails(id); if (id) selectTab("details"); },
    onToggleGroup: toggleGroup,
    // only positions the user chose are kept; everything else follows the grouped layout
    onMoved: (id, pos) => { state.positions[id] = pos; setDirty(); },
  });
  $("file-input").addEventListener("change", (ev) => { loadFiles(ev.target.files); ev.target.value = ""; });
  $("session-input").addEventListener("change", (ev) => { openSession(ev.target.files[0]); ev.target.value = ""; });
  const card = $("graph").parentElement;
  card.addEventListener("dragover", (ev) => { ev.preventDefault(); $("graph").classList.add("np-drop"); });
  card.addEventListener("dragleave", () => $("graph").classList.remove("np-drop"));
  card.addEventListener("drop", (ev) => { ev.preventDefault(); $("graph").classList.remove("np-drop"); loadFiles(ev.dataTransfer.files); });

  let timer = null;
  $("search").addEventListener("input", (ev) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = ev.target.value; syncQuick(); if (state.model) refresh(); }, 200);
  });
  for (const b of document.querySelectorAll(".np-quick")) {
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      const q = b.dataset.q;
      const terms = state.query.split(/\s+/).filter(Boolean);
      state.query = (terms.includes(q) ? terms.filter((t) => t !== q) : [...terms, q]).join(" ");
      $("search").value = state.query;
      syncQuick();
      if (state.model) refresh();
    });
  }
  $("hide-toggle").addEventListener("change", (ev) => { state.hide = ev.target.checked; if (state.model) refresh(); });
  $("filter-help-btn").addEventListener("click", () => {
    const h = $("filter-help");
    h.hidden = !h.hidden;
    $("filter-help-btn").setAttribute("aria-expanded", String(!h.hidden));
  });
  $("fit-btn").addEventListener("click", () => graph.fit());
  $("relayout-btn").addEventListener("click", () => { state.positions = {}; refresh({ relayout: true }); });
  $("collapse-btn").addEventListener("click", () => { state.collapsed = new Set(state.model?.groups.keys() ?? []); refresh(); });
  $("expand-btn").addEventListener("click", () => { state.collapsed = new Set(); refresh(); });
  $("dns-btn").hidden = !state.settings.dns.enabled;
  $("dns-btn").addEventListener("click", runDns);

  const menu = $("export-menu");
  const setMenu = (open) => { menu.hidden = !open; $("export-btn").setAttribute("aria-expanded", String(open)); if (open) menu.querySelector("button")?.focus(); };
  $("export-btn").addEventListener("click", () => setMenu(menu.hidden));
  menu.addEventListener("click", (ev) => { const k = ev.target.closest("[data-export]")?.dataset.export; if (k) { setMenu(false); doExport(k); } });
  menu.addEventListener("keydown", (ev) => {
    const items = [...menu.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    if (ev.key === "Escape") { setMenu(false); $("export-btn").focus(); }
    if (ev.key === "ArrowDown") { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (ev.key === "ArrowUp") { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener("click", (ev) => { if (!menu.hidden && !ev.target.closest(".np-menu")) setMenu(false); });

  const tabs = ["details", "hosts", "files"];
  for (const t of tabs) {
    $(`tab-${t}`).addEventListener("click", () => selectTab(t));
    $(`tab-${t}`).addEventListener("keydown", (ev) => {
      const i = tabs.indexOf(t);
      const next = ev.key === "ArrowRight" ? tabs[(i + 1) % 3] : ev.key === "ArrowLeft" ? tabs[(i + 2) % 3] : null;
      if (next) { selectTab(next); $(`tab-${next}`).focus(); }
    });
  }
  window.addEventListener("resize", () => graph.resize());
  state.model = buildModel([], state.settings);
  rebuild();
  showView();
}

function syncQuick() {
  const terms = state.query.split(/\s+/);
  for (const b of document.querySelectorAll(".np-quick")) b.setAttribute("aria-pressed", String(terms.includes(b.dataset.q)));
}

init();
