# Knowledge Base

## Architecture
Extension components, storage design, sync throttling, build pipeline, and CI/CD workflows.
-> docs/architecture.md

## Development
Setup, scripts, local dev loop, testing, linting, TypeScript config, commit conventions, and release process.
-> docs/development.md

## Troubleshooting
Common issues (pnpm, nave, stale builds, test failures, sync quota), debugging tips for service worker and UI.
-> docs/troubleshooting.md

## Sharded Sync Storage
Design of the sharded `chrome.storage.sync` format: head/chunk/meta keys, Chromium-exact byte metering, the ~95 KB ceiling, conflict protection, and mixed-version fleet safety.
-> docs/superpowers/specs/2026-08-01-sharded-sync-storage-design.md

<!-- docs-synced-through: f02da2c (2026-08-03) -->
