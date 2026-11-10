// Detect the netstat flavour from the shape of its socket lines (never from header words,
// which Windows translates).

const SHAPES = [
  // order = tie-break priority
  ["linux-ss", /^(tcp|udp)\s+[A-Z][A-Z0-9-]*\s+\d+\s+\d+\s+\S+:\S+\s+\S+:\S+/],
  ["macos", /^(tcp|udp)(4|6|46)\s+\d+\s+\d+\s+\S+\.(\d+|\*)\s+\S+\.(\d+|\*)/],
  ["linux-netstat", /^(tcp|udp)6?\s+\d+\s+\d+\s+\S+:(\d+|\*)\s+\S+:(\d+|\*)/],
  ["windows", /^(TCP|UDP)\s+\S+:\d+\s+\S+:(\d+|\*)/],
];
const MAX_CANDIDATES = 500;

/**
 * @param {string} body
 * @returns {import('./types.js').Format|null}
 */
export function detectFormat(body) {
  const counts = new Map(SHAPES.map(([name]) => [name, 0]));
  let seen = 0;
  for (const raw of body.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!/^(tcp|udp)/i.test(line)) continue;
    for (const [name, re] of SHAPES) if (re.test(line)) counts.set(name, counts.get(name) + 1);
    if (++seen >= MAX_CANDIDATES) break;
  }
  let best = null, bestCount = 0;
  for (const [name] of SHAPES) {
    if (counts.get(name) > bestCount) { best = name; bestCount = counts.get(name); }
  }
  return best;
}
