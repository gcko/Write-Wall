@AGENTS.md

<!-- Above imports universal agent instructions. Claude-specific extensions below. -->

## Architecture Quick Reference

- UI page: `public/html/index.html` with logic in `src/main.ts`
- Service worker: `src/service_worker.ts` (tab management only)
- Shared utilities: `src/utils.ts` (throttle function)
- Sync storage key: `v2` in `chrome.storage.sync` (8,192 byte limit)
- Local storage key: `cursor` in `chrome.storage.local` (cursor position)
- Throttle: leading-edge, ~4 second delay calculated from `MAX_WRITE_OPERATIONS_PER_HOUR`

## Code Patterns

IIFE pattern: Both `main.ts` and `service_worker.ts` wrap logic in IIFEs that receive `chrome` as a parameter.

Storage writes always use `.then()` / `.catch()` chains (not await), and update UI on success:
```typescript
storage.sync.set(storageObject)
  .then(() => { updateUsage(); updateLastSynced(); })
  .catch((e: unknown) => { console.warn(e); });
```

Event listeners are attached imperatively after DOM element lookup with null guards:
```typescript
if (copyButtonEl) {
  copyButtonEl.addEventListener('click', () => { void copyAllText(); });
}
```

## Debugging Playbook

1. **Tests fail**: Run `pnpm test` locally. Tests mock Chrome APIs; check mock setup in spec files.
2. **Lint errors**: Run `pnpm lint:fix`. Biome config is in `biome.json`.
3. **Build issues**: Check `vite.config.ts`. Vite uses esbuild for transpilation; type checking is separate (`pnpm type:check`).
4. **Version mismatch**: Both `package.json` and `public/manifest.json` must match. Use `pnpm verify-version`.

## CI/CD Details

- CI runs on PRs: lint, type check, test (Node 22 + 24 matrix)
- Publish runs on `v*.*.*` tag push: builds + uploads `app.zip` to Chrome Web Store
- Secrets needed: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`

## Deep Dives

Full architecture, development workflow, and troubleshooting: docs/KNOWLEDGE_BASE.md
