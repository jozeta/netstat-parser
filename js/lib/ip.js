// IP address and endpoint normalisation. Pure; no DOM. Input is untrusted text.

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;

function parseV4(text) {
  const m = V4.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

/** Parse IPv6 text into 8 numeric groups, or null. Accepts a trailing embedded IPv4. */
function parseV6(text) {
  let s = text.toLowerCase();
  let tail = [];
  const lastColon = s.lastIndexOf(":");
  if (lastColon >= 0 && s.slice(lastColon + 1).includes(".")) {
    const v4 = parseV4(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, lastColon + 1) + "0"; // placeholder group, replaced below
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (h) => (h === "" ? [] : h.split(":"));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (tail.length) {
    // drop the placeholder from whichever half holds it
    (halves.length === 2 ? rest : head).pop();
  }
  const all = [...head, ...rest];
  if (!all.every((g) => HEX_GROUP.test(g))) return null;
  const nums = (arr) => arr.map((g) => parseInt(g, 16));
  const known = head.length + rest.length + tail.length;
  let groups;
  if (halves.length === 2) {
    if (known > 7) return null;
    const restNums = tail.length ? [...nums(rest), ...tail] : nums(rest);
    groups = [...nums(head), ...new Array(8 - known).fill(0), ...restNums];
  } else {
    if (known !== 8) return null;
    groups = [...nums(head), ...tail];
  }
  return groups;
}

function formatV6(groups) {
  // RFC 5952: compress the first longest run of >= 2 zero groups.
  let bestStart = -1, bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

/**
 * @param {string} text
 * @returns {{ip: string, family: 4|6} | null}
 */
export function normalizeIp(text) {
  if (typeof text !== "string") return null;
  let s = text.trim();
  if (s === "*") return { ip: "*", family: 4 };
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  if (s.length === 0 || s.length > 45) return null;
  const v4 = parseV4(s);
  if (v4) return { ip: v4.every((n) => n === 0) ? "*" : v4.join("."), family: 4 };
  if (!s.includes(":")) return null;
  const g = parseV6(s);
  if (!g) return null;
  if (g.every((n) => n === 0)) return { ip: "*", family: 6 };
  // IPv4-mapped ::ffff:a.b.c.d → IPv4
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    const ip = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
    return { ip: ip.every((n) => n === 0) ? "*" : ip.join("."), family: 4 };
  }
  return { ip: formatV6(g), family: 6 };
}

function parsePort(text) {
  if (text === "*") return { ok: true, port: null };
  if (!/^\d{1,5}$/.test(text)) return { ok: false };
  const n = Number(text);
  return n <= 65535 ? { ok: true, port: n } : { ok: false };
}

/**
 * Split "ip:port" (sep ':') or macOS "ip.port" (sep '.') into parts.
 * @param {string} token
 * @param {':'|'.'} sep
 * @returns {{ip: string, family: 4|6, port: number|null} | null}
 */
export function splitEndpoint(token, sep) {
  if (typeof token !== "string") return null;
  let host, portText;
  if (sep === ":" && token.startsWith("[")) {
    const close = token.indexOf("]");
    if (close < 0 || token[close + 1] !== ":") return null;
    host = token.slice(1, close);
    portText = token.slice(close + 2);
  } else {
    const at = token.lastIndexOf(sep);
    if (at <= 0) return null;
    host = token.slice(0, at);
    portText = token.slice(at + 1);
  }
  const port = parsePort(portText);
  if (!port.ok) return null;
  // Linux netstat writes IPv6 wildcard "::" before the port separator: ":::80" → host "::"
  const ip = normalizeIp(host);
  if (!ip) return null;
  return { ip: ip.ip, family: ip.family, port: port.port };
}

/** @param {string} ip canonical ip */
export function isWildcard(ip) {
  return ip === "*";
}

/** @param {string} ip canonical ip */
export function isLoopback(ip) {
  return ip === "::1" || /^127\./.test(ip);
}
