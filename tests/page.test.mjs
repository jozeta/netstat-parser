// The entry page keeps the standards that matter: viewport, strict CSP, no third-party loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("has a viewport meta tag (responsive)", () => {
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test("has a strict Content-Security-Policy", () => {
  assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});

test("loads nothing from other hosts", () => {
  assert.doesNotMatch(html, /(src|href)="https?:\/\//);
});
