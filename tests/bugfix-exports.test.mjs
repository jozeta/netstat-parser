// Container addresses behind one host's Docker bridge are not collector targets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../js/model/build.js";
import { targetsFile } from "../js/model/exports.js";
import { DEFAULT_SETTINGS } from "../js/model/settings.js";
import { winFile } from "./helpers/net.mjs";

test("targets file skips containers on a host's Docker bridge, keeps real uncollected hosts", () => {
  const a = winFile("A", [["TCP", "172.17.0.1:50000", "172.17.0.2:5432", "ESTABLISHED"], ["TCP", "10.0.0.1:50001", "10.0.0.9:22", "ESTABLISHED"]]);
  const b = winFile("B", [["TCP", "172.17.0.1:50000", "172.17.0.2:5432", "ESTABLISHED"], ["TCP", "10.0.5.1:50001", "10.0.0.9:22", "ESTABLISHED"]]);
  const lines = targetsFile(buildModel([a, b], DEFAULT_SETTINGS)).split("\n").filter((l) => l && !l.startsWith("#"));
  assert.ok(!lines.some((l) => l.startsWith("172.17.0.2")), lines.join("\n"));
  assert.ok(lines.some((l) => l.startsWith("10.0.0.9 ssh")), lines.join("\n"));
});
