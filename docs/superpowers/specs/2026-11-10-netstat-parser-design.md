# netstat-parser — design

Date: 2026-11-10. Status: approved by the owner 2026-11-10.

## Intent

Pentesters and incident responders who have been given access to a network need a fast picture of
**who talks to whom** and **where risky protocols are used**. They collect `netstat` output from
many machines (Windows, Linux, macOS) and today have to read it by hand. netstat-parser turns up to
~1000 such files into one interactive network map in the browser.

It is the successor to the owner's 2014 C# console tool (`~/Desktop/NetstatParser/`, outside this
repo), which merged `*.txt` netstat files into a yEd `.graphml` file. Lessons from it:

- It only parsed Windows-style lines (`TCP 10.0.0.1:80 10.0.0.2:57589 ESTABLISHED`) and only
  ESTABLISHED; macOS (`10.0.0.1.443`), Linux `ss` and IPv6 were not handled.
- It concatenated all files, losing which machine a line came from.
- It used the **local** port of each line as the edge port, which is an ephemeral port when the
  file is from the client side. The new tool must use the **service port** (see Graph model).
- Its port lists were hard-coded: secure `22,443`; insecure `21,23,80,161,445,8080`;
  misc `53,1433,3389,3306,5555`. The new tool makes these editable.

## Goals

1. Load many netstat files (drag-and-drop or file picker, multiple at once) from Windows, Linux and
   macOS, auto-detecting the format. Everything is processed locally in the browser.
2. Draw an interactive graph of hosts and connections, with subnets grouped and public
   addresses grouped into an "Internet" cloud.
3. Colour connections by protocol risk; show listening services; show whether each connection was
   seen from both ends or only one; show which hosts were not collected.
4. Click any host, group, cloud or connection to see details in a right-hand panel.
5. Search and filter on any attribute.
6. Editable settings: protocol risk lists, subnet names/ranges, role rules, optional DNS lookup.
7. Export PNG, session JSON and CSV; export uncollected hosts as a collector targets file.
8. An in-app "How to collect" page with copy-ready commands per OS.
9. A separate Python collector script that gathers the files remotely over SSH / WinRM.

## Non-goals

- Live packet capture, host discovery or scanning (the collector only touches listed targets).
- Any change on target machines beyond what remote execution unavoidably leaves behind
  (documented: login records, SSH/WinRM logs, a short-lived PowerShell session).
- Remote execution over SMB or pass-the-hash (owner decision, 2026-11-11).
- Auto-saving job data in the browser (see Data handling).
- Interface languages other than English.

## Anti-goals (failure even if it "works")

- Client network data leaving the operator's machine without an explicit opt-in.
- An unreadable hairball as the first view of a large job.
- Rendering file contents with `innerHTML` (files are untrusted input; a crafted netstat file
  must not be able to inject markup or script).
- A frozen tab while parsing 1000 files.

## Constraints

- Static site, no build step, no server: `index.html`, `css/`, `js/`, served by
  `python3 -m http.server`. Must also work when served from any static host.
- Strict CSP stays (`default-src 'self'`, no `unsafe-inline`/`unsafe-eval`). The only exception is
  `connect-src` for the chosen DNS-over-HTTPS resolvers (see DNS lookup), recorded as a reasoned
  waiver in `.claude-standards`.
- Third-party code is self-hosted in `vendor/` with its licence file.
- Låda Glass 1.1.1 design system (dark default, light alternative, compact). Use `lg-` components
  and tokens. Responsive down to 375 px with no sideways scroll; keyboard accessible.
- Tests: `node --test` (pure logic modules must be importable in Node without a DOM); ESLint with
  `no-unsanitized`. Test-first.
- Scale: up to 1000 files, which can mean 5,000–20,000 distinct addresses.

## Decisions

### Tech

- **Graph library: Cytoscape.js** (MIT), vendored. Chosen for native compound nodes
  (subnets/cloud as parents), canvas rendering that handles thousands of elements, and built-in
  PNG export. Layout algorithm is left to the builder (a bundled one such as `cose` is fine; a
  vendored extension like fcose is acceptable if needed for quality/performance).
- **Parsing runs in a Web Worker** so the UI stays responsive; it reports progress.
- **Logic is split into pure ES modules** (parsers, model, classification, filters, exports) that
  are testable in Node; DOM/Cytoscape code is a thin layer on top.

### Input formats

One parser per format behind an auto-detector, all producing the same record:
`{ proto (tcp|udp), localIp, localPort, remoteIp, remotePort, state, pid?, process?, family (4|6) }`.

