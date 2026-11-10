// Turn raw file bytes into text with "\n" line endings. Handles the encodings Windows produces:
// PowerShell 5 redirects (UTF-16LE + BOM), cmd redirects (OEM / ANSI code page), and UTF-8.

/** UTF-16 without a BOM: mostly-ASCII text has a zero byte in every other position. */
function utf16Guess(bytes) {
  const n = Math.min(bytes.length, 4000) & ~1;
  if (n < 8) return null;
  let evenZero = 0, oddZero = 0;
  for (let i = 0; i < n; i += 2) { if (bytes[i] === 0) evenZero++; if (bytes[i + 1] === 0) oddZero++; }
  const half = n / 2;
  if (oddZero > half * 0.4 && evenZero < half * 0.05) return "utf-16le";
  if (evenZero > half * 0.4 && oddZero < half * 0.05) return "utf-16be";
  return null;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeBytes(bytes) {
  let text;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    text = new TextDecoder("utf-8").decode(bytes.subarray(3));
  } else if (utf16Guess(bytes)) {
    text = new TextDecoder(utf16Guess(bytes)).decode(bytes);
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Not UTF-8: an 8-bit code page. Non-ASCII letters may be wrong, which the
      // state matcher tolerates (see states.js).
      text = new TextDecoder("windows-1252").decode(bytes);
    }
  }
  return text.replace(/\r\n?/g, "\n");
}
