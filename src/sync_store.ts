/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License. To view
 * a copy of this license, visit https://creativecommons.org/licenses/by-sa/4.0/
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
  stripMarker,
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

// Stored values are strings (head, chunks) or the plain meta object, both of
// which round-trip through structuredClone, so a JSON compare is exact enough.
// A false 'different' only keeps an overlay entry, which is the safe direction.
const sameStoredValue = (a: unknown, b: unknown): boolean =>
  typeof a === 'string' || typeof b === 'string'
    ? a === b
    : JSON.stringify(a) === JSON.stringify(b);

class SyncStore {
  private readonly options: Required<Pick<SyncStoreOptions, 'settleMs' | 'incoherentRetryMs'>> &
    SyncStoreOptions;
  private known: Record<string, unknown> = {};
  private rev = 0;
  private writerId = '';
  private blocked = false;
  // Keys seen via onChanged since the last settle. A remote update arrives as
  // one or more batches; only the union of `known` and `overlay` is a document
  // candidate. `undefined` records a deletion.
  private readonly overlay = new Map<string, unknown>();
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  // Bumped by every settle/retry entry. A continuation resuming after an await
  // with a stale generation has been superseded and must not touch state.
  private generation = 0;
  // Per-instance suffix for the echo identity. The persisted writerId is
  // per-profile, so two open tabs share it; without this, a sibling tab's write
  // at the same rev looks like our own echo and its document is dropped.
  private readonly instanceNonce = Math.random().toString(36).slice(2, 10);

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
    // Strip the truncation marker: it is a display artefact of sharding, and
    // leaving it in would let continued editing bake it into the document.
    return typeof head === 'string' ? stripMarker(head) : '';
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
    this.settleTimer = undefined;
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
    this.settleTimer = undefined;
    // Any settle outcome supersedes a retry armed by an earlier one; the
    // incoherent branch below re-arms it.
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.generation += 1;
    const generation = this.generation;
    const candidate = this.candidateItems();
    const result = assembleDocument(candidate);
    if (result.state === 'coherent') {
      this.adoptCoherent(candidate, result.text, result.meta);
      return;
    }
    if (result.state === 'mismatch' || result.state === 'legacy') {
      // 'mismatch': coherent key-set, failed integrity - a stale (pre-upgrade)
      // client overwrote v2. 'legacy': meta deleted remotely (should not
      // happen; meta is never deleted). Both are conflicts, not tearing.
      await this.resolveConflict(
        generation,
        result.state === 'mismatch' ? result.meta.rev : this.rev,
      );
      return;
    }
    // Incoherent: wait for more batches, then re-read once, then block.
    this.retryTimer = setTimeout(() => {
      void this.retryRead();
    }, this.options.incoherentRetryMs);
  }

  private async retryRead(): Promise<void> {
    this.retryTimer = undefined;
    this.generation += 1;
    const generation = this.generation;
    const items = await this.options.storage.sync.get(null);
    if (generation !== this.generation) return; // a settle took over mid-read
    const result = assembleDocument(items);
    if (result.state === 'coherent') {
      // Storage already reflects every batch delivered before the read, so the
      // overlay entries it accounts for are redundant - but a batch delivered
      // *during* the read is not in this snapshot and must survive.
      this.rebaseOverlay(items);
      this.known = { ...items };
      const wasBlocked = this.blocked;
      this.blocked = false;
      const isEcho = result.meta.writerId === this.writerId && result.meta.rev === this.rev;
      this.rev = Math.max(this.rev, result.meta.rev);
      if (this.options.isDirty()) {
        if (!isEcho) this.backupDiscarded(result.text);
      } else {
        this.options.onDocument(result.text, 'remote');
      }
      if (wasBlocked) this.options.onWritable?.();
      this.options.onStatus({ kind: 'synced' });
      return;
    }
    if (result.state === 'mismatch' || result.state === 'legacy') {
      // A conflict, not tearing. Blocking here would strand it until some
      // unrelated batch or a reload, with writes refused the whole time.
      this.known = { ...items };
      await this.resolveConflict(
        generation,
        result.state === 'mismatch' ? result.meta.rev : this.rev,
      );
      return;
    }
    this.blocked = true;
    this.options.onStatus({ kind: 'sync-incomplete' });
  }

  private adoptCoherent(items: Record<string, unknown>, text: string, meta: SyncMeta): void {
    this.overlay.clear();
    this.known = items;
    const wasBlocked = this.blocked;
    this.blocked = false;
    const isEcho = meta.writerId === this.writerId && meta.rev === this.rev;
    if (!isEcho) {
      this.rev = Math.max(this.rev, meta.rev);
      if (this.options.isDirty()) {
        this.backupDiscarded(text);
      } else {
        this.options.onDocument(text, 'remote');
      }
    }
    if (wasBlocked) {
      this.options.onStatus({ kind: 'synced' });
      this.options.onWritable?.();
    }
  }

  // A coherent remote document that lands while the editor is dirty is not
  // applied: the local edit wins and flushes over it at a higher rev. That
  // document was never in any editor, so no other path keeps a copy of it -
  // this backup is the only route back to the tail it carried.
  private backupDiscarded(text: string): void {
    if (text === this.options.getText()) return;
    void this.backupNow(text).catch((e: unknown) => {
      console.warn(e);
    });
  }

  // Protect the tail: back up what we hold, then republish the full document
  // over the damage - unless a complete, newer document arrives first.
  private async resolveConflict(generation: number, conflictRev: number): Promise<void> {
    const current = this.options.getText();
    await this.backupNow(current);
    if (generation !== this.generation) return; // a newer settle owns the state
    // Re-assemble before committing: a complete document may have landed while
    // we were backing up, and adopting it always beats clobbering it with our
    // pre-conflict text at a rev that would win fleet-wide.
    const candidate = this.candidateItems();
    const fresh = assembleDocument(candidate);
    const targetRev = Math.max(this.rev, conflictRev) + 1;
    if (fresh.state === 'coherent' && fresh.meta.rev >= targetRev) {
      this.adoptCoherent(candidate, fresh.text, fresh.meta);
      return;
    }
    this.overlay.clear();
    this.rev = Math.max(this.rev, conflictRev);
    this.blocked = false;
    const written = await this.write(current);
    if (generation !== this.generation) return;
    if (written) this.options.onStatus({ kind: 'republished' });
  }

  // Drop the overlay entries a fresh storage snapshot already accounts for,
  // keeping any batch that landed after the snapshot was taken. The queued
  // settle is cancelled only when nothing is left for it to reconcile.
  private rebaseOverlay(items: Record<string, unknown>): void {
    for (const key of [...this.overlay.keys()]) {
      const value = this.overlay.get(key);
      const present = key in items;
      const accounted =
        value === undefined ? !present : present && sameStoredValue(items[key], value);
      if (accounted) this.overlay.delete(key);
    }
    if (this.overlay.size === 0) {
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
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
  //
  // The returned id is 'persisted:instanceNonce'. The persisted half is stable
  // per profile (so it survives reloads); the nonce makes the echo identity
  // unique per SyncStore, because two tabs of one profile share the persisted
  // half and would otherwise swallow each other's same-rev writes as echoes.
  private async loadWriterId(): Promise<string> {
    const local = this.options.storage.local;
    if (!local) return `ephemeral-${this.instanceNonce}`;
    const items = await local.get(WRITER_ID_KEY);
    const existing = items[WRITER_ID_KEY];
    if (typeof existing === 'string' && existing.length > 0) {
      return `${existing}:${this.instanceNonce}`;
    }
    const fresh = globalThis.crypto?.randomUUID?.() ?? `w-${Math.random().toString(36).slice(2)}`;
    await local.set({ [WRITER_ID_KEY]: fresh });
    return `${fresh}:${this.instanceNonce}`;
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
