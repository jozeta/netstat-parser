// Socket state words → canonical state. Windows translates them, so English, German and
// Swedish are included. Matching uses a "skeleton" key (uppercase, '-' → '_', every other
// non-[A-Z0-9_] character → '?') so OEM code-page mojibake (ABHÖREN read as ABH™REN) still matches.

const WORDS = {
  // English: Windows, Linux netstat, macOS, ss
  LISTEN: "LISTEN", LISTENING: "LISTEN",
  BOUND: "BOUND", UNCONN: "BOUND",
  ESTABLISHED: "ESTABLISHED", ESTAB: "ESTABLISHED",
  SYN_SENT: "SYN_SENT",
  SYN_RECEIVED: "SYN_RECEIVED", SYN_RECV: "SYN_RECEIVED", SYN_RCVD: "SYN_RECEIVED",
  FIN_WAIT_1: "FIN_WAIT_1", FIN_WAIT1: "FIN_WAIT_1",
  FIN_WAIT_2: "FIN_WAIT_2", FIN_WAIT2: "FIN_WAIT_2",
  CLOSE_WAIT: "CLOSE_WAIT",
  CLOSING: "CLOSING",
  LAST_ACK: "LAST_ACK",
  TIME_WAIT: "TIME_WAIT",
  CLOSED: "CLOSED", CLOSE: "CLOSED",
  // German Windows
  "ABHÖREN": "LISTEN",
  HERGESTELLT: "ESTABLISHED",
  WARTEND: "TIME_WAIT",
  SCHLIESSEN_WARTEN: "CLOSE_WAIT",
  SYN_GESENDET: "SYN_SENT",
  SYN_EMPFANGEN: "SYN_RECEIVED",
  FIN_WARTEN_1: "FIN_WAIT_1",
  FIN_WARTEN_2: "FIN_WAIT_2",
  LETZTES_ACK: "LAST_ACK",
  SCHLIESSEND: "CLOSING",
  GESCHLOSSEN: "CLOSED",
  GEBUNDEN: "BOUND",
  // Swedish Windows (only words known from real output; others fall back to the
  // wildcard-remote rule in the parsers)
  LYSSNAR: "LISTEN",
  "UPPRÄTTAD": "ESTABLISHED",
  ETABLERAD: "ESTABLISHED",
};

function skeleton(word) {
  return word.toUpperCase().replace(/-/g, "_").replace(/[^A-Z0-9_]/g, "?");
}

const TABLE = new Map(Object.entries(WORDS).map(([w, s]) => [skeleton(w), s]));

/**
 * @param {string} word
 * @returns {string|null} canonical state or null if unknown
 */
export function normalizeState(word) {
  if (typeof word !== "string" || word.length === 0 || word.length > 40) return null;
  return TABLE.get(skeleton(word)) ?? null;
}
