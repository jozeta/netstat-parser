// Test helpers: ParsedFile[] from the generator, and small hand-built files.
import { buildNetwork } from "../../scripts/gen/topology.js";
import { renderFile } from "../../scripts/gen/render.js";
import { parseFile } from "../../js/parse/index.js";

export const AT = "2026-11-10T20:41:00Z";

export function generated(size, seed = 1) {
  const net = buildNetwork(size, seed);
  const files = net.hosts.filter((h) => h.collected).map((h) => {
    const f = renderFile(h, AT);
    return parseFile(f.fileName, f.text);
  });
  return { net, files };
}

/** Windows-format file; rows are [proto, local, remote, state, pid]. */
export function winFile(name, rows, header = null) {
  const head = header
    ? `### netstat-parser v1\nhostname: ${name}\nos: ${header.os ?? "Microsoft Windows 11 Pro"}\naddresses: ${header.addresses}\n### netstat\n`
    : "";
  const body = rows.map(([p, l, r, s = "", pid = "4"]) => `  ${p.padEnd(7)}${l.padEnd(23)}${r.padEnd(23)}${s.padEnd(16)}${pid}`).join("\n");
  return parseFile(`${name}_netstat.txt`, head + "Active Connections\n\n" + body + "\n");
}
