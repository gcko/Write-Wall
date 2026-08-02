# Sharded Sync Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise Write Wall's synced document ceiling from 8 KB to ~95 KB by sharding the document across `chrome.storage.sync` keys, with silent upgrade for existing users and mixed-version fleet safety.

**Architecture:** A pure formatting layer (`sync_format.ts`) packs/assembles documents using Chromium's exact byte metering; a stateful store (`sync_store.ts`) owns revisions, remote-change settling, and conflict handling behind a document-level API; `main.ts` swaps its raw `storage.sync` calls for that API. A stateful fake `chrome.storage` makes torn sync delivery and quota exhaustion testable.

**Tech Stack:** TypeScript (ES2024, strict), Vite, Vitest (Node env, mocked Chrome), Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-01-sharded-sync-storage-design.md` — read it first; it is the authority on behavior.

## Global Constraints

- All work on branch `feat/sharded-sync-storage`. Never commit to `main`.
- Every commit: Conventional Commits format AND `--signoff` AND `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Run `pnpm test`, `pnpm type:check`, `pnpm lint` before every commit (pre-commit hook runs lint + test; fix with `pnpm lint:fix`).
- Storage writes use `.then()/.catch()` chains in `main.ts` (existing pattern); `sync_store.ts` may use async/await internally.
- Sync keys: head `v2`, chunks `v2x_0`…`v2x_12`, meta `v2m`, legacy `text`. Local keys already in use: `cursor`, `theme`, `settings`, `countMode`; new local keys: `writerId`, `backup_0..2`.
- Marker line constant (exact): `'\n\n--- ✂ truncated — update Write Wall to see the rest ---'`
- Per-item quota 8,192 B with 256 B margin; total quota 102,400 B with 1,024 B reserve; max 13 chunks.
- One `storage.sync.set()` per flush on the hot path. `remove()` only at startup (GC, legacy migration).
- Do not edit `dist/`.

---

### Task 1: Chromium byte metering + hash (`sync_format.ts` part 1)

**Files:**
- Create: `src/sync_format.ts`
- Test: `src/sync_format.spec.ts`

**Interfaces:**
- Produces: `chromeItemBytes(key: string, value: string): number`, `stringJsonBytes(value: string): number`, `fnv1a(text: string): number`, and constants `HEAD_KEY = 'v2'`, `CHUNK_KEY_PREFIX = 'v2x_'`, `META_KEY = 'v2m'`, `LEGACY_KEY = 'text'`, `MARKER` (see Global Constraints), `ITEM_QUOTA_BYTES = 8192`, `ITEM_MARGIN_BYTES = 256`, `SYNC_QUOTA_BYTES = 102400`, `TOTAL_RESERVE_BYTES = 1024`, `MAX_CHUNKS = 13`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/sync_format.spec.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/sync_format.spec.ts`
Expected: FAIL — module `./sync_format.js` not found.

- [ ] **Step 3: Implement**

```typescript
// src/sync_format.ts  (include the standard project copyright header — copy from src/utils.ts)

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

const chromeItemBytes = (key: string, value: string): number =>
  key.length + stringJsonBytes(value);

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
  HEAD_KEY, CHUNK_KEY_PREFIX, META_KEY, LEGACY_KEY, MARKER,
  ITEM_QUOTA_BYTES, ITEM_MARGIN_BYTES, SYNC_QUOTA_BYTES, TOTAL_RESERVE_BYTES,
  MAX_CHUNKS, stringJsonBytes, chromeItemBytes, fnv1a,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/sync_format.spec.ts` — Expected: PASS.
Note: `fnv1a('a')` = 0xe40c292c is the published FNV-1a test vector. If the assertion fails, the implementation is wrong (likely FNV-1 not FNV-1a: XOR must come before multiply).

- [ ] **Step 5: Commit**

```bash
git add src/sync_format.ts src/sync_format.spec.ts
git commit --signoff -m "feat(sync): add Chromium-exact byte metering and FNV-1a hash

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Pack + assemble (`sync_format.ts` part 2)

**Files:**
- Modify: `src/sync_format.ts`
- Test: `src/sync_format.spec.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:

```typescript
interface SyncMeta { v: 1; rev: number; writerId: string; chunks: number; len: number; hash: number; }
class DocumentTooLargeError extends Error {}
type SyncPayload = Record<string, string | SyncMeta>;
function packDocument(text: string, rev: number, writerId: string): SyncPayload;
function stripMarker(head: string): string;
function isMeta(value: unknown): value is SyncMeta;
type AssembleResult =
  | { state: 'legacy'; text: string }
  | { state: 'coherent'; text: string; meta: SyncMeta }
  | { state: 'incoherent' }
  | { state: 'mismatch'; meta: SyncMeta; headText: string };
function assembleDocument(items: Record<string, unknown>): AssembleResult;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/sync_format.spec.ts`:

```typescript
import {
  assembleDocument, chromeItemBytes, CHUNK_KEY_PREFIX, DocumentTooLargeError, fnv1a,
  HEAD_KEY, ITEM_MARGIN_BYTES, ITEM_QUOTA_BYTES, MARKER, META_KEY, packDocument,
  stringJsonBytes, type SyncMeta,
} from './sync_format.js';

const WRITER = 'test-writer';
const BUDGET = ITEM_QUOTA_BYTES - ITEM_MARGIN_BYTES;

