// netstat-parser controller. Owns the job state, wires the DOM, and re-renders from pure modules.
// Untrusted data reaches the DOM only through textContent (see js/ui/dom.js).

import { buildModel } from "./model/build.js";
import { parseQuery, applyFilter } from "./model/filter.js";
import { connectionsCsv, hostsCsv, targetsFile } from "./model/exports.js";
import { createSession, parseSession } from "./model/session.js";
import { mergeSessionSettings } from "./model/settings.js";
import { resolveButton, shouldAutoResolve, loadChoice } from "./model/policy.js";
import { MAX_FILE_BYTES, MAX_ARCHIVE_BYTES } from "./worker-core.js";
import { isCandidate } from "./lib/inputs.js";
import { walkEntries } from "./ui/dropped.js";
import { resolvePtrs, RESOLVERS } from "./model/dns.js";
import { toElements } from "./ui/elements.js";
import { defaultCollapsed } from "./ui/collapse.js";
import { createGraph } from "./ui/graph.js";
import { hostDetails, groupDetails, edgeDetails, mergedDetails, hostsList, groupsList, filesList } from "./ui/panel.js";
import { el, replace, download } from "./ui/dom.js";
import { loadSettings, saveSettings } from "./ui/storage.js";
import { renderSettings } from "./ui/settings-view.js";
import { renderCollect } from "./ui/collect-view.js";
import { readTheme, writeTheme, applyTheme } from "./ui/theme.js";
import { uniqueFileNames } from "./model/files.js";

const $ = (id) => document.getElementById(id);
const storage = (() => { try { return window.localStorage; } catch { return null; } })();

const state = {
  files: [], // ParsedFile[]
  settings: loadSettings(storage),
  dns: {},
  positions: {},
  collapsed: new Set(),
  known: new Set(), // groups that already got their default expand/collapse state
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
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function toast(text, kind = "ok", ms = 6000) {
  const t = el("div", { class: `lg-toast lg-${kind}`, role: kind === "bad" ? "alert" : "status" }, el("div", null, text));
  $("toasts").append(t);
  setTimeout(() => t.remove(), ms);
}

let dialogOpen = false;
/**
 * Modal question. Returns "ok", "alt" (the optional middle choice) or null (cancelled).
 * @param {string} text
 * @param {{ok?: string, alt?: string, title?: string}} [labels]
 */
function askDialog(text, { ok: okLabel = "Continue", alt: altLabel = null, title = "Confirm" } = {}) {
  if (dialogOpen) return Promise.resolve(null); // one question at a time
  dialogOpen = true;
  return new Promise((resolve) => {
    const d = $("dialog"), ok = $("dialog-ok"), alt = $("dialog-alt"), cancel = $("dialog-cancel");
    const opener = document.activeElement;
    $("dialog-title").textContent = title;
    $("dialog-text").textContent = text;
    ok.textContent = okLabel;
    alt.hidden = !altLabel;
    alt.textContent = altLabel ?? "";
    d.hidden = false;
    ok.focus();
    const buttons = () => [cancel, alt, ok].filter((b) => !b.hidden);
    const done = (v) => {
      d.hidden = true;
      ok.onclick = alt.onclick = cancel.onclick = null;
      document.removeEventListener("keydown", keys, true);
      dialogOpen = false;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
      resolve(v);
    };
    // modal: Escape cancels, Tab cycles between the dialog's buttons only
    const keys = (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); done(null); }
      if (ev.key === "Tab") {
        ev.preventDefault();
        const list = buttons(), i = list.indexOf(document.activeElement);
        list[(i + (ev.shiftKey ? -1 : 1) + list.length) % list.length].focus();
      }
    };
    document.addEventListener("keydown", keys, true);
    ok.onclick = () => done("ok");
    alt.onclick = () => done("alt");
    cancel.onclick = () => done(null);
  });
}
const confirmDialog = (text, okLabel = "Continue") => askDialog(text, { ok: okLabel }).then((v) => v === "ok");

function setDirty(v = true) { state.dirty = v && state.files.length > 0; }
window.addEventListener("beforeunload", (ev) => { if (state.dirty) { ev.preventDefault(); ev.returnValue = ""; } });

