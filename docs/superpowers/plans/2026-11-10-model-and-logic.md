# Graph Model and Pure Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `ParsedFile[]` into the graph model (hosts, subnet/Internet groups, edges with risk
and "seen from both ends"). Add the logic the UI needs on top: settings with defaults and
validation, search and filter, CSV / targets / session export and import, and DNS-over-HTTPS PTR
helpers.

**Architecture:** Pure ES modules in `js/model/` and `js/lib/`, with no DOM and no network except
an injected `fetch`. The model is a pure function `buildModel(files, settings)`. It is rebuilt on
every change, and IDs are stable so the UI can keep positions and collapse state.

**Tech Stack:** ES2023 modules, `node --test`, ESLint.

**Spec:** `docs/superpowers/specs/2026-11-10-netstat-parser-design.md` (Graph model, Settings,
DNS lookup, Data handling and exports). Consumes `parseFile` / `ParsedFile` from plan 1.

## Global Constraints

- Risk levels: `vulnerable` (red), `exploitable` (orange), `safe` (neutral), `unclassified`.
- Default protocols are exactly the lists in the spec's "Risk levels" section.
- Default role rules: DC = all of 88, 389, 445; DB = any of 1433, 3306, 5432; Web = any of 80, 443; RDP = any of 3389.
- Internal ranges: 10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, fe80::/10, fc00::/7, plus
  any configured in settings. Everything else is Internet. Loopback is excluded from the graph.
- Default subnet: the configured CIDR (longest prefix match) if one matches, else the matching
  header address prefix, else /24 (IPv4) or /64 (IPv6).
- Service port: the listening port of either side's host if known; otherwise the lower port
  number. Direction is client → server.
- `seen`: `both` if the edge was observed in files of both endpoint hosts, else `one`.
- Session files and settings imports are untrusted: validate types and ranges, cap strings, and
  drop what doesn't fit. Never `eval`.
- CSV cells that start with `= + - @ \t \r` get a leading `'`. Quote cells containing `" , \n`.
- DNS: PTR only for Internet IPs. Resolvers (exact URLs):
  `cloudflare` `https://cloudflare-dns.com/dns-query?name=<q>&type=PTR` (header
  `accept: application/dns-json`), `google` `https://dns.google/resolve?name=<q>&type=PTR`,
  `quad9` `https://dns.quad9.net:5053/dns-query?name=<q>&type=PTR`.

## Interfaces (produced by this plan, consumed by the UI plan)

```js
// js/lib/cidr.js
parseCidr(text) -> {ip, prefix, family} | null      // network address canonicalised
inCidr(ip, cidr) -> boolean                          // cidr: {ip,prefix,family}
networkOf(ip, prefix) -> string                      // "10.10.1.0/24"
// js/model/settings.js
DEFAULT_SETTINGS                                     // {protocols, subnets, internalRanges, roleRules, graph, dns}
validateSettings(untrusted) -> Settings              // never throws; falls back per field
classify(port, proto, settings) -> {name, risk}
// js/model/build.js
buildModel(files: ParsedFile[], settings) -> Model
// Model = { hosts: Map<id, Host>, groups: Map<id, Group>, edges: Map<id, Edge>, conflicts: {ip, hostIds}[] }
// Host  = { id, label, hostname|null, ips[], internal, collected, files[{fileName, format, collected}],
//           os: 'windows'|'linux'|'macos'|'unknown', osDetail|null, role: 'server'|'client'|'both'|'unknown',
//           tags[], listening[{proto, port, bindIp, pid?, process?, name, risk}], loopback: NetRecord[],
//           groupId, warnings[] }
// Group = { id, kind: 'subnet'|'internet', cidr|null, name, hostIds[] }
// Edge  = { id, source, target, proto, port, name, risk, seen: 'both'|'one', bothCollected,
//           states[], observations[{fileName, hostId, localIp, localPort, remoteIp, remotePort, state, pid?, process?}] }
// js/model/filter.js
parseQuery(text) -> Term[]                           // Term = {field|null, value, negate}
applyFilter(model, terms) -> {hosts: Set<id>, edges: Set<id>}
// js/model/exports.js
csvCell(v) -> string; connectionsCsv(model) -> string; hostsCsv(model) -> string; targetsFile(model) -> string
// js/model/session.js
SESSION_VERSION = 1; createSession({files, settings, dns, positions, collapsed}) -> object; parseSession(text) -> same shape (throws Error with a user-facing message)
// js/model/dns.js
RESOLVERS; ptrName(ip) -> string; parsePtrAnswer(json) -> string|null;
resolvePtrs(ips, {resolver, fetch, concurrency=4, delayMs=100, signal, onProgress}) -> Promise<Map<ip, name|null>>
```

