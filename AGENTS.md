# AGENTS

## Project Overview
Write Wall is a Chrome Extension (Manifest V3) that provides a synced text pad backed by `chrome.storage.sync` so text is shared across the signed-in Chrome account. The UI is a single page (`src/html/index.html`) with a textarea and a byte counter; logic lives in `src/main.ts` and background logic in `src/service_worker.ts`.

## Tech Stack
- TypeScript (ES2024 target, strict mode)
- Webpack + ts-loader (build)
- Vitest (tests, `*.spec.ts` naming)
- Biome (lint + format)
- Husky (pre-commit: lint + test)
- pnpm (package manager, via corepack)
- Chrome Extension Manifest V3

## Repository Layout
- `src/main.ts`: UI logic, reads/writes synced text, throttles writes to respect sync quotas.
- `src/service_worker.ts`: MV3 service worker, opens `html/index.html` when the action icon is clicked.
- `src/utils.ts`: Shared utilities (throttle function).
- `src/html/index.html`: Extension UI page.
- `src/css/main.css`: UI styles (dark theme, CSS custom properties).
- `public/manifest.json`: MV3 manifest (source of truth, copied to `dist/` on build).
- `webpack/webpack.config.cjs`: Build config, emits bundles to `dist/` and copies static assets.
- `build.cjs`: Packages `dist/` into `app.zip` for release.
- `dist/`: Build output (generated, do not edit).

## Where to Add Code

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

## Development Workflow
- Use `nave` to manage Node versions; `.naverc` defines the version for this repo.
- Do NOT use `nvm`.
- Use `pnpm install` once to install dependencies (via corepack, not npm).
- Local development: `pnpm develop` (watch mode), then load `dist/` as unpacked extension.
- Production build: `pnpm build` generates `dist/` and `app.zip`.

## Scripts (package.json)
- `pnpm test`: Run Vitest tests.
- `pnpm lint`: Run Biome checks.
- `pnpm lint:fix`: Run Biome with auto-fix.
- `pnpm develop`: Webpack build in watch mode.
- `pnpm build`: Webpack build + package `dist/` into `app.zip`.
- `pnpm type:check`: Run TypeScript type checking.
- `pnpm prepare`: Install Husky hooks.
- `pnpm check-updates`: Run npm-check-updates in interactive mode.

## Critical Constraints
- Do NOT add external backends or cloud services; all persistence uses Chrome Storage APIs.
- Do NOT add long-lived state in the service worker (MV3 requirement).
- Always preserve sync write throttling; changes to sync logic must respect `chrome.storage.sync` quotas.
- Do NOT hand-edit files in `dist/`; it is generated output.
- Both `package.json` and `public/manifest.json` versions must always match.

## Common Pitfalls
- Sync quota is 8,192 bytes total. Test near-limit behavior.
- Webpack uses `tsconfig.build.json`, not `tsconfig.json`. Build errors may differ from editor errors.
- Pre-commit hook runs lint + test. Fix with `pnpm lint:fix` before retrying.
- Test environment is Node (not browser). Chrome APIs must be mocked in tests.

## Workflow Policy
- All work must be done in branches and merged via pull request.
- Do not commit directly to long-lived branches (e.g., main).

## Commit Workflow
- Create a feature branch for each change.
- Commits can happen one after another as needed.
- Commit with `git commit --signoff` (DIRECTIVE: every commit must include `--signoff`).

### Commit Signoff (DCO)
- Every commit must include a DCO signoff.
- Use `git commit -s` (or an equivalent workflow) to add `Signed-off-by`.

### Commit Message Standards (Conventional Commits)
- All commit messages must follow the Conventional Commits 1.0.0 specification:
  https://www.conventionalcommits.org/en/v1.0.0/#specification
- Maintain these standards for all future commits.
- Format: `type(scope)!: subject`
  - `type` is required (e.g., feat, fix, chore, docs, refactor, test, build, ci, perf, style, revert).
  - `scope` is optional but recommended.
  - `!` indicates a breaking change.
  - `subject` is a short, imperative description.
- If a commit introduces a breaking change, include a `BREAKING CHANGE:` footer.

## Pull Request Workflow
- Only create a pull request if and only if a user specifically requests a pull request to be made.
- When a PR is requested to be made, the PR summary must follow `.github/PULL_REQUEST_TEMPLATE.md`.
- Merge only after review and required checks pass.

## Additional Resources

- **CLAUDE.md** - Claude-specific deep dives, architecture patterns, and debugging playbook
- **docs/KNOWLEDGE_BASE.md** - Full documentation index
