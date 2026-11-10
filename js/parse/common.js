// Helpers shared by the per-format parsers.

import { normalizeState } from "./states.js";
import { cleanText } from "./header.js";

const CANDIDATE = /^(tcp|udp)(4|6|46)?$/i;
const MAX_LINE_SAMPLE = 300;
const MAX_SAMPLES = 50;

/** Split text into lines on any line ending. */
export function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

/** @param {string[]} tokens */
export function isCandidate(tokens) {
  return tokens.length > 0 && CANDIDATE.test(tokens[0]);
}

/** Create a parse accumulator. */
export function createResult() {
  const unknown = new Set();
  return {
    records: [],
    unparsed: [],
    unparsedCount: 0,
    unknown,
    addUnparsed(lineNo, line) {
      if (++this.unparsedCount > MAX_SAMPLES) return; // count all, keep a few
      // eslint-disable-next-line no-control-regex -- strip control characters from untrusted text
      this.unparsed.push({ lineNo, line: line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, MAX_LINE_SAMPLE) });
    },
    /** @returns {import('./types.js').FormatResult} */
    finish() {
      return { records: this.records, unparsed: this.unparsed, unparsedCount: this.unparsedCount, unknownStates: [...unknown] };
    },
  };
}

/**
 * Build a record from already split endpoints.
 * @param {string} protoToken e.g. "TCP", "tcp6", "udp4"
 * @param {{ip: string, family: 4|6, port: number|null}} local
 * @param {{ip: string, family: 4|6, port: number|null}} remote
 * @param {string|null} stateWord the raw state word, or null when the column is empty
 * @param {Set<string>} unknown collects unknown state words
 * @returns {import('./types.js').NetRecord|null} null when a TCP line has no state
 */
export function makeRecord(protoToken, local, remote, stateWord, unknown) {
  const lower = protoToken.toLowerCase();
  const proto = lower.startsWith("tcp") ? "tcp" : "udp";
  let family = local.ip === "*" && remote.ip !== "*" ? remote.family : local.family;
  if (lower.endsWith("6") && local.ip === "*" && remote.ip === "*") family = 6;
  const remoteWild = remote.ip === "*";
  // Windows writes a listening socket's remote as 0.0.0.0:0, other systems as *:* — same meaning
  const remotePort = remoteWild && remote.port === 0 ? null : remote.port;
  let state;
  if (stateWord) {
    state = normalizeState(stateWord);
    if (!state) {
      unknown.add(cleanText(stateWord, 40));
      state = remoteWild ? "LISTEN" : "UNKNOWN";
    }
  } else if (proto === "udp") {
    state = remoteWild ? "BOUND" : "ESTABLISHED";
  } else {
    return null;
  }
  return { proto, family, localIp: local.ip, localPort: local.port, remoteIp: remote.ip, remotePort, state };
}

/** Attach optional pid/process to a record, validating them. */
export function addProcess(record, pid, process) {
  if (pid !== undefined && pid !== null && /^\d{1,10}$/.test(String(pid))) record.pid = Number(pid);
  if (process) {
    const name = cleanText(process, 128);
    if (name) record.process = name;
  }
  return record;
}