Must support:
- Windows `netstat -ano` (and `-an`, `-anob` tolerated).
- Linux `netstat -tunap` / `-tuna` and `ss -tunap` / `-tuna`.
- macOS `netstat -anv -p tcp` / `netstat -an` (dotted `ip.port` notation, `tcp4/tcp6/udp4/udp6`).
- IPv4 and IPv6 (bracketed and unbracketed forms, zone IDs stripped), `*`/`0.0.0.0`/`::` as
  wildcard.

**Localized Windows output** (owner decision): state names and headers are recognised in English,
Swedish and German (e.g. `LISTENING`/`LYSSNAR`/`ABHÖREN`, `ESTABLISHED`/`UPPRÄTTAD`/`HERGESTELLT`)
via a state-name table that is easy to extend. Detection must not depend on English headers. For
unknown state words, a socket whose remote side is a wildcard (`0.0.0.0:0`, `*:*`, `[::]:0`) is
treated as listening, and the file gets a warning listing the unknown words.

States kept: ESTABLISHED and similar active states (SYN_SENT, TIME_WAIT, CLOSE_WAIT, etc., shown
in the panel and filterable) plus LISTEN (and UDP bound sockets) as listening services. Loopback
connections (127.0.0.0/8, ::1) are excluded from the graph but shown in the host panel.

Lines that do not parse are counted and listed per file (first few shown) rather than failing the
file. Files with zero parsable lines are reported as "not recognised".

**File header** (written by the app's collect commands and the collector; optional — plain
netstat output still works):

```
### netstat-parser v1
hostname: WS-0142
os: Microsoft Windows 11 Pro 10.0.22631
collected: 2026-11-10T20:41:00Z
addresses: 10.0.5.12/24, fe80::1c2a:3bff:fe4d:12/64
### netstat
<raw netstat / ss output>
```

The exact command lines per OS are designed by the builder; requirements: Linux `netstat` and
macOS `netstat` must be run with `-W` (wide), because without it they truncate long IPv6 addresses
(net-tools silently yields a different valid address; the Linux parser warns via
`warnings.truncatedAddresses`); output file named
`<hostname>_netstat.txt`, header as above, works without admin where possible (and says what is
lost without admin, e.g. PIDs/process names), Windows in both PowerShell and cmd if practical.

**Host identity** per file: header `hostname` + `addresses` when present. Otherwise: hostname from
the file name (`<hostname>_netstat.txt`, else the file name without extension), and own addresses
inferred from local addresses in the file (non-wildcard, non-loopback). If two files claim the same
IP, both are kept and the conflict is flagged in the panel.

