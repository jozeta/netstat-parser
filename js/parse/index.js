// Entry point: one netstat file (already decoded to text) → ParsedFile.

import { parseHeader, hostnameFromFileName, cleanText } from "./header.js";
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
// "web01:ssh" / "10.0.0.1:microsoft-ds": netstat or ss run without -n (names instead of numbers).
// The lookahead skips IPv6 hex groups such as "fe80::ab12".
// Tested line by line (never with /m over the whole body, where "^\s*" spans blank lines and
// goes quadratic), and only on lines of sane length.
const NAMES_NOT_NUMBERS = /^[ \t]*(?:(?:tcp|udp)\S*\s+(?:[A-Z-]+\s+)?\d+\s+\d+|TCP|UDP)\s+\S+[:.](?![0-9a-f]+\s)[a-z][\w-]*\s/;
const MAX_LINE = 1000;

function namesNotNumbers(body) {
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line.length <= MAX_LINE && NAMES_NOT_NUMBERS.test(line + "\n")) return true;
  }
  return false;
}

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
    fileName: cleanText(String(fileName), 255) || "unnamed",
    format,
    hostname: fromHeader || hostnameFromFileName(fileName),
    hostnameSource: fromHeader ? "header" : "filename",
    header,
    records: result.records,
    warnings: {
      unparsedCount: result.unparsedCount ?? result.unparsed.length,
      unparsedSamples: result.unparsed.slice(0, MAX_SAMPLES),
      unknownStates: result.unknownStates,
      notRecognised: format === null || result.records.length === 0,
      truncatedAddresses: result.truncated ?? 0,
      namesNotNumbers: namesNotNumbers(body),
    },
  };
}
