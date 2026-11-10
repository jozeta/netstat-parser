# Changelog

All notable changes to netstat-parser are listed here, newest first.

## Unreleased

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
