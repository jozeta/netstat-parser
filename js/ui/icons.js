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
