/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

const HEAD_KEY = 'v2';
const CHUNK_KEY_PREFIX = 'v2x_';
const META_KEY = 'v2m';
const LEGACY_KEY = 'text';
const MARKER = '\n\n--- ✂ truncated — update Write Wall to see the rest ---';
const ITEM_QUOTA_BYTES = 8192;
const ITEM_MARGIN_BYTES = 256;
const SYNC_QUOTA_BYTES = 102400;
const TOTAL_RESERVE_BYTES = 1024;
const MAX_CHUNKS = 13;

// Chars Chromium's base::WriteJson escapes with a single backslash (2 bytes).
const TWO_BYTE_ESCAPES = new Set(['"', '\\', '\b', '\f', '\n', '\r', '\t']);

const utf8Length = (codePoint: number): number =>
  codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;

// Byte size of base::WriteJson's serialization of a string, which is how
// Chrome meters chrome.storage.sync quota. Diverges from JSON.stringify:
// '<', U+2028, U+2029 become \u00XX (6 bytes); lone surrogates become
// U+FFFD (3 bytes).
const stringJsonBytes = (value: string): number => {
  let bytes = 2; // surrounding quotes
  for (const ch of value) {
    const codePoint = ch.codePointAt(0) as number;
    if (TWO_BYTE_ESCAPES.has(ch)) {
      bytes += 2;
    } else if (codePoint < 0x20 || ch === '<' || codePoint === 0x2028 || codePoint === 0x2029) {
      bytes += 6;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      bytes += 3; // lone surrogate -> U+FFFD
    } else {
      bytes += utf8Length(codePoint);
    }
  }
  return bytes;
};

const chromeItemBytes = (key: string, value: string): number => key.length + stringJsonBytes(value);

// 32-bit FNV-1a over UTF-16 code units. Integrity check, not security.
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

export {
  CHUNK_KEY_PREFIX,
  chromeItemBytes,
  fnv1a,
  HEAD_KEY,
  ITEM_MARGIN_BYTES,
  ITEM_QUOTA_BYTES,
  LEGACY_KEY,
  MARKER,
  MAX_CHUNKS,
  META_KEY,
  SYNC_QUOTA_BYTES,
  stringJsonBytes,
  TOTAL_RESERVE_BYTES,
};