// ---------- views ----------
function showView() {
  const view = (location.hash.replace("#", "") || "graph").split("/")[0];
  const known = ["graph", "collect", "settings"].includes(view) ? view : "graph";
  for (const v of ["graph", "collect", "settings"]) $(`view-${v}`).hidden = v !== known;
  for (const a of document.querySelectorAll(".lg-nav a")) a.toggleAttribute("aria-current", a.dataset.view === known);
  for (const a of document.querySelectorAll(".lg-nav a[aria-current]")) a.setAttribute("aria-current", "page");
  if (known === "settings") renderSettings($("settings-content"), state.settings, { onSave: applySettings, toast, current: () => state.settings });
  if (known === "collect") renderCollect($("collect-content"), { toast });
  if (known === "graph") requestAnimationFrame(() => graph?.resize());
}
window.addEventListener("hashchange", showView);

function applySettings(next) {
  if (next.graph.expandUpTo !== state.settings.graph.expandUpTo) state.known = new Set(); // re-apply to every group
  state.settings = next;
  if (!saveSettings(storage, next)) toast("Settings could not be stored in this browser (private mode?). They apply until you reload.", "warn");
  $("dns-btn").hidden = !next.dns.enabled;
  setDirty();
  rebuild();
}

// ---------- model + render ----------
function rebuild({ relayout = false, adopt = false } = {}) {
  state.model = buildModel(state.files, state.settings);
  const m = state.model, sel = state.selected;
  // new groups start expanded up to N hosts, collapsed above; groups with a state keep it
  if (adopt) for (const id of m.groups.keys()) state.known.add(id);
  const collapse = defaultCollapsed(m, state.settings.graph.expandUpTo, state.known);
  for (const id of m.groups.keys()) {
    if (state.known.has(id)) continue;
    state.known.add(id);
    if (collapse.has(id)) state.collapsed.add(id); else state.collapsed.delete(id);
  }
  if (sel && !sel.startsWith("a:") && !m.hosts.has(sel) && !m.groups.has(sel) && !m.edges.has(sel)) state.selected = null;
  refresh({ relayout });
  renderFiles();
  const hosts = state.model.hosts.size, edges = state.model.edges.size;
  $("job-summary").textContent = state.files.length ? `${count(state.files.length, "file")} · ${count(hosts, "host")} · ${count(edges, "connection")}` : "No files loaded";
  $("empty").hidden = state.files.length > 0;
}

