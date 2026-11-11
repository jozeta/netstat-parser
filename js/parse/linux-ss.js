// Linux `ss -tunap` / `-tuna` (iproute2).
//   tcp   ESTAB  0  0  10.10.20.5:22  10.10.1.30:51544  users:(("sshd",pid=1201,fd=4))
// With one protocol (`ss -tanp`, `-uanp`) there is no Netid column: lines start with the state.
// Such a file is UDP when it has UNCONN sockets and no TCP-only states, else TCP. (A UDP file
// with only connected sockets cannot be told apart and is read as TCP.)

import { splitEndpoint } from "../lib/ip.js";
import { splitLines, isCandidate, createResult, makeRecord, addProcess, SS_STATE, MAX_LINE } from "./common.js";

const USERS = /\(\("([^"]{1,128})",pid=(\d+)/;
const TCP_ONLY = /^(LISTEN|SYN-SENT|SYN-RECV|NEW-SYN-RECV|FIN-WAIT-1|FIN-WAIT-2|TIME-WAIT|CLOSE-WAIT|LAST-ACK|CLOSING)$/;

/** Protocol for state-first lines (no Netid column), decided once for the whole file. */
function stateFirstProto(lines) {
  let unconn = false;
  for (const line of lines) {
    if (line.length > MAX_LINE) continue;
    const first = line.trim().split(/\s/, 1)[0];
    if (TCP_ONLY.test(first)) return "tcp";
    if (first === "UNCONN") unconn = true;
  }
  return unconn ? "udp" : "tcp";
}

/**
 * @param {string} body
 * @returns {import('./types.js').FormatResult}
 */
export function parseLinuxSs(body) {
  const res = createResult();
  const lines = splitLines(body);
  let proto = null;
  lines.forEach((line, idx) => {
    const tokens = line.trim().split(/\s+/);
    if (SS_STATE.test(tokens[0])) tokens.unshift(proto ??= stateFirstProto(lines));
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
