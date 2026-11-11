// netstat-parser controller. Owns the job state, wires the DOM, and re-renders from pure modules.
// Untrusted data reaches the DOM only through textContent (see js/ui/dom.js).

import { buildModel } from "./model/build.js";
import { parseQuery, applyFilter } from "./model/filter.js";
import { connectionsCsv, hostsCsv, targetsFile } from "./model/exports.js";
import { createSession, parseSession } from "./model/session.js";
import { mergeSessionSettings, validateSettings, SAVED_FILTERS_MAX, SAVED_NAME_MAX } from "./model/settings.js";
import { findPath, neighbourhood } from "./model/paths.js";
import { VERSION } from "./version.js";
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
import { readJob, writeJob, clearJob } from "./ui/job-db.js";
import { toSaved, fromSaved } from "./model/saved-job.js";
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
  hops: 0, // 0 = draw everything; 1 or 2 = only the selection's neighbourhood
  pathStart: null, // host id chosen with "Start a path here"
  path: null, // {from, to, hosts, edges, riskyOnly, directed} when a path is shown
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
 * Modal question. Returns "ok", "alt" (the optional middle choice) or null (cancelled). With
 * `input`, it asks for a line of text instead and returns that text, or null when cancelled.
 * @param {string} text
 * @param {{ok?: string, alt?: string, title?: string, input?: {label: string, value?: string, max?: number}}} [labels]
 */
function askDialog(text, { ok: okLabel = "Continue", alt: altLabel = null, title = "Confirm", input = null } = {}) {
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
    const field = $("dialog-field"), inp = $("dialog-input");
    field.hidden = !input;
    if (input) { $("dialog-input-label").textContent = input.label; inp.value = input.value ?? ""; inp.maxLength = input.max ?? 200; }
    d.hidden = false;
    if (input) { inp.focus(); inp.select(); } else ok.focus();
    const buttons = () => [input ? inp : null, cancel, alt, ok].filter((b) => b && !b.hidden);
    const done = (choice) => {
      const v = input ? (choice === "ok" ? inp.value : null) : choice;
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
      if (ev.key === "Enter" && input && document.activeElement === inp) { ev.preventDefault(); done("ok"); }
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

function setDirty(v = true) { state.dirty = v && state.files.length > 0; scheduleSave(); }
// a job kept in the browser survives a reload, so only warn while a save is still on its way
window.addEventListener("beforeunload", (ev) => {
  if (state.dirty && !(state.settings.load.keepJob && !savePending)) { ev.preventDefault(); ev.returnValue = ""; }
});

// ---------- keeping the job across reloads (Settings → load.keepJob) ----------
let saveTimer = null, savePending = false, saveChain = Promise.resolve(), saveWarned = false;
function scheduleSave() {
  if (!state.settings.load.keepJob) return;
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; saveChain = saveChain.then(saveJobNow); }, 400);
}
async function saveJobNow() {
  // writes run one after another, so an older job can never overwrite a newer one
  const r = state.files.length && state.settings.load.keepJob
    ? await writeJob(toSaved({ files: state.files, settings: state.settings, dns: state.dns, positions: state.positions, collapsed: state.collapsed, dirty: state.dirty }))
    : await clearJob();
  savePending = saveTimer !== null;
  if (r.ok) saveWarned = false;
  else if (state.files.length && !saveWarned) {
    saveWarned = true;
    toast("This job could not be kept in the browser (storage full or blocked), so a reload loses it. Export a session to keep it.", "warn", 10000);
  }
}
async function restoreSavedJob() {
  if (!state.settings.load.keepJob) return;
  const gen = generation;
  const back = fromSaved(await readJob(), state.settings);
  if (!back || gen !== generation || state.files.length) return; // nothing kept, or the user already started
  Object.assign(state, { ...back, known: new Set(), selected: null });
  $("dns-btn").hidden = !state.settings.dns.enabled;
  rebuild({ adopt: true });
  toast(`Job restored: ${count(state.files.length, "file")}.`);
}

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
  const forget = state.settings.load.keepJob && !next.load.keepJob;
  state.settings = next;
  if (forget) { clearTimeout(saveTimer); saveTimer = null; saveChain = saveChain.then(saveJobNow); } // clears the kept job
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
  if (state.pathStart && !m.hosts.has(state.pathStart)) state.pathStart = null;
  if (state.path && !state.path.edges.every((id) => m.edges.has(id))) { state.path = null; graph.showPath(null); }
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
  const scope = scopeFor(state.selected);
  $("hops").classList.toggle("np-hops-idle", state.hops > 0 && !scope);
  const els = toElements(state.model, { collapsed: state.collapsed, visible: state.visible, mode: state.hide ? "hide" : "fade", dns: state.dns,
    labels: state.settings.graph.labels, scope });
  graph.render(els, state.positions, { relayout, fit: relayout || fit });
  renderHosts();
  if (state.selected) { graph.select(state.selected, { center: false }); showDetails(state.selected); }
}

/** The hosts a selection stands for (a host, a group's hosts, a connection's two ends). */
function hostsOf(id) {
  const m = state.model;
  if (!id || !m) return [];
  if (m.hosts.has(id)) return [id];
  if (m.groups.has(id)) return m.groups.get(id).hostIds;
  if (m.edges.has(id)) { const e = m.edges.get(id); return [e.source, e.target]; }
  if (id.startsWith("a:")) return id.slice(2).split("|").flatMap(hostsOf); // a merged line between collapsed groups
  return [];
}
/** Neighbourhood view: only what is within state.hops of the selection (null = draw everything). */
function scopeFor(id) {
  if (!state.hops) return null;
  const ids = hostsOf(id);
  return ids.length ? neighbourhood(state.model, ids, state.hops) : null;
}

