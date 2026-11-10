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

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://cloudflare-dns.com https://dns.google https://dns.quad9.net:5053; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";

test("CSP is exactly the agreed policy (DoH resolvers only)", () => {
  const m = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.equal(m?.[1], CSP);
});

test("Cytoscape's injected <style> is pre-empted by a real stylesheet", () => {
  assert.match(html, /<link rel="stylesheet" id="__________cytoscape_stylesheet" href="css\/cytoscape-container.css">/);
});

test("vendored Cytoscape ships with its licence", async () => {
  const { existsSync } = await import("node:fs");
  assert.ok(existsSync(new URL("../vendor/cytoscape-3.34.4/LICENSE", import.meta.url)));
  assert.ok(existsSync(new URL("../vendor/cytoscape-3.34.4/cytoscape.esm.min.mjs", import.meta.url)));
});

test("three views and a multi-file input", () => {
  for (const id of ["view-graph", "view-collect", "view-settings"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<input[^>]*type="file"[^>]*multiple/);
});

test("no inline styles or inline scripts", () => {
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/);
});

test("saved theme applies before first paint and there is a System/Dark/Light switch", () => {
  const boot = html.indexOf('<script src="js/theme-boot.js"></script>');
  assert.ok(boot > 0 && boot < html.indexOf('rel="stylesheet"'));
  for (const t of ["system", "dark", "light"]) assert.match(html, new RegExp(`role="radio" data-theme-choice="${t}"`));
});
