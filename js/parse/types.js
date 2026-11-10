// Shared record shapes for all netstat parsers (JSDoc only, plus the canonical state list).

/**
 * @typedef {{ proto: 'tcp'|'udp', family: 4|6, localIp: string, localPort: number|null,
 *   remoteIp: string, remotePort: number|null, state: string, pid?: number, process?: string }} NetRecord
 * ip: canonical text (IPv4 dotted, IPv6 RFC 5952) or '*' for any wildcard. port: null for '*'.
 * state: one of STATES or 'UNKNOWN'.
 */
/** @typedef {{ records: NetRecord[], unparsed: {lineNo: number, line: string}[], unknownStates: string[] }} FormatResult */
/** @typedef {{ hostname: string|null, os: string|null, collected: string|null, addresses: {ip: string, prefix: number}[] }} Header */
/** @typedef {'windows'|'linux-netstat'|'linux-ss'|'macos'} Format */
/**
 * @typedef {{ fileName: string, format: Format|null, hostname: string, hostnameSource: 'header'|'filename',
 *   header: Header|null, records: NetRecord[], warnings: { unparsedCount: number,
 *   unparsedSamples: {lineNo: number, line: string}[], unknownStates: string[], notRecognised: boolean } }} ParsedFile
 */

export const STATES = Object.freeze([
  "LISTEN", "BOUND", "ESTABLISHED", "SYN_SENT", "SYN_RECEIVED", "FIN_WAIT_1",
  "FIN_WAIT_2", "CLOSE_WAIT", "CLOSING", "LAST_ACK", "TIME_WAIT", "CLOSED",
]);
