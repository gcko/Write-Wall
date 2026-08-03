@AGENTS.md

<!-- Above imports universal agent instructions. Claude-specific extensions below. -->

## Architecture Quick Reference

- UI page: `public/html/index.html` with logic in `src/main.ts`
- Editor: `src/editor.ts` (line-diff rendering, external applies); banner: `src/banner.ts` (data events)
- Service worker: `src/service_worker.ts` (tab management only)
- Shared utilities: `src/utils.ts` (throttle function)
- Sync format: `src/sync_format.ts` (pure pack/assemble, Chromium-exact byte metering)
- Sync orchestration: `src/sync_store.ts` (`SyncStore`: startup, migration, writes, conflict protection). `main.ts` never writes sync directly.
- Sync storage keys: head `v2`, chunks `v2x_0..12` (value `"<rev>\0<piece>"`), meta `v2m` (`{v,rev,writerId,chunks,len,hash}`) — 102,400 byte total quota, 8,192 per item
- Local storage keys: `cursor`, `theme`, `settings`, `countMode`, `writerId`, backup ring `backup_0..2`
- Throttle: leading + trailing edge, 4,000 ms delay (half the sync write-op quota rate); immediate flushes (Cmd/Ctrl+S) rate-guarded at 1,000 ms
- Test harness: `src/test/fake_chrome_storage.ts` (`FakeSyncWorld`) for stateful multi-device storage tests

## Code Patterns

IIFE pattern: Both `main.ts` and `service_worker.ts` wrap logic in IIFEs that receive `chrome` as a parameter.

Storage writes in `main.ts` use `.then()` / `.catch()` chains (not await), and update UI on success:
```typescript
storage.local?.set({ [SETTINGS_KEY]: settings })
  .catch((e: unknown) => { console.warn(e); });
```
`SyncStore` (`src/sync_store.ts`) is the exception: it is async/await internally and owns every `storage.sync` write.

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
- Publish runs on `v*.*.*` tag push: validates (strict semver, forward-only, tag on main), syncs version files to the tag, tests + builds + uploads `app.zip`, creates the GitHub release from the changelog, opens a version-sync PR on drift
- Secrets needed: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`

## Deep Dives

Full architecture, development workflow, and troubleshooting: docs/KNOWLEDGE_BASE.md
