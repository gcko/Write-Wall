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
| Develop | `pnpm develop` | Vite watch mode, rebuilds on change |
| Build | `pnpm build` | Production Vite build + `app.zip` |
| Test | `pnpm test` | Run Vitest test suite |
| Lint | `pnpm lint` | Biome checks (errors only) |
| Lint fix | `pnpm lint:fix` | Biome auto-fix |
| Type check | `pnpm type:check` | TypeScript `--noEmit` check |
| Verify version | `pnpm verify-version` | Ensure package.json and manifest.json match |
| Prepare | `pnpm prepare` | Install Husky git hooks |
| Check updates | `pnpm check-updates` | Interactive dependency update check |

## Local Development Loop

1. Run `pnpm develop` to start Vite in watch mode
2. Open `chrome://extensions`, enable Developer mode
3. Click "Load unpacked" and select the `dist/` directory
4. Make changes to `src/` files; Vite rebuilds automatically
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
- Excludes: `.github/`, `.husky/`, `.idea/`, `dist/`, `node_modules/`, `*.cjs`

## TypeScript Configuration

- `tsconfig.json`: Base config, strict mode, target ES2024, ESNext modules
- `tsconfig.build.json`: Excludes test and config files from type-checked source
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

The kickoff is a tag push and nothing else:

1. Land everything for the release on `main` via PRs, including a
   `## [X.Y.Z]` section in `CHANGELOG.md` (it becomes the GitHub release
   notes). Bump versions with `pnpm set-version X.Y.Z` in the release PR.
2. `git tag vX.Y.Z <commit-on-main> && git push origin vX.Y.Z`

The publish workflow then:

- **validates**: strict semver (`vMAJOR.MINOR.PATCH` only), the new tag must
  sort above every existing release tag (versions only go up), and the tagged
  commit must be on `main`
- **publishes**: syncs `package.json` + `public/manifest.json` to the tag
  version in the build workspace (`scripts/set-version.cjs`), tests, builds,
  verifies the version inside `app.zip`, and uploads to the Chrome Web Store
- **releases**: creates the GitHub release from the tag's `CHANGELOG.md`
  section (falls back to a changelog link if the section is missing)
- **sync-versions**: if the repo files lagged the tag, opens a PR bringing
  them back in line (the store still received the tagged version)

A bad tag (non-semver, lower than an existing tag, or off-main) fails in
`validate` and nothing is published. Tags are never moved or deleted; to fix
a mistake, tag the next higher version.

## Adding Code

| What | Where |
|------|-------|
| UI behavior / event handlers | `src/main.ts` |
| Background / tab management | `src/service_worker.ts` |
| Shared utilities | `src/utils.ts` |
| Styles | `public/css/main.css` |
| HTML structure | `public/html/index.html` |
| Static assets / icons | `public/images/` |
| Manifest changes | `public/manifest.json` |
| Build config | `vite.config.ts` |
| New test | `src/<module>.spec.ts` |
