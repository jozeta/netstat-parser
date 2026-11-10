#!/usr/bin/env node
// Writes the synthetic datasets: <out>/<size>/<hostname>_netstat.txt + manifest.json.
// Usage: node scripts/generate-datasets.js [--seed N] [--out DIR]   (default out: tests/data/generated)

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNetwork } from "./gen/topology.js";
import { renderFile } from "./gen/render.js";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const seed = Number(opt("--seed", "1"));
if (!Number.isInteger(seed) || seed < 0) {
  console.error("--seed must be a non-negative integer");
  process.exit(2);
}
const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = resolve(opt("--out", join(repo, "tests", "data", "generated")));
const base = Date.parse("2026-11-10T20:00:00Z");

for (const size of ["small", "medium", "large"]) {
  const net = buildNetwork(size, seed);
  const dir = join(out, size);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let files = 0;
  const hosts = net.hosts.map(({ sockets, ...h }, i) => {
    if (!h.collected) return { ...h, fileName: null };
    const at = new Date(base + i * 47_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const { fileName, text } = renderFile({ ...h, sockets }, at);
    writeFileSync(join(dir, fileName), text);
    files++;
    return { ...h, fileName };
  });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ size, seed, subnets: net.subnets, hosts }, null, 2) + "\n");
  console.log(`${size}: ${net.hosts.length} hosts, ${files} files → ${dir}`);
}
