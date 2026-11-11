// Cytoscape wrapper: stylesheet from CSS tokens, layout, selection, PNG export.
import cytoscape from "../../vendor/cytoscape-3.34.4/cytoscape.esm.min.mjs";
import { groupedLayout } from "./layout.js";
import { cloudImage, grainTile, osIcon, OS_LIST } from "./icons.js";

const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function stylesheet(large = false) {
  const risk = {
    vulnerable: token("--np-risk-vulnerable", "#ff5d5d"),
    exploitable: token("--np-risk-exploitable", "#ffa23a"),
    safe: token("--np-risk-safe", "#c9d1dc"),
    unclassified: token("--np-risk-unclassified", "#6f7f99"),
  };
  const text = token("--np-node-text", "#e8edf5");
  const select = token("--np-select", "#7cc4ff");
  const font = token("--lg-font", "system-ui, sans-serif");
  const num = (name, fallback) => { const v = Number(token(name, "")); return Number.isFinite(v) && token(name, "") !== "" ? v : fallback; };
  // Frosted glass. A canvas cannot blur what lies behind a shape, so the effect is built from what
  // it can draw: a translucent tint that is lighter at the top (sheen), a fine grain, a bright edge
  // with a dark hairline outside it, and a faint shadow.
  const glass = {
    tint: token("--np-glass-tint", "#7896c8"), alpha: num("--np-glass-alpha", 0.13), sheen: token("--np-glass-sheen", "#ffffff"),
    edge: token("--np-glass-edge", "#dfe9fb"), edgeAlpha: num("--np-glass-edge-alpha", 0.3),
    outline: token("--np-glass-outline", "#05080e"), outlineAlpha: num("--np-glass-outline-alpha", 0.45),
    grain: num("--np-glass-grain", 0.45), shadow: token("--np-glass-shadow", "#000000"), shadowAlpha: num("--np-glass-shadow-alpha", 0.16),
  };
  const cloud = cloudImage(token("--np-internet", "#5aaaff"), token("--np-internet-border", token("--np-group-border", "#6a7f9f")),
    Number(token("--np-internet-alpha", ".12")) * 1.4, { sheen: glass.sheen, grain: glass.grain });
  const grain = grainTile(glass.grain);
  return [
    { selector: "node", style: { label: "data(label)", color: text, "font-family": font, "font-size": 10, "text-wrap": "wrap",
      "text-max-width": 140, "min-zoomed-font-size": 5, "text-outline-width": 0 } },
    { selector: "node.host", style: { width: 34, height: 34, shape: "ellipse", "background-color": token("--np-node", "#2a3446"),
      "background-image": "data(icon)", "background-fit": "none", "background-width": "60%", "background-height": "60%", "background-position-x": "50%", "background-position-y": "50%", "background-clip": "none", "border-width": 2,
      "border-color": token("--np-group-border", "#556"), "text-valign": "bottom", "text-margin-y": 7, "font-size": 9, "line-height": 1.25,
      "min-zoomed-font-size": 7 } },
    ...OS_LIST.map((os) => ({ selector: `node.os-${os}`, style: { "background-image": osIcon(os, token("--np-icon", "#8aa0bf")) } })),
    { selector: "node.role-server", style: { shape: "round-rectangle" } },
    { selector: "node.role-both", style: { shape: "diamond", width: 40, height: 40 } },
    { selector: 'node.host[border = "vulnerable"]', style: { "border-color": risk.vulnerable } },
    { selector: 'node.host[border = "exploitable"]', style: { "border-color": risk.exploitable } },
    { selector: 'node.host[border = "safe"]', style: { "border-color": risk.safe } },
    { selector: 'node.host[border = "unclassified"]', style: { "border-color": risk.unclassified } },
    { selector: "node.seen-only", style: { "background-color": token("--np-node-seen", "#3a3f48"), opacity: 0.55, "border-style": "dashed" } },
    { selector: "node.group", style: { shape: "round-rectangle", "corner-radius": 18, "background-color": glass.tint,
      "background-fill": "linear-gradient", "background-gradient-direction": "to-bottom",
      "background-gradient-stop-colors": `${glass.sheen} ${glass.tint} ${glass.tint}`, "background-gradient-stop-positions": "0 40 100",
      "background-opacity": glass.alpha,
      "background-image": grain, "background-repeat": "repeat", "background-fit": "none", "background-width": 96, "background-height": 96,
      "background-clip": "node", "background-image-opacity": 1, "background-image-containment": "inside",
      "border-width": 1, "border-color": glass.edge, "border-opacity": glass.edgeAlpha,
      "outline-width": 1, "outline-color": glass.outline, "outline-opacity": glass.outlineAlpha, "outline-offset": 0,
      "underlay-color": glass.shadow, "underlay-opacity": glass.shadowAlpha, "underlay-padding": 3, "underlay-shape": "round-rectangle", "underlay-corner-radius": 21,
      "text-valign": "top",
      "text-halign": "center", "font-size": 15, "font-weight": 600, padding: 14, "text-margin-y": -4, "min-zoomed-font-size": 0,
      "text-background-color": token("--np-label-bg", "#141a24"), "text-background-opacity": 0.75, "text-background-padding": 3,
      "text-background-shape": "round-rectangle" } },
    // The Internet group is a cloud image (the CSP allows data: images) on an invisible box. The
    // image is 138 % x 174 % of the box and shifted up, so the box lands on the cloud's safe area
    // (icons.js) and the lobes rise above the hosts; the label sits in the dome.
    { selector: "node.internet", style: { "background-opacity": 0, "border-width": 0, "outline-width": 0, "underlay-opacity": 0, "background-image": cloud,
      "background-repeat": "no-repeat", "background-image-opacity": 1,
      "background-fit": "none", "background-width": "138.3%", "background-height": "173.9%", "background-position-x": "50%",
      "background-position-y": "82.4%", "background-clip": "none", "background-image-containment": "over",
      "bounds-expansion": (ele) => Math.ceil(0.62 * ele.height()) + 4, "text-margin-y": (ele) => -Math.round(0.3 * ele.height()), "font-size": 16, "font-weight": 700,
      color: token("--np-internet-text", text), "text-background-opacity": 0 } },
    { selector: "node.collapsed", style: { "background-opacity": Math.min(1, glass.alpha * 2.2) } },
    { selector: "node.collapsed", style: { width: 140, height: 76, "text-valign": "center", "font-size": 14, "text-max-width": 130 } },
    { selector: "node.collapsed.internet", style: { shape: "round-rectangle", width: 160, height: 98, "background-opacity": 0,
      "background-width": "100%", "background-height": "100%", "background-position-y": "50%", "bounds-expansion": 0,
      "text-margin-y": 10, "font-size": 12 } },
    { selector: "edge", style: { width: 1.6, "line-color": risk.unclassified, "target-arrow-color": risk.unclassified,
      "target-arrow-shape": "triangle", "arrow-scale": 0.7, "curve-style": large ? "haystack" : "bezier", opacity: 0.9 } },
    ...Object.entries(risk).map(([r, c]) => ({ selector: `edge.risk-${r}`, style: { "line-color": c, "target-arrow-color": c } })),
    { selector: "edge.merged", style: { width: "mapData(count, 1, 40, 2, 7)", label: "data(label)", "font-size": 9, color: text,
      "text-rotation": "autorotate", "text-background-opacity": 0 } },
    { selector: "edge.seen-one", style: { "line-style": "dashed", "line-dash-pattern": [6, 4] } },
    { selector: ".faded", style: { opacity: 0.12 } },
    // focus: everything outside the selection's neighbourhood steps back
    { selector: "node.host.dim", style: { opacity: 0.18 } },
    { selector: "node.group.dim", style: { "text-opacity": 0.4 } },
    { selector: "edge.dim", style: { opacity: 0.05 } },
    { selector: "edge.focus", style: { opacity: 1, width: 2.4, "z-index": 10 } },
    { selector: "edge.faded", style: { opacity: 0.06 } },
    // a found path: drawn on top, everything else steps back
    { selector: "edge.on-path", style: { width: 4.5, "line-color": select, "target-arrow-color": select, "arrow-scale": 1, opacity: 1, "z-index": 30 } },
    { selector: "node.host.on-path", style: { "border-color": select, "border-width": 3.5, opacity: 1 } },
    { selector: ":selected", style: { "overlay-color": select, "overlay-opacity": 0.25, "overlay-padding": 4 } },
    { selector: "node.host:selected", style: { "border-color": select, "border-width": 3 } },
  ];
}

