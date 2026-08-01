import { describe, expect, it } from 'vitest';
import { chromeItemBytes, fnv1a, stringJsonBytes } from './sync_format.js';

describe('stringJsonBytes (Chromium base::WriteJson metering)', () => {
  it('meters plain ASCII as length plus two quotes', () => {
    expect(stringJsonBytes('abc')).toBe(5);
  });
  it('meters backslash-escaped chars at 2 bytes', () => {
    for (const ch of ['"', '\\', '\b', '\f', '\n', '\r', '\t']) {
      expect(stringJsonBytes(ch)).toBe(4); // 2 quotes + 2
    }
  });
  it('meters < and U+2028/U+2029 and other control chars at 6 bytes', () => {
    expect(stringJsonBytes('<')).toBe(8); // 2 quotes + <
    expect(stringJsonBytes(' ')).toBe(8);
    expect(stringJsonBytes(' ')).toBe(8);
    expect(stringJsonBytes('')).toBe(8);
  });
  it('meters non-ASCII as raw UTF-8', () => {
    expect(stringJsonBytes('é')).toBe(4); // 2 quotes + 2
    expect(stringJsonBytes('語')).toBe(5); // 2 quotes + 3
    expect(stringJsonBytes('😀')).toBe(6); // 2 quotes + 4
  });
  it('meters a lone surrogate at 3 bytes (Chromium writes U+FFFD)', () => {
    expect(stringJsonBytes('\uD800')).toBe(5);
  });
});

describe('chromeItemBytes', () => {
  it('adds the key length', () => {
    expect(chromeItemBytes('v2', 'abc')).toBe(2 + 5);
    expect(chromeItemBytes('v2x_12', '')).toBe(6 + 2);
  });
});

describe('fnv1a', () => {
  it('matches known FNV-1a 32-bit vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
  });
  it('differs for different strings', () => {
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });
});
