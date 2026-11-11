// Self-made OS glyphs (no brand logos) as SVG data URIs for Cytoscape node backgrounds.

const wrap = (body, stroke) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const GLYPHS = {
  // four panes
  windows: (c) => wrap('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>', c),
  // terminal prompt
  linux: (c) => wrap('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 10l3 2.5L7 15M12.5 15.5H17"/>', c),
  // laptop
  macos: (c) => wrap('<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 18.5h18"/>', c),
  // question mark in a circle
  unknown: (c) => wrap('<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 16.8v.1"/>', c),
};

const CACHE = new Map();

/**
 * @param {string} os
 * @param {string} [color] stroke colour (the graph passes the theme's --np-icon)
 */
export function osIcon(os, color = "#8aa0bf") {
  const key = Object.hasOwn(GLYPHS, os) ? os : "unknown";
  const c = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#8aa0bf";
  const id = `${key}|${c}`;
  if (!CACHE.has(id)) CACHE.set(id, `data:image/svg+xml,${encodeURIComponent(GLYPHS[key](c))}`);
  return CACHE.get(id);
}
export const OS_LIST = Object.keys(GLYPHS);

// Cloud outline for the Internet group, drawn the way icon sets draw clouds: a flat base and five
// overlapping round lobes with one dominant dome (the union of circles at (44,112,r42) (72,62,r44)
// (138,58,r56) (196,64,r42) (216,112,r42) over a flat bottom at y 154, in a 260 x 160 box).
// The group's hosts sit in the safe box x 36-224, y 56-148; graph.js sizes and offsets the image so
// that box matches the group, and layout.js reserves the room the lobes need.
const CLOUD_PATH = "M44 154 A42 42 0 0 1 29.3 72.7 A44 44 0 0 1 93.7 23.7 A56 56 0 0 1 182.6 24.2 " +
  "A42 42 0 0 1 236.4 75.3 A42 42 0 0 1 216 154 Z";
const hex = (c, fallback) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback);

const clamp01 = (v, fallback) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
// fine white noise; the alpha channel carries the grain so it lightens whatever is under it
// (the cloud image is drawn several times larger than its 260 x 160 box, so it needs a finer noise)
const grainFilter = (freq) => `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="7" stitchTiles="stitch"/>` +
  '<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.8 -0.3"/>';

/**
 * The Internet cloud as frosted glass: a translucent tint that is lighter at the top (the sheen),
 * a fine grain, a bright inner edge that fades downwards, and the outline.
 * @param {string} fill   the theme's --np-internet
 * @param {string} stroke the theme's --np-internet-border
 * @param {number} [alpha] tint opacity (Cytoscape ignores alpha in colours, so it is passed apart)
 * @param {{sheen?: string, grain?: number}} [glass] --np-glass-sheen and --np-glass-grain
 */
export function cloudImage(fill, stroke, alpha = 0.14, { sheen = "#ffffff", grain = 0.5 } = {}) {
  const a = clamp01(alpha, 0.14), g = clamp01(grain, 0.5), f = hex(fill, "#5aaaff"), sh = hex(sheen, "#ffffff");
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160" viewBox="0 0 260 160" preserveAspectRatio="none"><defs>` +
    `<linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${sh}" stop-opacity="${Math.min(1, a * 1.6).toFixed(3)}"/>` +
    `<stop offset="0.45" stop-color="${f}" stop-opacity="${a}"/>` +
    `<stop offset="1" stop-color="${f}" stop-opacity="${(a * 0.7).toFixed(3)}"/></linearGradient>` +
    `<linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${sh}" stop-opacity="0.55"/><stop offset="0.5" stop-color="${sh}" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="shape"><path d="${CLOUD_PATH}"/></clipPath>` +
    `<filter id="grain" x="0" y="0" width="100%" height="100%">${grainFilter(2.6)}</filter></defs>` +
    `<path d="${CLOUD_PATH}" fill="url(#fill)"/>` +
    `<rect width="260" height="160" filter="url(#grain)" clip-path="url(#shape)" opacity="${g}"/>` +
    // the inner highlight: a wide stroke clipped to the inside, so only its inner half shows
    `<path d="${CLOUD_PATH}" fill="none" stroke="url(#edge)" stroke-width="5" clip-path="url(#shape)"/>` +
    `<path d="${CLOUD_PATH}" fill="none" stroke="${hex(stroke, "#6a7f9f")}" ` +
    `stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(body)}`;
}

/**
 * A small seamless noise tile, repeated over subnet groups for the frosted-glass grain.
 * @param {number} [strength] 0-1
 */
export function grainTile(strength = 0.5) {
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<filter id="grain" x="0" y="0" width="100%" height="100%">${grainFilter(1.4)}</filter>` +
    `<rect width="96" height="96" filter="url(#grain)" opacity="${clamp01(Number(strength), 0.5)}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(body)}`;
}
