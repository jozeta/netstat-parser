# netstat-parser

Turn netstat output from many Windows, Linux and macOS machines into one interactive network map:
who talks to whom, over which protocols, and where the risky ones are. Built for pentesters and
incident responders mapping a network they have been given access to.

Everything runs locally in your browser. Files are never uploaded, and the app makes no network
requests unless you switch on the optional DNS lookup.

![netstat-parser showing a synthetic network: subnets, the Internet group, risk-coloured connections and the details panel](docs/screenshot.png)

**Status:** early development (2026-11-11). The web app and the collector script are usable. Design: [docs/superpowers/specs/2026-11-10-netstat-parser-design.md](docs/superpowers/specs/2026-11-10-netstat-parser-design.md).

## Features

- **Load many files at once** (up to ~1000): Windows `netstat -ano` (English, Swedish and German
  output), Linux `netstat` and `ss`, and macOS `netstat`. The format is detected automatically,
  and both IPv4 and IPv6 are handled.
- **Network graph:** hosts are grouped by subnet, and public addresses go into an "Internet" cloud.
  Subnets with up to 30 hosts start expanded and larger ones collapsed (the number is a setting).
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
- **Optional DNS lookup** for Internet addresses via DNS-over-HTTPS (Cloudflare, Google or Quad9),
  off by default. Once enabled in Settings: **Resolve DNS** looks up every Internet host, the
  **Resolve name** button in an Internet host's details looks up just that one, and an optional
  setting does it automatically after loading. Until you tick "I understand that public IP
  addresses are sent", every lookup asks first. Internal and documentation addresses are never sent.
- **Dark and light themes:** follows your system, or pick Dark or Light in the menu (top right).
- **Exports:**
  - PNG
  - a saved session (`.json`) you can reopen later
  - CSVs of connections and hosts
  - a targets file listing uncollected hosts, for the collector
- **"How to collect" page** with copy-ready commands per OS. Each command writes
  `<hostname>_netstat.txt` with a short header (hostname, IPs, OS, time).
- **Collector script** (`collector/`, Python 3): gathers the same files remotely over SSH (keys
  or ssh-agent) or WinRM (password from an environment variable or a prompt) and saves them on
  your machine. It only runs read-only commands and has a dry-run mode. See
  [collector/README.md](collector/README.md).

Job data is only kept in sessions you export yourself. The app does not auto-save it in the browser.

## Getting started

```sh
python3 -m http.server 8580      # then open http://localhost:8580/ (or: claude-update)
```

1. On each computer, run the command for its OS from the app's **How to collect** page. It writes
   `<hostname>_netstat.txt`.
2. Open the app and drop the files on the graph, or a whole folder, or a `.zip` of them (or use
   **Load files** / **Load folder**). From folders and zips only likely netstat files are read
   (`.txt`, `.log`, `.out`, no extension); the rest is skipped and counted. Loading more files later
   asks whether to add them to the current job or start a new one (the default is a setting).
3. Click hosts, groups or lines for details; search with `port:445 risk:red`, `collected:no`,
   `seen:one` and so on; name your subnets and tune the protocol risk table in **Settings**.
4. **Export → Session** saves the job to reopen later (nothing is saved automatically).

Many machines at once: export **Collector targets** from the graph, fill in users, then run
`python3 collector/collect.py targets.txt --dry-run` and without `--dry-run` to collect.

Try it without real data: `npm run gen:data` writes synthetic networks to `tests/data/generated/`.

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
