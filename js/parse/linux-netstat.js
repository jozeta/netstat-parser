// Linux `netstat -tunap` / `-tuna` (net-tools).
//   tcp        0      0 10.10.20.5:22           10.10.1.30:51544        ESTABLISHED 1201/sshd: root@pts/0
//   udp        0      0 0.0.0.0:68              0.0.0.0:*                           600/dhclient

import { splitEndpoint } from "../lib/ip.js";
import { splitLines, isCandidate, createResult, makeRecord, addProcess } from "./common.js";

const PID_PROG = /^(\d+)\/(.*)$/;

/**
 * @param {string} body
 * @returns {import('./types.js').FormatResult}
 */
export function parseLinuxNetstat(body) {
  const res = createResult();
  splitLines(body).forEach((line, idx) => {
    const tokens = line.trim().split(/\s+/);
    if (!isCandidate(tokens)) return;
    const ok = tokens.length >= 5 && /^\d+$/.test(tokens[1]) && /^\d+$/.test(tokens[2]);
    const local = ok ? splitEndpoint(tokens[3], ":") : null;
    const remote = local ? splitEndpoint(tokens[4], ":") : null;
    if (!local || !remote) { res.addUnparsed(idx + 1, line); return; }
    let rest = tokens.slice(5);
    let stateWord = null;
    if (rest.length && rest[0] !== "-" && !PID_PROG.test(rest[0])) { stateWord = rest[0]; rest = rest.slice(1); }
    const rec = makeRecord(tokens[0], local, remote, stateWord, res.unknown);
    if (!rec) { res.addUnparsed(idx + 1, line); return; }
    const m = PID_PROG.exec(rest.join(" "));
    if (m) addProcess(rec, m[1], m[2]);
    res.records.push(rec);
  });
  return res.finish();
}
