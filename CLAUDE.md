# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

webapp that parses multiple netstat files from computers and builds a graph

Project type: Static web site / web app (HTML, CSS, JS). Created 2026-11-10. **Keep this file up to date** as the project takes shape:
replace the starter sections below with the real commands, architecture and rules once they exist.

## Commands

```sh
python3 -m http.server 8580      # then open http://localhost:8580/ (or: claude-update)
```

Tests:

```sh
npm test            # node --test: tests/*.test.mjs
npm run lint        # ESLint, including the unsafe-DOM rule
```

## Layout

- `index.html`: entry page (strict CSP, viewport, Låda Glass app shell)
- `css/app.css`, `js/app.js`: the app's own styles and script (no build step)
- `vendor/lada-glass/1.1.1/`: the Låda Glass design system (copied; update with claude-check's advice)
- `tests/`: `node --test` tests

## Design

Låda Glass 1.1.1 (`~/Desktop/code/tools/design`, preview: `design/preview.html` there): dark frosted
glass is the main theme, light the alternative, compact density. Use its `lg-` components and
tokens instead of new styles; don't edit the vendored copy (update it when `claude-check` says it's
old). UI must stay responsive (no sideways scrolling at 375 px) and keyboard accessible.

## Working agreements

- This repo follows the app standards in `~/Desktop/code/tools/standards/STANDARDS.md` (rule IDs,
  severities). `claude-check --repo .` checks it; decisions and reasoned waivers go in `.claude-standards`.
- Plan before building: agree on goals, scope and tech choices first, then implement in small,
  tested steps (failing test first).
- Never commit secrets. `.env` files are gitignored; commit only `.env.example` with placeholders.
- Untrusted data (network, files, URLs, storage, user input) is rendered with `textContent` or a
  sanitizer, never `innerHTML`; no `eval`; no third-party requests (self-host libraries in `vendor/`).
- Keep CI (`.github/workflows/ci.yml`) green; record user-visible changes under "Unreleased" in
  `CHANGELOG.md`.
- There is no GitHub remote yet. Don't push or create repos unless asked.
