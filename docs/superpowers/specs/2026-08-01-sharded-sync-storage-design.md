# Sharded Sync Storage Design

**Date:** 2026-08-01
**Status:** Approved (pending final spec review)
**Author:** Claude + Jared Scott

## Problem

Write Wall stores the whole document under one `chrome.storage.sync` key (`v2`), so the
per-item quota (`QUOTA_BYTES_PER_ITEM`, 8,192 B) caps documents at ~8 KB even though the
total sync quota (`QUOTA_BYTES`) is 102,400 B. Users hit this wall and stop using the
extension.

## Goals

1. Raise the document ceiling to ~95 KB using only `chrome.storage.sync`.
2. Existing users upgrade silently: no migration event, no data loss, no visible change
   until their text outgrows the old limit.
3. Mixed-version fleets stay safe: during a Chrome Web Store rollout, one device may run
   the new format while another still runs the old code.
4. No external services. No backend. The developer never sees user data.

## Non-goals

- Google Drive `appDataFolder` storage (a possible later tier; out of scope here).
- Merge/CRDT editing. Write Wall keeps last-writer-wins semantics per document revision.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `v2` remains the head chunk; overflow spills into new keys | Existing users need no migration; old clients keep working on documents that fit the head |
| 2 | Metadata key `v2m` is created once and never deleted | "Meta absent" must mean exactly one thing (legacy install). Deleting meta re-creates the ambiguity that causes data loss under torn sync delivery |
| 3 | Every write carries a Lamport revision (`rev`); every chunk value embeds it | Makes mixed-generation assemblies structurally detectable; distinguishes stale-client writes from concurrent new-client writes |
| 4 | Stale-client writes are never adopted: re-publish the full document (protect the tail) | A stale client by construction never saw the tail; adopting its head-only write collapses the document |
| 5 | Sharded heads end with a visible truncation marker line | Stale and downgraded clients see why the text stops; users on those devices are unlikely to edit unknowingly |
| 6 | Exactly one `storage.sync.set()` per flush; no inline `remove()` | The write-op quota (1,800/hour) has zero headroom for a second call; orphan chunks are harmless (bounded by `v2m.chunks`) and GC'd at startup |
| 7 | Byte accounting replicates Chromium's `base::WriteJson` escaping, not JS `JSON.stringify` | Chromium escapes `<` to 6 bytes; markdown users paste HTML/JSX. A `JSON.stringify` budget under-counts by up to 5 B per `<` and causes permanently rejected writes |

## Storage format

### Sync keys

| Key | Value | Notes |
|-----|-------|-------|
| `v2` | Head text. When sharded, ends with the marker line | Old clients read and write this key unchanged |
| `v2x_0` … `v2x_n` | `"<rev>\u0000<text>"` | Overflow chunks; generation self-identifying; max ~13 |
| `v2m` | `{v: 1, rev, writerId, chunks, len, hash}` | Created once, never deleted. `chunks: 0` when the text fits in the head |

- `rev`: Lamport counter, incremented on every write.
- `writerId`: random per-install ID; filters a device's own `onChanged` echoes.
- `len`, `hash`: length and fast non-crypto hash (e.g. FNV-1a) of the full assembled text,
  marker excluded. Integrity check only, not security.
- Marker line (constant, written by the packer, stripped by the assembler):
  `\n\n--- ✂ truncated — update Write Wall to see the rest ---`

### Byte accounting

Chrome meters each item as `key.length + WriteJson(value).size()` in UTF-8. The helper
`chromeItemBytes(key, value)` replicates Chromium's rules:

