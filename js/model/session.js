// Session files: everything needed to reopen a job. Imports are untrusted: every field is
// rebuilt and validated; nothing from the input object is passed through as-is.

import { normalizeIp } from "../lib/ip.js";
import { cleanText } from "../parse/header.js";
import { STATES } from "../parse/types.js";
import { validateSettings } from "./settings.js";

export const SESSION_VERSION = 1;
const FORMAT = "netstat-parser-session";
const FORMATS = ["windows", "linux-netstat", "linux-ss", "macos"];
const STATE_SET = new Set([...STATES, "UNKNOWN"]);
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const HOSTNAME = /^[a-z0-9_.-]{1,253}$/i;

/**
 * @param {{files: object[], settings: object, dns: object, positions: object, collapsed: string[]}} job
 */
export function createSession(job) {
  return {
    format: FORMAT, version: SESSION_VERSION, savedAt: new Date().toISOString(),
    files: job.files, settings: job.settings, dns: job.dns, positions: job.positions, collapsed: job.collapsed,
  };
}

const str = (v, max) => (typeof v === "string" ? cleanText(v, max) : "");
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
// eslint-disable-next-line no-control-regex -- strip control characters, keep indentation
const sample = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 300) : "");

function canonicalIp(v) {
  if (v === "*") return "*";
  const n = typeof v === "string" ? normalizeIp(v) : null;
  return n && n.ip === v ? v : null;
}

function record(r) {
  if (!r || typeof r !== "object") return null;
  const proto = r.proto === "tcp" || r.proto === "udp" ? r.proto : null;
  const family = r.family === 4 || r.family === 6 ? r.family : null;
  const localIp = canonicalIp(r.localIp), remoteIp = canonicalIp(r.remoteIp);
  const port = (p) => (p === null ? null : int(p, 0, 65535));
  const localPort = port(r.localPort), remotePort = port(r.remotePort);
  const state = STATE_SET.has(r.state) ? r.state : null;
  if (!proto || !family || !localIp || !remoteIp || localPort === undefined || remotePort === undefined || !state) return null;
  const out = { proto, family, localIp, localPort, remoteIp, remotePort, state };
  const pid = int(r.pid, 0, 4294967295);
  if (pid !== undefined) out.pid = pid;
  const proc = str(r.process, 128);
  if (proc) out.process = proc;
  return out;
}

function header(h) {
  if (!h || typeof h !== "object") return null;
  const addresses = Array.isArray(h.addresses) ? h.addresses.map((a) => {
    const ip = a && canonicalIp(a.ip);
    const prefix = a && (a.prefix === null ? null : int(a.prefix, 0, 128));
    return ip && ip !== "*" && prefix !== undefined ? { ip, prefix } : null;
  }).filter(Boolean) : [];
  return { hostname: str(h.hostname, 253) || null, os: str(h.os, 200) || null, collected: str(h.collected, 40) || null, addresses };
}

function parsedFile(f) {
  if (!f || typeof f !== "object") return null;
  const hostname = str(f.hostname, 253);
  if (!hostname) return null;
  const w = f.warnings && typeof f.warnings === "object" ? f.warnings : {};
  const records = Array.isArray(f.records) ? f.records.slice(0, 500000).map(record).filter(Boolean) : [];
  return {
    fileName: str(f.fileName, 255) || "unnamed",
    format: FORMATS.includes(f.format) ? f.format : null,
    hostname,
    hostnameSource: f.hostnameSource === "header" ? "header" : "filename",
    header: header(f.header),
    records,
    warnings: {
      unparsedCount: int(w.unparsedCount, 0, 1e9) ?? 0,
      unparsedSamples: Array.isArray(w.unparsedSamples) ? w.unparsedSamples.slice(0, 5).map((u) => ({ lineNo: int(u?.lineNo, 1, 1e9) ?? 1, line: sample(u?.line) })) : [],
      unknownStates: Array.isArray(w.unknownStates) ? w.unknownStates.slice(0, 50).map((s) => str(s, 40)).filter(Boolean) : [],
      notRecognised: w.notRecognised === true,
      truncatedAddresses: int(w.truncatedAddresses, 0, 1e9) ?? 0,
    },
  };
}

function entries(obj, max) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.entries(obj).slice(0, max).filter(([k]) => !BAD_KEYS.has(k)) : [];
}

/**
 * @param {string} text
 * @returns {{files: object[], settings: object, dns: object, positions: object, collapsed: string[]}}
 */
export function parseSession(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Not a netstat-parser session file"); }
  if (!data || typeof data !== "object" || data.format !== FORMAT) throw new Error("Not a netstat-parser session file");
  if (data.version !== SESSION_VERSION) throw new Error(`Unsupported session version ${String(data.version).slice(0, 20)}`);
  const files = Array.isArray(data.files) ? data.files.slice(0, 5000).map(parsedFile).filter(Boolean) : [];
  const dns = {};
  for (const [ip, name] of entries(data.dns, 100000)) {
    if (canonicalIp(ip) && ip !== "*" && (name === null || (typeof name === "string" && HOSTNAME.test(name)))) dns[ip] = name;
  }
  const positions = {};
  for (const [id, p] of entries(data.positions, 200000)) {
    if (id.length <= 300 && p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[id] = { x: p.x, y: p.y };
  }
  const collapsed = Array.isArray(data.collapsed) ? data.collapsed.filter((g) => typeof g === "string" && g.length <= 300).slice(0, 10000) : [];
  return { files, settings: validateSettings(data.settings), dns, positions, collapsed };
}
