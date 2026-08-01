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
    expect(stringJsonBytes('\u2028')).toBe(8);
    expect(stringJsonBytes('\u2029')).toBe(8);
    expect(stringJsonBytes('\u0001')).toBe(8);
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

import {
  assembleDocument,
  CHUNK_KEY_PREFIX,
  DocumentTooLargeError,
  HEAD_KEY,
  ITEM_MARGIN_BYTES,
  ITEM_QUOTA_BYTES,
  MARKER,
  MAX_CHUNKS,
  META_KEY,
  packDocument,
  type SyncMeta,
} from './sync_format.js';

const WRITER = 'test-writer';
const BUDGET = ITEM_QUOTA_BYTES - ITEM_MARGIN_BYTES;

describe('packDocument', () => {
  it('keeps a small doc in the head with chunks: 0 meta', () => {
    const payload = packDocument('hello', 7, WRITER);
    expect(payload[HEAD_KEY]).toBe('hello');
    expect(payload[META_KEY]).toEqual({
      v: 1,
      rev: 7,
      writerId: WRITER,
      chunks: 0,
      len: 5,
      hash: fnv1a('hello'),
    });
    expect(Object.keys(payload)).toHaveLength(2);
  });

  it('shards a large doc: head ends with marker, chunks carry the rev', () => {
    const text = 'x'.repeat(20000);
    const payload = packDocument(text, 3, WRITER);
    const head = payload[HEAD_KEY] as string;
    expect(head.endsWith(MARKER)).toBe(true);
    const meta = payload[META_KEY] as SyncMeta;
    expect(meta.chunks).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < meta.chunks; i++) {
      const chunk = payload[`${CHUNK_KEY_PREFIX}${i}`] as string;
      expect(chunk.startsWith('3\u0000')).toBe(true);
    }
  });

  it('every packed item fits Chromium metering within budget', () => {
    const nasty = `${'<div className="a">\n'.repeat(2000)}😀\u2028${'y'.repeat(30000)}`;
    const payload = packDocument(nasty, 1, WRITER);
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') {
        expect(chromeItemBytes(key, value)).toBeLessThanOrEqual(BUDGET);
      }
    }
  });

  it('never splits a surrogate pair', () => {
    const emoji = '😀'.repeat(20000);
    const payload = packDocument(emoji, 1, WRITER);
    for (const [key, value] of Object.entries(payload)) {
      if (key === META_KEY || typeof value !== 'string') continue;
      const body =
        key === HEAD_KEY
          ? (value as string).slice(0, -MARKER.length)
          : (value as string).slice((value as string).indexOf('\u0000') + 1);
      expect(body.charCodeAt(0)).not.toBeGreaterThanOrEqual(0xdc00); // no leading low surrogate
      const last = body.charCodeAt(body.length - 1);
      expect(last < 0xd800 || last > 0xdbff).toBe(true); // no trailing high surrogate
    }
  });

  it('throws DocumentTooLargeError past the total-quota ceiling', () => {
    expect(() => packDocument('z'.repeat(120000), 1, WRITER)).toThrow(DocumentTooLargeError);
  });

  it('meters meta bytes in total budget (near ceiling)', () => {
    const text = 'x'.repeat(95000); // near but safe
    const payload = packDocument(text, 1, WRITER);
    let totalBytes = 0;
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') {
        totalBytes += chromeItemBytes(key, value);
      } else {
        // Meta: count as key + stringJsonBytes of serialized object
        totalBytes += META_KEY.length + (stringJsonBytes(JSON.stringify(value)) - 2);
      }
    }
    expect(totalBytes).toBeLessThanOrEqual(ITEM_QUOTA_BYTES * MAX_CHUNKS);
  });

  it('throws when payload with meta exceeds total quota', () => {
    // Document that would fit chunks but meta pushes over ceiling
    expect(() => packDocument('y'.repeat(101300), 1, WRITER)).toThrow(DocumentTooLargeError);
  });
});

describe('assembleDocument', () => {
  it('round-trips pack -> assemble byte-exactly, marker stripped', () => {
    for (const text of [
      '',
      'short',
      `a${'\n'.repeat(50)}<code>${'😀'.repeat(9000)}`,
      'w'.repeat(50000),
    ]) {
      const payload = packDocument(text, 5, WRITER);
      const result = assembleDocument(payload);
      expect(result.state).toBe('coherent');
      if (result.state === 'coherent') expect(result.text).toBe(text);
    }
  });

  it('reports legacy when meta is absent', () => {
    expect(assembleDocument({ v2: 'old text' })).toEqual({ state: 'legacy', text: 'old text' });
    expect(assembleDocument({})).toEqual({ state: 'legacy', text: '' });
  });

  it('reports incoherent when meta is present but malformed', () => {
    // Small payload with malformed meta
    const badMeta1 = { v2: 'small', v2m: { v: 2 } };
    expect(assembleDocument(badMeta1).state).toBe('incoherent');
    const badMeta2 = { v2: 'small', v2m: { v: 1, rev: 'not-a-number' } };
    expect(assembleDocument(badMeta2).state).toBe('incoherent');

    // Sharded payload with malformed meta
    const shardedBad = {
      v2: 'head' + MARKER,
      v2x_0: '1\u0000chunk',
      v2m: { v: 1, rev: 1, writerId: 'x', chunks: 1, len: 8, hash: 0 }, // missing fields or bad types
    };
    if (
      typeof shardedBad.v2m === 'object' &&
      shardedBad.v2m !== null &&
      Object.keys(shardedBad.v2m).length > 0
    ) {
      // Manually break one property
      (shardedBad.v2m as Record<string, unknown>).rev = 'bad';
      expect(assembleDocument(shardedBad).state).toBe('incoherent');
    }
  });

  it('reports incoherent when a chunk is missing or from another generation', () => {
    const payload = packDocument('q'.repeat(20000), 4, WRITER);
    const { [`${CHUNK_KEY_PREFIX}0`]: _dropped, ...missing } = payload;
    expect(assembleDocument(missing).state).toBe('incoherent');
    const mixed = { ...payload, [`${CHUNK_KEY_PREFIX}0`]: `3\u0000stale-generation-piece` };
    expect(assembleDocument(mixed).state).toBe('incoherent');
  });

  it('reports mismatch when the head was overwritten by a stale client', () => {
    const payload = packDocument('r'.repeat(20000), 4, WRITER);
    const result = assembleDocument({ ...payload, [HEAD_KEY]: 'stale client edit' });
    expect(result.state).toBe('mismatch');
    if (result.state === 'mismatch') expect(result.headText).toBe('stale client edit');
  });

  it('ignores orphan chunks beyond meta.chunks', () => {
    const payload = packDocument('tiny', 9, WRITER);
    const result = assembleDocument({ ...payload, [`${CHUNK_KEY_PREFIX}5`]: '2\u0000orphan' });
    expect(result.state).toBe('coherent');
    if (result.state === 'coherent') expect(result.text).toBe('tiny');
  });
});