function refresh({ relayout = false, fit = false } = {}) {
  graph.resize();
  const terms = parseQuery(state.query);
  state.visible = terms.length ? applyFilter(state.model, terms) : null;
  const els = toElements(state.model, { collapsed: state.collapsed, visible: state.visible, mode: state.hide ? "hide" : "fade", dns: state.dns, labels: state.settings.graph.labels });
  graph.render(els, state.positions, { relayout, fit: relayout || fit });
  renderHosts();
  if (state.selected) { graph.select(state.selected, { center: false }); showDetails(state.selected); }
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
  if (m.hosts.has(id)) {
    const host = m.hosts.get(id);
    const b = resolveButton(state.settings);
    const resolve = host.internal ? null : { disabled: b.disabled, busy: resolving.has(host.ips[0]), onClick: () => resolveOne(host) };
    replace(pane, hostDetails({ model: m, host, dns: state.dns, onPick: pick, resolve }));
  }
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

let groupsOpen = false;
// keep keyboard focus on the same toggle after the list re-renders
function toggleGroupFromList(id) {
  toggleGroup(id);
  document.querySelector(`#pane-hosts [data-group="${CSS.escape(id)}"]`)?.focus();
}

function renderHosts() {
  replace($("pane-hosts"),
    groupsList({ model: state.model, collapsed: state.collapsed, onToggle: toggleGroupFromList, onPick: pick, open: groupsOpen, onOpenChange: (v) => { groupsOpen = v; } }),
    hostsList({ model: state.model, visible: state.visible, onPick: pick }));
}
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
let generation = 0; // bumped whenever the job is replaced; stale parse results are dropped
const pending = new Map(); // job id → reject, so a crashed worker never leaves "Parsing…" up
const failAll = (msg) => { for (const reject of pending.values()) reject(new Error(msg)); pending.clear(); $("progress").hidden = true; };
worker.addEventListener("error", () => failAll("the parser stopped unexpectedly (file too large or browser out of memory?)"));
worker.addEventListener("messageerror", () => failAll("the parser sent an unreadable result"));

function parseInWorker(fileList) {
  const id = ++jobId;
  $("progress").hidden = false;
  $("progress-text").textContent = "Reading files…";
  // files over the worker's limit are sent empty (it reports them as too large) instead of read into memory;
  // archives may be larger (their entries are limited one by one while unpacking)
  const limit = (f) => (/\.zip$/i.test(f.name) ? MAX_ARCHIVE_BYTES : MAX_FILE_BYTES);
  return Promise.all([...fileList].map((f) => (f.size > limit(f) ? Promise.resolve(new ArrayBuffer(0)) : f.arrayBuffer())
    .then((buffer) => ({ name: f.name, buffer, tooLarge: f.size > limit(f) }))))
    .then((files) => new Promise((resolve, reject) => {
      $("progress").hidden = false;
      pending.set(id, (err) => { worker.removeEventListener("message", onMsg); reject(err); });
      const onMsg = (ev) => {
        if (ev.data.id !== id) return;
        if (ev.data.type === "progress") $("progress-text").textContent = `Parsing ${ev.data.done} / ${ev.data.total}…${pending.size > 1 ? ` (${pending.size - 1} more batch${pending.size > 2 ? "es" : ""} waiting)` : ""}`;
        else {
          worker.removeEventListener("message", onMsg);
          pending.delete(id);
          if (pending.size === 0) $("progress").hidden = true;
          if (ev.data.type === "done") resolve({ parsed: ev.data.parsed, notes: ev.data.notes }); else reject(new Error(ev.data.message));
        }
      };
      worker.addEventListener("message", onMsg);
      worker.postMessage({ id, files }, files.map((f) => f.buffer));
    }));
}

/**
 * @param {ArrayLike<File>} fileList
 * @param {{skipped?: number, truncated?: boolean}} [found] what a folder walk left out
 */
/** Forget the current job (files, layout, groups' state, DNS results); settings stay. */
function resetJob() {
  generation++;
  dnsAbort?.abort();
  Object.assign(state, { files: [], positions: {}, collapsed: new Set(), known: new Set(), dns: {}, selected: null });
  setDirty(false);
}

async function loadFiles(fileList, found = {}) {
  // copy first: an <input>'s FileList is live and is emptied when the input is reset, which
  // happens while the "add or start new" question is still open
  fileList = [...(fileList ?? [])];
  if (!fileList.length) {
    if (found.skipped) toast(`No netstat files found (${found.skipped} other files skipped).`, "warn");
    return;
  }
  const choice = loadChoice(state.settings, state.files.length);
  let fresh = choice === "new";
  if (choice === "ask") {
    const answer = await askDialog(`${state.files.length} file${state.files.length > 1 ? "s are" : " is"} already loaded. Add the new files to this job, or start a new job with only the new files?${state.dirty ? " A new job discards the current one; it has unsaved changes." : ""} (The default can be set in Settings.)`,
      { title: "Load more files", ok: "Add to current job", alt: "Start new job" });
    if (!answer) return;
    fresh = answer === "alt";
  }
  if (fresh) resetJob();
  const gen = generation;
  let parsed, notes;
  try { ({ parsed, notes } = await parseInWorker(fileList)); } catch (e) { toast(`Could not read the files: ${e.message}`, "bad"); return; }
  if (!parsed.length) {
    toast(`No netstat files found${notes.problems.length ? `: ${notes.problems[0]}` : ""}.`, "warn");
    return;
  }
  if (gen !== generation) { toast("Files parsed after a session was opened were discarded. Load them again to add them.", "warn"); return; }
  uniqueFileNames(parsed.map((p) => p.fileName)).forEach((name, i) => { parsed[i].fileName = name; });
  const byName = new Map(state.files.map((f) => [f.fileName, f]));
  for (const p of parsed) byName.set(p.fileName, p); // same name → replaced
  state.files = [...byName.values()];
  const model = buildModel(state.files, state.settings);
  setDirty();
  rebuild();
  const bad = parsed.filter((p) => p.warnings.notRecognised).length;
  const skipped = (found.skipped ?? 0) + notes.skipped;
  const extra = [
    bad ? `${bad} not recognised (see Files).` : "",
    skipped ? `${skipped} other files skipped.` : "",
    found.truncated ? "Stopped at 10,000 files." : "",
    notes.problems.length ? `${notes.problems.length} archive problem${notes.problems.length > 1 ? "s" : ""}: ${notes.problems.slice(0, 2).join("; ")}${notes.problems.length > 2 ? " …" : ""}` : "",
  ].filter(Boolean).join(" ");
  toast(`${count(parsed.length, "file")} read: ${count(model.hosts.size, "host")}, ${count(model.edges.size, "connection")}.${extra ? ` ${extra}` : ""}`,
    bad || notes.problems.length || found.truncated ? "warn" : "ok");
  if (shouldAutoResolve(state.settings)) runDns({ auto: true });
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
    generation++;
    // the session's tables apply to this job only: DNS opt-in and the user's internal ranges are kept, nothing is stored
    const settings = mergeSessionSettings(state.settings, s.settings);
    Object.assign(state, { files: s.files, settings, dns: s.dns, positions: s.positions, collapsed: new Set(s.collapsed), known: new Set(), selected: null });
    $("dns-btn").hidden = !settings.dns.enabled;
    setDirty(false);
    rebuild({ adopt: true });
    toast(`Session opened: ${s.files.length} files.`);
  } catch (e) {
    toast(e.message, "bad");
  }
}

