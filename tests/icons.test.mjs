import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudImage } from "../js/ui/icons.js";

const svg = (uri) => decodeURIComponent(uri.slice("data:image/svg+xml,".length));

test("cloud image is a self-contained SVG data URI in the given colours", () => {
  const uri = cloudImage("#5aaaff", "#6a7f9f");
  assert.ok(uri.startsWith("data:image/svg+xml,"));
  const s = svg(uri);
  assert.match(s, /<svg [^>]*preserveAspectRatio="none"/);
  assert.match(s, /<path d="M[^"]+Z"/);
  assert.match(s, /fill="#5aaaff"/);
  assert.match(s, /stroke="#6a7f9f"/);
  assert.match(s, /vector-effect="non-scaling-stroke"/);
  assert.doesNotMatch(s, /href|<script|url\(/);
});

test("cloud image ignores colours that are not hex (token values are not trusted into markup)", () => {
  const s = svg(cloudImage('red" onload="x', "rgb(1,2,3)"));
  assert.doesNotMatch(s, /onload|rgb/);
  assert.match(s, /fill="#[0-9a-f]{6}"/i);
});