*(Builder's call, settled in review.)* Several files for the **same hostname** (case-insensitive)
merge into one host node; all files are listed as its sources with their collection times, and
their connections and listening ports are combined (deduplicated).

**Loading more files adds to the current job** *(builder's call)*. The model is a pure function
over all loaded records and is rebuilt on each load; user state (node positions, collapse state,
DNS results, subnet names) is kept by stable host/group IDs. Files can also be removed from the job.
Importing a session replaces the current job (after the unsaved-work warning); files can then be
added to it.

### Graph model

- **Nodes**
  - *Collected host*: has a file. Normal colour, labelled by hostname.
  - *Seen-only host*: appears only as a remote address in other files. **Greyed out**, labelled by
    IP (or DNS name if looked up), marked "no file" in the panel.
  - A collected host with several IPs is one node; all its IPs map to it.
- **Groups (compound nodes)**
  - Private/internal addresses (RFC1918, link-local, ULA, CGNAT 100.64/10, plus any ranges
    configured in Settings) are grouped by subnet. Subnet = the configured range if one matches,
    else the prefix from the header `addresses`, else a default /24 (IPv4) or /64 (IPv6).
  - Everything else goes into one **Internet** cloud node.
  - Groups start **collapsed** when the graph is large (builder picks the threshold, e.g. > ~150
    hosts); a collapsed group shows host/connection counts and its aggregated edges carry the count
    and the worst risk colour. Expand/collapse on click or keyboard.
- **Edges**: one edge per `{hostA, hostB, servicePort, proto}`.
  - **Service port**: if one side's port is a listening port in that host's file, use it; else the
    well-known/lower port (≤ 49151 vs ephemeral); ties → lower number. Direction is client →
    server.
  - **Seen from both ends** (solid line) when both hosts' files contain the matching connection;
    otherwise **one end** (dashed line), with the source file(s) named in the panel. A connection
    between two collected hosts that appears in only one file is dashed with a note (netstat is a
    snapshot).
  - Colour = risk of the service port/protocol.
- **Risk levels** (colours expressed as theme tokens so they work in dark and light):
  - **Vulnerable — red.** Defaults: FTP 21, Telnet 23, TFTP 69/udp, rexec/rlogin/rsh 512–514,
    SNMP 161/162 udp.
  - **Exploitable / unencrypted — orange.** Defaults: HTTP 80/8080/8000, SMB 445, NetBIOS 137–139,
    RDP 3389, LDAP 389, Kerberos 88, MSRPC 135, WinRM-HTTP 5985, VNC 5900–5903, MSSQL 1433,
    MySQL 3306, PostgreSQL 5432, Redis 6379, ADB 5555, DNS 53, SMTP 25, POP3 110, IMAP 143.
  - **Safe — neutral light grey** (black is invisible on the dark theme). Defaults: SSH 22,
    HTTPS 443/8443, LDAPS 636, GC-SSL 3269, WinRM-HTTPS 5986, IMAPS 993, POP3S 995, SMTPS 465/587.
  - **Unclassified — dim blue-grey.**
  These are starting defaults; the owner can change any of them in Settings.
- **Host role and OS**
  - Role: *server* (accepts inbound connections on listening ports), *client* (only outbound),
    *both*. For seen-only hosts, inferred from which side used the service port. Shown by node
    shape.
  - OS: from the header, else from the netstat format (Windows/Linux/macOS), else unknown. Shown as
    a small self-made SVG icon in the node (no downloaded brand logos).
  - Optional role tags from listening-port rules, editable in Settings. Defaults: DC (88+389+445),
    DB (1433/3306/5432), Web (80/443), RDP (3389).
- **Listening ports**: badges on the host coloured by risk, capped at a few with "+N"; full list
  (port, proto, bind address, PID/process when present) in the panel.

### UI

- Layout: top bar (load files, search/filter, settings, export, "How to collect"), graph canvas in
  the middle, details panel on the right. On narrow screens the panel becomes a bottom sheet.
- Empty state explains how to start and links to "How to collect".
- Load summary after import: files parsed, hosts, connections, unrecognised files/lines.
- **Details panel** for: host (identity, IPs, OS, role, tags, listening ports, connections,
  source file, parse warnings), group/cloud (range, name, member count, top talkers), edge
  (endpoints, port/protocol, risk level and why, both/one end, states, PIDs/processes, which
  file(s)).
- **Search & filter**: free text plus field terms, combinable, e.g.
  `port:445 subnet:"Office VLAN" risk:red`. Fields: ip, host, port, proto/protocol name, risk, os,
  subnet, state, role, tag, collected (yes/no), seen (both/one). Non-matching elements fade
  (default) or are hidden (toggle). Exact syntax is the builder's call; it needs a short help popup.
- Keyboard: everything reachable without a mouse (tab through toolbar, arrow/Enter in lists of
  hosts/edges as an accessible alternative to the canvas).
- Unsaved-work warning when leaving the page with a loaded job that has not been exported as a
  session since the last change.

### Settings

Stored in `localStorage` (settings only, never job data), with export/import as JSON and
"reset to defaults":
- Protocol table: port, proto, name, risk level (add / edit / remove).
- Subnets: CIDR → name; also which ranges count as internal.
- Role rules (tag name → required listening ports).
- Graph: collapse threshold, labels on/off.
- DNS lookup (below).

### DNS lookup (opt-in, browser)

- Reverse (PTR) lookups for **public (Internet) addresses only**, via DNS-over-HTTPS JSON API.
- **Off by default.** Enabling it requires choosing a resolver from a fixed list (Cloudflare
  `cloudflare-dns.com`, Google `dns.google`, Quad9 `dns.quad9.net`) and acknowledging a warning that
  the client's public IPs are sent to that provider.
- Runs on demand (button "Resolve Internet hosts", or for the current selection), rate-limited,
  cancellable, with progress. Results are stored in the session file and shown as node labels, in
  the panel and in search.
- CSP `connect-src` lists exactly those resolver origins; `.claude-standards` records the waiver
  and reason. Custom resolvers are out of scope for v1 (they would need a CSP change).

### Data handling and exports

- Job data lives in memory and in exported files only — no auto-save to browser storage.
- **Session export/import** (`.json`, versioned schema): parsed records, host identities, settings
  snapshot, subnet names, DNS results, node positions, expanded/collapsed state. Import validates
  the schema and treats the file as untrusted.
- **PNG**: current view or full graph.
- **CSV**: `connections.csv` (source host/IP, destination host/IP, port, proto, protocol name,
  risk, states, both/one end, source files) and `hosts.csv` (hostname, IPs, OS, role, tags,
  subnet, collected yes/no, listening ports). Cells are escaped against CSV/formula injection.
- **Targets export**: seen-only **internal** hosts as a collector targets file template.

### "How to collect" page

In-app page (or panel) with copy buttons for Windows (PowerShell, and cmd if practical), Linux
(`ss` with `netstat` fallback) and macOS, producing the header format above into
`<hostname>_netstat.txt`; notes on admin rights; link to the collector.

### Collector (`collector/`, Python 3, built after the web app)

*(Revised 2026-11-11, owner decision: SSH and WinRM only. SMB exec and pass-the-hash are out of
scope; `smb` targets and `hash=` keys are rejected with a clear message.)*

- Runs on Linux, macOS and Windows operator machines, Python 3.9+. Standard library only for SSH
  (it shells out to the system `ssh`, keys or agent only, `BatchMode=yes`; unknown host keys fail
  unless `--accept-new-hostkeys`). Optional extra for Windows targets: `pypsrp` (WinRM, port 5985
  HTTP with message encryption, 5986 HTTPS). A missing extra → clear message, only those targets
  are skipped.
- Input: a targets file, one target per line with its own method and credentials reference, e.g.
  `10.0.5.12 ssh user=root key=~/.ssh/id_ed25519`, `DC01 winrm user=admin domain=CORP
  password-env=NP_CORP_PW`. Format: UTF-8 text, one target per line, `#` comments (whole line or
  after whitespace), blank lines ignored; fields are whitespace-separated:
  `<host> <method> [key=value ...]` with method `ssh|winrm` and keys `user`, `port`, `key`,
  `password-env`, `domain`. Any invalid line aborts the run before anything connects, listing every
  bad line with its number. The web app's targets export writes `<ip> <method-guess> user=CHANGEME`,
  with the method guessed from the ports the host serves (5985/5986 → winrm, 22 → ssh, Windows
  ports 445/135/3389 → winrm with a comment that WinRM must be enabled), and a header comment
  explaining the format.
- WinRM passwords come from `password-env=NP_NAME` (only `NP_*` variables, so a targets file can't
  send any other secret from the operator's environment) or a prompt (asked once per user before the run
  starts); never written to disk or logs. SSH takes no passwords. Every message that is printed is
  scrubbed of known secret values.
- Runs only read-only commands (the same collect commands as the app; one POSIX script that picks
  `ss`/`netstat -W` on Linux and `netstat -anvW` on macOS by `uname`). `--dry-run` prints the plan
  (targets, methods, ports, users, where each password comes from, the ssh command) and connects to
  nothing.
- Output: `<hostname>_netstat.txt` per target into an output folder (`--out`, default
  `./netstat-files`), hostname from the returned header, made filesystem-safe, falling back to the
  target name; output without the header is a failure; an existing file is never overwritten (`_2`, `_3`, … suffix). Remote output is
  untrusted: capped at 50 MB (ssh output is streamed and ssh killed past the cap; pypsrp buffers
  WinRM output, so that cap applies after arrival), written as bytes, never echoed to the terminal; remote error text is
  stripped of control characters and truncated before it is shown. A summary lists successes and
  failures; one failure does not stop the run; exit code 1 if any target failed. Concurrency: a
  thread pool, `--workers` (default 8), per-target `--timeout` (default 120 s, an overall limit for WinRM too).
- Tests (`python3 -m unittest discover -s collector`): parsing of the targets file, command
  construction, credential redaction in logs, output naming; remote execution mocked.

## Test data (owner decision)

No real client data is ever committed. Instead, a deterministic (seeded) generator script in the
repo produces three synthetic, realistic datasets. They serve as parser/model fixtures, as demo
data, and as performance checks:

- **small**: 20–40 computers
- **medium**: 150–250 computers
- **large**: 300–400 computers

Each contains:
- a mix of clients and servers (DC, file, DB, web, jump hosts)
- several subnets
- some hosts using online services
- a mix of Windows (English, Swedish and German), Linux (`netstat` and `ss`) and macOS output, with and without the header
- risky and safe protocols
- listening services
- IPv6 and loopback lines
- hosts that appear in other files but have no file of their own

Small hand-written fixtures for edge cases (e.g. `-anob` multi-line process names) are fine in
addition.

## Build order

Each step is test-first and leaves the app usable:

1. Synthetic dataset generator (small / medium / large), then parsers + auto-detect + header +
   localized state names, tested against the generated files and hand-written edge cases.
2. Graph model: identity, merge, service port, both/one end, subnets/cloud, risk, role/OS/tags.
3. Main screen: file loading (worker), Cytoscape graph, styling, badges, collapse, details panel.
4. Search and filters.
5. Settings.
6. Exports (PNG, session, CSV, targets) + session import.
7. "How to collect" page.
8. DNS lookup.
9. Collector.

## Left to the builder

Layout algorithm and collapse threshold; exact search syntax; exact collect command lines;
targets file syntax (shared between app and collector); module/file structure; how badges are
drawn in Cytoscape; colour token values within the Låda Glass palette; collector concurrency.
