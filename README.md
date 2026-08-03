# Write Wall

**A markdown scratchpad that lives in your browser and follows you everywhere.**

Write Wall is a Chrome extension (Manifest V3) that gives you a distraction-free
writing pad synced through your Chrome account via `chrome.storage.sync` — no
servers, no sign-ups, no tracking.

**[➜ Install from the Chrome Web Store](https://chromewebstore.google.com/detail/write-wall/epjfmbaohjlmcbnmobhiilcdccjbpmlg)**

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/epjfmbaohjlmcbnmobhiilcdccjbpmlg?label=chrome%20web%20store)](https://chromewebstore.google.com/detail/write-wall/epjfmbaohjlmcbnmobhiilcdccjbpmlg)
[![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/epjfmbaohjlmcbnmobhiilcdccjbpmlg)](https://chromewebstore.google.com/detail/write-wall/epjfmbaohjlmcbnmobhiilcdccjbpmlg)
[![CI](https://img.shields.io/github/actions/workflow/status/gcko/Write-Wall/ci.yml?branch=main&label=CI)](https://github.com/gcko/Write-Wall/actions/workflows/ci.yml)
[![License: CC BY-SA 4.0](https://img.shields.io/badge/license-CC%20BY--SA%204.0-lightgrey)](LICENSE)

## Features

- **Live markdown rendering** — the caret line shows raw markdown, every other
  line renders as rich text: headings, bold/italic/strikethrough, inline code,
  links, blockquotes, task lists with clickable checkboxes, bullet and numbered
  lists, code fences, and horizontal rules.
- **Focus mode & typewriter mode** — dim everything but the current line, or
  keep the caret vertically centered while you type.
- **Serverless sync** — your text rides Chrome's own sync
  (`chrome.storage.sync`), shared across every machine signed into your
  account. Documents grow to ~95 KB by sharding across sync keys, with
  conflict protection across devices and versions.
- **Markdown export** — download your pad as `write-wall.md`, or copy
  everything with one click.
- **Make it yours** — settings drawer with typeface (Mono/Serif/Sans), font
  size, line width, line height, and light/dark themes with system preference
  detection.
- **Quota awareness** — status bar shows word/character/byte counts and a sync
  quota meter that warns before you hit the limit.
- **Data backup & conflict recovery** — persistent in-app banner for sync
  conflicts, storage limits, and incomplete syncs, with one-click restore from
  a local backup ring.
- **Zero data collection** — the only permission is `storage`. No analytics,
  no network requests, nothing leaves Chrome.

## Screenshots

Screenshots coming soon. See `docs/images/` for where they'll live once captured.

## Install

### From the Chrome Web Store (recommended)

Grab it here: [Write Wall on the Chrome Web Store](https://chromewebstore.google.com/detail/write-wall/epjfmbaohjlmcbnmobhiilcdccjbpmlg).
Click the extension icon and start writing.

### Build from source

Requirements: Node.js 22 or 24 (`nave` recommended; see `.naverc`) and pnpm
via corepack.

```bash
pnpm install        # install dependencies
pnpm develop        # build in watch mode (or: pnpm build for production + app.zip)
```

Then load the `dist/` directory as an unpacked extension at
`chrome://extensions` (enable Developer mode → "Load unpacked").

Useful scripts: `pnpm test` (Vitest), `pnpm lint` / `pnpm lint:fix` (Biome),
`pnpm type:check` (TypeScript), `pnpm verify-version` (package/manifest
version parity).

## How it works

Everything persists through Chrome's storage APIs — there is no backend. The
document is sharded across `chrome.storage.sync` keys (head `v2`, chunks
`v2x_0..12`, meta `v2m`), raising the ceiling to ~95 KB against Chrome's
102,400-byte sync quota. Writes are throttled to respect Chrome's sync write
limits, remote updates patch only changed lines so the caret never jumps, and
torn or conflicting sync deliveries never reach the editor. See
[docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) for the full architecture.

## Contributing

Bug reports and feature requests are welcome via GitHub Issues. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[SECURITY.md](SECURITY.md) for reporting security issues.

## License

[Creative Commons Attribution-ShareAlike 4.0 International](LICENSE)
(CC BY-SA 4.0).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
