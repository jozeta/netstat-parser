import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleBatch } from "../js/worker-core.js";

const en = readFileSync(new URL("./fixtures/windows-en-ano.txt", import.meta.url), "utf8");

function utf16le(text) {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff; out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) { out[2 + 2 * i] = text.charCodeAt(i) & 255; out[3 + 2 * i] = text.charCodeAt(i) >> 8; }
  return out;
}

test("handleBatch decodes and parses each file; progress per file", () => {
  const progress = [];
  const out = handleBatch([
    { name: "WS-1_netstat.txt", bytes: new TextEncoder().encode(en) },
    { name: "WS-2_netstat.txt", bytes: utf16le(en) },
    { name: "junk.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]) },
  ], (d, t) => progress.push([d, t]));
  assert.equal(out.length, 3);
  assert.equal(out[0].hostname, "WS-1");
  assert.equal(out[1].records.length, 11);
  assert.equal(out[2].warnings.notRecognised, true);
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
});

test("files over 50 MB are not parsed", () => {
  const big = { name: "huge.txt", bytes: { length: 60 * 1024 * 1024 } };
  const [r] = handleBatch([big], () => {});
  assert.equal(r.warnings.notRecognised, true);
  assert.equal(r.warnings.tooLarge, true);
});
