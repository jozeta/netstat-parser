# Parsers and Synthetic Datasets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn raw netstat/ss text files from Windows (en/sv/de), Linux and macOS into one common
record format, and generate three realistic synthetic networks (small / medium / large) to test
against.

**Architecture:** Pure ES modules under `js/` with no DOM, importable both in Node tests and later
in the browser Web Worker. There is one parser per format, plus a detector that scores line shapes
(it never relies on English headers) and a `parseFile` entry point. A seeded generator under
`scripts/` builds a network model, stores each host's ground-truth sockets, and renders them in
that host's format. Round-trip tests compare `parseFile(render(host))` with the ground truth.

**Tech Stack:** Plain JavaScript (ES2023 modules), `node --test`, ESLint 9. No runtime
dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-netstat-parser-design.md` (sections "Input formats",
"Test data"). This plan is build-order step 1 only; the graph model, UI, etc. get their own plans.

## Global Constraints

- No runtime dependencies; dev dependencies only (eslint). No network access in code or tests.
- Modules in `js/` must not touch `window`/`document`; they run in Node 22+ and in a Web Worker.
- Input text is untrusted: never `eval`, never build regexes from input, cap stored strings
  (hostname ≤ 253 chars, process ≤ 128 chars), strip control characters.
- Formats: Windows `netstat -ano` (`-an`, `-anob` tolerated); Linux `netstat -tunap`/`-tuna` and
  `ss -tunap`/`-tuna`; macOS `netstat -an` and `netstat -anv -p tcp`. IPv4 + IPv6.
- Windows state names in English, Swedish and German. For an unknown state word, a socket with a
  wildcard remote counts as LISTEN, and the word is reported in `unknownStates`.
- Loopback records are **kept** by the parser; the model (a later plan) excludes them from the graph.
- Datasets: small 20–40, medium 150–250, large 300–400 internal computers; deterministic per seed;
  written to `tests/data/generated/` (gitignored). Public addresses only from documentation ranges
  `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`.
- Header format (exact):
  ```
  ### netstat-parser v1
  hostname: WS-0142
  os: Microsoft Windows 11 Pro 10.0.22631
  collected: 2026-11-10T20:41:00Z
  addresses: 10.0.5.12/24, fe80::1c2a:3bff:fe4d:12/64
  ### netstat
  ```
- File names: `<hostname>_netstat.txt`.

## Shared types (JSDoc, defined in `js/parse/types.js`)

```js
/** @typedef {{ proto: 'tcp'|'udp', family: 4|6, localIp: string, localPort: number|null,
 *   remoteIp: string, remotePort: number|null, state: string, pid?: number, process?: string }} NetRecord */
// ip: canonical text (IPv4 dotted; IPv6 RFC 5952 lowercase compressed; IPv4-mapped → IPv4,
//     family 4; zone id stripped) or '*' for any wildcard (0.0.0.0, ::, *). port: null for '*'.
// state: one of STATES (below) or 'UNKNOWN'.
/** @typedef {{ records: NetRecord[], unparsed: {lineNo: number, line: string}[],
 *   unknownStates: string[] }} FormatResult */
/** @typedef {{ hostname: string|null, os: string|null, collected: string|null,
 *   addresses: {ip: string, prefix: number}[] }} Header */
/** @typedef {{ fileName: string, format: Format|null, hostname: string,
 *   hostnameSource: 'header'|'filename', header: Header|null, records: NetRecord[],
 *   warnings: { unparsedCount: number, unparsedSamples: {lineNo:number,line:string}[],
 *   unknownStates: string[], notRecognised: boolean } }} ParsedFile */