IDs: collected host `h:<hostname lowercased>`; seen-only host `ip:<ip>`; group `g:<cidr>` or
`g:internet`; edge `e:<source>|<target>|<proto>/<port>`.

## Review Focus

1. **Two files with the same hostname but different IPs** (re-collected after DHCP). Expect one
   host holding both IPs and both files → Task 3 test.
2. **A host that is both client and server on the same port pair**, e.g. DC↔DC replication on 389
   in both directions. Expect two edges with opposite directions, never a self-loop → Task 3 test.
3. **A session file edited by hand or from a newer version.** Expect a clear error, or fields
   dropped, and never a crash or code execution → Task 5 test.
4. **A filter typo** (`port:abc`, `risk:purple`, unbalanced quotes). Expect no exception; the term
   matches nothing → Task 4 test.
5. **A PTR answer containing markup or control characters.** Expect it rejected (`null`) → Task 6 test.

---

### Task 1: CIDR utilities and settings

**Files:** Create `js/lib/cidr.js`, `js/model/settings.js`; Test `tests/cidr-settings.test.mjs`.

- [ ] **Step 1: Failing tests.**
  - `parseCidr('10.10.1.77/24')` → `{ip:'10.10.1.0', prefix:24, family:4}`.
  - `parseCidr('fd10:50::20/64')` → `{ip:'fd10:50::', prefix:64, family:6}`.
  - `parseCidr('10.0.0.0/33')` and `parseCidr('x')` → `null`.
  - `inCidr('10.10.1.5', parseCidr('10.10.0.0/16'))` → `true`; `inCidr('10.11.0.1', …)` → `false`;
    a v4 address against a v6 range → `false`.
  - `networkOf('10.10.1.77', 24)` → `'10.10.1.0/24'`; `networkOf('fd10:50::20', 64)` → `'fd10:50::/64'`.
  - `classify(445,'tcp',DEFAULT_SETTINGS)` → `{name:'SMB', risk:'exploitable'}`; 23 → Telnet,
    vulnerable; 443 → HTTPS, safe; 161/udp → SNMP, vulnerable; 161/tcp → unclassified; 40000 →
    `{name:'40000/tcp', risk:'unclassified'}`.
  - `validateSettings({protocols:[{port:'x'}], subnets:[{cidr:'10.0.0.0/8', name:'<b>A</b>'}], graph:{collapseThreshold:-5}})`
    → protocols fall back to the defaults; the subnet is kept with its name as plain text, capped
    at 64 characters; the threshold falls back to 150. `validateSettings(null)` deep-equals
    `DEFAULT_SETTINGS`.
- [ ] **Step 2:** Run `node --test tests/cidr-settings.test.mjs` → FAIL.
- [ ] **Step 3:** Implement. Protocol entries are `{port (1–65535 or a 'a-b' range string), proto,
  name, risk}`, and the table is checked first-match. DNS settings are
  `{enabled:false, resolver:null}`, with the resolver one of the `RESOLVERS` keys.
- [ ] **Step 4:** `npm test && npm run lint` → pass. **Step 5:** Commit `feat(model): CIDR utilities and settings`.

### Task 2: Host identity, OS, groups

**Files:** Create `js/model/build.js` (first part: identity); Test `tests/model-hosts.test.mjs`.
Helper for tests: `tests/helpers/net.mjs`, which builds `ParsedFile[]` from the generator (`buildNetwork` + `renderFile` + `parseFile`).

