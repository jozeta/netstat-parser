// Renders a generated host's sockets as the netstat/ss text its OS would produce, with the
// optional netstat-parser header. Column layouts follow tests/fixtures/.

/** Pad to a column width but always leave at least one space (long IPv6 addresses). */
const col = (s, w) => s.padEnd(w - 1) + " ";

const WIN_TEXT = {
  en: { title: "Active Connections", cols: ["Proto", "Local Address", "Foreign Address", "State"], states: { LISTEN: "LISTENING" } },
  sv: { title: "Aktiva anslutningar", cols: ["Prot.", "Lokal adress", "Extern adress", "Tillstånd"], states: { LISTEN: "LYSSNAR", ESTABLISHED: "UPPRÄTTAD" } },
  de: { title: "Aktive Verbindungen", cols: ["Proto", "Lokale Adresse", "Remoteadresse", "Status"], states: { LISTEN: "ABHÖREN", ESTABLISHED: "HERGESTELLT", TIME_WAIT: "WARTEND" } },
};
const SS_STATE = { ESTABLISHED: "ESTAB", BOUND: "UNCONN", TIME_WAIT: "TIME-WAIT", SYN_SENT: "SYN-SENT", SYN_RECEIVED: "SYN-RECV", CLOSE_WAIT: "CLOSE-WAIT" };

const port = (p) => (p === null ? "*" : String(p));

function winEndpoint(ip, p, family) {
  if (family === 6) return `[${ip === "*" ? "::" : ip}]:${p === null ? "*" : p}`;
  if (ip === "*" && p === null) return "*:*";
  return `${ip === "*" ? "0.0.0.0" : ip}:${port(p)}`;
}

function renderWindows(sockets, locale) {
  const t = WIN_TEXT[locale ?? "en"];
  const row = (a, b, c, d, e) => `  ${col(a, 7)}${col(b, 23)}${col(c, 23)}${d.padEnd(16)}${e}`;
  const lines = ["", t.title, "", row(t.cols[0], t.cols[1], t.cols[2], t.cols[3], "PID")];
  for (const r of sockets) {
    // Windows prints a listening socket's remote as 0.0.0.0:0 / [::]:0
    const remote = r.proto === "udp" ? "*:*" : winEndpoint(r.remoteIp, r.remoteIp === "*" && r.remotePort === null ? 0 : r.remotePort, r.family);
    const state = r.proto === "udp" ? "" : (t.states[r.state] ?? r.state);
    lines.push(row(r.proto.toUpperCase(), winEndpoint(r.localIp, r.localPort, r.family), remote, state, String(r.pid ?? "")));
  }
  return lines.join("\n") + "\n";
}

function linuxEndpoint(ip, p, family) {
  if (family === 6) return `${ip === "*" ? "::" : ip}:${port(p)}`;
  return `${ip === "*" ? "0.0.0.0" : ip}:${port(p)}`;
}

function renderLinuxNetstat(sockets) {
  const root = sockets.some((r) => r.pid !== undefined);
  const lines = [];
  if (!root) lines.push("(Not all processes could be identified, non-owned process info", " will not be shown, you would have to be root to see it all.)");
  lines.push("Active Internet connections (servers and established)",
    "Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name");
  for (const r of sockets) {
    const proto = r.proto + (r.family === 6 ? "6" : "");
    const state = r.state === "BOUND" ? "" : r.state;
    const prog = r.pid !== undefined ? `${r.pid}/${r.process}` : "-";
    lines.push(`${proto.padEnd(5)} ${"0".padStart(6)} ${"0".padStart(6)} ${col(linuxEndpoint(r.localIp, r.localPort, r.family), 24)}${col(linuxEndpoint(r.remoteIp, r.remotePort, r.family), 24)} ${state.padEnd(11)} ${prog}`);
  }
  lines.push("Active UNIX domain sockets (servers and established)",
    "Proto RefCnt Flags       Type       State         I-Node   PID/Program name     Path",
    "unix  2      [ ACC ]     STREAM     LISTENING     18542    -                    /run/systemd/private");
  return lines.join("\n") + "\n";
}

function ssEndpoint(ip, p, family) {
  if (family === 6) return `[${ip === "*" ? "::" : ip}]:${port(p)}`;
  return `${ip === "*" ? "0.0.0.0" : ip}:${port(p)}`;
}

function renderSs(sockets) {
  const lines = ["Netid State     Recv-Q Send-Q          Local Address:Port      Peer Address:Port  Process"];
  sockets.forEach((r, i) => {
    const state = SS_STATE[r.state] ?? r.state;
    const sendq = r.state === "LISTEN" ? "128" : "0";
    const users = r.pid !== undefined ? `users:(("${r.process}",pid=${r.pid},fd=${3 + (i % 20)}))` : "";
    lines.push(`${r.proto.padEnd(5)} ${state.padEnd(9)} ${"0".padEnd(6)} ${sendq.padEnd(6)} ${ssEndpoint(r.localIp, r.localPort, r.family).padStart(22)} ${ssEndpoint(r.remoteIp, r.remotePort, r.family).padStart(20)} ${users}`.trimEnd());
  });
  return lines.join("\n") + "\n";
}

function renderMacos(sockets) {
  const lines = ["Active Internet connections (including servers)",
    "Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)    "];
  for (const r of sockets) {
    const proto = r.proto + (r.family === 6 ? "6" : "4");
    const ep = (ip, p) => `${ip}.${port(p)}`;
    const state = r.proto === "udp" ? "" : r.state;
    lines.push(`${proto.padEnd(6)}${"0".padStart(6)}${"0".padStart(7)}  ${col(ep(r.localIp, r.localPort), 23)}${col(ep(r.remoteIp, r.remotePort), 23)}${state.padEnd(11)}`);
  }
  lines.push("Active LOCAL (UNIX) domain sockets",
    "Address          Type   Recv-Q Send-Q            Inode             Conn             Refs          Nextref Addr",
    "a1b2c3d4e5f60001 stream      0      0                0 a1b2c3d4e5f60002                0                0 /var/run/mDNSResponder");
  return lines.join("\n") + "\n";
}

const RENDER = {
  windows: (h) => renderWindows(h.sockets, h.locale),
  "linux-netstat": (h) => renderLinuxNetstat(h.sockets),
  "linux-ss": (h) => renderSs(h.sockets),
  macos: (h) => renderMacos(h.sockets),
};

/**
 * @param {object} host a GenHost from topology.js (collected)
 * @param {string} collectedAt ISO timestamp for the header
 * @returns {{fileName: string, text: string}}
 */
export function renderFile(host, collectedAt) {
  const body = RENDER[host.format](host);
  const header = host.withHeader
    ? ["### netstat-parser v1", `hostname: ${host.hostname}`, `os: ${host.osVersion}`, `collected: ${collectedAt}`,
      `addresses: ${host.addresses.map((a) => `${a.ip}/${a.prefix}`).join(", ")}`, "### netstat", ""].join("\n")
    : "";
  return { fileName: `${host.hostname}_netstat.txt`, text: header + body };
}
