# Development Guide

## Prerequisites

- **Node.js**: ^22.0.0 or ^24.0.0 (use `nave`, not `nvm`; see `.naverc`)
- **pnpm**: Use corepack (`corepack enable`), do not install via npm
- **Chrome**: For manual testing via `chrome://extensions`

## Setup

```bash
nave use        # activates the Node version from .naverc
pnpm install    # install dependencies
```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Develop | `pnpm develop` | Webpack watch mode, rebuilds on change |
| Build | `pnpm build` | Production webpack build + `app.zip` |
| Test | `pnpm test` | Run Vitest test suite |
| Lint | `pnpm lint` | Biome checks (errors only) |
| Lint fix | `pnpm lint:fix` | Biome auto-fix |
| Type check | `pnpm type:check` | TypeScript `--noEmit` check |
| Verify version | `pnpm verify-version` | Ensure package.json and manifest.json match |
| Prepare | `pnpm prepare` | Install Husky git hooks |
| Check updates | `pnpm check-updates` | Interactive dependency update check |

## Local Development Loop

1. Run `pnpm develop` to start webpack in watch mode
2. Open `chrome://extensions`, enable Developer mode
3. Click "Load unpacked" and select the `dist/` directory
4. Make changes to `src/` files; webpack rebuilds automatically
5. Click the reload button on the extension card in `chrome://extensions`

## Testing

Tests use **Vitest** and live alongside source files as `*.spec.ts`:
- `src/main.spec.ts` - UI logic and storage interactions
- `src/service_worker.spec.ts` - Tab management behavior
- `src/utils.spec.ts` - Throttle utility
- `src/verify-version.spec.ts` - Version parity check

Config: `vitest.config.ts` runs in Node environment with `clearMocks: true`.

Test files use `*.spec.ts` naming (not `*.test.ts`).

## Linting

**Biome** handles formatting and linting. Config in `biome.json`.

Key settings:
- Indent: 2 spaces, LF line endings
- Line width: 100
- Single quotes, trailing commas, semicolons always
- Excludes: `.github/`, `.husky/`, `.idea/`, `dist/`, `node_modules/`, `*.cjs`, `webpack/`

## TypeScript Configuration

- `tsconfig.json`: Base config, strict mode, target ES2024, ESNext modules
- `tsconfig.build.json`: Used by ts-loader for webpack builds
- `tsconfig.test.json`: Used by Vitest

Type definitions: `@types/chrome` for Chrome extension APIs.

## Git Hooks

**Husky** runs on pre-commit:
- `pnpm lint` - fails commit if linting errors exist
- `pnpm test` - fails commit if tests fail

## Commit Conventions

All commits follow **Conventional Commits 1.0.0**:
```
type(scope)!: subject
```

- **type** (required): `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`, `style`, `revert`
- **scope** (optional but recommended)
- **!** for breaking changes (include `BREAKING CHANGE:` footer)
- **DCO signoff required**: Always use `git commit -s` or `--signoff`

## Branch and PR Workflow

- All work in feature branches; no direct commits to long-lived branches
- PRs follow `.github/PULL_REQUEST_TEMPLATE.md`
- CI runs lint, type check, and tests on PR open/sync/reopen
- Merge only after review and checks pass

## Release Process

1. Update version in both `package.json` and `public/manifest.json`
2. Run `pnpm verify-version` to confirm parity
3. Tag as `vX.Y.Z` and push the tag
4. Publish workflow builds and uploads `app.zip` to Chrome Web Store

## Adding Code

| What | Where |
|------|-------|
| UI behavior / event handlers | `src/main.ts` |
| Background / tab management | `src/service_worker.ts` |
| Shared utilities | `src/utils.ts` |
| Styles | `src/css/main.css` |
| HTML structure | `src/html/index.html` |
| Static assets / icons | `src/images/` |
| Manifest changes | `public/manifest.json` |
| Build config | `webpack/webpack.config.cjs` |
| New test | `src/<module>.spec.ts` |
