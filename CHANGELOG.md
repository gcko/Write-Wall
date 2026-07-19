# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [3.0.0] - 2026-07-19

### Added

- "Paper" redesign: writing happens on a centered paper column with subtle side borders and a WRITE WALL wordmark
- Live markdown editing: the caret line shows raw markdown, every other line renders as rich text (headings, bold/italic/strikethrough, inline code, links, blockquotes, task lists with clickable checkboxes, bullet and numbered lists, code fences, horizontal rules)
- Hidden settings drawer (Aa button): typeface (Mono/Serif/Sans system stacks), font size 13–22px, line width (Narrow/Medium/Wide), line height (Tight/Normal/Open), theme, and modes — all persisted via `chrome.storage.local`
- Focus mode (dims everything but the current line) and Typewriter mode (keeps the caret vertically centered)
- Redesigned status bar: word/char/byte count (click to cycle), sync quota meter with percentage, and a near-limit warning above 90% of the 8,192-byte sync quota
- Export now produces a `write-wall.md` markdown file
- Action buttons (Export/Copy/Clear) reveal on status-bar hover to keep the canvas clean

### Changed

- The pad stores plain markdown text under the existing `v2` sync key — existing synced text is fully preserved and renders as markdown
- Theme switching moved from the top-right toggle into the settings drawer
- Bump version to 3.0.0

### Removed

- The plain `<textarea>` editor and top-right info bar

## [2.6.0] - 2026-02-07

### Added

- Light and dark mode support with system preference detection (`prefers-color-scheme`)
- Theme toggle button in the top-right info bar
- Theme preference persistence via `chrome.storage.local`
- Warm sepia/paper palette for light mode to reduce eye strain
- `color-scheme: light dark` on count mode select for native widget rendering
- AGENTS.md directive requiring PRs always target the `main` branch

### Changed

- Replace Webpack with Vite for build tooling
- Move static assets (`css/`, `html/`, `images/`) from `src/` to `public/`
- Output ESM bundles instead of IIFE (required for Vite multi-entry builds)
- Add `"type": "module"` to manifest background service worker
- Bump version to 2.6.0

### Removed

- Remove `webpack`, `webpack-cli`, `ts-loader`, `copy-webpack-plugin` dependencies
- Remove `webpack/` directory

## [2.5.0] - 2026-01-27

### Added

- Bytes/Chars/Words count mode toggle
- "Last synced" timestamp indicator
- OSS documentation: LICENSE, CONTRIBUTING.md, SECURITY.md, PR template
- .gitignore rule for macOS .DS_Store files

### Changed

- Bump version to 2.5.0

### Fixed

- Label usage by count mode and separate sync status display

## [2.4.0] - 2026-01-25

### Added

- AGENTS.md for AI coding agent instructions
- GitHub Actions CI workflow (lint, type check, test on Node 22 + 24)
- Chrome Web Store publish workflow triggered by version tags
- Version verification script to ensure package.json and manifest.json match

### Changed

- Replace ESLint with Biome for linting and formatting
- Replace Jest with Vitest for testing
- Bump packages to latest

## [2.3.0] - 2025-03-24

### Changed

- Bump packages to latest

### Fixed

- Fixed Eslint styling and configuration
- Fix tsconfig

## [2.2.0] - 2024-10-07

### Changed

- Bump packages to latest
- Update styling, allow for ease of use on a mobile device

## [2.1.6] - 2024-02-16

### Changed

- Ensure manifest version and Node package are up-to-date

## [2.1.5] - 2024-02-16

### Changed

- Bump packages to latest
- Update copyright to include 2024
- Remove unused package

## [2.1.2] - 2023-05-11

### Changed

- Update licensing language to CC BY-SA 4.0
- Bump packages to latest

## [2.1.1] - 2023-05-11

### Changed

- Cleanup the usage of magic constants
- Streamline the throttling behavior

## [2.1.0] - 2023-05-10

### Changed

- Migrate to Typescript
- Enable Webpack and building via Webpack
- Remove Dependency on lodash

## [2.0.5] - 2023-05-05

### Changed

- Upgrade the manifest.json file to manifest v3
- Standardize the copyright notices
- Update to node v20 and switch to using npm from yarn

## [2.0.4] - 2022-07-04

### Removed

Remove "Tabs" permission on package

## [2.0.3] - 2020-03-04

### Removed

Remove "Dev" naming convention on package

## [2.0.2] - 2020-03-03

### Changed

Update the Content Security Policy for the inline script to initialize Google Analytics.

## [2.0.1] - 2020-03-02

### Changed

This version moves the size indicator to the top of the viewing area for ease of use.

## [2.0] - 2020-03-02

### Fixed

This version updates many of the internal inconsistencies with prior versions. Your data will no longer be wiped out
while using the extension. In addition, writing within the tool will no longer have issues with intermittently removing
the last few characters inputted. Please let me know how it works!
