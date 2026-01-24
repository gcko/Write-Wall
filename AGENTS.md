# AGENTS

## Project Overview
Write Wall is a Chrome Extension (Manifest V3) that provides a synced text pad backed by `chrome.storage.sync` so text is shared across the signed-in Chrome account. The UI is a single page (`src/html/index.html`) with a textarea and a byte counter; logic lives in `src/main.ts` and background logic in `src/service_worker.ts`.

## Repository Layout
- `src/main.ts`: UI logic, reads/writes synced text, throttles writes to respect sync quotas.
- `src/service_worker.ts`: MV3 service worker, opens `html/index.html` when the action icon is clicked.
- `src/html/index.html`: Extension UI page.
- `src/css/main.css`: UI styles.
- `public/manifest.json`: MV3 manifest used for build output.
- `webpack/webpack.config.cjs`: Build config, emits bundles to `dist` and copies static assets.
- `build.cjs`: Packages `dist/` into `app.zip` for release.
- `dist/`: Build output (generated).

## Development Workflow
- Use `nave` to manage Node versions; `.naverc` defines the version for this repo.
- Do not use `nvm`.
- Use `pnpm install` once to install dependencies.
- For local development:
  - Run `pnpm develop` to build in watch mode.
  - Load `dist/` as an unpacked extension via `chrome://extensions`.
- For production builds:
  - Run `pnpm build` to generate `dist/` and `app.zip`.

## Scripts (package.json)
- `pnpm test`: Run Jest tests.
- `pnpm lint`: Run ESLint.
- `pnpm lint:fix`: Run ESLint with auto-fix.
- `pnpm develop`: Webpack build in watch mode.
- `pnpm build`: Webpack build + package `dist/` into `app.zip`.
- `pnpm prepare`: Install Husky hooks.
- `pnpm check-updates`: Run npm-check-updates in interactive mode.

## Tooling and Packages
- TypeScript: Source is `.ts`, built via `ts-loader` and `tsconfig.build.json`.
- Webpack: Bundles `src/main.ts` and `src/service_worker.ts` into `dist/` and copies `public/`, `src/html`, `src/css`, and `src/images`.
- Jest + ts-jest: Unit tests run under ESM with `tsconfig.test.json`.
- ESLint + Prettier: Linting is configured in `eslint.config.mjs` with Prettier rules enforced.
- Husky: Pre-commit hook runs `pnpm lint` and `pnpm test`.
- adm-zip: Used by `build.cjs` to create `app.zip`.

## Chrome Extension Gotchas
- MV3 service worker runs in the background; avoid long-lived state in the service worker.
- Text sync uses `chrome.storage.sync` and is throttled to respect quota. Any changes to sync logic should preserve write limits.
- `chrome.storage.sync` quota is small; the UI shows bytes used via `getBytesInUse`.
- `public/manifest.json` is the source manifest; it is copied into `dist/` during builds.
- `dist/` is generated output; avoid hand-editing it.

## Workflow Policy
- All work must be done in branches and merged via pull request.
- Do not commit directly to long-lived branches (e.g., main).

## Commit Signoff (DCO)
- Every commit must include a DCO signoff.
- Use `git commit -s` (or an equivalent workflow) to add `Signed-off-by`.

## Commit Message Standards (Conventional Commits)
- All commit messages must follow the Conventional Commits 1.0.0 specification:
  https://www.conventionalcommits.org/en/v1.0.0/#specification
- Maintain these standards for all future commits.
- Format: `type(scope)!: subject`
  - `type` is required (e.g., feat, fix, chore, docs, refactor, test, build, ci, perf, style, revert).
  - `scope` is optional but recommended.
  - `!` indicates a breaking change.
  - `subject` is a short, imperative description.
- If a commit introduces a breaking change, include a `BREAKING CHANGE:` footer.
