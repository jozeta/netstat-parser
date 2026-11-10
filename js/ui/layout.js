// Deterministic grouped layout: hosts in a grid inside their group, groups packed in rows
// (shelf packing). Pure, fast for thousands of nodes, and never overlaps groups.

const CELL_W = 130, CELL_H = 96, PAD = 60, GAP = 90, COLLAPSED_W = 150, COLLAPSED_H = 100;
const ROLE_ORDER = { server: 0, both: 1, client: 2, unknown: 3 };

/**
 * @param {{nodes: object[], edges: object[]}} els from toElements
 * @returns {Record<string, {x: number, y: number}>}
 */
export function groupedLayout({ nodes, edges }) {
  const degree = new Map();
  for (const e of edges) for (const id of [e.data.source, e.data.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const children = new Map();
  for (const n of nodes) if (n.data.parent) {
    if (!children.has(n.data.parent)) children.set(n.data.parent, []);
    children.get(n.data.parent).push(n);
  }
  // items to pack: expanded groups (with children), collapsed groups, orphans
  const items = [];
  for (const n of nodes) {
    if (n.data.parent) continue;
    const kids = children.get(n.data.id);
    if (kids?.length) {
      kids.sort((a, b) => (ROLE_ORDER[a.data.role] ?? 9) - (ROLE_ORDER[b.data.role] ?? 9) || (degree.get(b.data.id) ?? 0) - (degree.get(a.data.id) ?? 0) || String(a.data.label).localeCompare(String(b.data.label)));
      const cols = Math.max(1, Math.ceil(Math.sqrt(kids.length * 1.6)));
      const rows = Math.ceil(kids.length / cols);
      items.push({ id: n.data.id, kids, cols, w: cols * CELL_W + PAD, h: rows * CELL_H + PAD, internet: n.data.kind === "internet" });
    } else {
      items.push({ id: n.data.id, kids: null, w: COLLAPSED_W, h: COLLAPSED_H, internet: n.data.kind === "internet" });
    }
  }
  // big groups first, the Internet last (it reads as "outside")
  items.sort((a, b) => Number(a.internet) - Number(b.internet) || b.w * b.h - a.w * a.h || a.id.localeCompare(b.id));
  const area = items.reduce((s, i) => s + (i.w + GAP) * (i.h + GAP), 0);
  const maxRow = Math.max(Math.sqrt(area) * 1.4, ...items.map((i) => i.w));
  const pos = {};
  let x = 0, y = 0, rowH = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > maxRow) { x = 0; y += rowH + GAP; rowH = 0; }
    if (it.kids) {
      it.kids.forEach((k, i) => {
        pos[k.data.id] = { x: x + PAD / 2 + (i % it.cols) * CELL_W + CELL_W / 2, y: y + PAD / 2 + Math.floor(i / it.cols) * CELL_H + CELL_H / 2 };
      });
    } else {
      pos[it.id] = { x: x + it.w / 2, y: y + it.h / 2 };
    }
    x += it.w + GAP;
    rowH = Math.max(rowH, it.h);
  }
  return pos;
}