// ---------- DNS ----------
const dnsRanges = () => [...state.settings.internalRanges, ...state.settings.subnets.map((x) => x.cidr)];
const resolverLabel = () => RESOLVERS[state.settings.dns.resolver]?.label ?? "the resolver";
const resolving = new Set(); // addresses with a single lookup in flight

/** Look up every unresolved Internet host. auto: started by loading files (no questions asked). */
async function runDns({ auto = false } = {}) {
  if (dnsAbort) { if (!auto) dnsAbort.abort(); return; }
  const { resolver, enabled, acknowledged } = state.settings.dns;
  if (!enabled || !resolver) { toast("Enable DNS lookup in Settings first.", "warn"); return; }
  const ips = [...state.model.hosts.values()].filter((h) => !h.internal).map((h) => h.ips[0]).filter((ip) => ip && !(ip in state.dns));
  if (!ips.length) { if (!auto) toast("No unresolved Internet hosts."); return; }
  if (!acknowledged && !(await confirmDialog(`Up to ${ips.length} public IP address${ips.length > 1 ? "es" : ""} will be sent to ${resolverLabel()} to look up their names. Internal addresses are never sent. (Tick the acknowledgement in Settings to stop this question.)`, "Send to resolver"))) return;
  dnsAbort = new AbortController();
  $("dns-label").textContent = "Cancel DNS";
  $("progress").hidden = false;
  const partial = new Map();
  try {
    const res = await resolvePtrs(ips, { resolver, fetch: (u, o) => window.fetch(u, o), signal: dnsAbort.signal, internalRanges: dnsRanges(),
      onResult: (ip, name) => partial.set(ip, name),
      onProgress: (d, t) => { $("progress-text").textContent = `${resolverLabel()} DNS ${d} / ${t}…`; } });
    const named = [...res.values()].filter(Boolean).length;
    const notSent = ips.length - res.size;
    toast(`DNS: ${named} of ${res.size} addresses have a name (via ${resolverLabel()}).${notSent ? ` ${notSent} not sent (documentation, reserved or internal ranges never have public names).` : ""}`);
  } catch (e) {
    toast(e.name === "AbortError" ? `DNS lookup cancelled; ${partial.size} addresses kept.` : `DNS lookup failed: ${e.message}`, "warn");
  } finally {
    for (const [ip, name] of partial) state.dns[ip] = name;
    dnsAbort = null;
    $("dns-label").textContent = "Resolve DNS";
    $("progress").hidden = true;
    setDirty();
    refresh();
  }
}

