# Changelog

All notable changes to netstat-parser are listed here, newest first.

## Unreleased

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
