// Entry point: one netstat file (already decoded to text) → ParsedFile.

import { parseHeader, hostnameFromFileName } from "./header.js";
import { detectFormat } from "./detect.js";
import { parseWindows } from "./windows.js";
import { parseLinuxNetstat } from "./linux-netstat.js";
import { parseLinuxSs } from "./linux-ss.js";
import { parseMacos } from "./macos.js";

const PARSERS = {
  windows: parseWindows,
  "linux-netstat": parseLinuxNetstat,
  "linux-ss": parseLinuxSs,
  macos: parseMacos,
};
const MAX_SAMPLES = 5;

/**
 * @param {string} fileName
 * @param {string} text
 * @returns {import('./types.js').ParsedFile}
 */
export function parseFile(fileName, text) {
  const { header, body } = parseHeader(String(text ?? ""));
  const format = detectFormat(body);
  const result = format ? PARSERS[format](body) : { records: [], unparsed: [], unknownStates: [] };
  const fromHeader = header?.hostname;
  return {
    fileName: String(fileName),
    format,
    hostname: fromHeader || hostnameFromFileName(fileName),
    hostnameSource: fromHeader ? "header" : "filename",
    header,
    records: result.records,
    warnings: {
      unparsedCount: result.unparsed.length,
      unparsedSamples: result.unparsed.slice(0, MAX_SAMPLES),
      unknownStates: result.unknownStates,
      notRecognised: format === null || result.records.length === 0,
    },
  };
}
