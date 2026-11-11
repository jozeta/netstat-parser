import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudImage, grainTile } from "../js/ui/icons.js";

const svg = (uri) => decodeURIComponent(uri.slice("data:image/svg+xml,".length));

test("cloud image is a self-contained SVG data URI in the given colours", () => {
  const uri = cloudImage("#5aaaff", "#6a7f9f");
  assert.ok(uri.startsWith("data:image/svg+xml,"));
  const s = svg(uri);
  assert.match(s, /<svg [^>]*preserveAspectRatio="none"/);
  assert.match(s, /<path d="M[^"]+Z"/);
  assert.match(s, /stop-color="#5aaaff"/);
  assert.match(s, /stroke="#6a7f9f"/);
  assert.match(s, /vector-effect="non-scaling-stroke"/);
  assert.doesNotMatch(s, /href|<script/);
  for (const ref of s.match(/url\([^)]*\)/g) ?? []) assert.match(ref, /^url\(#[a-z]+\)$/, "only local references");
});

test("cloud image is frosted glass: a light sheen from the top, a fine grain, a bright inner edge", () => {
  const s = svg(cloudImage("#5aaaff", "#6a7f9f", 0.14, { sheen: "#ffffff" }));
  assert.match(s, /<linearGradient id="fill"[^>]*x2="0" y2="1"/, "vertical fill gradient");
  assert.match(s, /stop-color="#ffffff"/, "sheen colour at the top");
  assert.match(s, /<feTurbulence[^>]*type="fractalNoise"/, "grain");
  assert.match(s, /<clipPath id="shape">/, "grain stays inside the cloud");
  assert.match(s, /stroke="url\(#edge\)"/, "inner highlight fades downwards");
});

test("cloud image ignores colours that are not hex (token values are not trusted into markup)", () => {
  const s = svg(cloudImage('red" onload="x', "rgb(1,2,3)"));
  assert.doesNotMatch(s, /onload|rgb/);
  assert.match(s, /stop-color="#[0-9a-f]{6}"/i);
  assert.doesNotMatch(svg(cloudImage("#5aaaff", "#6a7f9f", 0.1, { sheen: '"/><script>' })), /<script/);
});

test("grain tile: a small repeatable noise SVG with a clamped strength", () => {
  const s = svg(grainTile(0.5));
  assert.match(s, /<svg [^>]*width="(\d+)" height="\1"/, "square tile");
  assert.match(s, /<feTurbulence[^>]*stitchTiles="stitch"/, "seamless when repeated");
  assert.doesNotMatch(s, /href|<script/);
  assert.match(svg(grainTile(7)), /opacity="1"/);
  assert.match(svg(grainTile("x")), /opacity="0.5"/);
});