- [ ] **Step 1: Failing tests** (use small hand-built ParsedFiles plus generated `small`):
  - A file with header hostname `DC01` and addresses `10.10.1.10/24` → host `h:dc01`,
    `collected:true`, `ips` include `10.10.1.10`, `os:'windows'` from `osDetail` "Windows Server…",
    group `g:10.10.1.0/24`.
  - Without a header: own IPs are inferred from non-wildcard, non-loopback local addresses; OS
    comes from the format (linux-ss → linux).
  - Two files with hostname `ws-1` and `WS-1` with different IPs → one host with both IPs and both files.
  - Two different hostnames claiming the same IP → `conflicts` has `{ip, hostIds:[a,b]}`, and the
    IP maps to the first host.
  - Seen-only internal remote `10.10.10.99` → host `ip:10.10.10.99`, `collected:false`,
    `os:'unknown'`, grouped `g:10.10.10.0/24`. Public remote `203.0.113.10` → group `g:internet`,
    `internal:false`.
  - Settings subnet `{cidr:'10.10.0.0/16', name:'Corp'}` → those hosts group into
    `g:10.10.0.0/16` named `Corp`.
  - Loopback records end up in `host.loopback` and create no hosts.
  - Generated `small`: every collected generator host maps to a model host with the same hostname,
    and every model group is a generator subnet CIDR or `g:internet`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `buildModel` identity and grouping.
  `label` = hostname, else IP. **Step 4:** pass + lint. **Step 5:** Commit `feat(model): host identity and grouping`.

### Task 3: Edges, service port, seen, risk, role, tags, listening

**Files:** Modify `js/model/build.js`; Test `tests/model-edges.test.mjs`.

- [ ] **Step 1: Failing tests:**
  - A Windows client file with `10.10.10.21:49712 → 10.10.1.10:445` plus the DC file with the
    mirror line → one edge `e:h:ws-1|h:dc01|tcp/445`, `seen:'both'`, `risk:'exploitable'`,
    `name:'SMB'`, 2 observations.
  - The same edge with only the client file → `seen:'one'`, target `ip:10.10.1.10`.
  - Both hosts collected but only one file shows the connection → `seen:'one'`, `bothCollected:true`.
  - Service port from listening: a client file only (no server file) where the client port is
    lower than the server's (`10.0.0.5:1025 → 10.0.0.9:8443`), and the client listens on nothing →
    lower-port rule → server port 1025 (documented limitation). When the remote host's file shows
    it listening on 8443 → the server port is 8443.
  - DC↔DC 389 in both directions → two edges, no self-loop. A record whose remote IP belongs to
    the same host → no edge.
  - LISTEN/BOUND records → `host.listening` with name and risk; the wildcard bind is shown as `*`.
  - Role: inbound edges only → `server`; outbound only → `client`; both → `both`; none →
    `unknown`. Tags: a DC with 88/389/445 listening gets `DC`; a seen-only host serving 1433 gets `DB`.
  - Generated `medium`: ≥ 85% of edges between two collected hosts are `seen:'both'`; at least one
    edge exists for each risk level `vulnerable`, `exploitable`, `safe`; and every edge `source` /
    `target` exists in `hosts`.
  - Performance: `buildModel` on the generated `large` set takes < 2 s.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** pass + lint. **Step 5:** Commit `feat(model): edges, risk, roles and tags`.

### Task 4: Search and filter

**Files:** Create `js/model/filter.js`; Test `tests/filter.test.mjs`.

- [ ] **Step 1: Failing tests:**
  - `parseQuery('port:445 subnet:"Office VLAN" risk:red -os:linux dc01')` →
    `[{field:'port',value:'445',negate:false},{field:'subnet',value:'Office VLAN',negate:false},
    {field:'risk',value:'red',negate:false},{field:'os',value:'linux',negate:true},{field:null,value:'dc01',negate:false}]`.
  - `parseQuery('subnet:"unterminated')` doesn't throw; its value is `unterminated`.
  - Risk aliases: `red`/`vulnerable`, `orange`/`exploitable`, `safe`/`green`, `none`/`unclassified`.
  - `applyFilter` on a hand-built model: `port:445` keeps the SMB edge and both its endpoints, and
    hosts listening on 445; `collected:no` keeps the seen-only hosts; `seen:one` keeps one-sided
    edges; free text `dc0` matches hostname substrings case-insensitively; `ip:10.10.1.` prefix
    matches; `proto:smb` matches by protocol name; `-risk:safe` excludes safe edges.
  - An empty query → every host and edge. `port:abc` → no edges and no hosts, and no throw.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. Fields: ip, host, port, proto, risk, os,
  subnet (group name or CIDR, case-insensitive substring), state, role, tag, collected (yes/no),
  seen (both/one). An edge matches when every term matches it; host-level fields are checked
  against either endpoint. A host matches when every term matches the host alone (`port` →
  listening ports; edge-only fields → false), or when it is an endpoint of a matched edge.
