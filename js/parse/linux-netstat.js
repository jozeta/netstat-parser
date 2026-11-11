// Linux `netstat -tunap` / `-tuna` / `-tunaep` (net-tools; -e adds User and Inode columns).
//   tcp        0      0 10.10.20.5:22           10.10.1.30:51544        ESTABLISHED 1201/sshd: root@pts/0
//   udp        0      0 0.0.0.0:68              0.0.0.0:*                           600/dhclient

import { splitEndpoint } from "../lib/ip.js";
import { normalizeState } from "./states.js";
import { splitLines, isCandidate, createResult, makeRecord, addProcess } from "./common.js";

const PID_PROG = /^(\d+)\/(.*)$/;

// Without -W, net-tools cuts an address so that address + port is at most 22 characters, which
// for IPv6 can leave a different but valid address. Flag endpoints that hit that limit exactly.
function mayBeTruncated(token) {
  // IPv6 (two or more colons) and exactly "22 characters + ':'" long
  return token.length === 23 && token.indexOf(":") !== token.lastIndexOf(":");
}

/**
 * @param {string} body
 * @returns {import('./types.js').FormatResult}
 */
export function parseLinuxNetstat(body) {
  const res = createResult();
  let truncated = 0;
  splitLines(body).forEach((line, idx) => {
    const tokens = line.trim().split(/\s+/);
    if (!isCandidate(tokens)) return;
    const ok = tokens.length >= 5 && /^\d+$/.test(tokens[1]) && /^\d+$/.test(tokens[2]);
    const local = ok ? splitEndpoint(tokens[3], ":") : null;
    const remote = local ? splitEndpoint(tokens[4], ":") : null;
    if (!local || !remote) { res.addUnparsed(idx + 1, line); return; }
    let rest = tokens.slice(5);
    let stateWord = null;
    const isTcp = tokens[0].toLowerCase().startsWith("tcp");
    // TCP always has a state column; UDP only when the word is a known state (else it is the
    // -e User column, or PID/Program)
    if (rest.length && rest[0] !== "-" && !PID_PROG.test(rest[0]) && (isTcp || normalizeState(rest[0]))) {
      stateWord = rest[0]; rest = rest.slice(1);
    }
    const rec = makeRecord(tokens[0], local, remote, stateWord, res.unknown);
    if (!rec) { res.addUnparsed(idx + 1, line); return; }
    if (mayBeTruncated(tokens[3]) || mayBeTruncated(tokens[4])) truncated++;
    // with -e, User and Inode come before PID/Program; the program name may contain spaces
    const at = rest.findIndex((t) => /^\d+\/./.test(t));
    const m = at < 0 ? null : PID_PROG.exec(rest.slice(at).join(" "));
    if (m) addProcess(rec, m[1], m[2]);
    res.records.push(rec);
  });
  return { ...res.finish(), truncated };
}
