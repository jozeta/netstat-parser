import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBytes } from "../js/parse/decode.js";
import { normalizeState } from "../js/parse/states.js";

function utf16le(text, bom = true) {
  const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  let o = 0;
  if (bom) { out[o++] = 0xff; out[o++] = 0xfe; }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[o++] = c & 255; out[o++] = c >> 8;
  }
  return out;
}

test("decodeBytes: UTF-16LE with BOM (PowerShell 5 redirect), CRLF → LF", () => {
  const line = "  TCP    0.0.0.0:135  0.0.0.0:0  LISTENING  1012";
  assert.equal(decodeBytes(utf16le(line + "\r\n")), line + "\n");
});

test("decodeBytes: UTF-16BE with BOM", () => {
  const le = utf16le("AB\n", false);
  const be = new Uint8Array(2 + le.length);
  be[0] = 0xfe; be[1] = 0xff;
  for (let i = 0; i < le.length; i += 2) { be[2 + i] = le[i + 1]; be[3 + i] = le[i]; }
  assert.equal(decodeBytes(be), "AB\n");
});

test("decodeBytes: UTF-8 with BOM and lone CR", () => {
  const bytes = new TextEncoder().encode("\uFEFFABHÖREN\rx");
  assert.equal(decodeBytes(bytes), "ABHÖREN\nx");
});

test("decodeBytes: invalid UTF-8 falls back to windows-1252 without throwing", () => {
  const s = decodeBytes(Uint8Array.from([0x41, 0x42, 0x48, 0x99, 0x52, 0x45, 0x4e]));
  assert.ok(s.startsWith("ABH") && s.endsWith("REN"), s);
});

test("normalizeState: English, Linux, ss spellings", () => {
  assert.equal(normalizeState("LISTENING"), "LISTEN");
  assert.equal(normalizeState("listen"), "LISTEN");
  assert.equal(normalizeState("ESTAB"), "ESTABLISHED");
  assert.equal(normalizeState("TIME-WAIT"), "TIME_WAIT");
  assert.equal(normalizeState("UNCONN"), "BOUND");
  assert.equal(normalizeState("SYN_RECV"), "SYN_RECEIVED");
  assert.equal(normalizeState("FIN_WAIT2"), "FIN_WAIT_2");
  assert.equal(normalizeState("BOUND"), "BOUND");
});

test("normalizeState: German", () => {
  assert.equal(normalizeState("ABHÖREN"), "LISTEN");
  assert.equal(normalizeState("HERGESTELLT"), "ESTABLISHED");
  assert.equal(normalizeState("WARTEND"), "TIME_WAIT");
  assert.equal(normalizeState("SCHLIESSEN_WARTEN"), "CLOSE_WAIT");
  assert.equal(normalizeState("SYN_GESENDET"), "SYN_SENT");
});

test("normalizeState: Swedish", () => {
  assert.equal(normalizeState("LYSSNAR"), "LISTEN");
  assert.equal(normalizeState("UPPRÄTTAD"), "ESTABLISHED");
  assert.equal(normalizeState("ETABLERAD"), "ESTABLISHED");
});

test("normalizeState: OEM code-page mojibake still matches", () => {
  assert.equal(normalizeState("ABH™REN"), "LISTEN");
  assert.equal(normalizeState("ABH”REN"), "LISTEN");
  assert.equal(normalizeState("UPPR„TTAD"), "ESTABLISHED");
});

test("normalizeState: unknown words → null", () => {
  assert.equal(normalizeState("(state)"), null);
  assert.equal(normalizeState("FOO"), null);
  assert.equal(normalizeState(""), null);
});
