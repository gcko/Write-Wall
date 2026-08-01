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
    getBytesInUse: (
      _keys: string | string[] | null,
      callback?: (n: number) => void,
    ): Promise<number> => {
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