- [ ] **Step 4:** pass + lint. **Step 5:** Commit `feat(model): search and filter`.

### Task 5: Exports and sessions

**Files:** Create `js/model/exports.js`, `js/model/session.js`; Test `tests/exports-session.test.mjs`.

- [ ] **Step 1: Failing tests:**
  - `csvCell('=HYPERLINK("x")')` → `"'=HYPERLINK(""x"")"`; `csvCell('a,b')` → `"a,b"` quoted;
    `csvCell(42)` → `42`.
  - `connectionsCsv` header line exactly:
    `source_host,source_ip,destination_host,destination_ip,port,proto,protocol,risk,states,seen,source_files`.
    `hostsCsv` header:
    `hostname,ips,os,role,tags,subnet,collected,listening_ports`. Row counts equal edges / hosts.
  - `targetsFile` lists only seen-only **internal** hosts, one line each, e.g.
    `10.10.10.99 smb user=CHANGEME`. The method is guessed from served/listening ports
    (5985/5986 → winrm, 445 → smb, 22 → ssh, otherwise `ssh  # method unknown`). It starts with
    `#` comment lines that explain the format (`<host> <method> [key=value ...]`, methods
    ssh|winrm|smb, keys user port key password-env hash domain).
  - `parseSession(JSON.stringify(createSession(x)))` deep-equals `x` for a generated `small` set
    with positions, dns and collapsed state.
  - `parseSession('{"version":99}')` throws `Unsupported session version 99`; `parseSession('nope')`
    throws `Not a netstat-parser session file`. A session whose record has `localPort: 1e9`, or
    a 10 kB `process` → that record is dropped (or the process is capped), with no throw.
    `__proto__` keys don't pollute `Object.prototype`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. The session shape is
  `{format:'netstat-parser-session', version:1, savedAt, files: ParsedFile[], settings, dns: {ip:name}, positions: {id:{x,y}}, collapsed: [groupId]}`.
  Validation rebuilds every object field by field, so nothing from the input is passed through.
- [ ] **Step 4:** pass + lint. **Step 5:** Commit `feat(model): CSV, targets and session files`.

### Task 6: DNS-over-HTTPS PTR helpers

**Files:** Create `js/model/dns.js`; Test `tests/dns.test.mjs`.

- [ ] **Step 1: Failing tests:**
  - `ptrName('203.0.113.10')` → `'10.113.0.203.in-addr.arpa'`; `ptrName('2001:db8::1')` → the
    32-nibble reversed form ending in `ip6.arpa`.
  - `parsePtrAnswer({Status:0, Answer:[{type:12, data:'web.example.com.'}]})` → `'web.example.com'`.
    `{Status:3}` → `null`. Data `<script>.x.` or containing `\u0007` → `null`. Data longer than
    253 characters → `null`.
  - `resolvePtrs(['203.0.113.10','198.51.100.7'], {resolver:'google', fetch: fake})` calls `fake`
    with `https://dns.google/resolve?name=10.113.0.203.in-addr.arpa&type=PTR`. Cloudflare calls
    carry `accept: application/dns-json`. It resolves to a Map of both IPs. It never runs more than
    `concurrency` requests at once, reports progress `(done, total)`, and stops early (rejecting
    with `AbortError`) when the signal aborts. A fetch that throws maps that IP to `null`.
  - An unknown resolver → throws `Unknown resolver`. Private IPs passed in are skipped (never sent).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** pass + lint. **Step 5:** Commit `feat(model): DNS-over-HTTPS PTR lookups`.
- [ ] **Step 6:** Add a CHANGELOG "Unreleased" line for the graph model, filters, exports and DNS
  helpers, and add `js/model/` to the CLAUDE.md layout. Commit `docs: model layer`.
