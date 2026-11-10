# netstat-parser

Turn netstat output from many Windows, Linux and macOS machines into one interactive network map:
who talks to whom, over which protocols, and where the risky ones are. Built for pentesters and
incident responders mapping a network they have been given access to.

Everything runs locally in your browser. Files are never uploaded, and the app makes no network
requests unless you switch on the optional DNS lookup.

<!-- Add a screenshot once the UI exists: claude-shots --write netstat-parser (web), or a capture in docs/. -->

**Status:** early development, being designed. Nothing below is built yet. The design is in
[docs/superpowers/specs/2026-11-10-netstat-parser-design.md](docs/superpowers/specs/2026-11-10-netstat-parser-design.md).

## Planned features

- **Load many files at once** (up to ~1000): Windows `netstat -ano` (English, Swedish and German
  output), Linux `netstat` and `ss`, and macOS `netstat`. The format is detected automatically,
  and both IPv4 and IPv6 are handled.
- **Network graph:** hosts are grouped by subnet, and public addresses go into an "Internet" cloud.
  Large jobs start with the groups collapsed.
- **Risk colours:** red for vulnerable protocols (e.g. Telnet, FTP), orange for exploitable or
  unencrypted ones (e.g. SMB, RDP, HTTP), neutral for safe ones (e.g. SSH, HTTPS).
- **Coverage at a glance:**
  - solid line: the connection was seen from both ends
  - dashed line: seen from one end only
  - greyed-out host: appears in other machines' files but has no file of its own
- **Hosts:** the node shape shows the role (client, server or both) and an icon shows the OS.
  Badges show listening ports, and tags mark well-known roles such as DC, DB, Web and RDP.
- **Details panel** for any host, group, cloud or connection.
- **Search and filter**, e.g. `port:445 subnet:"Office VLAN" risk:red`.
- **Settings:** edit which protocols count as vulnerable, unencrypted or safe; name your subnets;
  edit the role rules.
- **Optional DNS lookup** for Internet addresses via DNS-over-HTTPS (Cloudflare, Google or Quad9).
  It's off by default, and the app warns you before sending anything.
- **Exports:**
  - PNG
  - a saved session (`.json`) you can reopen later
  - CSVs of connections and hosts
  - a targets file listing uncollected hosts, for the collector
- **"How to collect" page** with copy-ready commands per OS. Each command writes
  `<hostname>_netstat.txt` with a short header (hostname, IPs, OS, time).
- **Collector script** (`collector/`, Python 3): gathers the same files remotely over SSH, WinRM
  or SMB (password, key or hash) and saves them on your machine. It only runs read-only commands
  and has a dry-run mode.

Job data is only kept in sessions you export yourself. The app does not auto-save it in the browser.

## Getting started

```sh
python3 -m http.server 8580      # then open http://localhost:8580/ (or: claude-update)
```

## Tests

```sh
npm test            # node --test: tests/*.test.mjs
npm run lint        # ESLint, including the unsafe-DOM rule
```

The test data is synthetic: a seeded generator builds small (20–40), medium (150–250) and large
(300–400) computer networks. Real client data is never committed, and `.gitignore` keeps
`*_netstat.txt`, targets files, sessions and exports out of git.

## License

MIT. See [LICENSE](LICENSE).
