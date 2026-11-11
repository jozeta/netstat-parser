// Windows `netstat -ano` / `-an` / `-anob`, any display language.
//   TCP    10.10.10.21:49712      10.10.1.10:445         ESTABLISHED     4
//   UDP    0.0.0.0:123            *:*                                    1456
// -anob adds "[process.exe]", service-name and "Can not obtain ownership" lines after a socket line.
// -anot adds an Offload State column (InHost / Offloaded / ...), which is ignored.

import { splitEndpoint } from "../lib/ip.js";
import { splitLines, isCandidate, createResult, makeRecord, addProcess } from "./common.js";

const OFFLOAD = /^(InHost|Offloaded|Offloading|Uploading)$/i;

/**
 * @param {string} body
 * @returns {import('./types.js').FormatResult}
 */
export function parseWindows(body) {
  const res = createResult();
  let last = null;
  splitLines(body).forEach((line, idx) => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length > 3 && OFFLOAD.test(tokens[tokens.length - 1])) tokens.pop();
    if (!isCandidate(tokens)) {
      const exe = /^\[(.+)\]$/.exec(line.trim());
      if (exe && last && !last.process) addProcess(last, null, exe[1]);
      return;
    }
    last = null;
    const local = tokens.length >= 3 ? splitEndpoint(tokens[1], ":") : null;
    const remote = local ? splitEndpoint(tokens[2], ":") : null;
    if (!local || !remote || tokens.length > 5) { res.addUnparsed(idx + 1, line); return; }
    let stateWord = null, pid;
    const rest = tokens.slice(3);
    if (rest.length && !/^\d+$/.test(rest[0])) { stateWord = rest[0]; pid = rest[1]; } else pid = rest[0];
    const rec = makeRecord(tokens[0], local, remote, stateWord, res.unknown);
    if (!rec) { res.addUnparsed(idx + 1, line); return; }
    addProcess(rec, pid, null);
    res.records.push(rec);
    last = rec;
  });
  return res.finish();
}
