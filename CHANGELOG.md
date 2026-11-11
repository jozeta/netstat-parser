# Changelog

All notable changes to netstat-parser are listed here, newest first.

## Unreleased

- Test data: the generated networks and the hand-written fixtures now use real public addresses
  that have reverse DNS names (for example 8.8.8.8 → dns.google, 140.82.112.3 →
  lb-140-82-112-3-iad.github.com) instead of documentation addresses, which DNS lookup skips.
  Run `npm run gen:data` again to get the new files.
- DNS: a **Resolve name** button in the details of each Internet host (disabled until DNS lookup
  is enabled); an optional automatic lookup after loading files; the "I understand public IPs are
  sent" acknowledgement is now its own setting, and until it is ticked every lookup asks first.
  The toolbar's Resolve DNS always covers all Internet hosts. Documentation and benchmark
  addresses (TEST-NET, 2001:db8::/32, 198.18/15) are never sent, and the summary says so.
- Loading files into a job that already has files asks: add to the current job, or start a new
  job (Cancel keeps everything). The default (ask / merge / new) is a setting.
- "1 file", "1 host", "1 connection" instead of "1 files" etc.
- Load a whole folder (drop it, or **Load folder**) or a `.zip` of netstat files. Zips are unpacked
  in the browser with limits against zip bombs; junk such as `.DS_Store` and `__MACOSX/` and
  non-text files are skipped and counted in the load summary.
- Subnets with up to 30 hosts start expanded, larger ones collapsed; the number is in Settings
  (Graph) and changing it re-applies the rule. Replaces the old whole-job collapse threshold.
- The left sidebar is gone: pages, theme and the privacy note are in a menu in the top right corner.
- Collapsed groups are larger and easier to read.
- The Internet group is drawn as a cloud (flat base, overlapping lobes) in both themes, expanded
  and collapsed; the layout leaves room for it.
- Selecting a host, group or connection focuses it: everything outside its neighbourhood fades.
- The graph refits when its area changes size (window, rotation) until you pan or zoom yourself;
  Collapse all and Expand all refit too.
- Quick filters are toggle chips with the legend's colours; the legend shows node shapes and the
  Internet cloud; group titles stay readable when zoomed out; host labels hide when too small.
- Fixes: the empty-state upload icon rendered as a black blob; Copy covered long collect commands;
  a selection that no longer exists is cleared after a reload of files; "1 host" instead of "1 hosts".
- Collector script (`collector/collect.py`, Python 3.9+): collects `<hostname>_netstat.txt` from
  the hosts in a targets file over SSH (system `ssh`, keys or agent) or WinRM (optional `pypsrp`),
  read-only commands only, `--dry-run`, passwords from environment variables or a prompt and
  scrubbed from every message, never overwrites a file, one failure does not stop the run. Only `NP_*`
  environment variables can supply passwords; ssh output is streamed and capped; `--timeout` is an
  overall limit for WinRM too; output without the header counts as a failure.
- Collector targets export suggests `winrm` for Windows hosts (SMB is not a collection method).
- Dark mode switch: System / Dark / Light in the sidebar, remembered in this browser and applied
  before the page draws; the graph recolours instantly.
- Keyboard: expand or collapse any single group from the Hosts tab; the confirm dialog keeps focus
  inside and returns it; Home/End on the panel tabs; Tab out of the Export menu closes it.
- Parsing: UTF-16 files without a byte-order mark, CR-only header lines, a hint when netstat or ss
  ran without -n, duplicate file names numbered, FQDN and short hostnames merged into one host,
  address conflicts listed on the host.
- DNS lookup never sends named subnets or NAT64 / 6to4 / Teredo addresses.
- Web app: load files (worker, drag and drop), grouped network graph with collapsible subnet and
  Internet groups, risk-coloured connections (dashed when seen from one end), greyed-out hosts
  without a file, OS icons and role shapes, listening-port badges, details panel with Hosts and
  Files lists, search and filters, settings (protocol risk table, subnets, internal ranges, role
  tags), exports (PNG, session, CSV, collector targets), session open, unsaved-work warning,
  "How to collect" page, and an opt-in DNS-over-HTTPS reverse lookup for Internet addresses.
- Parsers for Windows `netstat -ano` (English, Swedish and German), Linux `netstat` and `ss`,
  and macOS `netstat`, with format auto-detection and the optional `### netstat-parser v1` header.
- Graph model (hosts, subnet / Internet groups, connections with risk and "seen from both ends",
  roles, tags), search and filter, CSV / targets / session export and import, DNS-over-HTTPS PTR helpers.
- Synthetic test datasets (small / medium / large networks): `npm run gen:data`.
- Project created (2026-11-10).