/** @typedef {'windows'|'linux-netstat'|'linux-ss'|'macos'} Format */
```

`STATES = ['LISTEN','BOUND','ESTABLISHED','SYN_SENT','SYN_RECEIVED','FIN_WAIT_1','FIN_WAIT_2',
'CLOSE_WAIT','CLOSING','LAST_ACK','TIME_WAIT','CLOSED']`. UDP with no state column: `BOUND` if
the remote is a wildcard, else `ESTABLISHED`. `ss` `UNCONN` → `BOUND`.

A parser counts a line as a **candidate** only if its first token matches
`/^(tcp|udp)(4|6|46)?$/i`. Candidate lines that fail to parse go to `unparsed`; every other line
(titles, column headers, blank lines, the macOS UNIX-socket section) is skipped silently.

## Review Focus

1. **PowerShell 5 redirect files are UTF-16LE with a BOM**, and cmd redirects use the OEM code page,
   so `ABHÖREN` arrives as `ABH™REN` or similar. Expect them to parse normally → Task 2 tests
   (decode + mojibake-tolerant state matching).
2. **CRLF line endings and a trailing line with no newline.** Expect no phantom unparsed lines and
   no lost last record → Task 4 test `crlf and no final newline`.
3. **IPv4-mapped IPv6 (`::ffff:10.0.0.5`) on Linux.** Expect it to normalise to the same `10.0.0.5`
   that the peer's Windows file shows, otherwise "seen from both ends" breaks later → Task 1 and
   Task 6 tests.
4. **A file that isn't netstat at all** (e.g. `ipconfig` output or a picture renamed `.txt`).
   Expect `notRecognised: true`, zero records and no exception → Task 8 test.
5. **A hostile hostname in the header or file name** (control characters, 10 kB long). Expect it
   sanitised and capped, never thrown → Task 3 test.

---

### Task 1: Tooling and IP/endpoint utilities

**Files:**
- Modify: `eslint.config.js` (add globals `TextDecoder`, `self` for `js/**`; Node globals
  `process` and `URL` for `scripts/**`)
- Create: `js/lib/ip.js`, `js/parse/types.js` (typedefs + `STATES` export)
- Test: `tests/ip.test.mjs`

**Interfaces:**
- Produces: `normalizeIp(text: string) -> {ip: string, family: 4|6} | null` (wildcards →
  `{ip:'*', family}`, `0.0.0.0` → 4, `::` → 6, bare `*` → 4);
  `splitEndpoint(token: string, sep: ':'|'.') -> {ip, family, port: number|null} | null`;
  `isWildcard(ip) -> boolean`; `isLoopback(ip) -> boolean`; `STATES` from `types.js`.

- [ ] **Step 1: Install dev dependencies and confirm lint runs.** Run `npm install && npm run lint`.
  Expected: exits 0. Commit `package-lock.json` with this task.
- [ ] **Step 2: Write failing tests** in `tests/ip.test.mjs`:
  ```js
  normalizeIp('10.0.0.5')            → {ip:'10.0.0.5', family:4}
  normalizeIp('FE80:0:0:0:0:0:0:1')  → {ip:'fe80::1', family:6}
  normalizeIp('2001:db8:0:0:1:0:0:1')→ {ip:'2001:db8::1:0:0:1', family:6}   // RFC 5952: first longest run
  normalizeIp('::ffff:10.0.0.5')     → {ip:'10.0.0.5', family:4}
  normalizeIp('fe80::1%eth0')        → {ip:'fe80::1', family:6}
  normalizeIp('0.0.0.0') → {ip:'*',family:4};  normalizeIp('::') → {ip:'*',family:6}
  normalizeIp('999.1.1.1') → null;  normalizeIp('hello') → null;  normalizeIp('1:2:3') → null
  splitEndpoint('10.0.0.5:445', ':')      → {ip:'10.0.0.5', family:4, port:445}
  splitEndpoint('[::]:135', ':')          → {ip:'*', family:6, port:135}
  splitEndpoint(':::80', ':')             → {ip:'*', family:6, port:80}       // Linux netstat
  splitEndpoint('*:*', ':')               → {ip:'*', family:4, port:null}
  splitEndpoint('0.0.0.0%eth0:68', ':')   → {ip:'*', family:4, port:68}       // ss interface suffix
  splitEndpoint('[fe80::1%eth0]:546', ':')→ {ip:'fe80::1', family:6, port:546}
  splitEndpoint('192.168.50.12.52344', '.') → {ip:'192.168.50.12', family:4, port:52344}  // macOS
  splitEndpoint('*.22', '.')              → {ip:'*', family:4, port:22}
  splitEndpoint('fe80::1%lo0.49152', '.') → {ip:'fe80::1', family:6, port:49152}
  splitEndpoint('10.0.0.5:70000', ':')    → null
  isLoopback('127.0.0.1') && isLoopback('::1') && !isLoopback('10.0.0.1')
  ```
- [ ] **Step 3: Run** `node --test tests/ip.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement `js/lib/ip.js`.** Split the port off at the **last** separator. IPv6
  canonicalisation is done by hand (expand to 8 groups, drop leading zeros, compress the first
  longest run of ≥ 2 zero groups, lowercase); no URL/regex tricks on untrusted text beyond fixed
  patterns.
- [ ] **Step 5: Run** `npm test && npm run lint`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(parse): IP and endpoint normalisation`.

### Task 2: Text decoding and localized state names

**Files:**
- Create: `js/parse/decode.js`, `js/parse/states.js`
- Test: `tests/decode-states.test.mjs`

**Interfaces:**
- Produces: `decodeBytes(bytes: Uint8Array) -> string` (BOM → UTF-16LE/BE/UTF-8; no BOM → UTF-8 if
  valid, else `windows-1252`; output lines end in `\n`);
  `normalizeState(word: string) -> string | null` (canonical from `STATES`, or null if unknown).

- [ ] **Step 1: Write failing tests**:
  ```js
  decodeBytes(utf16leWithBom('  TCP    0.0.0.0:135  0.0.0.0:0  LISTENING  1012\r\n')) → '  TCP    0.0.0.0:135  0.0.0.0:0  LISTENING  1012\n'
  decodeBytes(Uint8Array.from([0x41,0x42,0x48,0x99,0x52,0x45,0x4e]))  → contains 'ABH' and 'REN' (no throw)
  normalizeState('LISTENING') → 'LISTEN';  normalizeState('listen') → 'LISTEN'
  normalizeState('ESTAB') → 'ESTABLISHED'; normalizeState('TIME-WAIT') → 'TIME_WAIT'; normalizeState('UNCONN') → 'BOUND'
  normalizeState('ABHÖREN') → 'LISTEN';  normalizeState('HERGESTELLT') → 'ESTABLISHED'
  normalizeState('WARTEND') → 'TIME_WAIT'; normalizeState('SCHLIESSEN_WARTEN') → 'CLOSE_WAIT'
  normalizeState('SYN_GESENDET') → 'SYN_SENT'
  normalizeState('LYSSNAR') → 'LISTEN';  normalizeState('UPPRÄTTAD') → 'ESTABLISHED'; normalizeState('ETABLERAD') → 'ESTABLISHED'
  normalizeState('ABH™REN') → 'LISTEN';  normalizeState('UPPR„TTAD') → 'ESTABLISHED'   // OEM code-page mojibake
  normalizeState('(state)') → null;  normalizeState('FOO') → null
  ```
- [ ] **Step 2: Run** `node --test tests/decode-states.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** `states.js` holds one table `{ word: canonical }` per language
  (English including Linux/macOS/ss spellings, German, Swedish) plus `BOUND`/`GEBUNDEN`. Matching
  key: uppercase, `-` → `_`, every character outside `[A-Z0-9_]` → `?`. Build the table keys the
  same way, so `ABHÖREN`, `ABH™REN` and `ABH”REN` all become `ABH?REN`. Swedish state words beyond
  LYSSNAR/UPPRÄTTAD/ETABLERAD are unverified; leave them out rather than guess (the unknown-state
  fallback covers them).
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(parse): decoding and en/sv/de state names`.

### Task 3: Header and hostname

**Files:**
- Create: `js/parse/header.js`
- Test: `tests/header.test.mjs`

**Interfaces:**
- Produces: `parseHeader(text: string) -> {header: Header|null, body: string}`;
  `hostnameFromFileName(name: string) -> string`; `cleanText(s: string, max: number) -> string`
  (strips C0/C1 control characters, trims, cuts to `max`).

- [ ] **Step 1: Write failing tests**:
  - The exact header from Global Constraints → `header.hostname === 'WS-0142'`, `header.os`,
    `header.collected === '2026-11-10T20:41:00Z'`,
    `header.addresses` deep-equals `[{ip:'10.0.5.12',prefix:24},{ip:'fe80::1c2a:3bff:fe4d:12',prefix:64}]`,
    and `body` starts with the first line after `### netstat`.
  - Leading blank lines and a UTF-8 BOM before `### netstat-parser v1` are tolerated.
  - No header → `{header: null, body: <unchanged text>}`.
  - Unknown keys are ignored; an address that doesn't parse is skipped.
  - `hostnameFromFileName('DC01_netstat.txt') === 'DC01'`; `('web-02_NETSTAT.TXT') === 'web-02'`;
    `('capture.log') === 'capture'`; `('noext') === 'noext'`.
  - A header hostname of `'evil\u0007\u001b[31m' + 'A'.repeat(10000)` → no control characters,
    length ≤ 253.
- [ ] **Step 2: Run** `node --test tests/header.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `js/parse/header.js` (addresses go through `normalizeIp`; prefix must
  be 0–32 for v4, 0–128 for v6).
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(parse): netstat-parser header and hostname`.

### Task 4: Windows parser

**Files:**
- Create: `js/parse/windows.js`
- Create fixtures: `tests/fixtures/windows-en-ano.txt`, `windows-sv-ano.txt`, `windows-de-ano.txt`,
  `windows-anob.txt` (hand-written to match real output: two-space indent, `Proto`/`Prot.` header
  lines, IPv4 + `[::]` lines, UDP lines with `*:*` and an empty state column, PIDs; the `-anob`
  file has `[svchost.exe]`, a service-name line such as ` Dnscache`, and
  `Can not obtain ownership information` lines)
- Test: `tests/parse-windows.test.mjs`

**Interfaces:**
- Consumes: `splitEndpoint(…, ':')`, `normalizeState`, `cleanText`.
- Produces: `parseWindows(body: string) -> FormatResult`.

- [ ] **Step 1: Write failing tests**:
  - en fixture line `  TCP    10.10.10.21:49712      10.10.1.10:445         ESTABLISHED     4` →
    `{proto:'tcp', family:4, localIp:'10.10.10.21', localPort:49712, remoteIp:'10.10.1.10',
    remotePort:445, state:'ESTABLISHED', pid:4}`.
  - `  TCP    [::]:135               [::]:0                 LISTENING       1012` →
    `{family:6, localIp:'*', localPort:135, remoteIp:'*', remotePort:0, state:'LISTEN', pid:1012}`.
  - `  UDP    0.0.0.0:123            *:*                                    1456` →
    `{proto:'udp', localIp:'*', localPort:123, remoteIp:'*', remotePort:null, state:'BOUND', pid:1456}`.
  - The sv and de fixtures produce the same records as en (same lines, translated states).
  - anob: the record just before `[svchost.exe]` gets `process:'svchost.exe'`; the service-name
    and ownership lines are not counted as unparsed.
  - Unknown state: `  TCP    0.0.0.0:445   0.0.0.0:0   ZUHÖREN_X   4` → state `'LISTEN'`,
    `unknownStates` includes `'ZUHÖREN_X'`; with a non-wildcard remote → state `'UNKNOWN'`.
  - `crlf and no final newline`: the en fixture with `\r\n` endings and no trailing newline gives
    the same records as the original, and `unparsed` is empty.
  - `  TCP    garbage` → one entry in `unparsed` with its 1-based `lineNo`.
- [ ] **Step 2: Run** `node --test tests/parse-windows.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `parseWindows`. Columns are whitespace-separated: proto, local,
  remote, [state], [pid]. The state is optional for UDP. A token that is all digits in the state
  slot is the PID.
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(parse): Windows netstat (en/sv/de, -anob)`.

### Task 5: Linux netstat parser

**Files:**
- Create: `js/parse/linux-netstat.js`
- Create fixtures: `tests/fixtures/linux-netstat-tunap.txt` (as root: `PID/Program name` column,
  e.g. `812/sshd`, `1201/sshd: root@pts/0`), `linux-netstat-tuna-nonroot.txt` (`-` in the PID column)
- Test: `tests/parse-linux-netstat.test.mjs`

**Interfaces:**
- Produces: `parseLinuxNetstat(body: string) -> FormatResult`.

- [ ] **Step 1: Write failing tests**:
  - `tcp        0      0 10.10.20.5:22           10.10.1.30:51544        ESTABLISHED 1201/sshd: root@pts/0`
    → `{proto:'tcp', family:4, localIp:'10.10.20.5', localPort:22, remoteIp:'10.10.1.30',
    remotePort:51544, state:'ESTABLISHED', pid:1201, process:'sshd: root@pts/0'}`.
  - `tcp6       0      0 :::80                   :::*                    LISTEN      900/nginx: master`
    → `{family:6, localIp:'*', localPort:80, remoteIp:'*', remotePort:null, state:'LISTEN', pid:900}`.
  - `tcp6  0  0 ::ffff:10.10.20.5:443  ::ffff:10.10.10.21:50122  ESTABLISHED -` →
    `{family:4, localIp:'10.10.20.5', remoteIp:'10.10.10.21'}`, no `pid`.
  - `udp        0      0 0.0.0.0:68              0.0.0.0:*                           600/dhclient`
    → `state:'BOUND', pid:600, process:'dhclient'`.
  - The `Active UNIX domain sockets` section and its `unix  2 [ ACC ] …` lines are skipped and not
    counted as unparsed.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Columns: proto, recv-q, send-q, local, foreign, [state], [pid/prog…].
  Everything after the PID's `/` up to the end of the line is the process name.
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(parse): Linux netstat`.

### Task 6: Linux ss parser

**Files:**
- Create: `js/parse/linux-ss.js`
- Create fixture: `tests/fixtures/linux-ss-tunap.txt` (header `Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process`)
- Test: `tests/parse-linux-ss.test.mjs`

**Interfaces:**
- Produces: `parseLinuxSs(body: string) -> FormatResult`.

- [ ] **Step 1: Write failing tests**:
  - `tcp   ESTAB  0      0      10.10.20.5:22      10.10.1.30:51544 users:(("sshd",pid=1201,fd=4))`
    → `{state:'ESTABLISHED', pid:1201, process:'sshd'}`.
  - `tcp   LISTEN 0      511    [::]:80            [::]:*` → `{family:6, localIp:'*', localPort:80, remoteIp:'*', remotePort:null, state:'LISTEN'}`, no pid.
  - `udp   UNCONN 0      0      0.0.0.0%eth0:68    0.0.0.0:*     users:(("dhclient",pid=600,fd=6))` → `state:'BOUND', localPort:68`.
  - `tcp   ESTAB  0      0      [::ffff:10.10.20.5]:443 [::ffff:10.10.10.21]:50122` → family 4, IPv4 addresses.
  - `tcp   TIME-WAIT 0   0      10.10.20.5:443     10.10.10.21:50110` → `state:'TIME_WAIT'`.
  - `users:(("nginx",pid=900,fd=6),("nginx",pid=901,fd=6))` → first one wins: `pid:900`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Columns: netid, state, recv-q, send-q, local, peer, [process…].
  The process name and pid come from the first `("name",pid=N` match.
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(parse): Linux ss`.

### Task 7: macOS parser

**Files:**
- Create: `js/parse/macos.js`
- Create fixtures: `tests/fixtures/macos-netstat-an.txt` (includes the `Active LOCAL (UNIX) domain
  sockets` section), `macos-netstat-anv.txt` (`-anv -p tcp` with extra columns, including a
  `process:pid` token such as `sharingd:412`)
- Test: `tests/parse-macos.test.mjs`

**Interfaces:**
- Produces: `parseMacos(body: string) -> FormatResult`.

- [ ] **Step 1: Write failing tests**:
  - `tcp4       0      0  192.168.50.12.52344    203.0.113.10.443       ESTABLISHED` →
    `{proto:'tcp', family:4, localIp:'192.168.50.12', localPort:52344, remoteIp:'203.0.113.10', remotePort:443, state:'ESTABLISHED'}`.
  - `tcp46      0      0  *.22                   *.*                    LISTEN` → `{localIp:'*', localPort:22, remoteIp:'*', remotePort:null, state:'LISTEN'}`.
  - `tcp6       0      0  fe80::1%lo0.49152      *.*                    LISTEN` → `{family:6, localIp:'fe80::1', localPort:49152}`.
  - `udp4       0      0  *.5353                 *.*` → `state:'BOUND'`.
  - In the `-anv` fixture, a line with a `sharingd:412` token → `pid:412, process:'sharingd'`.
  - Lines in the UNIX-socket section are skipped and not counted as unparsed.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `splitEndpoint(…, '.')`. The token after foreign is the state
  only if `normalizeState` knows it. In `-v` output, the pid comes from the first later token
  matching `/^([^:\s]+):(\d+)$/`.
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(parse): macOS netstat`.

### Task 8: Format detection and `parseFile`

**Files:**
- Create: `js/parse/detect.js`, `js/parse/index.js`
- Test: `tests/parse-file.test.mjs`

**Interfaces:**
- Consumes: all four parsers, `parseHeader`, `hostnameFromFileName`, `cleanText`.
- Produces: `detectFormat(body: string) -> Format|null`;
  `parseFile(fileName: string, text: string) -> ParsedFile` (the only entry point later plans use).

- [ ] **Step 1: Write failing tests**:
  - Each fixture from Tasks 4–7 is detected as its format. Swedish and German Windows are detected
    as `windows` even after the `Proto`/`Prot.` header lines are deleted.
  - `parseFile('DC01_netstat.txt', headerText + windowsEn)` → `hostname:'DC01'`,
    `hostnameSource:'header'`, `format:'windows'`, records equal `parseWindows(windowsEn).records`.
  - Without a header → `hostname` comes from the file name, `hostnameSource:'filename'`.
  - **Not netstat:** `ipconfig`-style text, and 2 kB of random bytes decoded with `decodeBytes` →
    `format:null, records:[], warnings.notRecognised:true`, no throw.
  - Empty string → `notRecognised:true`.
  - `warnings.unparsedSamples` holds at most 5 entries while `unparsedCount` counts them all.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement `detectFormat`.** Over the first 500 candidate lines, count how many
  match each format's line-shape regex below. The highest count wins; zero for all → null. Ties
  resolve in this order: ss, macos, linux-netstat, windows.
  ```
  linux-ss:      ^(tcp|udp)\s+[A-Z][A-Z0-9-]*\s+\d+\s+\d+\s+\S+:\S+\s+\S+:\S+
  macos:         ^(tcp|udp)(4|6|46)\s+\d+\s+\d+\s+\S+\.(\d+|\*)\s+\S+\.(\d+|\*)
  linux-netstat: ^(tcp|udp)6?\s+\d+\s+\d+\s+\S+:(\d+|\*)\s+\S+:(\d+|\*)
  windows:       ^\s*(TCP|UDP)\s+\S+:\d+\s+\S+:(\d+|\*)
  ```
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(parse): format detection and parseFile`.

### Task 9: Seeded network generator

**Files:**
- Create: `scripts/gen/random.js`, `scripts/gen/topology.js`
- Test: `tests/gen-topology.test.mjs`

**Interfaces:**
- Produces: `createRng(seed: number) -> {next(): number, int(min, max): number, pick(arr), chance(p): boolean}` (mulberry32);
  `buildNetwork(size: 'small'|'medium'|'large', seed: number) -> Network` where
  `Network = { size, seed, subnets: {cidr, name}[], hosts: GenHost[] }` and
  `GenHost = { hostname, os: 'windows'|'linux'|'macos'|'device', osVersion, format: Format|null,
  locale: 'en'|'sv'|'de'|null, withHeader: boolean, collected: boolean, role: string,
  addresses: {ip, prefix}[], sockets: NetRecord[] }` (`sockets` = the exact records this host's
  file must parse to; empty for uncollected hosts).

- [ ] **Step 1: Write failing tests** (for each size, seed 1):
  - Internal computer count (all hosts except public ones) is within 20–40 / 150–250 / 300–400.
  - `buildNetwork('medium', 1)` deep-equals a second call with the same seed. Seed 2 differs.
  - At least one host of each role: `dc`, `file`, `db`, `web`, `jump`, `client`, plus `device`
    (printer/switch, never collected).
  - Between 10% and 25% of internal hosts have `collected:false`.
  - Every format appears among collected hosts, all three Windows locales appear, and both
    `withHeader` true and false appear.
  - **Both ends:** for ≥ 85% of established TCP sockets between two collected hosts, the peer has
    the mirrored socket (local and remote swapped). At least one such pair exists without a mirror
    (snapshot effect).
  - Risky traffic exists: at least one socket each to ports 23, 21, 445, 3389, 1433 or 3306, 80,
    and 161/udp. Safe traffic exists: 22 and 443.
  - Online services: some sockets go to public addresses, and all of them are inside the
    documentation ranges from Global Constraints. At least one is IPv6.
  - Every collected host has listening sockets and at least one loopback socket.
  - Client ports are ephemeral for the OS (Windows/macOS 49152–65535, Linux 32768–60999).
- [ ] **Step 2: Run** `node --test tests/gen-topology.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Layout:** server VLAN `10.10.1.0/24`, client VLANs `10.10.10.0/24` and up (about 60 hosts
    each), DMZ `172.16.5.0/24` (web, reverse proxy), dev/Mac VLAN `192.168.50.0/24`, devices
    `10.10.0.0/24`.
  - **Roles and services:**
    - DC: 53, 88, 135, 389, 445, 636, 3268/3269
    - file: 445, 21 on some
    - db: 1433 or 3306/5432
    - web: 80, 443, 8080
    - jump: 22, 3389
    - devices: 23, 161/udp, 9100
  - **Typical traffic:**
    - clients → DC (88/389/445/53)
    - clients → file 445
    - web → db
    - jump → servers (3389/22)
    - admins → devices (23/161)
    - Macs/Linux → servers 22
    - everyone → public 443/80
  - **Mix:** about 60% Windows, 25% Linux, 15% macOS.
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(gen): seeded synthetic network model`.

### Task 10: Rendering, CLI and round-trip tests

**Files:**
- Create: `scripts/gen/render.js`, `scripts/generate-datasets.js`
- Modify: `package.json` (add `"gen:data": "node scripts/generate-datasets.js"`)
- Test: `tests/gen-roundtrip.test.mjs`

**Interfaces:**
- Consumes: `buildNetwork`, `parseFile`, the fixtures (as the reference for column layout).
- Produces: `renderFile(host: GenHost, collectedAt: string) -> {fileName: string, text: string}`;
  the CLI `node scripts/generate-datasets.js [--seed N] [--out DIR]`, which writes
  `DIR/<size>/<hostname>_netstat.txt` for every collected host plus `DIR/<size>/manifest.json`
  (the `Network` object without sockets, and each host's file name). DIR defaults to
  `tests/data/generated`.

- [ ] **Step 1: Write failing tests**:
  - For every collected host in all three sizes (seed 1): `parseFile(fileName, text).records`
    deep-equals `host.sockets` (order-insensitive), `format` equals `host.format`, `hostname`
    equals `host.hostname`, and `warnings.unparsedCount === 0`.
  - Windows output for `locale:'sv'` contains `LYSSNAR`; for `'de'` it contains `ABHÖREN`.
  - The rendered Windows `en` text for a fixed tiny host matches the column layout of
    `tests/fixtures/windows-en-ano.txt` line for line. Do the same for one Linux ss host and one
    macOS host against their fixtures; this guards against the generator and parser sharing a
    format bug.
  - **Performance:** parsing every file of `large` takes < 3 s in `node --test`.
  - Running the CLI into a temp dir (`fs.mkdtempSync`) writes a `manifest.json` and a number of
    `.txt` files equal to the count of collected hosts per size.
- [ ] **Step 2: Run** `node --test tests/gen-roundtrip.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `render.js` (one renderer per format and locale, reproducing the
  fixture column layout; the header goes first when `withHeader`) and the CLI (no dependencies;
  `fs`/`path` only; it replaces only the `<size>/` folders it writes into).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run gen:data`. Expected: tests pass. The
  CLI prints three lines like `small: 31 hosts, 26 files → tests/data/generated/small`. Then
  `git status` shows nothing under `tests/data/`.
- [ ] **Step 5: Docs.** In `CHANGELOG.md` "Unreleased", add "Parsers for Windows (en/sv/de),
  Linux netstat/ss and macOS netstat; synthetic test datasets (`npm run gen:data`)". In
  `CLAUDE.md` Commands, add `npm run gen:data`, and update Layout with `js/lib`, `js/parse`,
  `scripts/gen`.
- [ ] **Step 6: Commit** `feat(gen): render datasets and round-trip tests`.
