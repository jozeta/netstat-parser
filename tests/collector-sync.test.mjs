// The collector runs the same read-only commands as the app's "How to collect" page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMANDS } from "../js/ui/collect-view.js";

const sh = readFileSync(new URL("../collector/npcollect/collect.sh", import.meta.url), "utf8");
const ps = readFileSync(new URL("../collector/npcollect/collect.ps1", import.meta.url), "utf8");
const app = Object.fromEntries(COMMANDS.map((c) => [c.id, c.code.replaceAll("\\\\", "\\")]));
// lines of an app command that do the collecting (not the file redirection)
const body = (code) => code.split("\n").map((l) => l.trim()).filter((l) => /^(echo|netstat|if command|\$ips|\$os)/.test(l));

for (const id of ["linux", "macos"]) {
  test(`collector POSIX script has every ${id} collect line`, () => {
    for (const line of body(app[id])) assert.ok(sh.includes(line) || sh.includes(line.replace(/^echo "hostname: \$h"$/, "")), `${id}: ${line}`);
  });
}

test("collector PowerShell script has the app's PowerShell collect lines", () => {
  for (const line of body(app["win-ps"])) assert.ok(ps.includes(line), line);
  assert.match(ps, /\(netstat -ano\)/);
});