// ---------- paths ----------
function findPathTo(to, { riskyOnly, directed }) {
  const from = state.pathStart, m = state.model;
  if (!from || !m.hosts.has(from) || !m.hosts.has(to)) return;
  const p = findPath(m, from, to, { riskyOnly, directed });
  const a = m.hosts.get(from).label, b = m.hosts.get(to).label;
  if (!p) {
    toast(`No path from ${a} to ${b}${riskyOnly ? " over red or orange connections" : ""}${directed ? " in the direction the connections were made" : ""}.`, "warn");
    return;
  }
  state.path = { from, to, ...p, riskyOnly, directed };
  // every host on the path must be drawn: expand its group, leave the neighbourhood view
  for (const id of p.hosts) state.collapsed.delete(m.hosts.get(id).groupId);
  if (state.hops) { state.hops = 0; $("hops").value = "0"; }
  refresh();
  const missing = graph.showPath(p);
  toast(`Path from ${a} to ${b}: ${count(p.edges.length, "hop")}.${missing ? " Part of it is hidden by the search (Hide non-matching)." : ""}`);
}
function clearPath() {
  state.path = null;
  graph.showPath(null);
  if (state.selected) showDetails(state.selected);
}
function pathProps(h) {
  const m = state.model, start = state.pathStart && m.hosts.get(state.pathStart);
  const result = state.path && state.path.to === h.id ? state.path : null;
  return {
    startLabel: start ? start.label : null,
    isStart: state.pathStart === h.id,
    onStart: () => { state.pathStart = h.id; showDetails(h.id); toast(`Path start: ${h.label}. Now select another host and choose "Find path".`); },
    onCancel: () => { state.pathStart = null; clearPath(); showDetails(h.id); },
    onFind: (opts) => findPathTo(h.id, opts),
    onClear: clearPath,
    result: result && {
      ...result,
      steps: result.edges.map((eid, i) => {
        const e = m.edges.get(eid), from = result.hosts[i];
        return { edge: e, from: m.hosts.get(from).label, to: m.hosts.get(result.hosts[i + 1]).label, forward: e.source === from };
      }),
    },
  };
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
    replace(pane, hostDetails({ model: m, host, dns: state.dns, onPick: pick, resolve, path: pathProps(host) }));
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
  Object.assign(state, { files: [], positions: {}, collapsed: new Set(), known: new Set(), dns: {}, selected: null, pathStart: null, path: null });
  graph.showPath(null);
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
    onSelect: (id) => {
      state.selected = id;
      if (state.hops) refresh({ fit: true }); else showDetails(id);
      if (id) selectTab("details");
    },
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
  $("hops").addEventListener("change", (ev) => {
    state.hops = Number(ev.target.value) || 0;
    if (state.hops && !hostsOf(state.selected).length) toast("Select a host, group or connection to see what is around it.");
    if (state.model) refresh({ fit: true });
  });
  $("save-filter-btn").addEventListener("click", saveFilter);
  renderSaved();
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
  $("app-version").textContent = `netstat-parser ${VERSION}`;
  state.model = buildModel([], state.settings);
  rebuild();
  showView();
  restoreSavedJob();
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
  for (const b of document.querySelectorAll(".np-saved-btn")) b.setAttribute("aria-pressed", String(state.query.trim() === b.dataset.q));
}

// ---------- saved filters (a setting: they belong to the user, not to the job) ----------
function setQuery(q) {
  state.query = q;
  $("search").value = q;
  syncQuick();
  if (state.model) refresh();
}
function renderSaved() {
  replace($("saved-filters"), state.settings.savedFilters.map((f) => el("span", { class: "np-saved-chip" },
    el("button", { class: "lg-btn lg-btn-ghost np-saved-btn", type: "button", title: f.query, "data-q": f.query,
      "aria-pressed": String(state.query.trim() === f.query), onclick: () => setQuery(state.query.trim() === f.query ? "" : f.query) }, f.name),
    el("button", { class: "lg-btn lg-btn-ghost np-saved-x", type: "button", title: `Remove "${f.name}"`, "aria-label": `Remove saved filter ${f.name}`,
      onclick: () => storeSaved(state.settings.savedFilters.filter((g) => g !== f)) }, "×"))));
}
function storeSaved(list) {
  state.settings = validateSettings({ ...state.settings, savedFilters: list });
  if (!saveSettings(storage, state.settings)) toast("Saved filters could not be stored in this browser (private mode?). They apply until you reload.", "warn");
  renderSaved();
}
async function saveFilter() {
  const q = state.query.trim();
  if (!q) { toast("Type a search first, then save it.", "warn"); $("search").focus(); return; }
  const name = (await askDialog(`Save the search "${q}" as a chip next to the quick filters.`,
    { title: "Save filter", ok: "Save", input: { label: "Name", value: q.slice(0, SAVED_NAME_MAX), max: SAVED_NAME_MAX } }))?.trim();
  if (!name) return;
  const others = state.settings.savedFilters.filter((f) => f.name.toLowerCase() !== name.toLowerCase());
  if (others.length >= SAVED_FILTERS_MAX) { toast(`At most ${SAVED_FILTERS_MAX} saved filters; remove one first.`, "warn"); return; }
  const replaced = others.length < state.settings.savedFilters.length;
  storeSaved([...others, { name, query: q }]);
  toast(replaced ? `Saved filter "${name}" updated.` : `Saved filter "${name}" added.`);
}

init();
