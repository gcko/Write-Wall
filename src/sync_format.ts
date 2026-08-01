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

interface SyncMeta {
  v: 1;
  rev: number;
  writerId: string;
  chunks: number;
  len: number;
  hash: number;
}

type SyncPayload = Record<string, string | SyncMeta>;

class DocumentTooLargeError extends Error {
  constructor() {
    super('document too large for sync storage (~95 KB ceiling)');
    this.name = 'DocumentTooLargeError';
  }
}

const ITEM_BUDGET = ITEM_QUOTA_BYTES - ITEM_MARGIN_BYTES;

// Largest code-point-aligned prefix length of `text` such that
// prefix + suffix fits ITEM_BUDGET for `key`. Monotonic, so binary search.
const splitPoint = (key: string, text: string, prefixBytes: number, suffix: string): number => {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    const bytes = prefixBytes + chromeItemBytes(key, text.slice(0, mid) + suffix);
    if (bytes <= ITEM_BUDGET) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const code = text.charCodeAt(lo - 1);
  return code >= 0xd800 && code <= 0xdbff && lo < text.length ? lo - 1 : lo;
};

const packDocument = (text: string, rev: number, writerId: string): SyncPayload => {
  const meta: SyncMeta = { v: 1, rev, writerId, chunks: 0, len: text.length, hash: fnv1a(text) };
  if (chromeItemBytes(HEAD_KEY, text) <= ITEM_BUDGET) {
    return { [HEAD_KEY]: text, [META_KEY]: meta };
  }
  const headLen = splitPoint(HEAD_KEY, text, 0, MARKER);
  const head = text.slice(0, headLen) + MARKER;
  const payload: SyncPayload = { [HEAD_KEY]: head };
  let totalBytes = chromeItemBytes(HEAD_KEY, head);
  const revPrefix = `${rev}\u0000`;
  const revPrefixBytes = stringJsonBytes(revPrefix) - 2; // exclude double-counted quotes
  let rest = text.slice(headLen);
  let index = 0;
  while (rest.length > 0) {
    if (index >= MAX_CHUNKS) {
      throw new DocumentTooLargeError();
    }
    const key = `${CHUNK_KEY_PREFIX}${index}`;
    const take = splitPoint(key, rest, revPrefixBytes, '');
    if (take === 0) {
      throw new DocumentTooLargeError(); // cannot make progress (pathological input)
    }
    const value = revPrefix + rest.slice(0, take);
    totalBytes += chromeItemBytes(key, value);
    if (totalBytes > SYNC_QUOTA_BYTES - TOTAL_RESERVE_BYTES) {
      throw new DocumentTooLargeError();
    }
    payload[key] = value;
    rest = rest.slice(take);
    index += 1;
  }
  meta.chunks = index;
  // Exact for SyncMeta: numbers plus a UUID writerId contain no characters
  // Chromium's WriteJson escapes differently from JSON.stringify.
  const metaBytes = META_KEY.length + new TextEncoder().encode(JSON.stringify(meta)).length;
  totalBytes += metaBytes;
  if (totalBytes > SYNC_QUOTA_BYTES - TOTAL_RESERVE_BYTES) {
    throw new DocumentTooLargeError();
  }
  payload[META_KEY] = meta;
  return payload;
};

const stripMarker = (head: string): string =>
  head.endsWith(MARKER) ? head.slice(0, -MARKER.length) : head;

const isMeta = (value: unknown): value is SyncMeta => {
  const m = value as SyncMeta | null;
  return (
    typeof m === 'object' &&
    m !== null &&
    m.v === 1 &&
    typeof m.rev === 'number' &&
    typeof m.writerId === 'string' &&
    typeof m.chunks === 'number' &&
    typeof m.len === 'number' &&
    typeof m.hash === 'number'
  );
};

type AssembleResult =
  | { state: 'legacy'; text: string }
  | { state: 'coherent'; text: string; meta: SyncMeta }
  | { state: 'incoherent' }
  | { state: 'mismatch'; meta: SyncMeta; headText: string };

const assembleDocument = (items: Record<string, unknown>): AssembleResult => {
  const metaRaw = items[META_KEY];
  const head = items[HEAD_KEY];
  if (metaRaw === undefined) {
    return { state: 'legacy', text: typeof head === 'string' ? head : '' };
  }
  if (!isMeta(metaRaw)) {
    return { state: 'incoherent' };
  }
  if (typeof head !== 'string') {
    return { state: 'incoherent' };
  }
  const pieces: string[] = [];
  for (let i = 0; i < metaRaw.chunks; i++) {
    const raw = items[`${CHUNK_KEY_PREFIX}${i}`];
    if (typeof raw !== 'string') {
      return { state: 'incoherent' };
    }
    const sep = raw.indexOf('\u0000');
    if (sep === -1 || Number(raw.slice(0, sep)) !== metaRaw.rev) {
      return { state: 'incoherent' };
    }
    pieces.push(raw.slice(sep + 1));
  }
  const text = stripMarker(head) + pieces.join('');
  if (text.length !== metaRaw.len || fnv1a(text) !== metaRaw.hash) {
    return { state: 'mismatch', meta: metaRaw, headText: stripMarker(head) };
  }
  return { state: 'coherent', text, meta: metaRaw };
};

export type { AssembleResult, SyncMeta, SyncPayload };
export {
  assembleDocument,
  CHUNK_KEY_PREFIX,
  chromeItemBytes,
  DocumentTooLargeError,
  fnv1a,
  HEAD_KEY,
  ITEM_MARGIN_BYTES,
  ITEM_QUOTA_BYTES,
  isMeta,
  LEGACY_KEY,
  MARKER,
  MAX_CHUNKS,
  META_KEY,
  packDocument,
  SYNC_QUOTA_BYTES,
  stringJsonBytes,
  stripMarker,
  TOTAL_RESERVE_BYTES,
};
