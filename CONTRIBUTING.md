# Contributing to Write Wall

Thanks for taking the time to contribute. This project aims to keep the
extension minimal and reliable, so small, focused changes are preferred.

Please read this guide before opening a pull request.

## Code of Conduct

By participating, you agree to follow the community guidelines in
`CODE_OF_CONDUCT.md`.

## Getting Started

### Prerequisites

- Node.js 22 or 24 (use `nave`, see `.naverc`)
- pnpm (use corepack; do not use `nvm`)

### Install dependencies

```bash
pnpm install
```

### Local development

```bash
pnpm develop
```

Load `dist/` as an unpacked extension in `chrome://extensions`.

### Testing and quality checks

```bash
pnpm lint
pnpm type:check
pnpm test
pnpm verify-version
```

## Versioning

`package.json` and `public/manifest.json` must always match. Use
`pnpm verify-version` before tagging releases.

## Pull Requests

- Work in a branch; do not commit directly to long-lived branches.
- Use Conventional Commits (`type(scope): subject`).
- Include a DCO signoff (`git commit -s`).
- Keep changes scoped and describe the motivation in the PR.

## Notes for Extension Changes

- Avoid editing `dist/` directly (generated output).
- `chrome.storage.sync` is quota-limited; preserve write throttling.
- The UI is `src/html/index.html`; logic is in `src/main.ts`.

## Communication

- Open issues for bugs and feature requests.
- Security reports should follow `SECURITY.md`.
