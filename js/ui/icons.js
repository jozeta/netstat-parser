// Self-made OS glyphs (no brand logos) as SVG data URIs for Cytoscape node backgrounds.

const STROKE = "#9fb4d0";
const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const GLYPHS = {
  // four panes
  windows: wrap('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  // terminal prompt
  linux: wrap('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 10l3 2.5L7 15M12.5 15.5H17"/>'),
  // laptop
  macos: wrap('<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 18.5h18"/>'),
  // question mark in a circle
  unknown: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 16.8v.1"/>'),
};

const CACHE = new Map();

/** @param {string} os */
export function osIcon(os) {
  const key = Object.hasOwn(GLYPHS, os) ? os : "unknown";
  if (!CACHE.has(key)) CACHE.set(key, `data:image/svg+xml,${encodeURIComponent(GLYPHS[key])}`);
  return CACHE.get(key);
}
