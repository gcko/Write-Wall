/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License. To view
 * a copy of this license, visit https://creativecommons.org/licenses/by-sa/4.0/
 */

import { describe, expect, it, vi } from 'vitest';
import {
  applySettings,
  clampSize,
  DEFAULT_SETTINGS,
  FONT_STACKS,
  normalizeSettings,
} from './settings.js';

describe('normalizeSettings', () => {
  it('returns defaults for empty or invalid input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const valid = {
      font: 'mono',
      size: 14,
      width: 820,
      lineHeight: 1.5,
      focus: true,
      typewriter: true,
    };
    expect(normalizeSettings(valid)).toEqual(valid);
  });

  it('rejects unknown fonts, widths, and line heights', () => {
    const out = normalizeSettings({ font: 'comic-sans', width: 700, lineHeight: 3 });
    expect(out.font).toBe(DEFAULT_SETTINGS.font);
    expect(out.width).toBe(DEFAULT_SETTINGS.width);
    expect(out.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
  });

  it('clamps sizes into range', () => {
    expect(normalizeSettings({ size: 2 }).size).toBe(13);
    expect(normalizeSettings({ size: 99 }).size).toBe(22);
  });

  it('coerces non-boolean modes to false', () => {
    const out = normalizeSettings({ focus: 'yes', typewriter: 1 });
    expect(out.focus).toBe(false);
    expect(out.typewriter).toBe(false);
  });
});

describe('clampSize', () => {
  it('clamps and rounds', () => {
    expect(clampSize(12)).toBe(13);
    expect(clampSize(23)).toBe(22);
    expect(clampSize(17.6)).toBe(18);
  });
});

describe('applySettings', () => {
  it('sets CSS custom properties and mode classes', () => {
    const setProperty = vi.fn();
    const classes = new Set<string>();
    const root = { style: { setProperty } } as unknown as HTMLElement;
    const body = {
      classList: {
        toggle: vi.fn((name: string, on: boolean) => {
          if (on) {
            classes.add(name);
          } else {
            classes.delete(name);
          }
        }),
      },
    } as unknown as HTMLElement;

    applySettings(
      { font: 'mono', size: 15, width: 560, lineHeight: 2.0, focus: true, typewriter: false },
      root,
      body,
    );

    expect(setProperty).toHaveBeenCalledWith('--ww-font', FONT_STACKS.mono);
    expect(setProperty).toHaveBeenCalledWith('--ww-size', '15px');
    expect(setProperty).toHaveBeenCalledWith('--ww-width', '560px');
    expect(setProperty).toHaveBeenCalledWith('--ww-lh', '2');
    expect(classes.has('ww-focus')).toBe(true);
    expect(classes.has('ww-typewriter')).toBe(false);
  });
});
