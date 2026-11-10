// Cytoscape wrapper: stylesheet from CSS tokens, layout, selection, PNG export.
import cytoscape from "../../vendor/cytoscape-3.34.4/cytoscape.esm.min.mjs";
import { groupedLayout } from "./layout.js";
import { osIcon, OS_LIST } from "./icons.js";

const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function stylesheet() {
  const risk = {
    vulnerable: token("--np-risk-vulnerable", "#ff5d5d"),
    exploitable: token("--np-risk-exploitable", "#ffa23a"),
    safe: token("--np-risk-safe", "#c9d1dc"),
    unclassified: token("--np-risk-unclassified", "#6f7f99"),
  };
  const text = token("--np-node-text", "#e8edf5");
  const select = token("--np-select", "#7cc4ff");
  const font = token("--lg-font", "system-ui, sans-serif");
  return [
    { selector: "node", style: { label: "data(label)", color: text, "font-family": font, "font-size": 10, "text-wrap": "wrap",
      "text-max-width": 140, "min-zoomed-font-size": 5, "text-outline-width": 0 } },
    { selector: "node.host", style: { width: 34, height: 34, shape: "ellipse", "background-color": token("--np-node", "#2a3446"),
      "background-image": "data(icon)", "background-fit": "none", "background-width": "60%", "background-height": "60%", "background-position-x": "50%", "background-position-y": "50%", "background-clip": "none", "border-width": 2,
      "border-color": token("--np-group-border", "#556"), "text-valign": "bottom", "text-margin-y": 7, "font-size": 9, "line-height": 1.25 } },
    ...OS_LIST.map((os) => ({ selector: `node.os-${os}`, style: { "background-image": osIcon(os, token("--np-icon", "#8aa0bf")) } })),
    { selector: "node.role-server", style: { shape: "round-rectangle" } },
    { selector: "node.role-both", style: { shape: "diamond", width: 40, height: 40 } },
    { selector: 'node.host[border = "vulnerable"]', style: { "border-color": risk.vulnerable } },
    { selector: 'node.host[border = "exploitable"]', style: { "border-color": risk.exploitable } },
    { selector: 'node.host[border = "safe"]', style: { "border-color": risk.safe } },
    { selector: 'node.host[border = "unclassified"]', style: { "border-color": risk.unclassified } },
    { selector: "node.seen-only", style: { "background-color": token("--np-node-seen", "#3a3f48"), opacity: 0.55, "border-style": "dashed" } },
    { selector: "node.group", style: { shape: "round-rectangle", "background-color": token("--np-group", "#7896c8"),
      "background-opacity": Number(token("--np-group-alpha", ".1")), "border-width": 1, "border-color": token("--np-group-border", "#556"), "text-valign": "top",
      "text-halign": "center", "font-size": 12, "font-weight": 600, padding: 14, "text-margin-y": -4 } },
    { selector: "node.internet", style: { "background-color": token("--np-internet", "#5aaaff"), "background-opacity": Number(token("--np-internet-alpha", ".12")) } },
    { selector: "node.collapsed", style: { "background-opacity": 0.35 } },
    { selector: "node.collapsed", style: { width: 96, height: 52, "text-valign": "center", "font-size": 11, "text-max-width": 90 } },
    { selector: "node.collapsed.internet", style: { shape: "ellipse", width: 120, height: 64 } },
    { selector: "edge", style: { width: 1.6, "line-color": risk.unclassified, "target-arrow-color": risk.unclassified,
      "target-arrow-shape": "triangle", "arrow-scale": 0.7, "curve-style": "bezier", opacity: 0.9 } },
    ...Object.entries(risk).map(([r, c]) => ({ selector: `edge.risk-${r}`, style: { "line-color": c, "target-arrow-color": c } })),
    { selector: "edge.merged", style: { width: "mapData(count, 1, 40, 2, 7)", label: "data(label)", "font-size": 9, color: text,
      "text-rotation": "autorotate", "text-background-opacity": 0 } },
    { selector: "edge.seen-one", style: { "line-style": "dashed", "line-dash-pattern": [6, 4] } },
    { selector: ".faded", style: { opacity: 0.12 } },
    { selector: "edge.faded", style: { opacity: 0.06 } },
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
  cy.on("dragfree", "node", (ev) => {
    const moved = ev.target.isParent() ? ev.target.descendants().filter((n) => !n.isParent()) : ev.target;
    moved.forEach((n) => { const p = n.position(); handlers.onMoved(n.id(), { x: Math.round(p.x), y: Math.round(p.y) }); });
  });
  // re-read the colour tokens when the system theme or a forced data-theme changes
  const restyle = () => cy.style(stylesheet());
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", restyle);
  new MutationObserver(restyle).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  return {
    cy,
    /** Replace all elements. Saved positions win unless relayout; others come from the grouped layout. */
    render(els, positions, { relayout = false, fit = false } = {}) {
      const { nodes, edges } = els;
      const large = nodes.length + edges.length > 3000;
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
      cy.style().selector("edge").style("curve-style", large ? "haystack" : "bezier").update();
      if (fit || relayout || !hadNodes) cy.fit(undefined, 30);
      return Promise.resolve();
    },
    positions() {
      const out = {};
      cy.nodes().filter((n) => !n.isParent()).forEach((n) => { const p = n.position(); out[n.id()] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }; });
      return out;
    },
    select(id) {
      cy.$(":selected").unselect();
      if (!id) return;
      const n = cy.getElementById(id);
      if (n.nonempty()) { n.select(); cy.animate({ center: { eles: n } }, { duration: reducedMotion() ? 0 : 250 }); }
    },
    fit() { cy.fit(undefined, 30); },
    resize() { cy.resize(); },
    png(full) {
      return cy.png({ output: "blob", full, scale: 2, bg: getComputedStyle(document.body).backgroundColor || "#111" });
    },
  };
}
