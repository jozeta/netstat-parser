import { test } from "node:test";
import assert from "node:assert/strict";
import { isCandidate, isZip, expandArchives } from "../js/lib/inputs.js";
import { walkEntries } from "../js/ui/dropped.js";
import { makeZip } from "./helpers/zip.mjs";

test("likely netstat files are candidates; junk and other types are not", () => {
  for (const n of ["DC01_netstat.txt", "x/y/host.log", "out.OUT", "netstat", "a\\b\\WS1_netstat.TXT"]) assert.ok(isCandidate(n), n);
  for (const n of [".DS_Store", "._DC01_netstat.txt", "__MACOSX/DC01_netstat.txt", "Thumbs.db", "desktop.ini", "shot.png", "notes.docx", "dir/", ".hidden"])
    assert.ok(!isCandidate(n), n);
});

test("zip detection by name or by magic bytes", () => {
  assert.ok(isZip("logs.ZIP", new Uint8Array(0)));
  assert.ok(isZip("logs", Uint8Array.from([0x50, 0x4b, 0x03, 0x04])));
  assert.ok(!isZip("DC01_netstat.txt", new TextEncoder().encode("Active Connections")));
});

test("archives in a batch are replaced by their netstat entries; junk is counted", async () => {
  const zip = makeZip([{ name: "net/DC01_netstat.txt", data: "dc" }, { name: "__MACOSX/net/._DC01_netstat.txt", data: "junk" },
    { name: "net/readme.pdf", data: "%PDF" }, { name: "inner.zip", data: "PK", method: 0 }]);
  const plain = { name: "WS1_netstat.txt", bytes: new TextEncoder().encode("ws") };
  const r = await expandArchives([plain, { name: "case.zip", bytes: zip }]);
  assert.deepEqual(r.files.map((f) => f.name), ["WS1_netstat.txt", "DC01_netstat.txt"]);
  assert.equal(r.notes.skipped, 3);
  assert.match(r.notes.problems.join("\n"), /case\.zip: inner\.zip: zip inside a zip/);
});

test("a broken archive is reported, the rest of the batch still loads", async () => {
  const r = await expandArchives([{ name: "bad.zip", bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2]) }, { name: "a.txt", bytes: new Uint8Array(1) }]);
  assert.deepEqual(r.files.map((f) => f.name), ["a.txt"]);
  assert.match(r.notes.problems[0], /^bad\.zip: /);
});

// fake FileSystemEntry objects, as given by DataTransferItem.webkitGetAsEntry()
const file = (name) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok({ name, size: 1 }) });
const dir = (name, children, batch = 2) => ({
  isFile: false, isDirectory: true, name,
  createReader() { let i = 0; return { readEntries: (ok) => { const out = children.slice(i, i + batch); i += batch; ok(out); } }; },
});

test("dropped folders are walked recursively, in reader batches, with junk skipped", async () => {
  const tree = [dir("case", [file("DC01_netstat.txt"), file(".DS_Store"), dir("sub", [file("WS1_netstat.txt"), file("all.zip"), file("pic.jpg")]), file("x.log")]),
    file("loose_netstat.txt")];
  const r = await walkEntries(tree);
  assert.deepEqual(r.files.map((f) => f.name).sort(), ["DC01_netstat.txt", "WS1_netstat.txt", "all.zip", "loose_netstat.txt", "x.log"]);
  assert.equal(r.skipped, 2);
  assert.equal(r.truncated, false);
});

test("folder walking stops at the file limit", async () => {
  const r = await walkEntries([dir("big", Array.from({ length: 50 }, (_, i) => file(`h${i}.txt`)), 7)], { maxFiles: 10 });
  assert.equal(r.files.length, 10);
  assert.equal(r.truncated, true);
});

test("worker upload: a zip of netstat files parses like the files themselves", async () => {
  const { handleUpload } = await import("../js/worker-core.js");
  const win = "Active Connections\r\n\r\n  Proto  Local Address          Foreign Address        State           PID\r\n  TCP    10.0.0.5:445         10.0.0.9:50000         ESTABLISHED     4\r\n";
  const zip = makeZip([{ name: "case/FS01_netstat.txt", data: win }, { name: "case/.DS_Store", data: "x" }]);
  const progress = [];
  const r = await handleUpload([{ name: "case.zip", bytes: zip }], (d, t) => progress.push([d, t]));
  assert.deepEqual(r.parsed.map((p) => p.fileName), ["FS01_netstat.txt"]);
  assert.equal(r.parsed[0].records.length, 1);
  assert.deepEqual(r.notes, { skipped: 1, archives: 1, problems: [] });
  assert.deepEqual(progress.at(-1), [1, 1]);
});
