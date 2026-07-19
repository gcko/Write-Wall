# design-sync notes — Write-Wall

- **Tokens-only DS.** Write-Wall is a Chrome extension (vanilla TS, no React,
  no component library). The sync ships the theme only: 8 CSS custom
  properties + light/dark theming from `public/css/main.css`. Zero components
  is the expected, user-approved result — the user chose "proceed anyway" when
  told the repo isn't a component library.
- **Empty entry stub.** The converter needs an `--entry` to resolve the package
  root; `.design-sync/entry.mjs` is a committed empty module for that
  (`cfg.entry` points at it). Without it, PKG_DIR falls back to
  `node_modules/write-wall` which doesn't exist.
- **Converter deps live in `.ds-sync/node_modules`.** The repo has no React,
  so `react`, `react-dom` (for `_vendor/`), and `playwright` are installed
  into the staged-scripts dir; pass `--node-modules .ds-sync/node_modules`.
  Never `pnpm add` these to the repo itself.
- **Playwright pin: 1.60.0** — matches cached `chromium-1223` in
  `~/.cache/ms-playwright/`. Re-check the cache before installing on a new
  machine (latest playwright wanted uncached 1228).
- **`guidelinesGlob: []` is deliberate.** `docs/*.md` are engineering docs
  (architecture, troubleshooting), not design guidelines — shipping them would
  mislead the design agent.
- No build command needed: the CSS is static under `public/`; the extension's
  `pnpm build` output is irrelevant to the sync.

## Re-sync risks

- `conventions.md` inlines the 8 token names and the styling idiom (border,
  hover, monospace rules). If `public/css/main.css` tokens or control styles
  change, re-validate every name in `conventions.md` against the fresh
  `_ds_bundle.css` and update the prose.
- First sync ran from `feature/light-and-dark-mode`, later confirmed identical
  to `main` after PR #28 merged (re-sync verdict 2026-07-19: `upload.any: false`).
  Future syncs should run from `main`.
- The playwright↔chromium cache pin can drift on a different machine or after
  a cache cleanup; re-run the §4.1 cache check rather than trusting 1.60.0.