export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * @param {HTMLElement} container
 * @param {{onSelect: (id: string|null) => void, onToggleGroup: (id: string) => void, onMoved: (id: string, pos: {x: number, y: number}) => void}} handlers
 */
export function createGraph(container, handlers) {
  const cy = cytoscape({ container, elements: [], style: stylesheet(), minZoom: 0.05, maxZoom: 4,
    boxSelectionEnabled: false, textureOnViewport: true, motionBlur: false });
  cy.on("tap", (ev) => {
    if (ev.target === cy) handlers.onSelect(null);
    else handlers.onSelect(ev.target.id());
  });
  cy.on("dbltap", "node.group", (ev) => handlers.onToggleGroup(ev.target.id()));
  // focus the selection: its own connections and neighbours stay, the rest steps back
  let path = null; // {hosts, edges} while a path is shown; it wins over the selection focus
  const unfocus = () => { cy.elements().removeClass("dim focus"); if (path) applyPath(); };
  /** @returns {number} how many path elements are not drawn (hidden by a filter) */
  const applyPath = () => {
    cy.elements().removeClass("on-path");
    if (!path) return 0;
    let on = cy.collection(), missing = 0;
    for (const id of [...path.hosts, ...path.edges]) {
      const e = cy.getElementById(id);
      if (e.empty()) missing++; else on = on.union(e);
    }
    const keep = on.union(on.nodes().ancestors());
    cy.batch(() => {
      cy.elements().removeClass("dim focus");
      cy.elements().not(keep).addClass("dim");
      on.addClass("on-path");
    });
    return missing;
  };
  const focus = (ele) => {
    if (path) { applyPath(); return; }
    cy.elements().removeClass("dim focus");
    let keep;
    if (ele.isEdge()) keep = ele.union(ele.connectedNodes());
    else if (ele.isParent()) keep = ele.union(ele.descendants()).union(ele.descendants().connectedEdges()).union(ele.descendants().neighborhood());
    else keep = ele.closedNeighborhood();
    keep = keep.union(keep.nodes().ancestors());
    cy.batch(() => {
      cy.elements().not(keep).addClass("dim");
      keep.edges().addClass("focus");
    });
  };
  cy.on("select", (ev) => focus(ev.target));
  cy.on("unselect", () => { if (cy.$(":selected").empty()) unfocus(); });
  // refit when the canvas changes size (rotation, panel, window) until the user moves the view
  let userMoved = false;
  cy.on("scrollzoom pinchzoom dragpan", () => { userMoved = true; });
  if (typeof window.ResizeObserver === "function") {
    new window.ResizeObserver(() => { cy.resize(); if (!userMoved && cy.nodes().length) cy.fit(undefined, 30); }).observe(container);
  }
  cy.on("dragfree", "node", (ev) => {
    const moved = ev.target.isParent() ? ev.target.descendants().filter((n) => !n.isParent()) : ev.target;
    moved.forEach((n) => { const p = n.position(); handlers.onMoved(n.id(), { x: Math.round(p.x), y: Math.round(p.y) }); });
  });
  // re-read the colour tokens when the system theme or a forced data-theme changes
  let large = false;
  const restyle = () => cy.style(stylesheet(large));
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", restyle);
  new MutationObserver(restyle).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  return {
    cy,
    /** Replace all elements. Saved positions win unless relayout; others come from the grouped layout. */
    render(els, positions, { relayout = false, fit = false } = {}) {
      const { nodes, edges } = els;
      const isLarge = nodes.length + edges.length > 3000;
      const computed = groupedLayout(els);
      const hadNodes = cy.nodes().length > 0;
      cy.startBatch();
      cy.elements().remove();
      cy.add([...nodes.map((n) => ({ group: "nodes", ...n })), ...edges.map((e) => ({ group: "edges", ...e }))]);
      cy.nodes().filter((n) => !n.isParent()).forEach((n) => {
        const p = (!relayout && positions[n.id()]) || computed[n.id()];
        if (p) n.position(p);
      });
      cy.endBatch();
      // only rebuild the stylesheet when the size class changes (appending rules every render leaks)
      if (isLarge !== large) { large = isLarge; restyle(); }
      if (fit || relayout || !hadNodes) { cy.fit(undefined, 30); userMoved = false; }
      applyPath();
      return Promise.resolve();
    },
    /** Show a path ({hosts, edges} ids) or clear it (null). Returns how many of its elements are not drawn. */
    showPath(p) {
      path = p ? { hosts: [...p.hosts], edges: [...p.edges] } : null;
      if (!path) { cy.elements().removeClass("on-path dim focus"); const sel = cy.$(":selected"); if (sel.nonempty()) focus(sel[0]); return 0; }
      const missing = applyPath();
      const on = cy.elements(".on-path");
      if (on.nonempty()) cy.animate({ fit: { eles: on, padding: 60 } }, { duration: reducedMotion() ? 0 : 300 });
      return missing;
    },
    positions() {
      const out = {};
      cy.nodes().filter((n) => !n.isParent()).forEach((n) => { const p = n.position(); out[n.id()] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }; });
      return out;
    },
    select(id, { center = true } = {}) {
      cy.$(":selected").unselect();
      if (!id) return;
      const n = cy.getElementById(id);
      if (n.nonempty()) { n.select(); if (center) cy.animate({ center: { eles: n } }, { duration: reducedMotion() ? 0 : 250 }); }
    },
    fit() { cy.fit(undefined, 30); userMoved = false; },
    resize() { cy.resize(); },
    png(full) {
      return cy.png({ output: "blob", full, scale: 2, bg: getComputedStyle(document.body).backgroundColor || "#111" });
    },
  };
}
