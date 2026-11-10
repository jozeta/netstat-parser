# Changelog

All notable changes to netstat-parser are listed here, newest first.

## Unreleased

- Parsers for Windows `netstat -ano` (English, Swedish and German), Linux `netstat` and `ss`,
  and macOS `netstat`, with format auto-detection and the optional `### netstat-parser v1` header.
- Graph model (hosts, subnet / Internet groups, connections with risk and "seen from both ends",
  roles, tags), search and filter, CSV / targets / session export and import, DNS-over-HTTPS PTR helpers.
- Synthetic test datasets (small / medium / large networks): `npm run gen:data`.
- Project created (2026-11-10).
