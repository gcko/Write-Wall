/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

type Typeface = 'mono' | 'serif' | 'sans';

interface PadSettings {
  font: Typeface;
  size: number;
  width: number;
  lineHeight: number;
  focus: boolean;
  typewriter: boolean;
}

const FONT_STACKS: Record<Typeface, string> = {
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  serif: "'Iowan Old Style', Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const SIZE_MIN = 13;
const SIZE_MAX = 22;
const WIDTHS = [560, 680, 820];
const LINE_HEIGHTS = [1.5, 1.8, 2.0];

const DEFAULT_SETTINGS: PadSettings = {
  font: 'serif',
  size: 17,
  width: 680,
  lineHeight: 1.8,
  focus: false,
  typewriter: false,
};

const clampSize = (size: number): number =>
  Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(size)));

// Coerce anything read from storage into a valid settings object.
const normalizeSettings = (raw: unknown): PadSettings => {
  const src = (raw ?? {}) as Partial<Record<keyof PadSettings, unknown>>;
  const font =
    typeof src.font === 'string' && src.font in FONT_STACKS
      ? (src.font as Typeface)
      : DEFAULT_SETTINGS.font;
  const size = typeof src.size === 'number' ? clampSize(src.size) : DEFAULT_SETTINGS.size;
  const width =
    typeof src.width === 'number' && WIDTHS.includes(src.width)
      ? src.width
      : DEFAULT_SETTINGS.width;
  const lineHeight =
    typeof src.lineHeight === 'number' && LINE_HEIGHTS.includes(src.lineHeight)
      ? src.lineHeight
      : DEFAULT_SETTINGS.lineHeight;
  return {
    font,
    size,
    width,
    lineHeight,
    focus: src.focus === true,
    typewriter: src.typewriter === true,
  };
};

// Project settings onto the document: CSS custom properties + mode classes.
const applySettings = (settings: PadSettings, root: HTMLElement, body: HTMLElement): void => {
  root.style.setProperty('--ww-font', FONT_STACKS[settings.font]);
  root.style.setProperty('--ww-size', `${settings.size}px`);
  root.style.setProperty('--ww-width', `${settings.width}px`);
  root.style.setProperty('--ww-lh', String(settings.lineHeight));
  body.classList.toggle('ww-focus', settings.focus);
  body.classList.toggle('ww-typewriter', settings.typewriter);
};

export {
  applySettings,
  clampSize,
  DEFAULT_SETTINGS,
  FONT_STACKS,
  LINE_HEIGHTS,
  normalizeSettings,
  SIZE_MAX,
  SIZE_MIN,
  WIDTHS,
};
export type { PadSettings, Typeface };