describe('packDocument', () => {
  it('keeps a small doc in the head with chunks: 0 meta', () => {
    const payload = packDocument('hello', 7, WRITER);
    expect(payload[HEAD_KEY]).toBe('hello');
    expect(payload[META_KEY]).toEqual({
      v: 1, rev: 7, writerId: WRITER, chunks: 0, len: 5, hash: fnv1a('hello'),
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
      const body = key === HEAD_KEY
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
});

describe('assembleDocument', () => {
  it('round-trips pack -> assemble byte-exactly, marker stripped', () => {
    for (const text of ['', 'short', `a${'\n'.repeat(50)}<code>${'😀'.repeat(9000)}`, 'w'.repeat(50000)]) {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/sync_format.spec.ts` — Expected: FAIL — `packDocument` not exported.

- [ ] **Step 3: Implement**

Append to `src/sync_format.ts`:

```typescript
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
  payload[META_KEY] = meta;
  return payload;
};

const stripMarker = (head: string): string =>
  head.endsWith(MARKER) ? head.slice(0, -MARKER.length) : head;

const isMeta = (value: unknown): value is SyncMeta => {
  const m = value as SyncMeta | null;
  return (
    typeof m === 'object' && m !== null && m.v === 1 &&
    typeof m.rev === 'number' && typeof m.writerId === 'string' &&
    typeof m.chunks === 'number' && typeof m.len === 'number' && typeof m.hash === 'number'
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
  if (!isMeta(metaRaw)) {
    return { state: 'legacy', text: typeof head === 'string' ? head : '' };
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
export { assembleDocument, DocumentTooLargeError, isMeta, packDocument, stripMarker };
```

Note on `revPrefixBytes`: `splitPoint` measures `key + quotes + slice + suffix`; the rev prefix's bytes are added separately, minus the 2 quote bytes `stringJsonBytes` would double-count.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/sync_format.spec.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync_format.ts src/sync_format.spec.ts
git commit --signoff -m "feat(sync): add document packer and assembler with rev-stamped chunks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Stateful fake `chrome.storage` (test harness)

**Files:**
- Create: `src/test/fake_chrome_storage.ts`
- Test: `src/test/fake_chrome_storage.spec.ts`

**Interfaces:**
- Consumes: `chromeItemBytes`, `stringJsonBytes` from Task 1.
- Produces:

```typescript
class FakeSyncWorld {
  createDevice(): FakeChromeStorage;
  // Deliver queued cross-device changes; `keys` filters for torn delivery.
  deliver(device: FakeChromeStorage, keys?: string[]): void;
  deliverAll(): void;
}
// FakeChromeStorage is shape-compatible with the chrome.storage subset the
// app uses: sync.get/set/remove/getBytesInUse + QUOTA_* constants,
// local.get/set/remove, onChanged.addListener. Promise AND callback forms.
```

- [ ] **Step 1: Write the failing tests**

```typescript
// src/test/fake_chrome_storage.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSyncWorld } from './fake_chrome_storage.js';

describe('FakeSyncWorld', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('round-trips set/get on one device', async () => {
    const world = new FakeSyncWorld();
    const device = world.createDevice();
    await device.sync.set({ v2: 'hello' });
    expect(await device.sync.get(null)).toEqual({ v2: 'hello' });
  });

  it('rejects an item over QUOTA_BYTES_PER_ITEM with Chrome-like message', async () => {
    const device = new FakeSyncWorld().createDevice();
    await expect(device.sync.set({ v2: 'x'.repeat(8300) })).rejects.toThrow(
      /QUOTA_BYTES_PER_ITEM/,
    );
  });

  it('rejects when total exceeds QUOTA_BYTES', async () => {
    const device = new FakeSyncWorld().createDevice();
    const items: Record<string, string> = {};
    for (let i = 0; i < 14; i++) items[`k${i}`] = 'y'.repeat(7900);
    await expect(device.sync.set(items)).rejects.toThrow(/QUOTA_BYTES(?!_)/);
  });

  it('rejects the 1801st write in an hour with MAX_WRITE_OPERATIONS_PER_HOUR', async () => {
    const device = new FakeSyncWorld().createDevice();
    for (let i = 0; i < 1800; i++) {
      await device.sync.set({ v2: `t${i}` });
      vi.advanceTimersByTime(1000); // 1 op/s: under the 120/min limit,
    } // and all 1800 ops still inside the first op's rolling hour
    await expect(device.sync.set({ v2: 'over' })).rejects.toThrow(
      /MAX_WRITE_OPERATIONS_PER_HOUR/,
    );
  });

  it('fires onChanged locally with old and new values', async () => {
    const device = new FakeSyncWorld().createDevice();
    const seen: unknown[] = [];
    device.onChanged.addListener((changes, area) => seen.push([area, changes]));
    await device.sync.set({ v2: 'a' });
    await device.sync.set({ v2: 'b' });
    expect(seen[1]).toEqual(['sync', { v2: { oldValue: 'a', newValue: 'b' } }]);
  });

  it('queues cross-device changes until deliver(), supporting torn delivery', async () => {
    const world = new FakeSyncWorld();
    const writer = world.createDevice();
    const reader = world.createDevice();
    const batches: Record<string, unknown>[] = [];
    reader.onChanged.addListener((changes) => batches.push(changes));
    await writer.sync.set({ v2: 'head', v2x_0: 'chunk', v2m: { v: 1 } });
    expect(batches).toHaveLength(0); // nothing until delivery
    world.deliver(reader, ['v2']); // torn: head arrives alone
    expect(batches).toHaveLength(1);
    expect(Object.keys(batches[0])).toEqual(['v2']);
    expect(await reader.sync.get(null)).toEqual({ v2: 'head' });
    world.deliver(reader); // the rest arrives
    expect(batches).toHaveLength(2);
    expect(await reader.sync.get(null)).toEqual({ v2: 'head', v2x_0: 'chunk', v2m: { v: 1 } });
  });

  it('supports callback-style get and getBytesInUse', async () => {
    const device = new FakeSyncWorld().createDevice();
    await device.sync.set({ v2: 'abcd' });
    const got = await new Promise((resolve) => device.sync.get(null, resolve));
    expect(got).toEqual({ v2: 'abcd' });
    const used = await new Promise((resolve) => device.sync.getBytesInUse(null, resolve));
    expect(used).toBe(2 + 6); // key 'v2' + "abcd" with quotes
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/fake_chrome_storage.spec.ts` — Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/test/fake_chrome_storage.ts  (test-only; no copyright header needed, matches spec files)
import { chromeItemBytes, stringJsonBytes } from '../sync_format.js';

type Items = Record<string, unknown>;
type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type Listener = (changes: Changes, areaName: string) => void;
type GetCallback = (items: Items) => void;

const itemBytes = (key: string, value: unknown): number =>
  typeof value === 'string'
    ? chromeItemBytes(key, value)
    : key.length + stringJsonBytes(JSON.stringify(value)) - 2; // object: serialized form, quotes not doubled

const clone = <T>(value: T): T => structuredClone(value);

class FakeChromeStorage {
  private readonly world: FakeSyncWorld;
  private readonly syncItems = new Map<string, unknown>();
  private readonly localItems = new Map<string, unknown>();
  private readonly listeners: Listener[] = [];
  private readonly writeTimestamps: number[] = [];
  readonly pendingRemote = new Map<string, { oldValue?: unknown; newValue?: unknown }>();

  readonly sync = {
    QUOTA_BYTES: 102400,
    QUOTA_BYTES_PER_ITEM: 8192,
    MAX_ITEMS: 512,
    MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
    MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
    get: (keys: string | string[] | null, callback?: GetCallback): Promise<Items> => {
      const wanted =
        keys == null ? [...this.syncItems.keys()] : Array.isArray(keys) ? keys : [keys];
      const result: Items = {};
      for (const key of wanted) {
        if (this.syncItems.has(key)) result[key] = clone(this.syncItems.get(key));
      }
      callback?.(result);
      return Promise.resolve(result);
    },
    set: (items: Items): Promise<void> => {
      const err = this.checkWriteOp() ?? this.checkQuota(items);
      if (err) return Promise.reject(new Error(err));
      const changes: Changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: clone(this.syncItems.get(key)), newValue: clone(value) };
        this.syncItems.set(key, clone(value));
      }
      this.emit(changes);
      this.world.broadcast(this, changes);
      return Promise.resolve();
    },
    remove: (keys: string | string[]): Promise<void> => {
      const err = this.checkWriteOp();
      if (err) return Promise.reject(new Error(err));
      const changes: Changes = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (!this.syncItems.has(key)) continue;
        changes[key] = { oldValue: clone(this.syncItems.get(key)) };
        this.syncItems.delete(key);
      }
      if (Object.keys(changes).length > 0) {
        this.emit(changes);
        this.world.broadcast(this, changes);
      }
      return Promise.resolve();
    },
    getBytesInUse: (_keys: string | string[] | null, callback?: (n: number) => void): Promise<number> => {
      let total = 0;
      for (const [key, value] of this.syncItems) total += itemBytes(key, value);
      callback?.(total);
      return Promise.resolve(total);
    },
  };

  readonly local = {
    get: (keys: string | string[] | null, callback?: GetCallback): Promise<Items> => {
      const wanted =
        keys == null ? [...this.localItems.keys()] : Array.isArray(keys) ? keys : [keys];
      const result: Items = {};
      for (const key of wanted) {
        if (this.localItems.has(key)) result[key] = clone(this.localItems.get(key));
      }
      callback?.(result);
      return Promise.resolve(result);
    },
    set: (items: Items): Promise<void> => {
      for (const [key, value] of Object.entries(items)) this.localItems.set(key, clone(value));
      return Promise.resolve();
    },
    remove: (keys: string | string[]): Promise<void> => {
      for (const key of Array.isArray(keys) ? keys : [keys]) this.localItems.delete(key);
      return Promise.resolve();
    },
  };

  readonly onChanged = {
    addListener: (listener: Listener): void => {
      this.listeners.push(listener);
    },
  };

  constructor(world: FakeSyncWorld) {
    this.world = world;
  }

  // Called by the world when another device's changes are delivered.
  applyRemote(changes: Changes): void {
    for (const [key, change] of Object.entries(changes)) {
      if ('newValue' in change && change.newValue !== undefined) {
        this.syncItems.set(key, clone(change.newValue));
      } else {
        this.syncItems.delete(key);
      }
    }
    this.emit(changes);
  }

  queueRemote(changes: Changes): void {
    for (const [key, change] of Object.entries(changes)) this.pendingRemote.set(key, change);
  }

  private emit(changes: Changes): void {
    for (const listener of this.listeners) listener(clone(changes), 'sync');
  }

  private checkWriteOp(): string | null {
    const now = Date.now();
    while (this.writeTimestamps.length > 0 && now - this.writeTimestamps[0] >= 3600000) {
      this.writeTimestamps.shift();
    }
    const lastMinute = this.writeTimestamps.filter((t) => now - t < 60000).length;
    if (this.writeTimestamps.length >= 1800) {
      return 'This request exceeds the MAX_WRITE_OPERATIONS_PER_HOUR quota.';
    }
    if (lastMinute >= 120) {
      return 'This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.';
    }
    this.writeTimestamps.push(now);
    return null;
  }

  private checkQuota(items: Items): string | null {
    const next = new Map(this.syncItems);
    for (const [key, value] of Object.entries(items)) {
      if (itemBytes(key, value) > this.sync.QUOTA_BYTES_PER_ITEM) {
        return 'QUOTA_BYTES_PER_ITEM quota exceeded';
      }
      next.set(key, value);
    }
    let total = 0;
    for (const [key, value] of next) total += itemBytes(key, value);
    if (total > this.sync.QUOTA_BYTES) return 'QUOTA_BYTES quota exceeded';
    if (next.size > this.sync.MAX_ITEMS) return 'MAX_ITEMS quota exceeded';
    return null;
  }
}

class FakeSyncWorld {
  private readonly devices: FakeChromeStorage[] = [];

  createDevice(): FakeChromeStorage {
    const device = new FakeChromeStorage(this);
    this.devices.push(device);
    return device;
  }

  broadcast(source: FakeChromeStorage, changes: Changes): void {
    for (const device of this.devices) {
      if (device !== source) device.queueRemote(changes);
    }
  }

  deliver(device: FakeChromeStorage, keys?: string[]): void {
    const wanted = keys ?? [...device.pendingRemote.keys()];
    const batch: Changes = {};
    for (const key of wanted) {
      const change = device.pendingRemote.get(key);
      if (change) {
        batch[key] = change;
        device.pendingRemote.delete(key);
      }
    }
    if (Object.keys(batch).length > 0) device.applyRemote(batch);
  }

  deliverAll(): void {
    for (const device of this.devices) this.deliver(device);
  }
}

export { FakeChromeStorage, FakeSyncWorld };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/test/fake_chrome_storage.spec.ts` — Expected: PASS.
If vitest doesn't pick up `src/test/`, check `vitest.config`/`vite.config.ts` include patterns and widen to `src/**/*.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/test/fake_chrome_storage.ts src/test/fake_chrome_storage.spec.ts
git commit --signoff -m "test(sync): add stateful fake chrome.storage with quotas and torn delivery

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `SyncStore` — startup, write path, error classification

**Files:**
- Create: `src/sync_store.ts`
- Test: `src/sync_store.spec.ts`

**Interfaces:**
- Consumes: Task 2 exports; `FakeSyncWorld` (tests only); `throttle` from `./utils.js`.
- Produces:

```typescript
type DocumentOrigin = 'remote' | 'conflict-republish';
interface SyncStatus {
  kind: 'synced' | 'sync-error' | 'sync-incomplete' | 'too-large' | 'republished';
  message?: string;
}
interface SyncStoreOptions {
  storage: StorageLike;              // chrome.storage-shaped (see Task 3 fake)
  onDocument: (text: string, origin: DocumentOrigin) => void;
  onStatus: (status: SyncStatus) => void;
  isDirty: () => boolean;
  getText: () => string;             // current editor content, for republish
  onWritable?: () => void;           // coherence returned; flush if dirty
  settleMs?: number;                 // default 300
  incoherentRetryMs?: number;        // default 5000
}
class SyncStore {
  constructor(options: SyncStoreOptions);
  start(): Promise<string>;          // initial document text
  write(text: string): Promise<boolean>; // false = blocked (torn state), not an error
  handleChanges(changes: Changes, areaName: string): void;
  noteLocalEdit(): void;             // resets the remote overlay
  backupNow(text: string): Promise<void>;      // rotate into backup ring
  readNewestBackup(): Promise<string | null>;
}
```

- [ ] **Step 1: Write the failing tests** (startup + write; remote handling is Task 5)

```typescript
// src/sync_store.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fnv1a, packDocument } from './sync_format.js';
import { SyncStore, type SyncStatus } from './sync_store.js';
import { FakeSyncWorld } from './test/fake_chrome_storage.js';

const harness = (world = new FakeSyncWorld()) => {
  const device = world.createDevice();
  const docs: [string, string][] = [];
  const statuses: SyncStatus[] = [];
  let dirty = false;
  let text = '';
  const store = new SyncStore({
    storage: device,
    onDocument: (t, origin) => {
      text = t;
      docs.push([t, origin]);
    },
    onStatus: (s) => statuses.push(s),
    isDirty: () => dirty,
    getText: () => text,
    settleMs: 300,
    incoherentRetryMs: 5000,
  });
  device.onChanged.addListener((changes, area) => store.handleChanges(changes, area));
  return {
    world, device, store, docs, statuses,
    setDirty: (d: boolean) => { dirty = d; },
    setText: (t: string) => { text = t; },
  };
};

describe('SyncStore.start', () => {
  beforeEach(() => vi.useFakeTimers());

  it('migrates the legacy text key into v2 + v2m in one set', async () => {
    const h = harness();
    await h.device.sync.set({ text: 'legacy words' });
    const initial = await h.store.start();
    expect(initial).toBe('legacy words');
    const items = await h.device.sync.get(null);
    expect(items.text).toBeUndefined();
    expect(items.v2).toBe('legacy words');
    expect(items.v2m).toMatchObject({ chunks: 0, len: 12, hash: fnv1a('legacy words') });
  });

  it('adopts a v2-only doc and publishes meta once', async () => {
    const h = harness();
    await h.device.sync.set({ v2: 'existing user text' });
    expect(await h.store.start()).toBe('existing user text');
    const items = await h.device.sync.get(null);
    expect(items.v2m).toMatchObject({ rev: 1, chunks: 0 });
  });

  it('starts empty on a fresh install without writing meta twice', async () => {
    const h = harness();
    expect(await h.store.start()).toBe('');
    const items = await h.device.sync.get(null);
    expect(items.v2).toBe('');
    expect(items.v2m).toMatchObject({ rev: 1, chunks: 0 });
  });

  it('assembles a sharded doc and GCs orphan chunks', async () => {
    const h = harness();
    const big = 'b'.repeat(20000);
    await h.device.sync.set(packDocument(big, 6, 'other-device'));
    await h.device.sync.set({ v2x_9: '2\u0000orphan from an old generation' });
    expect(await h.store.start()).toBe(big);
    const items = await h.device.sync.get(null);
    expect(items.v2x_9).toBeUndefined();
  });
});

describe('SyncStore.write', () => {
  beforeEach(() => vi.useFakeTimers());

  it('writes head+meta in a single set and bumps rev', async () => {
    const h = harness();
    await h.store.start();
    const setSpy = vi.spyOn(h.device.sync, 'set');
    expect(await h.store.write('hello world')).toBe(true);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const items = await h.device.sync.get(null);
    expect(items.v2).toBe('hello world');
    expect(items.v2m).toMatchObject({ rev: 2 });
  });

  it('reports too-large as its own status kind', async () => {
    const h = harness();
    await h.store.start();
    expect(await h.store.write('z'.repeat(120000))).toBe(false);
    expect(h.statuses.at(-1)?.kind).toBe('too-large');
  });

  it('classifies a write-op-quota rejection distinctly', async () => {
    const h = harness();
    await h.store.start();
    for (let i = 0; i < 119; i++) {
      await h.device.sync.set({ pad: `p${i}` }); // burn the per-minute budget
    }
    expect(await h.store.write('quota-bound')).toBe(false);
    const status = h.statuses.at(-1);
    expect(status?.kind).toBe('sync-error');
    expect(status?.message).toMatch(/MAX_WRITE_OPERATIONS/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/sync_store.spec.ts` — Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SyncStore` (startup + write; leave remote handling stubs)**

```typescript
// src/sync_store.ts  (include the standard project copyright header)
import {
  assembleDocument, CHUNK_KEY_PREFIX, DocumentTooLargeError, HEAD_KEY, isMeta, LEGACY_KEY,
  META_KEY, packDocument, type SyncMeta, type SyncPayload,
} from './sync_format.js';

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type DocumentOrigin = 'remote' | 'conflict-republish';

interface SyncStatus {
  kind: 'synced' | 'sync-error' | 'sync-incomplete' | 'too-large' | 'republished';
  message?: string;
}

interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface StorageLike {
  sync: StorageAreaLike;
  local?: StorageAreaLike;
}

interface SyncStoreOptions {
  storage: StorageLike;
  onDocument: (text: string, origin: DocumentOrigin) => void;
  onStatus: (status: SyncStatus) => void;
  isDirty: () => boolean;
  getText: () => string;
  onWritable?: () => void;
  settleMs?: number;
  incoherentRetryMs?: number;
}

const WRITER_ID_KEY = 'writerId';
const BACKUP_KEYS = ['backup_0', 'backup_1', 'backup_2'];
const DOC_KEY_PATTERN = /^(v2|v2m|v2x_\d+|text)$/;

class SyncStore {
  private readonly options: Required<Pick<SyncStoreOptions, 'settleMs' | 'incoherentRetryMs'>> &
    SyncStoreOptions;
  private known: Record<string, unknown> = {};
  private readonly overlay = new Map<string, unknown>();
  private rev = 0;
  private writerId = '';
  private blocked = false;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SyncStoreOptions) {
    this.options = { settleMs: 300, incoherentRetryMs: 5000, ...options };
  }

  async start(): Promise<string> {
    this.writerId = await this.loadWriterId();
    const items = await this.options.storage.sync.get(null);
    // Legacy 'text' key (pre-v2) wins: same precedence as the old main.ts path.
    const legacyText = items[LEGACY_KEY];
    if (typeof legacyText === 'string') {
      this.rev = 1;
      const payload = packDocument(legacyText, this.rev, this.writerId);
      await this.options.storage.sync.set(payload);
      await this.options.storage.sync.remove(LEGACY_KEY);
      this.known = { ...payload };
      return legacyText;
    }
    const result = assembleDocument(items);
    if (result.state === 'legacy') {
      // v2-only install (or fresh). Publish meta once; 'meta absent' then
      // permanently means 'legacy' fleet-wide.
      this.rev = 1;
      const payload = packDocument(result.text, this.rev, this.writerId);
      await this.options.storage.sync.set(payload);
      this.known = { ...payload };
      return result.text;
    }
    if (result.state === 'coherent') {
      this.rev = result.meta.rev;
      this.known = { ...items };
      await this.gcOrphans(items, result.meta);
      return result.text;
    }
    if (result.state === 'mismatch') {
      // A stale client overwrote v2 before we ever ran. The old head is gone;
      // the recoverable document is new-head + surviving tail. Republish it
      // so the fleet converges on a coherent state.
      const tail = this.assembleTail(items, result.meta);
      const text = result.headText + tail;
      this.rev = result.meta.rev + 1;
      const payload = packDocument(text, this.rev, this.writerId);
      await this.options.storage.sync.set(payload);
      this.known = { ...payload };
      this.options.onStatus({ kind: 'republished' });
      return text;
    }
    // Incoherent: show the best text we have (newest backup, else stripped
    // head) and block sync writes until coherence arrives.
    this.blocked = true;
    this.known = { ...items };
    this.options.onStatus({ kind: 'sync-incomplete' });
    const backup = await this.readNewestBackup();
    if (backup != null) return backup;
    const head = items[HEAD_KEY];
    return typeof head === 'string' ? head : '';
  }

  async write(text: string): Promise<boolean> {
    if (this.blocked) {
      this.options.onStatus({ kind: 'sync-incomplete' });
      return false;
    }
    this.rev += 1;
    let payload: SyncPayload;
    try {
      payload = packDocument(text, this.rev, this.writerId);
    } catch (e: unknown) {
      this.rev -= 1;
      if (e instanceof DocumentTooLargeError) {
        this.options.onStatus({ kind: 'too-large', message: e.message });
        return false;
      }
      throw e;
    }
    try {
      await this.options.storage.sync.set(payload);
    } catch (e: unknown) {
      this.rev -= 1;
      this.options.onStatus({ kind: 'sync-error', message: this.describeError(e) });
      return false;
    }
    this.known = { ...this.known, ...payload };
    this.options.onStatus({ kind: 'synced' });
    return true;
  }

  // Task 5 replaces these stubs.
  handleChanges(_changes: Changes, _areaName: string): void {}
  noteLocalEdit(): void {}

  async backupNow(text: string): Promise<void> {
    const local = this.options.storage.local;
    if (!local) return;
    const existing = await local.get(BACKUP_KEYS);
    let target = BACKUP_KEYS[0];
    let oldest = Number.POSITIVE_INFINITY;
    for (const key of BACKUP_KEYS) {
      const slot = existing[key] as { at?: number } | undefined;
      const at = slot?.at ?? -1;
      if (at < oldest) {
        oldest = at;
        target = key;
      }
    }
    await local.set({ [target]: { text, at: Date.now(), rev: this.rev } });
  }

  async readNewestBackup(): Promise<string | null> {
    const local = this.options.storage.local;
    if (!local) return null;
    const existing = await local.get(BACKUP_KEYS);
    let best: { text: string; at: number } | null = null;
    for (const key of BACKUP_KEYS) {
      const slot = existing[key] as { text?: string; at?: number } | undefined;
      if (typeof slot?.text === 'string' && (best === null || (slot.at ?? 0) > best.at)) {
        best = { text: slot.text, at: slot.at ?? 0 };
      }
    }
    return best?.text ?? null;
  }

  private async loadWriterId(): Promise<string> {
    const local = this.options.storage.local;
    if (!local) return `ephemeral-${Math.random().toString(36).slice(2)}`;
    const items = await local.get(WRITER_ID_KEY);
    const existing = items[WRITER_ID_KEY];
    if (typeof existing === 'string' && existing.length > 0) return existing;
    const fresh =
      globalThis.crypto?.randomUUID?.() ?? `w-${Math.random().toString(36).slice(2)}`;
    await local.set({ [WRITER_ID_KEY]: fresh });
    return fresh;
  }

  private assembleTail(items: Record<string, unknown>, meta: SyncMeta): string {
    const pieces: string[] = [];
    for (let i = 0; i < meta.chunks; i++) {
      const raw = items[`${CHUNK_KEY_PREFIX}${i}`];
      if (typeof raw !== 'string') return '';
      const sep = raw.indexOf('\u0000');
      if (sep === -1) return '';
      pieces.push(raw.slice(sep + 1));
    }
    return pieces.join('');
  }

  private async gcOrphans(items: Record<string, unknown>, meta: SyncMeta): Promise<void> {
    const orphans = Object.keys(items).filter((key) => {
      if (!key.startsWith(CHUNK_KEY_PREFIX)) return false;
      const index = Number(key.slice(CHUNK_KEY_PREFIX.length));
      return Number.isInteger(index) && index >= meta.chunks;
    });
    if (orphans.length > 0) {
      await this.options.storage.sync.remove(orphans);
      for (const key of orphans) delete this.known[key];
    }
  }

  private describeError(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}

export type { Changes, DocumentOrigin, StorageLike, SyncStatus, SyncStoreOptions };
export { SyncStore, DOC_KEY_PATTERN, WRITER_ID_KEY, BACKUP_KEYS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/sync_store.spec.ts` — Expected: PASS. Also run `pnpm type:check`.

- [ ] **Step 5: Commit**

```bash
git add src/sync_store.ts src/sync_store.spec.ts
git commit --signoff -m "feat(sync): add SyncStore startup, migrations, write path, backup ring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `SyncStore` — remote changes, settling, conflict protection

**Files:**
- Modify: `src/sync_store.ts` (replace the `handleChanges`/`noteLocalEdit` stubs)
- Test: `src/sync_store.spec.ts`

**Interfaces:**
- Consumes/Produces: unchanged from Task 4 (behavioral completion).

- [ ] **Step 1: Write the failing tests**

Append to `src/sync_store.spec.ts` (uses the Task 4 `harness`):

```typescript
describe('SyncStore remote changes', () => {
  beforeEach(() => vi.useFakeTimers());

  const twoDevices = async () => {
    const world = new FakeSyncWorld();
    const a = harness(world);
    const b = harness(world);
    await a.store.start();
    await b.store.start();
    return { world, a, b };
  };

  it('applies a coherent remote write after the settle window', async () => {
    const { world, a, b } = await twoDevices();
    a.setText('from device A');
    await a.store.write('from device A');
    world.deliver(b.device);
    expect(b.docs.filter(([, o]) => o === 'remote')).toHaveLength(0); // not yet settled
    await vi.advanceTimersByTimeAsync(300);
    expect(b.docs.at(-1)).toEqual(['from device A', 'remote']);
  });

  it('never applies a torn delivery, then applies once completed', async () => {
    const { world, a, b } = await twoDevices();
    const big = 'a'.repeat(20000);
    a.setText(big);
    await a.store.write(big);
    world.deliver(b.device, ['v2', 'v2m']); // chunks missing
    await vi.advanceTimersByTimeAsync(300);
    expect(b.docs.filter(([, o]) => o === 'remote')).toHaveLength(0);
    world.deliver(b.device); // chunks arrive
    await vi.advanceTimersByTimeAsync(300);
    expect(b.docs.at(-1)?.[0]).toBe(big);
  });

  it('blocks writes and reports sync-incomplete when torn state persists', async () => {
    const { world, a, b } = await twoDevices();
    const big = 'c'.repeat(20000);
    a.setText(big);
    await a.store.write(big);
    world.deliver(b.device, ['v2m']); // meta only, chunks never arrive
    await vi.advanceTimersByTimeAsync(300); // settle: incoherent
    await vi.advanceTimersByTimeAsync(5000); // retry re-read: still incoherent
    expect(b.statuses.at(-1)?.kind).toBe('sync-incomplete');
    expect(await b.store.write('typed while torn')).toBe(false);
    world.deliver(b.device); // remaining chunks arrive -> coherent again
    await vi.advanceTimersByTimeAsync(300);
    expect(await b.store.write('typed after recovery')).toBe(true);
  });

  it('ignores its own write echo', async () => {
    const h = harness();
    await h.store.start();
    h.setText('self');
    await h.store.write('self'); // fake fires local onChanged synchronously
    await vi.advanceTimersByTimeAsync(300);
    expect(h.docs.filter(([, o]) => o === 'remote')).toHaveLength(0);
  });

  it('keeps local text while dirty', async () => {
    const { world, a, b } = await twoDevices();
    b.setDirty(true);
    a.setText('remote update');
    await a.store.write('remote update');
    world.deliver(b.device);
    await vi.advanceTimersByTimeAsync(300);
    expect(b.docs.filter(([, o]) => o === 'remote')).toHaveLength(0);
  });

  it('protects the tail from a stale-client head overwrite', async () => {
    const { world, a, b } = await twoDevices();
    const big = 'd'.repeat(20000);
    a.setText(big);
    await a.store.write(big);
    world.deliver(b.device);
    await vi.advanceTimersByTimeAsync(300);
    expect(b.docs.at(-1)?.[0]).toBe(big);
    // Simulate a pre-upgrade client: writes v2 alone, no rev bump.
    const stale = world.createDevice();
    await stale.sync.set({ v2: 'stale head edit' });
    world.deliver(b.device);
    await vi.advanceTimersByTimeAsync(300);
    // B re-published the full doc instead of adopting the truncation.
    const items = await b.device.sync.get(null);
    const meta = items.v2m as { rev: number };
    expect(meta.rev).toBeGreaterThan(2);
    expect(b.statuses.some((s) => s.kind === 'republished')).toBe(true);
    expect(b.docs.at(-1)?.[0]).toBe(big); // document unchanged locally
    // and a backup of the pre-conflict doc exists
    expect(await b.store.readNewestBackup()).toBe(big);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/sync_store.spec.ts` — Expected: the new describe block FAILS (stubs do nothing).

- [ ] **Step 3: Implement**

Replace the two stubs in `src/sync_store.ts`:

```typescript
  handleChanges(changes: Changes, areaName: string): void {
    if (areaName !== 'sync') return;
    let touched = false;
    for (const [key, change] of Object.entries(changes)) {
      if (!DOC_KEY_PATTERN.test(key)) continue;
      touched = true;
      if ('newValue' in change && change.newValue !== undefined) {
        this.overlay.set(key, change.newValue);
      } else {
        this.overlay.set(key, undefined); // deletion
      }
    }
    if (!touched) return;
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      void this.settle();
    }, this.options.settleMs);
  }

  noteLocalEdit(): void {
    this.overlay.clear();
    clearTimeout(this.settleTimer);
  }

  private candidateItems(): Record<string, unknown> {
    const candidate: Record<string, unknown> = { ...this.known };
    for (const [key, value] of this.overlay) {
      if (value === undefined) {
        delete candidate[key];
      } else {
        candidate[key] = value;
      }
    }
    return candidate;
  }

  private async settle(): Promise<void> {
    const candidate = this.candidateItems();
    const result = assembleDocument(candidate);
    if (result.state === 'coherent') {
      this.overlay.clear();
      this.known = candidate;
      clearTimeout(this.retryTimer);
      const wasBlocked = this.blocked;
      this.blocked = false;
      const isEcho = result.meta.writerId === this.writerId && result.meta.rev === this.rev;
      if (!isEcho) {
        this.rev = Math.max(this.rev, result.meta.rev);
        if (!this.options.isDirty()) {
          this.options.onDocument(result.text, 'remote');
        }
      }
      if (wasBlocked) {
        this.options.onStatus({ kind: 'synced' });
        this.options.onWritable?.();
      }
      return;
    }
    if (result.state === 'mismatch') {
      // Coherent key-set, failed integrity: a stale (pre-upgrade) client
      // overwrote v2. Protect the tail: back up, then republish our full doc.
      const current = this.options.getText();
      await this.backupNow(current);
      this.overlay.clear();
      this.rev = Math.max(this.rev, result.meta.rev);
      this.blocked = false;
      const written = await this.write(current);
      if (written) this.options.onStatus({ kind: 'republished' });
      return;
    }
    if (result.state === 'legacy') {
      // Meta deleted remotely (should not happen; meta is never deleted).
      // Treat like mismatch: republish over it.
      const current = this.options.getText();
      await this.backupNow(current);
      this.overlay.clear();
      this.blocked = false;
      await this.write(current);
      return;
    }
    // Incoherent: wait for more batches, then re-read once, then block.
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      void this.retryRead();
    }, this.options.incoherentRetryMs);
  }

  private async retryRead(): Promise<void> {
    const items = await this.options.storage.sync.get(null);
    const result = assembleDocument(items);
    if (result.state === 'coherent') {
      this.overlay.clear();
      this.known = { ...items };
      const wasBlocked = this.blocked;
      this.blocked = false;
      this.rev = Math.max(this.rev, result.meta.rev);
      if (!this.options.isDirty()) {
        this.options.onDocument(result.text, 'remote');
      }
      if (wasBlocked) this.options.onWritable?.();
      this.options.onStatus({ kind: 'synced' });
      return;
    }
    this.blocked = true;
    this.options.onStatus({ kind: 'sync-incomplete' });
  }
```

Also update `write()` (Task 4) so a successful write clears `blocked` state interactions cleanly — no change needed if `write` already returns `false` while blocked; verify.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/sync_store.spec.ts` — Expected: PASS. Run the full suite: `pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add src/sync_store.ts src/sync_store.spec.ts
git commit --signoff -m "feat(sync): settle remote batches, block torn writes, protect tail from stale clients

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Fix `CHANGE_DELAY` and rate-guard immediate flushes (independently shippable)

**Files:**
- Modify: `src/main.ts:20-33` (constants), `src/main.ts:224-228` (immediate update), `src/main.ts:408-421` (Ctrl+S)
- Test: `src/main.spec.ts`

**Interfaces:**
- Produces: `CHANGE_DELAY` = 4,000 ms; `immediateStorageUpdate` rate-limited to one leading-edge call per 1,000 ms with trailing coalesce.

- [ ] **Step 1: Write the failing test**

In `src/main.spec.ts`, locate the throttle test around lines 380-391 (it advances fake timers by the old 2,000 ms window). Add:

```typescript
it('throttles sync writes to at least 4 seconds', async () => {
  const { chromeMock, typeText } = await boot({ v2: 'ab' });
  chromeMock.storage.sync.set.mockClear();
  typeText('c');
  expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1); // leading edge
  typeText('d');
  vi.advanceTimersByTime(3999);
  expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1); // still inside window
  vi.advanceTimersByTime(1);
  expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(2); // trailing edge at 4s
});

it('rate-guards repeated Ctrl+S', async () => {
  const { chromeMock, pressCtrlS } = await boot({ v2: 'ab' });
  chromeMock.storage.sync.set.mockClear();
  pressCtrlS();
  pressCtrlS();
  pressCtrlS(); // key repeat
  expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(2); // one trailing flush
});
```

Adapt `typeText`/`pressCtrlS` to the helpers the spec file actually provides (read the existing tests around lines 189-210 for the established input-simulation pattern; reuse it rather than inventing a new one).

- [ ] **Step 2: Run to verify the new tests fail** (`pnpm test src/main.spec.ts`) and note which existing timing tests fail because they assume 2,000 ms — those get updated in Step 3.

- [ ] **Step 3: Implement**

In `src/main.ts`:

```typescript
const HOUR_IN_MS = 60 * 60 * 1000;
const IMMEDIATE_FLUSH_GUARD_MS = 1000;
```

Replace the `CHANGE_DELAY` initializer (delete `HOUR_IN_SECONDS` and `FOUR_SECONDS_IN_MIL` if now unused):

```typescript
    // One write op per 2s is the sync quota ceiling (1800/hour); run at half
    // that rate so immediate flushes (Ctrl+S, tab switches) have headroom.
    CHANGE_DELAY =
      Math.ceil(HOUR_IN_MS / chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR) * 2, // 4000 ms
```

Replace `immediateStorageUpdate`:

```typescript
  // Leading-edge with trailing coalesce: key-repeat Ctrl+S and rapid tab
  // switches cannot burn the write-op quota.
  const immediateStorageUpdate = throttle(writeToSync, IMMEDIATE_FLUSH_GUARD_MS, {
    trailing: true,
  });
```

(Call sites already call `immediateStorageUpdate()`; they keep working.) Update the existing 2,000 ms-based timing tests to 4,000 ms.

- [ ] **Step 4: Run tests** — `pnpm test` all green; `pnpm type:check`; `pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/main.spec.ts
git commit --signoff -m "fix(sync): honor 4s write throttle and rate-guard immediate flushes

CHANGE_DELAY's formula produced 2000ms, saturating Chrome's 1800/hour
write-op quota; Ctrl+S key-repeat and tab switches wrote unthrottled.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Editor — line-diff `value` setter and caret-preserving remote apply (independently shippable)

**Files:**
- Modify: `src/editor.ts:50-57` (value setter), add `applyExternal` method
- Test: `src/editor.spec.ts`

**Interfaces:**
- Produces: `MarkdownEditor.applyExternal(text: string): void` — replaces content, patches only changed lines, preserves caret position (clamped). `set value` unchanged in behavior for callers but now patches instead of full rebuild when possible.

- [ ] **Step 1: Write the failing tests**

Append to `src/editor.spec.ts` (reuse the file's existing setup helpers for constructing an editor with a container):

```typescript
describe('applyExternal', () => {
  it('patches only changed lines instead of rebuilding all', () => {
    const { editor, container } = buildEditor('alpha\nbravo\ncharlie');
    const untouched = container.children[0];
    editor.applyExternal('alpha\nBRAVO\ncharlie');
    expect(container.children[0]).toBe(untouched); // same node: not rebuilt
    expect(editor.value).toBe('alpha\nBRAVO\ncharlie');
  });

  it('handles line insertion and removal', () => {
    const { editor } = buildEditor('one\ntwo');
    editor.applyExternal('one\nmid\ntwo');
    expect(editor.value).toBe('one\nmid\ntwo');
    editor.applyExternal('one');
    expect(editor.value).toBe('one');
  });

  it('preserves the absolute caret offset across an external apply', () => {
    const { editor } = buildEditor('first\nsecond');
    editor.setSelectionRange(8); // line 'second', offset 2
    editor.applyExternal('CHANGED\nsecond');
    expect(editor.selectionStart).toBe(8); // same absolute offset, remapped
  });

  it('clamps the caret when the document shrinks', () => {
    const { editor } = buildEditor('long line here');
    editor.setSelectionRange(14);
    editor.applyExternal('ab');
    expect(editor.selectionStart).toBeLessThanOrEqual(2);
  });
});
```

Match `buildEditor` to the spec file's existing construction helper; if none exists, follow the pattern the first `describe` block in `editor.spec.ts` uses.

- [ ] **Step 2: Run to verify failure** — `pnpm test src/editor.spec.ts`: FAIL, `applyExternal` is not a function.

- [ ] **Step 3: Implement**

In `src/editor.ts`, replace the `value` setter and add the patch logic:

```typescript
  set value(text: string) {
    const next = text.split('\n');
    const previous = this.lines;
    this.lines = next;
    if (this.active >= this.lines.length) {
      this.active = this.lines.length - 1;
    }
    this.caretOffset = Math.min(this.caretOffset, this.lines[this.active].length);
    this.patchFrom(previous);
  }

  // External replacement (remote sync apply): patch lines and keep the caret
  // at the same absolute offset, clamped to the new document.
  applyExternal(text: string): void {
    const absolute = this.selectionStart;
    this.value = text;
    this.setSelectionRange(Math.min(absolute, text.length));
  }

  // Minimal DOM update: trim common prefix/suffix, splice the middle, then
  // rebuild any line whose fence state or role changed (fences ripple).
  private patchFrom(previous: string[]): void {
    if (this.container.children.length !== previous.length) {
      this.renderAll();
      return;
    }
    const next = this.lines;
    let prefix = 0;
    while (
      prefix < previous.length &&
      prefix < next.length &&
      previous[prefix] === next[prefix]
    ) {
      prefix++;
    }
    if (prefix === previous.length && previous.length === next.length) {
      return; // identical
    }
    let suffix = 0;
    while (
      suffix < previous.length - prefix &&
      suffix < next.length - prefix &&
      previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix++;
    }
    const fences = computeFenceStates(next);
    const roles = this.fenceRoles();
    // Remove replaced nodes, insert fresh ones.
    for (let i = previous.length - suffix - 1; i >= prefix; i--) {
      this.container.children[i]?.remove();
    }
    const anchor = this.container.children[prefix] ?? null;
    for (let i = prefix; i < next.length - suffix; i++) {
      this.container.insertBefore(this.buildLine(i, fences[i], roles[i]), anchor);
    }
    // Reindex + refresh lines whose fence context changed.
    const previousFences = computeFenceStates(previous);
    for (let i = 0; i < next.length; i++) {
      const el = this.container.children[i] as HTMLElement | undefined;
      if (!el) continue;
      el.dataset.index = String(i);
      const inSplice = i >= prefix && i < next.length - suffix;
      if (!inSplice && (fences[i] !== previousFences[i] || i === this.active)) {
        this.container.replaceChild(this.buildLine(i, fences[i], roles[i]), el);
      }
    }
  }
```

Note: `renderAll()` remains the fallback whenever DOM child count and line count disagree. The active line is always rebuilt so its contenteditable state stays consistent.

- [ ] **Step 4: Run tests** — `pnpm test` (the full editor suite must stay green — regressions here break typing).

- [ ] **Step 5: Commit**

```bash
git add src/editor.ts src/editor.spec.ts
git commit --signoff -m "perf(editor): patch changed lines on external value updates, preserve caret

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Banner UI (HTML + CSS + helper)

**Files:**
- Modify: `public/html/index.html` (inside `<body>`, before the status bar element), `public/css/main.css`
- Create: `src/banner.ts`
- Test: `src/banner.spec.ts`

**Interfaces:**
- Produces:

```typescript
interface BannerActions { onRestore?: () => void; }
class Banner {
  constructor(root: HTMLElement, actions?: BannerActions);
  show(message: string, options?: { restore?: boolean }): void;
  hide(): void;
  get visible(): boolean;
}
```

- [ ] **Step 1: Write the failing tests**

```typescript
// src/banner.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Banner } from './banner.js';

const buildRoot = (): HTMLElement => {
  document.body.innerHTML = `
    <div id="banner" hidden>
      <span id="banner-text"></span>
      <button id="banner-restore" hidden>restore backup</button>
      <button id="banner-dismiss" aria-label="dismiss">×</button>
    </div>`;
  return document.getElementById('banner') as HTMLElement;
};

describe('Banner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows a message and stays visible until dismissed', () => {
    const banner = new Banner(buildRoot());
    banner.show('sync incomplete — waiting for other devices');
    expect(banner.visible).toBe(true);
    expect(document.getElementById('banner-text')?.textContent).toContain('sync incomplete');
    (document.getElementById('banner-dismiss') as HTMLButtonElement).click();
    expect(banner.visible).toBe(false);
  });

  it('wires the restore button only when requested', () => {
    const onRestore = vi.fn();
    const banner = new Banner(buildRoot(), { onRestore });
    banner.show('replaced by another device', { restore: true });
    const restore = document.getElementById('banner-restore') as HTMLButtonElement;
    expect(restore.hidden).toBe(false);
    restore.click();
    expect(onRestore).toHaveBeenCalledTimes(1);
    banner.show('plain message');
    expect(restore.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/banner.ts  (include the standard project copyright header)
interface BannerActions {
  onRestore?: () => void;
}

// Persistent, dismissible message strip for data events (conflict republish,
// sync incomplete, document too large). Cosmetic feedback stays on the
// status-bar flash; anything about the user's data goes through here.
class Banner {
  private readonly root: HTMLElement;
  private readonly textEl: HTMLElement | null;
  private readonly restoreEl: HTMLButtonElement | null;

  constructor(root: HTMLElement, actions: BannerActions = {}) {
    this.root = root;
    this.textEl = root.querySelector('#banner-text');
    this.restoreEl = root.querySelector('#banner-restore');
    root.querySelector('#banner-dismiss')?.addEventListener('click', () => {
      this.hide();
    });
    this.restoreEl?.addEventListener('click', () => {
      actions.onRestore?.();
      this.hide();
    });
  }

  show(message: string, options: { restore?: boolean } = {}): void {
    if (this.textEl) {
      this.textEl.textContent = message;
    }
    if (this.restoreEl) {
      this.restoreEl.hidden = options.restore !== true;
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}

export type { BannerActions };
export { Banner };
```

`public/html/index.html` — add directly after the `<body>` open tag (match the file's indentation):

```html
    <div id="banner" role="alert" hidden>
      <span id="banner-text"></span>
      <button id="banner-restore" type="button" hidden>restore backup</button>
      <button id="banner-dismiss" type="button" aria-label="dismiss">×</button>
    </div>
```

`public/css/main.css` — append, using the file's existing custom properties (inspect the top of the file for the variable names; use the same accent/danger tokens the near-limit warning uses):

```css
#banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  background: var(--surface-raised, #2a2a2a);
  border-bottom: 1px solid var(--accent, #888);
}
#banner[hidden] {
  display: none;
}
#banner button {
  cursor: pointer;
}
```

- [ ] **Step 4: Run tests** — `pnpm test src/banner.spec.ts`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/banner.ts src/banner.spec.ts public/html/index.html public/css/main.css
git commit --signoff -m "feat(ui): add persistent dismissible banner for data events

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `main.ts` integration

**Files:**
- Modify: `src/main.ts` (storage constants ~20-28, `writeToSync` ~200-220, initial load ~374-404, `onChanged` listener ~532-545, quota UI ~92-115)
- Test: `src/main.spec.ts`

**Interfaces:**
- Consumes: `SyncStore` (Task 4/5), `Banner` (Task 8), `MarkdownEditor.applyExternal` (Task 7), `SYNC_QUOTA_BYTES` (Task 1).

- [ ] **Step 1: Update the chrome mock, then write the failing tests**

In `src/main.spec.ts` `buildChrome` (lines ~65-95): add to the sync mock `QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_WRITE_OPERATIONS_PER_MINUTE: 120`; add `remove: vi.fn(() => Promise.resolve())` to the local mock. **Better:** where a test needs storage behavior (not just call assertions), swap `buildChrome` for a `FakeSyncWorld` device wrapped with `vi.spyOn` — the fake is now the preferred harness. Keep `buildChrome` for pure UI tests.

New tests:

```typescript
it('boots a legacy v2 user unchanged and publishes meta', async () => {
  const { chromeMock, editorValue } = await bootWithFake({ v2: 'my old wall' });
  expect(editorValue()).toBe('my old wall');
  const items = await chromeMock.storage.sync.get(null);
  expect(items.v2m).toMatchObject({ chunks: 0 });
});

it('shows the quota meter against 102,400 bytes', async () => {
  const { getQuotaPct } = await bootWithFake({ v2: 'x'.repeat(5000) });
  // ~5KB of ~100KB is ~5%, not the old ~61% of 8192
  expect(getQuotaPct()).toBeLessThanOrEqual(6);
});

it('applies a coherent remote change through applyExternal', async () => {
  const { world, reader, editorValue } = await bootTwoDeviceFake();
  await writerWrites(world, 'from elsewhere');
  world.deliver(reader);
  await vi.advanceTimersByTimeAsync(300);
  expect(editorValue()).toBe('from elsewhere');
});

it('surfaces too-large through the banner, not the flash', async () => {
  const { typeHugeText, bannerText } = await bootWithFake({});
  typeHugeText(120000);
  await vi.advanceTimersByTimeAsync(4000);
  expect(bannerText()).toMatch(/too large/i);
});
```

Write the `bootWithFake`/`bootTwoDeviceFake` helpers in the spec file: construct a `FakeSyncWorld`, create a device, assign it as the `chrome.storage` in the existing `boot` scaffolding (follow how `boot` currently injects `chromeMock`), and return accessors that read the DOM (`#quota-pct`, `#banner-text`) the way existing tests do.

- [ ] **Step 2: Run to verify the new tests fail.**

- [ ] **Step 3: Implement the integration**

In `src/main.ts`:

1. Imports: `import { Banner } from './banner.js';`, `import { SyncStore } from './sync_store.js';`, `import { SYNC_QUOTA_BYTES } from './sync_format.js';`
2. Constants: delete `QUOTA_BYTES = 8192`; add `NEAR_LIMIT_PCT = 80` (replacing 90). Quota UI (`countLabel` bytes mode + `updateQuota`) uses `chrome.storage.sync.QUOTA_BYTES ?? SYNC_QUOTA_BYTES` as the denominator and updates the near-limit copy to `` `approaching sync limit — ${limit - inUse} B left` ``.
3. Construct the store and banner (after the `editor` construction so callbacks can reference it):

```typescript
  const banner = new Banner(document.getElementById('banner') as HTMLElement, {
    onRestore: () => {
      void syncStore.readNewestBackup().then((backup) => {
        if (backup != null) {
          editor.applyExternal(backup);
          dirty = true;
          throttledStorageUpdate();
        }
      });
    },
  });

  const syncStore = new SyncStore({
    storage: chrome.storage,
    onDocument: (text, origin) => {
      editor.applyExternal(text);
      updateUsage();
      updateLastSynced();
      if (origin === 'conflict-republish') {
        banner.show('restored full text over an edit from an outdated device', { restore: true });
      }
    },
    onStatus: (status) => {
      if (status.kind === 'synced') {
        updateUsage();
        updateLastSynced();
        return;
      }
      if (lastSyncedEl) {
        lastSyncedEl.textContent = 'sync failed';
      }
      if (status.kind === 'too-large') {
        banner.show('document too large to sync (~95 KB limit) — trim or export it');
      } else if (status.kind === 'sync-incomplete') {
        banner.show('sync incomplete — waiting for the rest of the document from other devices');
      } else if (status.kind === 'republished') {
        banner.show('protected your text from an outdated device — backup kept', { restore: true });
      } else {
        banner.show(`not synced — ${status.message ?? 'unknown error'}`);
      }
    },
    isDirty: () => dirty,
    getText: () => editor.value,
    onWritable: () => {
      if (dirty) {
        immediateStorageUpdate();
      }
    },
  });
```

4. Replace `writeToSync`'s body: call `syncStore.write(editor.value)`, keeping the `dirty`-clearing compare-and-set on success. Delete the `storageObject` module accumulator entirely (reused-payload footgun) and delete `remoteStoredText` (`main.ts:49`) — `SyncStore` now owns synced state; remove its remaining references in the load and `onChanged` blocks you are replacing.
5. Replace the initial `storage.sync.get([...])` block with `syncStore.start().then((text) => { editor.value = text; ... })` preserving the cursor-restore logic that follows it today (`main.ts:395-402`).
6. Replace the `storage.onChanged` listener body with `syncStore.handleChanges(changes, areaName)`; keep registration guarded (`storage.onChanged?.addListener?.(...)`).
7. In the editor `onInput` callback, add `syncStore.noteLocalEdit();` before `throttledStorageUpdate()`.
8. Mirror scheduling: add alongside `throttledStorageUpdate`:

```typescript
  const throttledBackup = throttle(
    () => {
      void syncStore.backupNow(editor.value);
    },
    20000,
    { trailing: true },
  );
```

Call `throttledBackup()` inside `onInput`, and add `void syncStore.backupNow(editor.value)` to `flushIfDirty` so `pagehide` snapshots the text.

- [ ] **Step 4: Run everything** — `pnpm test`, `pnpm type:check`, `pnpm lint`. Existing tests asserting `set({ v2: 'abc' })` shapes now expect `set({ v2: 'abc', v2m: expect.objectContaining({ chunks: 0 }) })` — update them with `expect.objectContaining` rather than exact equality.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm develop`, load `dist/` as an unpacked extension (chrome://extensions → Load unpacked). Verify: existing text appears; typing syncs (badge in status bar updates); paste ~20 KB of text and confirm the byte counter passes 8,192 without a sync failure; reload the extension page and confirm the full text returns.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/main.spec.ts
git commit --signoff -m "feat(sync): integrate sharded SyncStore, 100KB quota UI, and data banner

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Word-count debounce

**Files:**
- Modify: `src/main.ts` (`countLabel` call in `onInput`, ~line 232-240)
- Test: `src/main.spec.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

```typescript
it('debounces the word count during rapid typing', async () => {
  const { typeText, statusText } = await bootWithFake({ v2: '' });
  typeText('a');
  typeText('b');
  typeText('c');
  await vi.advanceTimersByTimeAsync(250);
  expect(statusText()).toBe('1 words');
});
```

- [ ] **Step 2: Verify it fails** (statusText updates synchronously today — the assertion on intermediate state differs; if it happens to pass, assert instead that `countWords` is not invoked per keystroke by spying on the throttled wrapper's inner calls via a counter).

- [ ] **Step 3: Implement** — in `main.ts`, wrap the input-path count update:

```typescript
  const debouncedCountLabel = throttle(countLabel, 250, { trailing: true });
```

and in `onInput` replace `if (countMode !== 'bytes') { countLabel(); }` with `if (countMode !== 'bytes') { debouncedCountLabel(); }`. Direct calls elsewhere (mode toggle, load) keep the immediate `countLabel()`.

- [ ] **Step 4: Run tests** — full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/main.spec.ts
git commit --signoff -m "perf(ui): debounce word count during typing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Documentation corrections

**Files:**
- Modify: `AGENTS.md`, `CLAUDE.md`, `docs/KNOWLEDGE_BASE.md`

- [ ] **Step 1: Apply the corrections**

- `CLAUDE.md` Architecture Quick Reference: replace the `v2`/8,192 lines with:
  - `Sync storage keys: head 'v2', chunks 'v2x_0..12', meta 'v2m' (102,400 byte total quota, 8,192 per item)`
  - `Local storage keys: 'cursor', 'theme', 'settings', 'countMode', 'writerId', backup ring 'backup_0..2'`
  - `Throttle: leading-edge + trailing, 4 second delay (half the sync write-op quota rate)`
- `AGENTS.md` Project Overview + Common Pitfalls: document ceiling is ~95 KB; per-item quota 8,192 B still applies per chunk; sync logic lives in `src/sync_format.ts` + `src/sync_store.ts`; "Where to Add Code" table gains a `Sync format / conflict logic | src/sync_store.ts, src/sync_format.ts` row.
- `docs/KNOWLEDGE_BASE.md`: add a pointer to the spec `docs/superpowers/specs/2026-08-01-sharded-sync-storage-design.md`.
- Verify no other doc repeats the old "8,192 byte total" claim: `grep -rn "8,192\|8192" AGENTS.md CLAUDE.md docs/ --include="*.md"` and fix hits that describe the *total* limit (per-item mentions stay).

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md CLAUDE.md docs/KNOWLEDGE_BASE.md
git commit --signoff -m "docs: update storage architecture for sharded sync format

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Full verification pass

- [ ] **Step 1:** `pnpm test` — entire suite green.
- [ ] **Step 2:** `pnpm type:check` — clean.
- [ ] **Step 3:** `pnpm lint` — clean (`pnpm lint:fix` first if needed).
- [ ] **Step 4:** `pnpm build` — builds `dist/` + `app.zip` without error.
- [ ] **Step 5:** Manual two-profile test: load the built extension in two Chrome profiles signed into the same account (or one profile + reload cycles), paste >8 KB, verify both sides converge. Verify the truncation marker never appears in the editor itself.
- [ ] **Step 6:** Confirm `package.json` and `public/manifest.json` versions still match (`pnpm verify-version`). Do NOT bump the version — release is the owner's call.
- [ ] **Step 7:** Push the branch. Do not open a PR unless the user asks (workflow policy).

---

## Self-review notes (already applied)

- Type consistency: `SyncStore` callbacks (`onDocument`, `onStatus`, `isDirty`, `getText`, `onWritable`) are used with identical signatures in Tasks 4, 5, and 9. `applyExternal` (Task 7) is what Task 9's `onDocument` calls. `SYNC_QUOTA_BYTES` (Task 1) feeds Task 9's meter fallback.
- Spec coverage: format/meta permanence (T2/T4), Chromium metering (T1), single-set hot path + startup-only GC (T4/T5), settle/incoherence/block (T5), stale-client protection + backup ring (T4/T5/T9), throttle fix + rate guard (T6), editor perf (T7/T10), banner + meter UI (T8/T9), docs (T11), fake harness (T3).
- Known simplification: the fake's object metering approximates `base::WriteJson` for non-string values (meta only, ~100 B, exotic-char-free) — exactness matters only for chunk strings, which use the real formula.
