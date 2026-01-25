# Write Wall

Write Wall is a Chrome Extension (Manifest V3) that provides a synced text pad
backed by `chrome.storage.sync`, so text is shared across the signed-in Chrome
account. The UI is a single page with a textarea and byte counter, and the
extension opens that page when the action icon is clicked.

## Overview

Write Wall focuses on quick, low-friction note syncing for short text snippets.
It is intentionally minimal: no accounts, no cloud backend, and no setup beyond
signing in to Chrome.

## Features

- Syncs text across Chrome profiles using `chrome.storage.sync`
- Shows bytes used to help stay within sync quota limits
- Migrates legacy storage key (`text`) to the current key (`v2`)
- Runs entirely in-browser, no external services

## How It Works

- The UI lives in `src/html/index.html` with logic in `src/main.ts`
- Text is saved to `chrome.storage.sync` under the `v2` key
- Writes are throttled to respect Chrome sync quotas
- The byte counter uses `chrome.storage.sync.getBytesInUse`

## Installation

### From source (development)

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Build in watch mode:
   ```bash
   pnpm develop
   ```
3. Load `dist/` as an unpacked extension in `chrome://extensions`

## Usage

1. Click the extension action icon to open the Write Wall page.
2. Type or paste text into the textarea.
3. The text syncs across devices signed into the same Chrome account.
4. The byte counter shows current sync usage.

## Development

### Requirements

- Node.js 22 or 24 (`nave` is recommended; see `.naverc`)
- pnpm (use corepack, do not install via `npm`)

### Common Scripts

- `pnpm develop`: Webpack build in watch mode
- `pnpm build`: Production build + `app.zip` packaging
- `pnpm lint`: Biome checks
- `pnpm lint:fix`: Biome auto-fix
- `pnpm type:check`: TypeScript type check
- `pnpm test`: Vitest test suite
- `pnpm verify-version`: Ensure version parity between package and manifest

### Project Layout

- `src/main.ts`: UI logic and storage sync
- `src/service_worker.ts`: Opens the UI when the action icon is clicked
- `public/manifest.json`: MV3 manifest copied to `dist/`
- `dist/`: Build output (generated)

## Release Workflow

1. Update `package.json` and `public/manifest.json` to the same version.
2. Verify with:
   ```bash
   pnpm verify-version
   ```
3. Tag the release as `vX.Y.Z` and push the tag.

Tag pushes trigger the publish workflow, which builds the extension and uploads
`app.zip` to the Chrome Web Store (requires repository secrets to be configured).

## Communication

- Bug reports and feature requests: GitHub Issues
- Contributions: see `CONTRIBUTING.md`
- Security reports: see `SECURITY.md`

## License

This project is licensed under the Creative Commons Attribution-ShareAlike 4.0
International Public License. See `COPYING`.

## Changelog

See `CHANGELOG.md`.
