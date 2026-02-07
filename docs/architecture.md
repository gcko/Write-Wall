# Architecture

## Overview

Write Wall is a Chrome Extension built on Manifest V3. It provides a synced text pad that persists across devices using the signed-in Chrome account. There is no external backend; all persistence uses the Chrome Storage API.

## Extension Components

### UI Page (`src/html/index.html`)

Single HTML page rendered when the extension action icon is clicked. Contains:
- `<textarea id="text">` - main editing area
- `#info` bar - byte/char/word counter, sync status, count mode selector, Export/Copy/Clear buttons
- `<select id="count-mode">` - toggles between Bytes, Chars, Words display

### Main Logic (`src/main.ts`)

Runs in the context of the UI page. Responsibilities:
- Reads stored text from `chrome.storage.sync` on load (key: `v2`)
- Migrates legacy storage key `text` to `v2` if found
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

| Store | Key | Purpose | Quota |
|-------|-----|---------|-------|
| `chrome.storage.sync` | `v2` | Synced text content | 8,192 bytes total |
| `chrome.storage.sync` | `text` (legacy) | Old key, migrated to `v2` on first load | - |
| `chrome.storage.local` | `cursor` | `{start, end}` cursor position | No sync quota |

### Sync Throttling

Write rate is calculated from Chrome's `MAX_WRITE_OPERATIONS_PER_HOUR` constant:
```
CHANGE_DELAY = (MAX_WRITE_OPERATIONS_PER_HOUR / 3600) * 4000
```
This yields roughly a 4-second delay between sync writes. The `throttle` utility drops calls during the cooldown window (leading-edge throttle).

`Cmd/Ctrl+S` bypasses the throttle for an immediate save.

## Build Pipeline

### Webpack (`webpack/webpack.config.cjs`)

- **Entry points**: `src/main.ts` and `src/service_worker.ts`
- **Output**: `dist/` directory with `main.bundle.js` and `service_worker.bundle.js`
- **Loader**: `ts-loader` using `tsconfig.build.json`
- **Copy plugin**: copies `public/` (manifest, icons), `src/html/`, `src/css/`, `src/images/` into `dist/`
- **Mode**: production with inline source maps

### Packaging (`build.cjs`)

After webpack, `build.cjs` uses `adm-zip` to create `app.zip` from `dist/` for Chrome Web Store submission.

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
  main.ts              - UI logic, storage sync, event handlers
  service_worker.ts    - Tab management on action click
  utils.ts             - Throttle utility
  main.spec.ts         - Tests for main.ts
  service_worker.spec.ts - Tests for service worker
  utils.spec.ts        - Tests for throttle utility
  verify-version.spec.ts - Tests for version verification
  html/index.html      - Extension UI page
  css/main.css         - Styles (dark theme, CSS variables)
  images/              - Extension icons (16, 19, 48, 64, 128, 512)
public/
  manifest.json        - MV3 manifest (source of truth)
webpack/
  webpack.config.cjs   - Build configuration
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
