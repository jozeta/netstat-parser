// macOS (BSD) `netstat -an` / `netstat -anv -p tcp`. Endpoints use a dot before the port.
//   tcp4       0      0  192.168.50.12.52344    203.0.113.10.443       ESTABLISHED
//   tcp46      0      0  *.22                   *.*                    LISTEN
// -v adds columns, including a "process:pid" token.

import { splitEndpoint } from "../lib/ip.js";
import { normalizeState } from "./states.js";
import { splitLines, isCandidate, createResult, makeRecord, addProcess } from "./common.js";

const PROC_PID = /^([^:\s]+):(\d+)$/;

/**
 * @param {string} body
 * @returns {import('./types.js').FormatResult}
 */
export function parseMacos(body) {
  const res = createResult();
  splitLines(body).forEach((line, idx) => {
    const tokens = line.trim().split(/\s+/);
    if (!isCandidate(tokens)) return;
    const ok = tokens.length >= 5 && /^\d+$/.test(tokens[1]) && /^\d+$/.test(tokens[2]);
    const local = ok ? splitEndpoint(tokens[3], ".") : null;
    const remote = local ? splitEndpoint(tokens[4], ".") : null;
    if (!local || !remote) { res.addUnparsed(idx + 1, line); return; }
    let rest = tokens.slice(5);
    let stateWord = null;
    const isTcp = tokens[0].toLowerCase().startsWith("tcp");
    // TCP always has a state column; UDP only has one if the word is a known state.
    if (rest.length && (isTcp || normalizeState(rest[0]))) { stateWord = rest[0]; rest = rest.slice(1); }
    const rec = makeRecord(tokens[0], local, remote, stateWord, res.unknown);
    if (!rec) { res.addUnparsed(idx + 1, line); return; }
    const pp = rest.map((t) => PROC_PID.exec(t)).find(Boolean);
    if (pp) addProcess(rec, pp[2], pp[1]);
    res.records.push(rec);
  });
  return res.finish();
}
