# Changelog

All notable changes to netstat-parser are listed here, newest first.

## Unreleased

## 0.2.2 (2026-11-12)

Fixes from the first collection over real SSH (Debian with `ss`, Debian with only net-tools,
Alpine/busybox; collector also run on Python 3.9).

- Linux collect command and collector: without `ip`, the header's addresses come from `ifconfig`
  (net-tools and busybox formats). Before, such machines had an empty `addresses:` line.
- Header: an IPv4 prefix may be a netmask (`10.0.5.12/255.255.255.0`); a non-contiguous mask
  keeps the address without a prefix.
- Groups: an address with no prefix of its own joins the most specific subnet another header
  reported (/16 or narrower, /48 for IPv6) before falling back to /24 or /64. Before, one Docker
  network showed up as both 172.18.0.0/16 and 172.18.0.0/24.
- README: corrected two lines that said the job is never saved in the browser. By default it is
  kept in this browser's IndexedDB so a reload keeps it; turning off "Keep the current job in this
  browser" deletes the kept copy.

## 0.2.1 (2026-11-11)

Bug fixes from a full code review (32 issues).

- The app is published on GitHub Pages: <https://jozeta.github.io/netstat-parser/> (link in the
  README). It is the same static app; files are still only read in your browser.
- Privacy: DNS lookup sends IPv6 addresses only from global unicast (2000::/3), so private
  addresses in IPv6 form (`::10.0.0.5`, `::ffff:0:a00:5`), site-local `fec0::/10` and `100::/64`
  are never sent; 192.0.0.0/24 and 192.88.99.0/24 are blocked too. Opening a session keeps your own
  named subnets protected. DNS answers that arrive after "Start new job" or "Open session" are
  dropped, and opening a session cancels a running lookup.
- Settings: a session's or restored job's subnet names and protocol table are no longer saved as
  your own settings (only the Settings page and saved filters change what is stored). Importing a
  settings file without saved filters keeps yours, and the chips update after any settings change.
- Kept job: a "Start new job" load that reads nothing keeps the current job (it used to empty it
  and delete the kept copy). Each tab keeps its own job, so two tabs never overwrite each other;
  a closed tab's job is taken over by the next tab. One failed save no longer stops later saves.
  Files dropped while the kept job is being restored are no longer merged into it unasked.
- Parsing: `ss -tanp`, `-tlnp`, `-uanp` (no Netid column), Linux `netstat -tunae`/`-tunaep` (User
  and Inode columns), Windows `netstat -anot` (Offload State column), macOS `-anv` process names
  with spaces, and macOS IPv6 addresses cut to 16 characters are flagged. Host names from file
  names keep their dots (`10.0.0.5`, `web01.corp.local`), and such files are read from folders and
  zips. Zip entry names from Windows' "Send to compressed folder" (CP437) are decoded correctly.
- Model: two machines with the same short name in different domains stay two hosts; a Docker
  bridge address no longer decides a host's subnet, and container addresses are per host (and
  left out of the collector targets export); a connection to a host's own link-local address no
  longer makes an empty node; a session cannot give an IPv4 address a prefix above 32.
- Search: plain words (`445`, `smb`) also match the hosts on those connections, so "Hide
  non-matching" shows them.
- Robustness: zips whose entries share data (zip bombs) stop at the size limit; files full of blank
  lines or very long lines no longer stall parsing; one unreadable item no longer fails a whole
  folder drop. Picking a host from a list redraws the neighbourhood view; opening a session clears
  a shown path.
- Collector: noisy ssh error output no longer stalls collection; `port=` takes ASCII digits only;
  the Linux script falls back to `uname -sr` when `/etc/os-release` is missing; output whose header
  has an empty hostname is kept; `[::1]:22` style hosts are rejected (use `port=`), and zone ids are
  rejected for WinRM.

## 0.2.0 (2026-11-11)

First public release.

- Development: ESLint 10 (with `minimatch` 11, which fixes a denial-of-service advisory), CI on
  `actions/checkout` and `actions/setup-node` v7, collector tests in the `python:3.9-slim` container.
- Search: `process:` (e.g. `process:sshd`), and plain words also match process names. The
  connections CSV has `source_process` and `destination_process` columns.
- Saved filters: save the current search under a name (**+** next to the search box); it appears
  as a chip beside the quick filters. Stored with your settings.
- Path finding: **Start a path here** on one host, **Find path** on another; the path is
  highlighted and listed hop by hop. Options: only red/orange connections, ignore direction.
- Neighbourhood view: **Show → 1 hop / 2 hops around selection** draws only what is near the
  selection.
- Subnet groups and the Internet cloud look like frosted glass: a translucent tint with a light
  sheen from the top, a fine grain, a bright rim and a soft shadow, tuned for dark and light.
- The current job survives a reload or a closed tab: it is kept in this browser (IndexedDB) until
  you start a new job. New setting "Keep the current job in this browser" (on); turning it off
  deletes the kept copy. The leave-page warning now only appears when the job is not kept.
- Resolving DNS names no longer moves nodes: hosts in a group were sorted by their label, which a
  DNS answer changes. They are now ordered by address.
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