/** The details panel's "Resolve name" button: one Internet host, on its own. */
async function resolveOne(host) {
  const ip = host.ips[0];
  const { disabled, warn } = resolveButton(state.settings);
  if (disabled || !ip || resolving.has(ip)) return;
  if (warn && !(await confirmDialog(`${ip} will be sent to ${resolverLabel()} to look up its name. (Tick the acknowledgement in Settings to stop this question.)`, "Send to resolver"))) return;
  resolving.add(ip);
  showDetails(state.selected);
  try {
    const res = await resolvePtrs([ip], { resolver: state.settings.dns.resolver, fetch: (u, o) => window.fetch(u, o), internalRanges: dnsRanges(), delayMs: 0 });
    if (!res.has(ip)) { toast(`${ip} was not sent: it is in a range that never has a public name (documentation, reserved or internal).`, "warn"); return; }
    state.dns[ip] = res.get(ip);
    toast(res.get(ip) ? `${ip} is ${res.get(ip)}.` : `${ip} has no DNS name (no PTR record).`);
    setDirty();
    refresh();
  } catch (e) {
    toast(`DNS lookup failed: ${e.message}`, "warn");
  } finally {
    resolving.delete(ip);
    if (state.selected) showDetails(state.selected);
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
  card.addEventListener("drop", (ev) => {
    ev.preventDefault();
    $("graph").classList.remove("np-drop");
    // entries must be taken during the event; folders are walked, plain files are read as they are
    const entries = [...(ev.dataTransfer.items ?? [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.some((e) => e.isDirectory)) {
      $("progress").hidden = false;
      $("progress-text").textContent = "Reading folder…";
      walkEntries(entries).then((r) => { $("progress").hidden = true; loadFiles(r.files, r); },
        (e) => { $("progress").hidden = true; toast(`Could not read the folder: ${e?.message ?? e}`, "bad"); });
    } else loadFiles(ev.dataTransfer.files);
  });
  $("folder-input").addEventListener("change", (ev) => {
    const all = [...ev.target.files];
    const files = all.filter((f) => /\.zip$/i.test(f.name) || isCandidate(f.webkitRelativePath || f.name));
    loadFiles(files, { skipped: all.length - files.length });
    ev.target.value = "";
  });

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
  $("relayout-btn").addEventListener("click", () => { state.positions = {}; setDirty(); refresh({ relayout: true }); });
  $("collapse-btn").addEventListener("click", () => { state.collapsed = new Set(state.model?.groups.keys() ?? []); setDirty(); refresh({ fit: true }); });
  $("expand-btn").addEventListener("click", () => { state.collapsed = new Set(); setDirty(); refresh({ fit: true }); });
  $("dns-btn").hidden = !state.settings.dns.enabled;
  $("dns-btn").addEventListener("click", runDns);

  // app menu (top right): pages, theme, privacy note
  const appMenu = $("app-menu"), menuBtn = $("menu-btn");
  const setAppMenu = (open, { focusButton = false } = {}) => {
    appMenu.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
    if (open) appMenu.querySelector('a[aria-current="page"], a')?.focus();
    else if (focusButton) menuBtn.focus();
  };
  menuBtn.addEventListener("click", () => setAppMenu(appMenu.hidden));
  appMenu.addEventListener("click", (ev) => { if (ev.target.closest("a[href]")) setAppMenu(false); });
  appMenu.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); setAppMenu(false, { focusButton: true }); } });
  appMenu.addEventListener("focusout", (ev) => { if (ev.relatedTarget && !appMenu.contains(ev.relatedTarget) && ev.relatedTarget !== menuBtn) setAppMenu(false); });
  document.addEventListener("click", (ev) => { if (!appMenu.hidden && !ev.target.closest(".np-appmenu")) setAppMenu(false); });

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
  // tabbing out of the menu closes it
  menu.addEventListener("focusout", (ev) => { if (!menu.contains(ev.relatedTarget) && ev.relatedTarget !== $("export-btn")) setMenu(false); });

  const tabs = ["details", "hosts", "files"];
  for (const t of tabs) {
    $(`tab-${t}`).addEventListener("click", () => selectTab(t));
    $(`tab-${t}`).addEventListener("keydown", (ev) => {
      const i = tabs.indexOf(t);
      const next = ev.key === "ArrowRight" ? tabs[(i + 1) % 3] : ev.key === "ArrowLeft" ? tabs[(i + 2) % 3]
        : ev.key === "Home" ? tabs[0] : ev.key === "End" ? tabs[2] : null;
      if (next) { selectTab(next); $(`tab-${next}`).focus(); }
    });
  }
  window.addEventListener("resize", () => graph.resize());
  initTheme();
  state.model = buildModel([], state.settings);
  rebuild();
  showView();
}

function initTheme() {
  const radios = [...document.querySelectorAll("[data-theme-choice]")];
  const set = (choice, focus = false) => {
    applyTheme(choice);
    writeTheme(storage, choice);
    for (const r of radios) {
      const on = r.dataset.themeChoice === choice;
      r.setAttribute("aria-checked", String(on));
      r.tabIndex = on ? 0 : -1;
      if (on && focus) r.focus();
    }
  };
  set(readTheme(storage));
  radios.forEach((r, i) => {
    r.addEventListener("click", () => set(r.dataset.themeChoice));
    r.addEventListener("keydown", (ev) => {
      const d = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
      if (d) { ev.preventDefault(); set(radios[(i + d + radios.length) % radios.length].dataset.themeChoice, true); }
    });
  });
}

function syncQuick() {
  const terms = state.query.split(/\s+/);
  for (const b of document.querySelectorAll(".np-quick")) b.setAttribute("aria-pressed", String(terms.includes(b.dataset.q)));
}

init();
