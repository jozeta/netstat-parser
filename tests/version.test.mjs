// One version number: package.json is the source; the app, the collector and the docs follow it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../js/version.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const pkg = JSON.parse(read("../package.json")).version;

test("the app's version is package.json's", () => assert.equal(VERSION, pkg));
test("the collector's version is package.json's", () => {
  assert.match(read("../collector/npcollect/__init__.py"), new RegExp(`__version__ = "${pkg.replaceAll(".", "\\.")}"`));
});
test("README and CHANGELOG name the current version", () => {
  assert.match(read("../README.md"), new RegExp(`Version ${pkg.replaceAll(".", "\\.")}`));
  assert.match(read("../CHANGELOG.md"), new RegExp(`^## ${pkg.replaceAll(".", "\\.")} `, "m"));
});
test("the menu shows the version", () => assert.match(read("../index.html"), /id="app-version"/));
