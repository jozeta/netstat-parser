# Låda Glass changelog

Newest first. Apps vendor a version under `vendor/lada-glass/<version>/`; `claude-check` reports an
older copy as advice (DES-FAMILY-2).

## Unreleased

## 1.1.1 (2026-11-08)

- Bootstrap bridge: a forced `data-bs-theme` now always wins. On a light-mode system, the system-light
  rule of `lada-glass.css` outranked `[data-bs-theme="dark"]`, so a dark Bootstrap app got light
  accent-text tokens (white text on accent colours; found by Fingerprinter's contrast checks).

## 1.1.0 (2026-11-08)

- `lada-glass-bootstrap.css`, a bridge for apps built with Bootstrap 5.3: `data-bs-theme` picks the
  same theme tokens as `data-theme`, Bootstrap's variables (body, borders, radii, primary, links,
  status colours) point at the Låda Glass tokens, and cards, modals, dropdowns, navbars, buttons,
  form controls, tables, tabs and badges get the frosted-glass look. Markup and scripts stay as they
  are. Built by `build.py` from `lada-glass.css` and `bootstrap-bridge.src.css`.

## 1.0.1 (2026-11-04)

- Fix: a button written as a link (`<a class="lg-btn lg-btn-primary">`) got the link colour, which made
  the primary button's text invisible. The base link rule is now `.lg :where(a)`, so `.lg-btn*` wins.
- `LadaGlass.swift` is unchanged apart from the version line.

## 1.0.0 (2026-11-04)

- First version. Tokens from Låda (`tokens.json`): surfaces, text, borders, status colours, ten
  accent themes (fjord default, frost cyan second accent), 4-pt spacing, radii 6/10, type scale,
  motion (140 ms quick, 320 standard, 350 data, 550 slow), compact density.
- For WCAG AA: chip labels use `*-text` status colours, and the light cloudberry and birch-gold
  accents are 3 % deeper than Låda's.
- `lada-glass.css`: dark/light themes (system, or `data-theme`), accent presets and custom accents,
  frosted-glass surfaces with a fine edge, backdrop with two glows, app shell (sidebar becomes a top
  bar on phones), responsive grid, cards, KPIs, buttons, inputs, tabs, toggle, chips, table, toast,
  empty state, extension popup, icons; 44 px touch targets on touch screens; reduced motion,
  reduced transparency, forced colours and print.
- `LadaGlass.swift`: the same tokens for SwiftUI, with panel, backdrop, chip and motion helpers.
- 44 line icons (`icons/`, plus `sprite.svg`), 4 line-art graphics (`graphics/`), `preview.html`.
