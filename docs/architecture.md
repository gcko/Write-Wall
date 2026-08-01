# Architecture

## Overview

Write Wall is a Chrome Extension built on Manifest V3. It provides a synced text pad that persists across devices using the signed-in Chrome account. There is no external backend; all persistence uses the Chrome Storage API.

## Extension Components

### UI Page (`public/html/index.html`)

Single HTML page rendered when the extension action icon is clicked. Contains:
- `<textarea id="text">` - main editing area
- `#info` bar - byte/char/word counter, sync status, count mode selector, Export/Copy/Clear buttons
- `<select id="count-mode">` - toggles between Bytes, Chars, Words display

### Main Logic (`src/main.ts`)

Runs in the context of the UI page. Responsibilities:
- Owns a `SyncStore` (`src/sync_store.ts`), which reads, migrates, and writes sync storage on its behalf
- Throttles writes to sync storage to respect Chrome quota limits
- Updates byte/char/word counter after each sync
- Displays "last synced" timestamp on successful save
- Stores cursor position in `chrome.storage.local` (key: `cursor`)
- Restores cursor position and auto-focuses textarea on load
- Handles Copy (clipboard API with execCommand fallback), Clear (with confirm), and Export (.txt download)
- Keyboard shortcuts: Cmd/Ctrl+S for immediate save, Cmd/Ctrl+Shift+C for copy all

### Service Worker (`src/service_worker.ts`)

MV3 background service worker. Single responsibility:
- Listens for `chrome.action.onClicked`
- Queries for an existing Write Wall tab; focuses it if found (including switching windows)
- Creates a new tab if no existing tab is open

### Utilities (`src/utils.ts`)

Exports a generic `throttle` function used by `main.ts` to rate-limit storage writes and cursor position saves.

## Storage Architecture

The document is sharded across sync keys, which raises the ceiling to ~95 KB. `src/sync_format.ts` packs and assembles; `src/sync_store.ts` (`SyncStore`) owns every sync write.

| Store | Key | Purpose | Quota |
|-------|-----|---------|-------|
| `chrome.storage.sync` | `v2` | Head: the whole document, or its first chunk plus a truncation marker | 8,192 bytes per item |
| `chrome.storage.sync` | `v2x_0..12` | Chunks, each valued `"<rev>\0<piece>"` | 8,192 bytes per item |
| `chrome.storage.sync` | `v2m` | Meta: `{v, rev, writerId, chunks, len, hash}` | 8,192 bytes per item |
| `chrome.storage.sync` | `text` (legacy) | Pre-v2 key, migrated on first load then removed | - |
| `chrome.storage.local` | `cursor` | `{start, end}` cursor position | No sync quota |
| `chrome.storage.local` | `theme`, `settings`, `countMode` | UI preferences | No sync quota |
| `chrome.storage.local` | `writerId` | Stable per-device id, stamped into `v2m` | No sync quota |
| `chrome.storage.local` | `backup_0..2` | Rolling backup ring, mirrored every 20 s | No sync quota |

Total sync quota is 102,400 bytes; `packDocument` reserves 1,024 bytes of it and 256 bytes of each item, and meters bytes the way Chromium's `base::WriteJson` does rather than the way `JSON.stringify` does. A document that will not fit in 13 chunks throws `DocumentTooLargeError`.

### Sync Throttling

Write rate is derived from Chrome's `MAX_WRITE_OPERATIONS_PER_HOUR` constant:
```
CHANGE_DELAY = Math.ceil(HOUR_IN_MS / MAX_WRITE_OPERATIONS_PER_HOUR) * 2  // 4,000 ms
```
That is 4,000 ms between sync writes — half the quota's 1-per-2-seconds rate, since one document write can touch several keys. The `throttle` utility fires on the leading edge and again on the trailing edge, so edits made inside the cooldown window still reach storage.

`Cmd/Ctrl+S` takes an immediate path, itself rate-guarded at 1,000 ms.

## Build Pipeline

### Vite (`vite.config.ts`)

- **Entry points**: `src/main.ts` and `src/service_worker.ts`
- **Output**: `dist/` directory with `main.bundle.js` and `service_worker.bundle.js`
- **Transpilation**: esbuild (built into Vite), targeting ES2024
- **Static assets**: `public/` directory (manifest, HTML, CSS, icons) copied verbatim to `dist/`
- **Mode**: production, no source maps

### Packaging (`build.cjs`)

After Vite builds, `build.cjs` uses `adm-zip` to create `app.zip` from `dist/` for Chrome Web Store submission.

## CI/CD

### CI Workflow (`.github/workflows/ci.yml`)

Runs on pull requests. Matrix tests against Node 22 and 24:
1. Install dependencies (`pnpm install --frozen-lockfile`)
2. Verify version parity (`pnpm verify-version`)
3. Lint (`pnpm lint` via Biome)
4. Type check (`pnpm type:check`)
5. Test (`pnpm test` via Vitest)

### Publish Workflow (`.github/workflows/publish-extension.yml`)

Triggered by `v*.*.*` tag pushes:
1. Verify tag version matches `package.json` and `public/manifest.json`
2. Build extension (`pnpm build`)
3. Upload `app.zip` to Chrome Web Store via `chrome-extension-upload` action
4. Requires secrets: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`

## File Structure

```
src/
  main.ts              - UI logic, event handlers, wiring
  sync_format.ts       - Pure sharded sync format (metering, pack, assemble)
  sync_store.ts        - SyncStore: startup, migration, writes, conflict protection
  editor.ts            - Editor rendering and line-diff external applies
  banner.ts            - Persistent dismissible data-event banner
  settings.ts          - Settings state
  markdown.ts          - Markdown rendering
  service_worker.ts    - Tab management on action click
  utils.ts             - Throttle utility
  test/
    fake_chrome_storage.ts - FakeSyncWorld, stateful storage fake for tests
  *.spec.ts            - Vitest tests, one per module
public/
  manifest.json        - MV3 manifest (source of truth)
  html/index.html      - Extension UI page
  css/main.css         - Styles (dark theme, CSS variables)
  images/              - Extension icons (16, 19, 48, 64, 128, 512)
vite.config.ts         - Build configuration
scripts/
  verify-version.cjs   - Checks package.json and manifest.json version parity
dist/                  - Build output (generated, do not edit)
```

## CSS Theme

Styles use CSS custom properties for a dark theme:
- `--bg-top` / `--bg-bottom`: gradient background
- `--text-main` / `--text-muted`: text colors
- `--accent` / `--border` / `--hover-bg` / `--hover-text`: interactive element styling

Desktop breakpoint at 1024px sets `max-width: 900px` on the textarea.