| Input | Bytes |
|-------|-------|
| `"` `\` `\b` `\f` `\n` `\r` `\t` | 2 |
| `<`, U+2028, U+2029, code points < 0x20 | 6 |
| Everything else | UTF-8 length |
| Plus | 2 (quotes) + key length |

The packer finds each chunk's split point by binary search against 8,192 minus a 256 B
margin, splitting only on code-point boundaries (a sliced surrogate pair becomes U+FFFD
in Chromium and corrupts text). Ceiling: ~13 chunks ≈ 95 KB. Writes beyond the ceiling
fail with an explicit "document too large" error, never a generic one.

## Write path

1. Build the payload object fresh on every flush. Never reuse an accumulator across
   writes (a reused object resurrects stale chunks).
2. Pack: strip marker → hash → split into head + chunks → stamp all chunks and `v2m` with
   `rev + 1`.
3. Issue exactly one `storage.sync.set({v2, v2x_*, v2m})`. Do not remove shrunk chunk
   keys here; `v2m.chunks` bounds the reader and startup GC reclaims them.
4. On success: update mirror state, usage meter, last-synced stamp.
5. On failure: read `error.message` and report the true cause — per-item bytes, total
   bytes, write-op quota, or other — in the status banner.

**Throttle.** Replace the broken formula (currently `(1800/3600) × 4000` = 2,000 ms,
which saturates the hourly quota) with
`Math.ceil(HOUR_IN_MS / MAX_WRITE_OPERATIONS_PER_HOUR) * 2` ≥ 4,000 ms. Route Ctrl+S,
`pagehide`, and `visibilitychange` flushes through a shared rate guard so key-repeat and
tab-switching cannot spam ops.

**Local mirror.** Mirror the full text to `chrome.storage.local` on an independent
~20 s trailing debounce plus `pagehide`, into a 3-slot ring (`backup_0..2` with
timestamps). `storage.local` has no write-op quota and a 10 MB byte quota. Known limit:
`"incognito": "split"` gives incognito its own `storage.local`, so backups written there
stay there.

## Startup read path

1. `storage.sync.get(null)`.
2. Legacy `text` key present → migrate: one `set({v2: text, v2m: {v:1, rev:1, chunks:0, …}})`,
   then `remove('text')`. (Startup writes are outside the hot path; two ops once is fine.)
3. `v2m` absent (legacy v2 install) → adopt `v2` as the document and publish `v2m` once.
   One boot write per device permanently removes the ambiguous meta-absent state.
4. `v2m` present → assemble head + chunks; verify chunk revs, `len`, `hash`. Coherent →
   display. Incoherent → display the local mirror (best available), mark sync incomplete,
   and block writes (see below).
5. GC: remove `v2x_i` where `i >= v2m.chunks`. Startup only.

## Remote change handling

`storage.onChanged` deltas accumulate in an overlay on the last-known sync state.

- **Echo filter:** ignore batches whose `v2m.writerId` and `rev` match our own last write.
- **Settle window:** ~300 ms after the last delta, attempt assembly from the overlay.
- **Coherent** (all chunks present, every chunk rev == `v2m.rev`, `len`+`hash` verify):
  apply to the editor unless `dirty`; local unsynced edits always win locally.
- **Incoherent:** keep waiting. After ~5 s, re-read `get(null)` once. Still incoherent →
  show a persistent "sync incomplete" indicator and **block sync writes** until a
  coherent state arrives. The editor stays usable; edits accumulate as dirty local state
  and flush once coherence returns. Writing while torn would publish a document assembled
  from a state known to be partial.
- **Dirty interaction:** check `dirty` at apply time, not receive time. Any local edit
  resets the overlay accumulator.
- **Stale-client write** (coherent state where `v2` changed but `rev` did not): do not
  adopt. Save the current full document to the backup ring, then re-publish head +
  chunks + `v2m` at `rev + 1` through the normal throttle. The stale device's edit
  reverts; the marker line explains the truncated view it was editing.

## UI changes

- Quota meter and byte counter denominator: 102,400 (read from
  `chrome.storage.sync.QUOTA_BYTES`, with fallback).
- Near-limit warning starts at 80% (the usable ceiling is ~96% of raw quota; 90% left
  only ~3 KB of warning).
- New persistent, dismissible banner for data events (conflict re-publish, sync
  incomplete, document too large), with a Restore action wired to the backup ring. The
  1.6 s flash remains only for cosmetic messages (copied, exported, cleared).

## Editor performance (required at 95 KB)

- `MarkdownEditor.value` setter diffs the new line array against the current one and
  patches only changed lines; today it rebuilds every line (`renderAll()`), which at
  95 KB destroys ~3,000 DOM nodes on every remote apply.
- Preserve caret and scroll across remote applies.
- Debounce the word count; `countWords(editor.value)` currently joins and regex-splits
  the whole document on every keystroke.

## Testing

**Harness.** A stateful fake `chrome.storage` (`src/test/fake_chrome_storage.ts`):

- Enforces per-item and total quotas with the Chromium byte formula.
- Enforces 1,800/hour and 120/minute write-op counters.
- Dispatches `onChanged`, supports torn/reordered/delayed batch delivery.
- Simulates two devices sharing a sync backend.

The current mocks resolve every call unconditionally and cannot express any failure in
this design.

**Property tests.** Packing round-trips over strings heavy in `<`, control characters,
U+2028/U+2029, emoji/astral-plane code points, and boundary sizes; every packed item fits
Chromium's metering; assembly is byte-exact.

**Scenario tests.** Silent upgrade (v2-only → first write publishes meta); growth past
the head; shrink below the head; stale-client write → tail protected and re-published;
torn delivery with a mid-delivery pause → no truncated apply, writes blocked, recovery on
completion; ops-quota exhaustion → correct error surfaced; legacy `text` migration;
downgrade round-trip (old code edits head, upgrade re-detects).

**Mock updates.** Existing specs gain `QUOTA_*` constants and `storage.local.remove`.

## Code layout

- `src/sync_store.ts` — format, packing, assembly, revision and conflict logic. Pure
  functions exported; document-level API: `read()`, `write(text)`, `onRemoteChange(cb)`.
- `src/sync_store.spec.ts` — property + scenario tests.
- `src/test/fake_chrome_storage.ts` — stateful fake.
- `src/main.ts` — swaps raw `storage.sync` calls for the module; keeps UI wiring.
- `src/editor.ts` — line-diffing `value` setter.
- Docs: fix the "~4 second" throttle claims in AGENTS.md and CLAUDE.md; document the new
  keys.

## Accepted trade-offs and risks

- **Downgrade:** rolled-back clients see the head + marker and a broken quota meter
  (old code divides total usage by 8,192). The marker is the only mitigation available to
  code we no longer control.
- **Stale-device edits revert.** Chosen deliberately (protect the tail). The marker line
  reduces the chance of such edits; the backup ring preserves what a revert replaces.
- **Small docs gain one extra key (`v2m`).** Old clients ignore it; layout parity was
  worth trading for unambiguous state.
- **`<`-heavy documents get a lower effective ceiling** (escaping inflates metered
  bytes). The meter reports metered usage, so the UI stays honest.

## Implementation order

1. `chromeItemBytes` + packer/assembler + property tests (pure, no Chrome APIs).
2. Fake `chrome.storage` harness.
3. `sync_store.ts` with scenario tests.
4. `CHANGE_DELAY` fix + rate guard (separate commit; independently shippable).
5. Editor line-diffing (separate commit; independently shippable).
6. `main.ts` integration + UI (banner, meter).
7. Docs corrections.
