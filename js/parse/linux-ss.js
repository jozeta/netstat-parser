// Linux `ss -tunap` / `-tuna` (iproute2).
//   tcp   ESTAB  0  0  10.10.20.5:22  10.10.1.30:51544  users:(("sshd",pid=1201,fd=4))

import { splitEndpoint } from "../lib/ip.js";
import { splitLines, isCandidate, createResult, makeRecord, addProcess } from "./common.js";

const USERS = /\(\("([^"]{1,128})",pid=(\d+)/;

/**
 * @param {string} body
 * @returns {import('./types.js').FormatResult}
 */
export function parseLinuxSs(body) {
  const res = createResult();
  splitLines(body).forEach((line, idx) => {
    const tokens = line.trim().split(/\s+/);
    if (!isCandidate(tokens)) return;
    const ok = tokens.length >= 6 && /^\d+$/.test(tokens[2]) && /^\d+$/.test(tokens[3]);
    const local = ok ? splitEndpoint(tokens[4], ":") : null;
    const remote = local ? splitEndpoint(tokens[5], ":") : null;
    if (!local || !remote) { res.addUnparsed(idx + 1, line); return; }
    const rec = makeRecord(tokens[0], local, remote, tokens[1], res.unknown);
    const m = USERS.exec(tokens.slice(6).join(" "));
    if (m) addProcess(rec, m[2], m[1]);
    res.records.push(rec);
  });
  return res.finish();
}
