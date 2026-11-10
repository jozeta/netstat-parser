// Turn raw file bytes into text with "\n" line endings. Handles the encodings Windows produces:
// PowerShell 5 redirects (UTF-16LE + BOM), cmd redirects (OEM / ANSI code page), and UTF-8.

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
