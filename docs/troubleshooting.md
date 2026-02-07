# Troubleshooting

## Common Issues

### "pnpm: command not found"

Enable corepack first:
```bash
corepack enable
```
Do **not** install pnpm via npm. The project pins a specific pnpm version via `packageManager` in `package.json`.

### "nave: command not found" or wrong Node version

Install nave globally: `npm install -g nave`. Then use `nave use` in the repo root. The `.naverc` file defines the required Node version.

Do **not** use `nvm` for this project.

### Build output is stale after changes

Vite watch mode (`pnpm develop`) rebuilds on file changes, but you must still manually reload the extension in `chrome://extensions`. Click the reload icon on the Write Wall extension card.

### Tests fail with Chrome API errors

Tests mock `chrome.storage.sync` and related APIs. If a test fails with "chrome is not defined", ensure the test file properly sets up mocks before importing the module under test. The test environment is Node, not a browser.

### Lint errors block commit

Husky pre-commit hook runs `pnpm lint` and `pnpm test`. Fix lint issues with `pnpm lint:fix` before committing. If tests fail, fix the failing test before retrying.

### Version mismatch error

Both `package.json` and `public/manifest.json` must have the same version string. Run `pnpm verify-version` to check. Update both files before tagging a release.

### Sync quota exceeded

`chrome.storage.sync` has an 8,192-byte total limit. The byte counter in the UI shows current usage. If text approaches the limit, the sync write may silently fail. The throttle logic prevents exceeding write rate limits but does not guard against total size.

### Extension doesn't open / action icon does nothing

Check the service worker status in `chrome://extensions`. If it shows "Inactive" or "Error", inspect the service worker console for errors. Common cause: syntax error in `service_worker.bundle.js` after a bad build.

### Cursor position not restored

Cursor position is stored in `chrome.storage.local`, not sync storage. If local storage is cleared (e.g., extension reinstall), cursor position resets to the start.

## Debugging Tips

- **Service worker logs**: Open `chrome://extensions`, find Write Wall, click "Inspect views: service worker"
- **UI page logs**: Right-click the Write Wall page, choose "Inspect" to open DevTools
- **Storage inspection**: In DevTools console, run `chrome.storage.sync.get(null, console.log)` to see all synced data
- **Throttle behavior**: The throttle is leading-edge; the first call fires immediately, subsequent calls within the delay window are dropped (not queued)
