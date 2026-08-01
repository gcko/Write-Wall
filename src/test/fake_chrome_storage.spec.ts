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
    await expect(device.sync.set({ v2: 'x'.repeat(8300) })).rejects.toThrow(/QUOTA_BYTES_PER_ITEM/);
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
    await expect(device.sync.set({ v2: 'over' })).rejects.toThrow(/MAX_WRITE_OPERATIONS_PER_HOUR/);
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
