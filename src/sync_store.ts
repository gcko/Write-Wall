/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import {
  assembleDocument,
  CHUNK_KEY_PREFIX,
  DocumentTooLargeError,
  HEAD_KEY,
  LEGACY_KEY,
  packDocument,
  type SyncMeta,
  type SyncPayload,
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
  private rev = 0;
  private writerId = '';
  private blocked = false;

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

  // Task 5 replaces these stubs with real remote-change handling.
  handleChanges(_changes: Changes, _areaName: string): void {
    // no-op until Task 5
  }

  noteLocalEdit(): void {
    // no-op until Task 5
  }

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

  // Must stay ASCII-safe: packDocument's meta byte accounting assumes the
  // writerId contains no characters Chromium's WriteJson escapes differently
  // from JSON.stringify. Both sources below emit ASCII only.
  private async loadWriterId(): Promise<string> {
    const local = this.options.storage.local;
    if (!local) return `ephemeral-${Math.random().toString(36).slice(2)}`;
    const items = await local.get(WRITER_ID_KEY);
    const existing = items[WRITER_ID_KEY];
    if (typeof existing === 'string' && existing.length > 0) return existing;
    const fresh = globalThis.crypto?.randomUUID?.() ?? `w-${Math.random().toString(36).slice(2)}`;
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
export { BACKUP_KEYS, DOC_KEY_PATTERN, SyncStore, WRITER_ID_KEY };
