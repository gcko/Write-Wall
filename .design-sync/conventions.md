# Write Wall — theme conventions

This is a **tokens-only design system**: it ships no components, only a theme.
Build your own markup and style it entirely with the CSS custom properties
below (all defined in `styles.css` via `_ds_bundle.css`). Do not invent new
color values — every color on screen must come from a token.

## Tokens (the complete set)

| Token | Role |
|---|---|
| `--bg-top` / `--bg-bottom` | page background gradient stops — use `background: linear-gradient(180deg, var(--bg-top) 0%, var(--bg-bottom) 100%)` on the page root |
| `--text-main` | primary text |
| `--text-muted` | secondary text, labels, control text |
| `--accent` | interactive highlight (hover border color, emphasis) |
| `--border` | 1px control borders |
| `--hover-bg` | control background on hover |
| `--hover-text` | control text on hover |

## Theming

Dark is the default (`:root`). Light theme applies two ways:
- `[data-theme="light"]` on the root element (explicit toggle; `[data-theme="dark"]` forces dark);
- `@media (prefers-color-scheme: light)` when no `data-theme` attribute is set.

Never hard-code light/dark values — set `data-theme` on `<html>` and let the
tokens swap. Add `color-scheme: light dark` to native form controls.

## Styling idiom

Minimal, flat, monospace. Controls (buttons, selects) are transparent with a
1px `var(--border)` border, `var(--text-muted)` text, `font-family: monospace`,
`font-size: 12px`, `padding: 0.2rem 0.5rem`. Hover state: background
`var(--hover-bg)`, color `var(--hover-text)`, border-color `var(--accent)`.
Body text is `monospace` at 14px, `line-height: 1.5`. No border-radius, no
shadows, no webfonts — system monospace only.

## Example

```html
<body style="background: linear-gradient(180deg, var(--bg-top), var(--bg-bottom)); color: var(--text-main); font-family: monospace;">
  <button style="background: transparent; border: 1px solid var(--border); color: var(--text-muted); font-family: monospace; font-size: 12px; padding: 0.2rem 0.5rem; cursor: pointer;">
    Copy
  </button>
</body>
```

Read `styles.css` (and its `_ds_bundle.css` import) before styling — it is the
source of truth for the token values in both themes.
