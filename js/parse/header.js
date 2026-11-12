// The optional "### netstat-parser v1" header written by the app's collect commands and the
// collector, plus hostname fallback from the file name. All input is untrusted.

import { normalizeIp } from "../lib/ip.js";

const START = "### netstat-parser v1";
const END = "### netstat";
const MAX_HEADER_LINES = 50;

/**
 * Remove control, bidi and zero-width characters, trim, and cap the length.
 * @param {string} s
 * @param {number} max
 */
export function cleanText(s, max) {
  // also bidi overrides and zero-width characters, which can spoof how a name is displayed
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return String(s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim().slice(0, max).trim();
}

/** "255.255.0.0" → 16; null for a non-contiguous or invalid mask. */
function maskPrefix(mask) {
  const parts = mask.split(".").map(Number);
  if (parts.some((p) => p > 255)) return null;
  const bits = parts.map((p) => p.toString(2).padStart(8, "0")).join("");
  return /^1*0*$/.test(bits) ? bits.indexOf("0") === -1 ? 32 : bits.indexOf("0") : null;
}

function parseAddresses(value) {
  const out = [];
  for (const part of value.split(",")) {
    // "10.0.0.5/24", or "10.0.0.5/255.255.255.0" (ifconfig's netmask, where there is no `ip`)
    const m = /^\s*([^/\s]+)(?:\/(\d{1,3}(?:\.\d{1,3}){3}|\d{1,3}))?\s*$/.exec(part);
    if (!m) continue;
    const ip = normalizeIp(m[1]);
    const prefix = m[2] === undefined ? null : m[2].includes(".") ? maskPrefix(m[2]) : Number(m[2]);
    if (!ip || ip.ip === "*" || (prefix !== null && prefix > (ip.family === 4 ? 32 : 128))) continue;
    out.push({ ip: ip.ip, prefix });
  }
  return out;
}

/**
 * @param {string} text
 * @returns {{header: import('./types.js').Header|null, body: string}}
 */
export function parseHeader(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || lines[i].trim() !== START) return { header: null, body: text };

  const header = { hostname: null, os: null, collected: null, addresses: [] };
  let j = i + 1;
  for (; j < lines.length && j <= i + MAX_HEADER_LINES; j++) {
    const line = lines[j].trim();
    if (line === END) { j++; break; }
    const m = /^([a-z]+):\s*(.*)$/i.exec(line);
    if (!m) break; // no end marker: netstat output starts here
    const key = m[1].toLowerCase();
    const value = m[2];
    if (key === "hostname") header.hostname = cleanText(value, 253) || null;
    else if (key === "os") header.os = cleanText(value, 200) || null;
    else if (key === "collected") header.collected = cleanText(value, 40) || null;
    else if (key === "addresses") header.addresses = parseAddresses(value);
  }
  return { header, body: lines.slice(j).join("\n") };
}

/**
 * "DC01_netstat.txt" → "DC01"; otherwise the base name without a .txt/.log/.out extension.
 * Other dots are kept: "10.0.0.5" and "web01.corp.local" are host names, not extensions.
 * @param {string} name
 */
export function hostnameFromFileName(name) {
  const base = String(name).split(/[\\/]/).pop() ?? "";
  const noExt = base.replace(/\.(txt|log|out)$/i, "") || base;
  const raw = noExt.replace(/_netstat$/i, "") || noExt;
  return cleanText(raw, 253) || "unknown";
}
