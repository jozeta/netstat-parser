# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, offline web app for pentesters and incident responders. It parses up to ~1000 netstat
files (Windows / Linux / macOS) and draws an interactive network graph: hosts grouped by subnet,
public IPs in an "Internet" cloud, and connections coloured by protocol risk. Solid lines mean seen
from both ends, dashed means one end only, and hosts without a file are greyed out. A Python
collector (`collector/`, built after the web app) gathers the files remotely.

It is the successor to the owner's 2014 C# tool in `~/Desktop/NetstatParser/` (outside this repo,
for reference only).

**The agreed design is `docs/superpowers/specs/2026-11-10-netstat-parser-design.md`. Read it
before building anything.** It holds the goals and non-goals, the input formats, the graph model,
the UI, settings, exports and the build order. Change the spec first if the behaviour changes.

Status: designed (2026-11-10). Implementation has not started; the starter screen is still the
scaffold. Update this file as modules land.

## Commands

```sh
python3 -m http.server 8580      # then open http://localhost:8580/ (or: claude-update)
```

Tests:

```sh
npm test            # node --test: tests/*.test.mjs
npm run lint        # ESLint, including the unsafe-DOM rule
npm run gen:data    # write synthetic datasets to tests/data/generated/{small,medium,large} (gitignored)
```

## Layout

- `index.html`: entry page (strict CSP, viewport, Låda Glass app shell)
- `css/app.css`, `js/app.js`: the app's own styles and script (no build step)
- `vendor/lada-glass/1.1.1/`: the Låda Glass design system (copied; update with claude-check's advice)
- `tests/`: `node --test` tests; `tests/fixtures/` hand-written netstat samples per format (committed)
- `docs/superpowers/specs/`, `docs/superpowers/plans/`: the design and implementation plans
- `js/lib/ip.js`: IP/endpoint normalisation (canonical IPv6, IPv4-mapped → IPv4, wildcard `*`)
- `js/parse/`: `parseFile(name, text)` in `index.js` is the entry point; `decode.js` (bytes → text,
  UTF-16/code pages), `header.js`, `detect.js` (line-shape scoring), `states.js` (en/sv/de state
  words, mojibake-tolerant), one parser per format, `common.js` shared helpers, `types.js` typedefs
- `js/lib/cidr.js`: CIDR math and the default internal ranges
- `js/model/`: `build.js` (`buildModel(files, settings)` → hosts/groups/edges), `settings.js`
  (defaults, `validateSettings`, `classify`), `filter.js` (`parseQuery`, `applyFilter`), `exports.js`
  (CSV, targets), `session.js` (save/open, untrusted import), `dns.js` (DoH PTR, injected fetch)
- `scripts/gen/`: seeded network generator (`topology.js`) and renderer (`render.js`);
  `scripts/generate-datasets.js` is the CLI

Planned (see the spec):
- `vendor/cytoscape/`: the graph library, with its licence
- `js/` pure ES modules (parsers, model, classification, filters, exports), importable in Node
  without a DOM, plus a thin DOM/Cytoscape layer and a Web Worker for parsing
- `collector/`: the Python 3 collector

## Architecture rules

- Logic lives in pure modules with tests, and the UI stays a thin layer on top. Parsing runs in a
  Web Worker.
- Every parser produces the same record:
  `{proto, localIp, localPort, remoteIp, remotePort, state, pid?, process?, family}`.
  Formats are auto-detected and never rely on English headers. Windows state names are recognised
  in English, Swedish and German.
- The edge port is the **service port**: the listening port if known, else the lower or
  well-known one. Never use the local port blindly; that was the old tool's bug.
- Job data lives in memory and in exported session files only. `localStorage` holds
  **settings only**.
- The CSP stays strict. The only allowed exception is `connect-src` for the fixed DNS-over-HTTPS
  resolvers (Cloudflare, Google, Quad9), used for the opt-in DNS lookup. That waiver must be
  recorded in `.claude-standards` when it lands.
- The targets file format is shared between the app's export and the collector. It is fixed in
  the spec, so change both together.

## Design

Låda Glass 1.1.1 (`~/Desktop/code/tools/design`, preview: `design/preview.html` there): dark frosted
glass is the main theme, light the alternative, compact density. Use its `lg-` components and
tokens instead of new styles; don't edit the vendored copy (update it when `claude-check` says it's
old). UI must stay responsive (no sideways scrolling at 375 px) and keyboard accessible. Risk
colours are theme tokens: "safe" is neutral light grey, not black.

## Working agreements

- This repo follows the app standards in `~/Desktop/code/tools/standards/STANDARDS.md` (rule IDs,
  severities). `claude-check --repo .` checks it; decisions and reasoned waivers go in `.claude-standards`.
- Plan before building: agree on goals, scope and tech choices first, then implement in small,
  tested steps (failing test first).
- Never commit secrets. `.env` files are gitignored; commit only `.env.example` with placeholders.
- **Never commit real netstat output, targets files, sessions or exports.** Client network data
  is confidential. Test data comes from the synthetic generator.
- Netstat files, session files and DNS answers are untrusted input. Render them with
  `textContent` or a sanitizer, never `innerHTML`; no `eval`; escape CSV cells against formula
  injection. No third-party requests apart from the opt-in DNS lookup (self-host libraries in
  `vendor/`).
- Keep CI (`.github/workflows/ci.yml`) green; record user-visible changes under "Unreleased" in
  `CHANGELOG.md`.
- There is no GitHub remote yet. Don't push or create repos unless asked.
