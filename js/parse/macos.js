// macOS (BSD) `netstat -an` / `netstat -anv -p tcp`. Endpoints use a dot before the port.
//   tcp4       0      0  192.168.50.12.52344    203.0.113.10.443       ESTABLISHED
//   tcp46      0      0  *.22                   *.*                    LISTEN
// -v adds columns, including a "process:pid" token.

import { splitEndpoint } from "../lib/ip.js";
import { normalizeState } from "./states.js";
import { splitLines, isCandidate, createResult, makeRecord, addProcess } from "./common.js";

const PROC_PID = /^([^:\s]*):(\d+)$/;
const TRUNCATED = /:\.(\d+|\*)$/;
// Without -W, BSD netstat cuts the address part to 16 characters; an IPv6 address of exactly
// that length may have been cut (to a different valid address, or an invalid one).
const CUT_WIDTH = 16;
function mayBeCut(token) {
  const host = token.slice(0, token.lastIndexOf("."));
  return host.length === CUT_WIDTH && host.includes(":");
}

/**
 * The -v "process:pid" field. The name may contain spaces ("Google Chrome He:1234"), so take
 * the words before the name:pid token back to the numeric columns (rhiwat, shiwat, bytes).
 * @param {string[]} rest tokens after the state column
 */
function processOf(rest) {
  const i = rest.findIndex((t) => PROC_PID.test(t) && !/^\d/.test(t));
  if (i < 0) return null;
  const m = PROC_PID.exec(rest[i]);
  let j = i;
  while (j > 0 && !/^\d+$/.test(rest[j - 1])) j--;
  return { pid: m[2], name: [...rest.slice(j, i), m[1]].join(" ") };
}

/**
 * @param {string} body
 * @returns {import('./types.js').FormatResult}
 */
export function parseMacos(body) {
  const res = createResult();
  let truncated = 0;
  splitLines(body).forEach((line, idx) => {
    const tokens = line.trim().split(/\s+/);
    if (!isCandidate(tokens)) return;
    // netstat cuts long IPv6 addresses (even with -W for scoped link-local ones): "fe80::1a2b:3c4d:.62015"
    if (TRUNCATED.test(tokens[3] ?? "") || TRUNCATED.test(tokens[4] ?? "")) { truncated++; return; }
    const ok = tokens.length >= 5 && /^\d+$/.test(tokens[1]) && /^\d+$/.test(tokens[2]);
    const cut = ok && (mayBeCut(tokens[3]) || mayBeCut(tokens[4]));
    const local = ok ? splitEndpoint(tokens[3], ".") : null;
    const remote = local ? splitEndpoint(tokens[4], ".") : null;
    if (cut) truncated++;
    if (!local || !remote) { if (!cut) res.addUnparsed(idx + 1, line); return; }
    let rest = tokens.slice(5);
    let stateWord = null;
    const isTcp = tokens[0].toLowerCase().startsWith("tcp");
    // TCP always has a state column; UDP only has one if the word is a known state.
    if (rest.length && (isTcp || normalizeState(rest[0]))) { stateWord = rest[0]; rest = rest.slice(1); }
    const rec = makeRecord(tokens[0], local, remote, stateWord, res.unknown);
    if (!rec) { res.addUnparsed(idx + 1, line); return; }
    const pp = processOf(rest);
    if (pp) addProcess(rec, pp.pid, pp.name);
    res.records.push(rec);
  });
  return { ...res.finish(), truncated };
}
