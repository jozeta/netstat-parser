// Pure part of the parse worker: [{name, bytes}] → ParsedFile[]. Importable in Node tests.

import { decodeBytes } from "./parse/decode.js";
import { parseFile } from "./parse/index.js";
import { cleanText } from "./parse/header.js";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * @param {{name: string, bytes: Uint8Array}[]} batch
 * @param {(done: number, total: number) => void} onProgress
 */
export function handleBatch(batch, onProgress) {
  return batch.map((f, i) => {
    let result;
    if (f.bytes.length > MAX_FILE_BYTES) {
      result = parseFile(f.name, "");
      result.warnings.tooLarge = true;
    } else {
      result = parseFile(cleanText(f.name, 255), decodeBytes(f.bytes));
    }
    onProgress(i + 1, batch.length);
    return result;
  });
}
