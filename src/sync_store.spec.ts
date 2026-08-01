import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assembleDocument, fnv1a, packDocument } from './sync_format.js';
import { type SyncStatus, SyncStore } from './sync_store.js';
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
    world,
    device,
    store,
    docs,
    statuses,
    setDirty: (d: boolean) => {
      dirty = d;
    },
    setText: (t: string) => {
      text = t;
    },
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

describe('SyncStore.start recovery paths', () => {
  beforeEach(() => vi.useFakeTimers());

  it('republishes head + surviving tail when a stale client clobbered the head', async () => {
    const h = harness();
    const big = 'c'.repeat(20000);
    await h.device.sync.set(packDocument(big, 5, 'other-device'));
    // A stale client overwrote the head only; the tail chunks still carry rev 5.
    await h.device.sync.set({ v2: 'stale head' });
    const recovered = await h.store.start();
    expect(recovered.startsWith('stale head')).toBe(true);
    expect(recovered.length).toBeGreaterThan('stale head'.length);
    expect(h.statuses.at(-1)?.kind).toBe('republished');
    const items = await h.device.sync.get(null);
    expect(items.v2m).toMatchObject({ rev: 6, len: recovered.length, hash: fnv1a(recovered) });
    expect(assembleDocument(items)).toMatchObject({ state: 'coherent', text: recovered });
  });

  it('blocks writes and reports sync-incomplete when meta is malformed', async () => {
    const h = harness();
    await h.device.sync.set({ v2: 'partial head', v2m: { v: 2 } });
    expect(await h.store.start()).toBe('partial head');
    expect(h.statuses.at(-1)?.kind).toBe('sync-incomplete');
    expect(await h.store.write('anything')).toBe(false);
    expect(h.statuses.at(-1)?.kind).toBe('sync-incomplete');
  });

  it('prefers the newest local backup over a torn head', async () => {
    const h = harness();
    await h.device.local.set({
      backup_0: { text: 'older backup', at: 100 },
      backup_1: { text: 'newest backup', at: 900 },
    });
    await h.device.sync.set({ v2: 'partial head', v2m: { v: 1, rev: 'nope' } });
    expect(await h.store.start()).toBe('newest backup');
    expect(h.statuses.at(-1)?.kind).toBe('sync-incomplete');
  });

  it('falls back to empty text when incoherent storage has no usable head', async () => {
    const h = harness();
    await h.device.sync.set({ v2m: { v: 1, rev: 3, writerId: 'w', chunks: 1, len: 5, hash: 1 } });
    expect(await h.store.start()).toBe('');
    expect(h.statuses.at(-1)?.kind).toBe('sync-incomplete');
  });
});

describe('SyncStore backups and writerId', () => {
  beforeEach(() => vi.useFakeTimers());

  it('rotates the backup ring oldest-first and reads back the newest', async () => {
    const h = harness();
    await h.store.start();
    vi.setSystemTime(1000);
    await h.store.backupNow('one');
    vi.setSystemTime(2000);
    await h.store.backupNow('two');
    vi.setSystemTime(3000);
    await h.store.backupNow('three');
    const slots = await h.device.local.get(['backup_0', 'backup_1', 'backup_2']);
    expect(slots.backup_0).toMatchObject({ text: 'one', at: 1000 });
    expect(slots.backup_1).toMatchObject({ text: 'two', at: 2000 });
    expect(slots.backup_2).toMatchObject({ text: 'three', at: 3000 });
    expect(await h.store.readNewestBackup()).toBe('three');
    vi.setSystemTime(4000);
    await h.store.backupNow('four');
    const rotated = await h.device.local.get('backup_0');
    expect(rotated.backup_0).toMatchObject({ text: 'four', at: 4000 });
    expect(await h.store.readNewestBackup()).toBe('four');
  });

  it('treats a timestamp-less backup slot as oldest', async () => {
    const h = harness();
    await h.store.start();
    await h.device.local.set({ backup_2: { text: 'no timestamp' } });
    vi.setSystemTime(5000);
    await h.store.backupNow('stamped');
    expect(await h.store.readNewestBackup()).toBe('stamped');
  });

  it('reuses a persisted writerId across store instances', async () => {
    const h = harness();
    await h.store.start();
    const stored = await h.device.local.get('writerId');
    expect(typeof stored.writerId).toBe('string');
    const items = await h.device.sync.get('v2m');
    expect(items.v2m).toMatchObject({ writerId: stored.writerId });
    // ASCII-only: the meta byte accounting in packDocument depends on it.
    expect(stored.writerId as string).toMatch(/^[\x20-\x7e]+$/);
  });

  it('works without a local area, using an ephemeral writerId and no backups', async () => {
    const world = new FakeSyncWorld();
    const device = world.createDevice();
    const statuses: SyncStatus[] = [];
    const store = new SyncStore({
      storage: { sync: device.sync },
      onDocument: () => undefined,
      onStatus: (s) => statuses.push(s),
      isDirty: () => false,
      getText: () => '',
    });
    expect(await store.start()).toBe('');
    await expect(store.backupNow('ignored')).resolves.toBeUndefined();
    expect(await store.readNewestBackup()).toBeNull();
    expect(await store.write('no local area')).toBe(true);
    const items = await device.sync.get(null);
    expect(items.v2).toBe('no local area');
    expect(items.v2m).toMatchObject({ rev: 2 });
  });
});

describe('SyncStore.write error propagation', () => {
  beforeEach(() => vi.useFakeTimers());

  it('rethrows unexpected packing errors instead of reporting too-large', async () => {
    vi.resetModules();
    vi.doMock('./sync_format.js', async () => {
      const actual = await vi.importActual<typeof import('./sync_format.js')>('./sync_format.js');
      let calls = 0;
      return {
        ...actual,
        packDocument: (text: string, rev: number, writerId: string) => {
          calls += 1;
          if (calls > 1) throw new TypeError('unexpected packing failure');
          return actual.packDocument(text, rev, writerId);
        },
      };
    });
    const { SyncStore: PatchedStore } = await import('./sync_store.js');
    const device = new FakeSyncWorld().createDevice();
    const statuses: SyncStatus[] = [];
    const store = new PatchedStore({
      storage: device,
      onDocument: () => undefined,
      onStatus: (s) => statuses.push(s),
      isDirty: () => false,
      getText: () => '',
    });
    await store.start(); // first packDocument call succeeds
    await expect(store.write('boom')).rejects.toThrow('unexpected packing failure');
    expect(statuses.some((s) => s.kind === 'too-large')).toBe(false);
    vi.doUnmock('./sync_format.js');
    vi.resetModules();
  });
});
