import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assembleDocument, fnv1a, MARKER, packDocument, stripMarker } from './sync_format.js';
import { type SyncStatus, SyncStore } from './sync_store.js';
import { FakeSyncWorld } from './test/fake_chrome_storage.js';

const harness = (world = new FakeSyncWorld(), device = world.createDevice()) => {
  const docs: [string, string][] = [];
  const statuses: SyncStatus[] = [];
  let dirty = false;
  let text = '';
  let writableCalls = 0;
  const store = new SyncStore({
    storage: device,
    onDocument: (t, origin) => {
      text = t;
      docs.push([t, origin]);
    },
    onStatus: (s) => statuses.push(s),
    isDirty: () => dirty,
    getText: () => text,
    onWritable: () => {
      writableCalls += 1;
    },
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
    writableCalls: () => writableCalls,
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

  it('strips the truncation marker from the head fallback when no backup exists', async () => {
    const h = harness();
    const big = 'd'.repeat(20000);
    await h.device.sync.set(packDocument(big, 4, 'other-device'));
    // The head is marker-bearing; a malformed meta makes the doc incoherent.
    await h.device.sync.set({ v2m: { v: 2 } });
    const stored = await h.device.sync.get('v2');
    const rawHead = stored.v2 as string;
    expect(rawHead.endsWith(MARKER)).toBe(true);
    const recovered = await h.store.start();
    expect(h.statuses.at(-1)?.kind).toBe('sync-incomplete');
    expect(recovered).toBe(stripMarker(rawHead));
    expect(recovered.includes(MARKER)).toBe(false);
    expect(recovered).toBe(big.slice(0, recovered.length));
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
    vi.setSystemTime(1000);
    await h.store.backupNow('one'); // -> backup_0
    vi.setSystemTime(2000);
    await h.store.backupNow('two'); // -> backup_1
    await h.device.local.set({ backup_2: { text: 'no timestamp' } });
    vi.setSystemTime(5000);
    await h.store.backupNow('stamped');
    const slots = await h.device.local.get(['backup_0', 'backup_1', 'backup_2']);
    // The slot with no 'at' is the oldest, so it must be the one overwritten.
    expect(slots.backup_2).toMatchObject({ text: 'stamped', at: 5000 });
    expect(slots.backup_0).toMatchObject({ text: 'one', at: 1000 });
    expect(slots.backup_1).toMatchObject({ text: 'two', at: 2000 });
    expect(await h.store.readNewestBackup()).toBe('stamped');
  });

  it('reuses a persisted writerId across store instances', async () => {
    const h = harness();
    await h.store.start();
    const stored = await h.device.local.get('writerId');
    expect(typeof stored.writerId).toBe('string');
    const items = await h.device.sync.get('v2m');
    const meta = items.v2m as { writerId: string };
    // Instance-scoped identity: the persisted per-profile id plus a per-store
    // nonce, so two tabs of one profile never mistake each other for an echo.
    expect(meta.writerId.startsWith(`${stored.writerId as string}:`)).toBe(true);
    expect(meta.writerId.length).toBeGreaterThan((stored.writerId as string).length + 1);
    // ASCII-only: the meta byte accounting in packDocument depends on it.
    expect(stored.writerId as string).toMatch(/^[\x20-\x7e]+$/);
    expect(meta.writerId).toMatch(/^[\x20-\x7e]+$/);
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

  it('applies a recovered document once when the retry read beats a queued settle', async () => {
    const { world, a, b } = await twoDevices();
    const big = 'e'.repeat(20000);
    a.setText(big);
    await a.store.write(big);
    world.deliver(b.device, ['v2m']); // meta only: torn
    await vi.advanceTimersByTimeAsync(300); // settle -> incoherent, retry armed at +5000
    await vi.advanceTimersByTimeAsync(4800); // just short of the retry
    world.deliver(b.device); // storage is coherent now, and a settle is queued
    await vi.advanceTimersByTimeAsync(500); // retry fires first, then the queued settle
    expect(b.docs.filter(([, o]) => o === 'remote')).toHaveLength(1);
  });

  it('disarms the retry read once a settle resolves the torn state', async () => {
    const { world, a, b } = await twoDevices();
    const big = 'f'.repeat(20000);
    a.setText(big);
    await a.store.write(big);
    world.deliver(b.device, ['v2m']); // meta only: torn
    await vi.advanceTimersByTimeAsync(300); // settle -> incoherent, retry armed at +5000
    b.setText('text typed on B');
    const stale = world.createDevice();
    await stale.sync.set({ v2: 'stale head edit' });
    world.deliver(b.device); // stale head + A's chunks -> mismatch, so B republishes
    await vi.advanceTimersByTimeAsync(300);
    const settled = b.docs.length;
    await vi.advanceTimersByTimeAsync(6000); // the superseded retry must not fire
    expect(b.docs.length).toBe(settled);
    expect(b.statuses.filter((s) => s.kind === 'sync-incomplete')).toHaveLength(0);
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

describe('SyncStore conflict routing and settle races', () => {
  beforeEach(() => vi.useFakeTimers());

  const twoDevices = async () => {
    const world = new FakeSyncWorld();
    const a = harness(world);
    const b = harness(world);
    await a.store.start();
    await b.store.start();
    return { world, a, b };
  };

  // b ends up holding `text` at rev 2, coherently, with a settled overlay.
  const seed = async (
    world: FakeSyncWorld,
    a: ReturnType<typeof harness>,
    b: ReturnType<typeof harness>,
    text: string,
  ) => {
    a.setText(text);
    await a.store.write(text);
    world.deliver(b.device);
    await vi.advanceTimersByTimeAsync(300);
  };

  it('resolves a stale-client conflict found by the retry read instead of blocking', async () => {
    const { world, a, b } = await twoDevices();
    const t1 = 'a'.repeat(20000);
    await seed(world, a, b, t1);
    expect(b.docs.at(-1)?.[0]).toBe(t1);

    const t2 = 'b'.repeat(20000);
    a.setText(t2);
    await a.store.write(t2); // rev 3, queued for b
    world.deliver(b.device, ['v2m']); // torn: meta only
    await vi.advanceTimersByTimeAsync(300); // settle -> incoherent, retry armed at +5000
    await vi.advanceTimersByTimeAsync(4800); // t+5100: just short of the retry
    world.deliver(b.device); // the rest of T2 lands: storage is coherent
    const stale = world.createDevice();
    await stale.sync.set({ v2: 'stale head edit' }); // a pre-upgrade client clobbers the head
    world.deliver(b.device, ['v2']); // storage now mismatches
    await vi.advanceTimersByTimeAsync(250); // t+5350: the retry fires, its settle has not

    expect(b.statuses.some((s) => s.kind === 'republished')).toBe(true);
    const items = await b.device.sync.get(null);
    expect((items.v2m as { rev: number }).rev).toBeGreaterThan(3);
    expect(b.statuses.at(-1)?.kind).not.toBe('sync-incomplete');
    expect(await b.store.write('still writable')).toBe(true);
  });

  it('does not swallow a sibling tab document as its own echo', async () => {
    const world = new FakeSyncWorld();
    const device = world.createDevice(); // one profile, one storage area, two tabs
    const tab1 = harness(world, device);
    const tab2 = harness(world, device);
    await tab1.store.start();
    await tab2.store.start();

    tab1.setText('typed in tab one');
    await tab1.store.write('typed in tab one'); // rev 2
    tab2.setText('typed in tab two');
    await tab2.store.write('typed in tab two'); // also rev 2: tab2 has not settled yet
    await vi.advanceTimersByTimeAsync(300);

    expect(tab1.docs.at(-1)).toEqual(['typed in tab two', 'remote']);
    expect(tab2.docs.filter(([, o]) => o === 'remote')).toHaveLength(0); // its own echo
  });

  it('adopts a complete newer document that lands while a republish is prepared', async () => {
    const { world, a, b } = await twoDevices();
    const t1 = 'a'.repeat(20000);
    await seed(world, a, b, t1);

    const stale = world.createDevice();
    await stale.sync.set({ v2: 'stale head edit' });
    world.deliver(b.device); // conflict lands on b; settle armed
    const t2 = 'b'.repeat(20000);
    a.setText(t2);
    await a.store.write(t2); // rev 3, complete, queued for b
    // Deliver T2 while b sits inside backupNow's local.get, i.e. mid-republish.
    const realLocalGet = b.device.local.get.bind(b.device.local);
    vi.spyOn(b.device.local, 'get').mockImplementationOnce((keys: string | string[] | null) => {
      world.deliver(b.device);
      return realLocalGet(keys);
    });
    await vi.advanceTimersByTimeAsync(300);

    expect(b.statuses.some((s) => s.kind === 'republished')).toBe(false);
    expect(b.docs.at(-1)?.[0]).toBe(t2);
    const items = await b.device.sync.get(null);
    expect(assembleDocument(items)).toMatchObject({ state: 'coherent', text: t2 });
    expect(await b.store.readNewestBackup()).toBe(t1); // T1 was still backed up
  });

  it('keeps a batch delivered while the retry read is in flight', async () => {
    const { world, a, b } = await twoDevices();
    const t1 = 'a'.repeat(20000);
    await seed(world, a, b, t1);

    const t2 = 'b'.repeat(20000);
    a.setText(t2);
    await a.store.write(t2); // rev 3
    world.deliver(b.device, ['v2m']); // torn
    await vi.advanceTimersByTimeAsync(300); // settle -> incoherent, retry armed at +5000
    await vi.advanceTimersByTimeAsync(4800); // t+5100
    world.deliver(b.device); // T2 completes in storage
    const t3 = 'c'.repeat(20000);
    a.setText(t3);
    await a.store.write(t3); // rev 4, queued for b
    // The retry read takes its snapshot, then T3's head+meta land mid-flight.
    const realGet = b.device.sync.get.bind(b.device.sync);
    vi.spyOn(b.device.sync, 'get').mockImplementationOnce((keys: string | string[] | null) => {
      const snapshot = realGet(keys);
      world.deliver(b.device, ['v2', 'v2m']);
      return snapshot;
    });
    await vi.advanceTimersByTimeAsync(250); // t+5350: the retry adopts T2
    world.deliver(b.device); // T3's chunks complete it
    await vi.advanceTimersByTimeAsync(300);

    expect(b.docs.at(-1)?.[0]).toBe(t3);
    expect(b.statuses.some((s) => s.kind === 'republished')).toBe(false);
  });

  it('signals writable again through the settle path after a blocked tear', async () => {
    const { world, a, b } = await twoDevices();
    const big = 'a'.repeat(20000);
    a.setText(big);
    await a.store.write(big);
    world.deliver(b.device, ['v2m']);
    await vi.advanceTimersByTimeAsync(5300); // settle -> incoherent, retry -> blocked
    expect(b.writableCalls()).toBe(0);
    expect(b.statuses.at(-1)?.kind).toBe('sync-incomplete');

    world.deliver(b.device);
    await vi.advanceTimersByTimeAsync(300); // settle -> coherent
    expect(b.writableCalls()).toBe(1);
    expect(b.statuses.at(-1)?.kind).toBe('synced');
  });

  it('signals writable again through the retry-read path after a blocked tear', async () => {
    const { world, a, b } = await twoDevices();
    const big = 'a'.repeat(20000);
    a.setText(big);
    await a.store.write(big);
    world.deliver(b.device, ['v2m']);
    await vi.advanceTimersByTimeAsync(5300); // blocked
    expect(b.writableCalls()).toBe(0);

    world.deliver(b.device, ['v2']); // still torn: chunks missing
    await vi.advanceTimersByTimeAsync(300); // settle -> incoherent, retry armed at +5000
    await vi.advanceTimersByTimeAsync(4900); // just short of that retry
    world.deliver(b.device); // chunks land in storage
    await vi.advanceTimersByTimeAsync(150); // the retry fires first and unblocks

    expect(b.writableCalls()).toBe(1);
    expect(b.statuses.at(-1)?.kind).toBe('synced');
  });
});
