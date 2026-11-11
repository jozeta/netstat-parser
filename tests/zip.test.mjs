import { test } from "node:test";
import assert from "node:assert/strict";
import { unzip } from "../js/lib/zip.js";
import { makeZip } from "./helpers/zip.mjs";

const text = (b) => new TextDecoder().decode(b);

test("unzips stored and deflate entries with their paths", async () => {
  const z = makeZip([{ name: "a/DC01_netstat.txt", data: "hello dc", method: 8 }, { name: "WS1_netstat.txt", data: "hi ws", method: 0 },
    { name: "a/", dir: true, method: 0 }]);
  const r = await unzip(z);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.entries.map((e) => [e.path, text(e.bytes)]), [["a/DC01_netstat.txt", "hello dc"], ["WS1_netstat.txt", "hi ws"]]);
});

test("not a zip, or a truncated one, is an error, not a crash", async () => {
  assert.match((await unzip(new TextEncoder().encode("plain text"))).error, /not a zip/i);
  const z = makeZip([{ name: "x.txt", data: "x".repeat(1000) }]);
  assert.ok((await unzip(z.slice(0, 40))).error);
});

test("encrypted and unsupported entries are skipped with a reason", async () => {
  const z = makeZip([{ name: "secret.txt", data: "s", flags: 1, method: 0 }, { name: "bz.txt", data: "b", method: 12 }, { name: "ok.txt", data: "ok", method: 0 }]);
  const r = await unzip(z);
  assert.deepEqual(r.entries.map((e) => e.path), ["ok.txt"]);
  assert.deepEqual(r.skipped.map((s) => s.path), ["secret.txt", "bz.txt"]);
  assert.match(r.skipped[0].reason, /encrypted/);
  assert.match(r.skipped[1].reason, /compression/);
});

test("an entry larger than the per-entry limit is marked too large, even if its header lies", async () => {
  const big = "A".repeat(5000);
  const r = await unzip(makeZip([{ name: "big.txt", data: big, size: 10 }, { name: "small.txt", data: "s" }]), { maxEntry: 1000 });
  assert.deepEqual(r.entries.map((e) => [e.path, e.tooLarge === true, e.bytes.length]), [["big.txt", true, 0], ["small.txt", false, 1]]);
});

test("unpacking stops at the total limit (zip bomb)", async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `f${i}.txt`, data: "Z".repeat(4000) }));
  const r = await unzip(makeZip(many), { maxTotal: 20_000 });
  assert.match(r.error, /more than/);
  assert.ok(r.entries.reduce((s, e) => s + e.bytes.length, 0) <= 20_000);
});

test("entry count is limited", async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.txt`, data: "x", method: 0 }));
  const r = await unzip(makeZip(many), { maxEntries: 10 });
  assert.match(r.error, /entries/);
  assert.equal(r.entries.length, 0);
});
