// @vitest-environment jsdom
/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packDocument } from './sync_format.js';
import { type FakeChromeStorage, FakeSyncWorld } from './test/fake_chrome_storage.js';

const PAGE = `
  <div id="banner" role="alert" hidden>
    <span id="banner-text"></span>
    <button id="banner-restore" type="button" hidden>restore backup</button>
    <button id="banner-dismiss" type="button" aria-label="dismiss">x</button>
  </div>
  <div id="wordmark">WRITE WALL</div>
  <div id="scroll"><div id="paper"><div id="pad"></div></div></div>
  <div id="status">
    <div id="actions">
      <button id="export" type="button">Export</button>
      <button id="copy" type="button">Copy</button>
      <button id="clear" type="button">Clear</button>
    </div>
    <button id="status-count" type="button">0</button>
    <span id="last-synced">synced --</span>
    <span id="quota-bar"><span id="quota-fill"></span></span>
    <span id="quota-pct">0%</span>
    <span id="near-limit" hidden></span>
  </div>
  <button id="drawer-toggle" type="button" aria-expanded="false">Aa</button>
  <div id="drawer" hidden>
    <button type="button" data-font="mono">Mono</button>
    <button type="button" data-font="serif">Serif</button>
    <button type="button" data-width="560">Narrow</button>
    <button type="button" data-width="820">Wide</button>
    <button type="button" data-lh="1.5">Tight</button>
    <button type="button" data-lh="2">Open</button>
    <button type="button" data-set-theme="light">Light</button>
    <button type="button" data-set-theme="dark">Dark</button>
    <button id="size-down" type="button">-</button>
    <button id="size-label" type="button" disabled>17px</button>
    <button id="size-up" type="button">+</button>
    <button id="mode-focus" type="button">Focus</button>
    <button id="mode-typewriter" type="button">Typewriter</button>
  </div>
`;

interface ChromeMock {
  storage: {
    sync: {
      QUOTA_BYTES: number;
      QUOTA_BYTES_PER_ITEM: number;
      MAX_WRITE_OPERATIONS_PER_HOUR: number;
      MAX_WRITE_OPERATIONS_PER_MINUTE: number;
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      getBytesInUse: ReturnType<typeof vi.fn>;
    };
    local?: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
    onChanged?: {
      addListener: ReturnType<typeof vi.fn>;
    };
  };
}

// Call-assertion harness: the storage areas answer but never retain anything.
// Any test that needs storage to actually behave uses `bootWithFake` instead.
const buildChrome = (
  syncItems: Record<string, unknown> = {},
  localItems: Record<string, unknown> = {},
  options: { bytesInUse?: number; includeLocal?: boolean } = {},
): ChromeMock => {
  const { bytesInUse = 100, includeLocal = true } = options;
  const chromeMock: ChromeMock = {
    storage: {
      sync: {
        QUOTA_BYTES: 102400,
        QUOTA_BYTES_PER_ITEM: 8192,
        MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
        MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
        get: vi.fn((_keys: unknown, cb?: (items: Record<string, unknown>) => void) => {
          cb?.(syncItems);
          return Promise.resolve(syncItems);
        }),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
        getBytesInUse: vi.fn((_keys: unknown, cb?: (inUse: number) => void) => {
          cb?.(bytesInUse);
          return Promise.resolve(bytesInUse);
        }),
      },
    },
  };
  if (includeLocal) {
    chromeMock.storage.local = {
      get: vi.fn((_keys: unknown, cb?: (items: Record<string, unknown>) => void) => {
        cb?.(localItems);
        return Promise.resolve(localItems);
      }),
      set: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    };
  }
  chromeMock.storage.onChanged = { addListener: vi.fn() };
  return chromeMock;
};

// Startup is promise-chained now (writer id, read, migrate, publish), so the
// module is only settled once its microtask chain has drained. Timer-free so
// it works identically under fake timers.
const flushPromises = async (ticks = 60): Promise<void> => {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
};

const resetPage = (): void => {
  document.body.innerHTML = PAGE;
  document.documentElement.removeAttribute('data-theme');
  document.body.className = '';
};

const loadMain = async (storage: unknown): Promise<void> => {
  vi.stubGlobal('chrome', { storage });
  vi.resetModules();
  await import('./main.js');
  await flushPromises();
};

const boot = async (
  syncItems: Record<string, unknown> = {},
  localItems: Record<string, unknown> = {},
  options: { bytesInUse?: number; includeLocal?: boolean } = {},
) => {
  resetPage();
  const chromeMock = buildChrome(syncItems, localItems, options);
  await loadMain(chromeMock.storage);
  return chromeMock;
};

// Stateful harness: a real (fake) sync world, so sharding, meta, quota
// accounting, and cross-device delivery all behave.
const bootWithFake = async (
  syncItems: Record<string, unknown> = {},
  localItems: Record<string, unknown> = {},
) => {
  const world = new FakeSyncWorld();
  const device = world.createDevice();
  if (Object.keys(syncItems).length > 0) {
    await device.sync.set(syncItems);
  }
  if (Object.keys(localItems).length > 0) {
    await device.local.set(localItems);
  }
  resetPage();
  await loadMain(device);
  return { world, device };
};

const WRITER_ID = 'other-device';

const bootTwoDeviceFake = async (seed = 'shared start') => {
  const world = new FakeSyncWorld();
  const writer = world.createDevice();
  const reader = world.createDevice();
  await writer.sync.set(packDocument(seed, 1, WRITER_ID));
  world.deliver(reader);
  resetPage();
  await loadMain(reader);
  return { world, writer, reader };
};

const writerWrites = async (
  writer: FakeChromeStorage,
  text: string,
  rev: number,
): Promise<void> => {
  await writer.sync.set(packDocument(text, rev, WRITER_ID));
};

// A coherent key set whose integrity check fails: a stale pre-upgrade client
// overwrote v2. Recoverable, so startup republishes and reports 'republished'.
const repairableMismatch = () => ({
  v2: 'partial text',
  v2m: { v: 1, rev: 3, writerId: 'stale-device', chunks: 0, len: 999, hash: 12345 },
});

// Chunk values are `<rev>\u0000<text>`; the NUL is the separator assembleDocument
// splits on, and a wrong rev prefix would read as tearing rather than a conflict.
const CHUNK_REV_PREFIX = '3\u0000';

// The same conflict, but the recovered head + tail is far past what
// packDocument can pack, so the repair write throws and start() rejects.
const unrepairableMismatch = () => {
  const chunks = 20;
  const items: Record<string, unknown> = {
    v2: 'z'.repeat(8000),
    v2m: { v: 1, rev: 3, writerId: 'stale-device', chunks, len: 1, hash: 0 },
  };
  for (let i = 0; i < chunks; i++) {
    items[`v2x_${i}`] = `${CHUNK_REV_PREFIX}${'z'.repeat(8000)}`;
  }
  return items;
};

const pad = () => document.getElementById('pad') as HTMLElement;
const activeLine = () => document.querySelector('.ww-active') as HTMLElement;

const editorText = () =>
  [...pad().querySelectorAll('.ww-line')].map((el) => el.textContent ?? '').join('\n');

const bannerText = () => document.getElementById('banner-text')?.textContent ?? '';

const quotaPct = () =>
  Number((document.getElementById('quota-pct')?.textContent ?? '0%').replace('%', ''));

const typeInActive = (text: string) => {
  const el = activeLine();
  el.textContent = text;
  el.dispatchEvent(new Event('input'));
};

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Sync payloads now carry meta alongside the head, so assertions match on the
// head text rather than the whole object.
const wrote = (text: string) => expect.objectContaining({ v2: text });

describe('main', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('loading', () => {
    it('loads stored v2 text into the editor and restores the cursor', async () => {
      await boot({ v2: 'hello\nworld' }, { cursor: { start: 2, end: 2 } });
      const lines = pad().querySelectorAll('.ww-line');
      expect(lines).toHaveLength(2);
      expect(activeLine().textContent).toBe('hello');
    });

    it('migrates the legacy text key to v2 and removes it', async () => {
      const chromeMock = await boot({ text: 'legacy words' });
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote('legacy words'));
      expect(chromeMock.storage.sync.remove).toHaveBeenCalledWith('text');
    });

    it('starts empty without stored text and focuses the editor', async () => {
      await boot({}, {}, { includeLocal: false });
      expect(activeLine()).toBeTruthy();
    });

    it('applies stored settings on load', async () => {
      await boot(
        { v2: 'x' },
        {
          settings: {
            font: 'mono',
            size: 14,
            width: 820,
            lineHeight: 1.5,
            focus: true,
            typewriter: false,
          },
        },
      );
      expect(document.documentElement.style.getPropertyValue('--ww-size')).toBe('14px');
      expect(document.documentElement.style.getPropertyValue('--ww-width')).toBe('820px');
      expect(document.body.classList.contains('ww-focus')).toBe(true);
    });

    it('applies a stored explicit theme', async () => {
      await boot({ v2: 'x' }, { theme: 'light' });
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('leaves theme to the system when nothing is stored', async () => {
      await boot({ v2: 'x' });
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
  });

  describe('editing and sync', () => {
    it('writes editor content to sync storage on input', async () => {
      const chromeMock = await boot({ v2: 'start' });
      typeInActive('start more');
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote('start more'));
      await flushMicrotasks();
      expect(document.getElementById('last-synced')?.textContent).toMatch(/^synced \d/);
    });

    it('saves immediately with mod+s', async () => {
      const chromeMock = await boot({ v2: 'abc' });
      chromeMock.storage.sync.set.mockClear();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true }),
      );
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote('abc'));
    });

    it('persists the cursor position', async () => {
      const chromeMock = await boot({ v2: 'abcdef' });
      typeInActive('abcdefg');
      await flushMicrotasks();
      expect(chromeMock.storage.local?.set).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: expect.anything() }),
      );
    });
  });

  describe('status bar', () => {
    it('shows word count by default', async () => {
      await boot({ v2: 'one two three' });
      expect(document.getElementById('status-count')?.textContent).toBe('3 words');
    });

    it('debounces the word count during rapid typing', async () => {
      vi.useFakeTimers();
      await boot({ v2: 'a' });
      const countEl = document.getElementById('status-count') as HTMLElement;
      const relabel = vi.spyOn(countEl, 'setAttribute');
      typeInActive('a b');
      typeInActive('a b c');
      typeInActive('a b c d');
      // The burst is coalesced: only the leading keystroke recounts, so the
      // label still shows that first count and the work ran once, not thrice.
      expect(relabel).toHaveBeenCalledTimes(1);
      expect(countEl.textContent).toBe('2 words');
      await vi.advanceTimersByTimeAsync(250);
      expect(countEl.textContent).toBe('4 words');
    });

    it('cycles count modes on click and persists the mode', async () => {
      const chromeMock = await boot({ v2: 'one two' });
      const countEl = document.getElementById('status-count') as HTMLElement;
      countEl.click();
      expect(countEl.textContent).toBe('7 chars');
      countEl.click();
      expect(countEl.textContent).toBe('100 / 102400 B');
      countEl.click();
      expect(countEl.textContent).toBe('2 words');
      expect(chromeMock.storage.local?.set).toHaveBeenCalledWith({ countMode: 'chars' });
    });

    it('restores a stored count mode', async () => {
      await boot({ v2: 'abc' }, { countMode: 'chars' });
      expect(document.getElementById('status-count')?.textContent).toBe('3 chars');
    });

    it('renders quota percentage and fill width against the 100 KB area', async () => {
      await boot({ v2: 'x' }, {}, { bytesInUse: 51200 });
      expect(document.getElementById('quota-pct')?.textContent).toBe('50%');
      expect((document.getElementById('quota-fill') as HTMLElement).style.width).toBe('50%');
      expect((document.getElementById('near-limit') as HTMLElement).hidden).toBe(true);
    });

    it('no longer treats the old 8,192-byte item cap as the limit', async () => {
      await boot({ v2: 'x' }, {}, { bytesInUse: 7900 });
      expect(document.getElementById('quota-pct')?.textContent).toBe('8%');
      expect((document.getElementById('near-limit') as HTMLElement).hidden).toBe(true);
    });

    it('warns when approaching the sync limit', async () => {
      await boot({ v2: 'x' }, {}, { bytesInUse: 82000 });
      const nearLimit = document.getElementById('near-limit') as HTMLElement;
      expect(nearLimit.hidden).toBe(false);
      expect(nearLimit.textContent).toContain('20400 B left');
    });
  });

  describe('actions', () => {
    it('copies markdown source to the clipboard and flashes', async () => {
      vi.useFakeTimers();
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
      await boot({ v2: '# hi' });
      (document.getElementById('copy') as HTMLElement).click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('# hi');
      await vi.advanceTimersByTimeAsync(1);
      expect(document.getElementById('status-count')?.textContent).toBe('copied to clipboard');
      await vi.advanceTimersByTimeAsync(1600);
      expect(document.getElementById('status-count')?.textContent).toBe('2 words');
    });

    it('falls back to execCommand when the clipboard API is missing', async () => {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });
      document.execCommand = vi.fn(() => true);
      await boot({ v2: 'plain' });
      (document.getElementById('copy') as HTMLElement).click();
      await flushMicrotasks();
      expect(document.execCommand).toHaveBeenCalledWith('copy');
    });

    it('copies with mod+shift+c', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
      await boot({ v2: 'abc' });
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', metaKey: true, shiftKey: true, cancelable: true }),
      );
      await flushMicrotasks();
      expect(writeText).toHaveBeenCalledWith('abc');
    });

    it('exports the pad as a markdown file', async () => {
      await boot({ v2: 'notes' });
      (document.getElementById('export') as HTMLElement).click();
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });

    it('clears the pad after confirmation', async () => {
      const chromeMock = await boot({ v2: 'delete me' });
      (document.getElementById('clear') as HTMLElement).click();
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote(''));
    });

    it('keeps text when the clear confirmation is declined', async () => {
      vi.stubGlobal(
        'confirm',
        vi.fn(() => false),
      );
      const chromeMock = await boot({ v2: 'keep me' });
      chromeMock.storage.sync.set.mockClear();
      (document.getElementById('clear') as HTMLElement).click();
      expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();
    });
  });

  describe('resilience and system theme', () => {
    it('boots with a minimal DOM missing every optional element', async () => {
      document.body.innerHTML = '<div id="pad"></div>';
      const chromeMock = buildChrome({ v2: 'hi there' });
      vi.stubGlobal('chrome', chromeMock);
      vi.resetModules();
      await import('./main.js');
      await flushPromises();
      typeInActive('hi there!');
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote('hi there!'));
    });

    it('skips the count label refresh while in bytes mode', async () => {
      await boot({ v2: 'x' }, { countMode: 'bytes' });
      const countEl = document.getElementById('status-count') as HTMLElement;
      expect(countEl.textContent).toBe('100 / 102400 B');
      typeInActive('xy');
      expect(countEl.textContent).toBe('100 / 102400 B');
    });

    it('follows system theme changes when no explicit theme is set', async () => {
      let changeHandler: (() => void) | undefined;
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({
          matches: true,
          addEventListener: (_type: string, handler: () => void) => {
            changeHandler = handler;
          },
        })),
      );
      await boot({ v2: 'x' });
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      changeHandler?.();
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      (document.querySelector('[data-set-theme="dark"]') as HTMLElement).click();
      changeHandler?.();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('handles execCommand copy failures', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });
      document.execCommand = vi.fn(() => {
        throw new Error('nope');
      });
      await boot({ v2: 'plain' });
      (document.getElementById('copy') as HTMLElement).click();
      await flushMicrotasks();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('sync integrity', () => {
    it('flushes trailing edits made inside the throttle window', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot({ v2: 'a' });
      chromeMock.storage.sync.set.mockClear();
      typeInActive('ab');
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote('ab'));
      typeInActive('abc');
      typeInActive('abcd');
      expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(8001);
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote('abcd'));
    });

    it('throttles sync writes to at least 4 seconds', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot({ v2: 'ab' });
      chromeMock.storage.sync.set.mockClear();
      typeInActive('abc');
      expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1); // leading edge
      typeInActive('abcd');
      vi.advanceTimersByTime(3999);
      expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1); // still inside window
      vi.advanceTimersByTime(1);
      expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(2); // trailing edge at 4s
    });

    it('rate-guards repeated immediate flushes', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot({ v2: 'ab' });
      chromeMock.storage.sync.set.mockClear();
      const pressCtrlS = () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }),
        );
      };
      pressCtrlS();
      pressCtrlS();
      pressCtrlS(); // key repeat
      expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(2); // one trailing flush
    });

    it('persists a clear immediately even during an open throttle window', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot({ v2: 'text' });
      typeInActive('text more');
      chromeMock.storage.sync.set.mockClear();
      (document.getElementById('clear') as HTMLElement).click();
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote(''));
    });

    it('keeps the pad cleared when coherence arrives after a blocked clear', async () => {
      vi.useFakeTimers();
      const world = new FakeSyncWorld();
      const writer = world.createDevice();
      const reader = world.createDevice();
      const big = 'k'.repeat(20000);
      await writer.sync.set(packDocument(big, 1, WRITER_ID));
      world.deliver(reader, ['v2m']); // torn boot: meta only, so writes are blocked
      resetPage();
      await loadMain(reader);
      expect(bannerText()).toContain('sync incomplete');
      (document.getElementById('clear') as HTMLElement).click();
      expect(editorText()).toBe('');
      world.deliver(reader); // the rest arrives -> coherent
      await vi.advanceTimersByTimeAsync(300);
      // Clear is a local edit like any other: the arriving remote document must
      // not be applied over it and resurrect the cleared text.
      expect(editorText()).toBe('');
    });

    it('surfaces sync write failures instead of failing silently', async () => {
      const chromeMock = await boot({ v2: 'a' });
      chromeMock.storage.sync.set.mockImplementation(() => Promise.reject(new Error('quota')));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      typeInActive('ab');
      await flushMicrotasks();
      expect(document.getElementById('last-synced')?.textContent).toBe('sync failed');
      // Data events live in the persistent banner, never in the 1.6s flash.
      expect(bannerText()).toContain('not synced');
      expect(document.getElementById('status-count')?.textContent).not.toContain('not synced');
      warn.mockRestore();
    });

    it('flushes unsynced text on pagehide', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot({ v2: 'a' });
      typeInActive('ab');
      typeInActive('abc');
      chromeMock.storage.sync.set.mockClear();
      window.dispatchEvent(new Event('pagehide'));
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote('abc'));
    });

    it('does not write on pagehide when nothing is unsynced', async () => {
      const chromeMock = await boot({ v2: 'a' });
      await flushMicrotasks();
      chromeMock.storage.sync.set.mockClear();
      window.dispatchEvent(new Event('pagehide'));
      expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();
    });

    it('applies a coherent remote change through applyExternal', async () => {
      vi.useFakeTimers();
      const { world, writer, reader } = await bootTwoDeviceFake();
      await writerWrites(writer, 'from elsewhere', 2);
      world.deliver(reader);
      await vi.advanceTimersByTimeAsync(300);
      expect(editorText()).toBe('from elsewhere');
    });

    it('keeps local unsynced edits when a remote change arrives', async () => {
      vi.useFakeTimers();
      const { world, writer, reader } = await bootTwoDeviceFake();
      typeInActive('local x');
      typeInActive('local xy');
      await writerWrites(writer, 'remote wins?', 2);
      world.deliver(reader);
      await vi.advanceTimersByTimeAsync(300);
      expect(editorText()).toContain('local xy');
    });
  });

  describe('sharded sync integration', () => {
    it('boots a legacy v2 user unchanged and publishes meta', async () => {
      const { device } = await bootWithFake({ v2: 'my old wall' });
      expect(editorText()).toBe('my old wall');
      const items = await device.sync.get(null);
      expect(items.v2).toBe('my old wall');
      expect(items.v2m).toMatchObject({ chunks: 0, rev: 1 });
    });

    it('shows the quota meter against 102,400 bytes', async () => {
      await bootWithFake({ v2: 'x'.repeat(5000) });
      // ~5 KB of ~100 KB is ~5%, not the old ~61% of 8,192.
      expect(quotaPct()).toBeLessThanOrEqual(6);
    });

    it('shards a document past the old 8,192-byte item cap', async () => {
      vi.useFakeTimers();
      const { device } = await bootWithFake({});
      typeInActive('y'.repeat(20000));
      await vi.advanceTimersByTimeAsync(4000);
      const items = await device.sync.get(null);
      expect(items.v2m).toMatchObject({ len: 20000 });
      expect((items.v2m as { chunks: number }).chunks).toBeGreaterThan(0);
      expect(bannerText()).toBe('');
    });

    it('surfaces too-large through the banner, not the flash', async () => {
      vi.useFakeTimers();
      await bootWithFake({});
      typeInActive('x'.repeat(120000));
      await vi.advanceTimersByTimeAsync(4000);
      expect(bannerText()).toMatch(/too large/i);
      expect(document.getElementById('banner')?.hidden).toBe(false);
      expect(document.getElementById('last-synced')?.textContent).toBe('sync failed');
    });

    it('falls back to the newest local backup when startup cannot repair sync', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await boot(unrepairableMismatch(), { backup_0: { text: 'rescued draft', at: 9 } });
      expect(bannerText()).toMatch(/backup/i);
      expect(editorText()).toBe('rescued draft');
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('starts empty when startup fails and no backup exists', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await boot(unrepairableMismatch());
      expect(bannerText()).toMatch(/backup/i);
      expect(editorText()).toBe('');
      expect(activeLine()).toBeTruthy();
      warn.mockRestore();
    });

    it('flushes the dirty document once a torn sync becomes coherent', async () => {
      vi.useFakeTimers();
      const world = new FakeSyncWorld();
      const writer = world.createDevice();
      const reader = world.createDevice();
      const payload = packDocument('m'.repeat(10000), 1, WRITER_ID);
      await writer.sync.set(payload);
      // The head and meta land, the chunk does not: sync is blocked.
      world.deliver(reader, ['v2', 'v2m']);
      resetPage();
      await loadMain(reader);
      expect(bannerText()).toMatch(/sync incomplete/i);

      typeInActive('mended by hand');
      await vi.advanceTimersByTimeAsync(0);
      // The blocked write was refused, so nothing of the edit reached storage.
      expect((await reader.sync.get(null)).v2).not.toBe('mended by hand');

      world.deliver(reader, ['v2x_0']);
      await vi.advanceTimersByTimeAsync(300);
      // onWritable fired, and the still-dirty text went out without new input.
      expect((await reader.sync.get(null)).v2).toBe('mended by hand');
    });

    it('keeps the restore affordance when a later error replaces the conflict banner', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot(repairableMismatch(), {
        backup_0: { text: 'the rescued draft', at: 9 },
      });
      const restore = document.getElementById('banner-restore') as HTMLButtonElement;
      expect(bannerText()).toMatch(/outdated device/i);
      expect(restore.hidden).toBe(false);

      chromeMock.storage.sync.set.mockImplementation(() => Promise.reject(new Error('offline')));
      typeInActive('kept typing');
      await flushPromises();

      expect(bannerText()).toContain('not synced');
      // The backup is still the only copy of the clobbered tail — the button
      // that reaches it must survive an unrelated failure.
      expect(restore.hidden).toBe(false);
      chromeMock.storage.sync.set.mockImplementation(() => Promise.resolve());
      restore.click();
      await flushPromises();
      expect(editorText()).toBe('the rescued draft');
    });

    it('restores the backup from the banner and reschedules a sync write', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot(repairableMismatch(), {
        backup_0: { text: 'the rescued draft', at: 9 },
      });
      const restore = document.getElementById('banner-restore') as HTMLButtonElement;
      chromeMock.storage.sync.set.mockClear();
      chromeMock.storage.sync.set.mockImplementation(() => Promise.reject(new Error('offline')));

      restore.click();
      await flushPromises();
      expect(editorText()).toBe('the rescued draft');
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote('the rescued draft'));

      // The refused write must leave the restore dirty, so the pagehide flush
      // still has the text to send.
      chromeMock.storage.sync.set.mockClear();
      chromeMock.storage.sync.set.mockImplementation(() => Promise.resolve());
      window.dispatchEvent(new Event('pagehide'));
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(wrote('the rescued draft'));
    });

    it('mirrors edits to a local backup the banner can restore', async () => {
      vi.useFakeTimers();
      const { device } = await bootWithFake({ v2: 'original' });
      typeInActive('original plus more');
      await vi.advanceTimersByTimeAsync(1);
      const backups = await device.local.get(['backup_0', 'backup_1', 'backup_2']);
      expect(backups.backup_0).toMatchObject({ text: 'original plus more' });
    });
  });

  describe('drawer', () => {
    it('toggles the drawer and closes on Escape', async () => {
      await boot({ v2: 'x' });
      const toggle = document.getElementById('drawer-toggle') as HTMLElement;
      const drawer = document.getElementById('drawer') as HTMLElement;
      toggle.click();
      expect(drawer.hidden).toBe(false);
      expect(document.body.classList.contains('ww-drawer-open')).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(drawer.hidden).toBe(true);
      toggle.click();
      toggle.click();
      expect(drawer.hidden).toBe(true);
    });

    it('changes typeface, width, and line height and persists settings', async () => {
      const chromeMock = await boot({ v2: 'x' });
      (document.querySelector('[data-font="mono"]') as HTMLElement).click();
      (document.querySelector('[data-width="820"]') as HTMLElement).click();
      (document.querySelector('[data-lh="2"]') as HTMLElement).click();
      expect(document.documentElement.style.getPropertyValue('--ww-width')).toBe('820px');
      expect(document.documentElement.style.getPropertyValue('--ww-lh')).toBe('2');
      expect(chromeMock.storage.local?.set).toHaveBeenCalledWith({
        settings: expect.objectContaining({ font: 'mono', width: 820, lineHeight: 2 }),
      });
      expect(
        (document.querySelector('[data-font="mono"]') as HTMLElement).classList.contains('ww-on'),
      ).toBe(true);
    });

    it('adjusts font size within limits', async () => {
      await boot({ v2: 'x' });
      const up = document.getElementById('size-up') as HTMLElement;
      for (let i = 0; i < 10; i++) {
        up.click();
      }
      expect(document.getElementById('size-label')?.textContent).toBe('22px');
      const down = document.getElementById('size-down') as HTMLElement;
      for (let i = 0; i < 20; i++) {
        down.click();
      }
      expect(document.getElementById('size-label')?.textContent).toBe('13px');
    });

    it('toggles focus and typewriter modes', async () => {
      await boot({ v2: 'x' });
      (document.getElementById('mode-focus') as HTMLElement).click();
      expect(document.body.classList.contains('ww-focus')).toBe(true);
      (document.getElementById('mode-typewriter') as HTMLElement).click();
      expect(document.body.classList.contains('ww-typewriter')).toBe(true);
      (document.getElementById('mode-focus') as HTMLElement).click();
      expect(document.body.classList.contains('ww-focus')).toBe(false);
    });

    it('survives storage write failures on every persistence path', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const chromeMock = await boot({ v2: 'abc' });
      chromeMock.storage.sync.set.mockImplementation(() => Promise.reject(new Error('sync')));
      chromeMock.storage.local?.set.mockImplementation(() => Promise.reject(new Error('local')));
      typeInActive('abcd');
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true }),
      );
      (document.querySelector('[data-font="mono"]') as HTMLElement).click();
      (document.querySelector('[data-set-theme="dark"]') as HTMLElement).click();
      (document.getElementById('status-count') as HTMLElement).click();
      await flushMicrotasks();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('ignores drawer clicks that miss buttons', async () => {
      await boot({ v2: 'x' });
      const drawer = document.getElementById('drawer') as HTMLElement;
      drawer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(document.documentElement.style.getPropertyValue('--ww-width')).toBe('680px');
    });

    it('sets an explicit theme and persists it', async () => {
      const chromeMock = await boot({ v2: 'x' });
      (document.querySelector('[data-set-theme="light"]') as HTMLElement).click();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(chromeMock.storage.local?.set).toHaveBeenCalledWith({ theme: 'light' });
      expect(
        (document.querySelector('[data-set-theme="light"]') as HTMLElement).classList.contains(
          'ww-on',
        ),
      ).toBe(true);
    });
  });

  describe('active line visibility', () => {
    const mockScrollViewport = (height: number) => {
      const scrollEl = document.getElementById('scroll') as HTMLElement;
      Object.defineProperty(scrollEl, 'clientHeight', { value: height, configurable: true });
      return scrollEl;
    };

    const mockActiveLineRect = (top: number, bottom: number) => {
      activeLine().getBoundingClientRect = () => ({ top, bottom, height: bottom - top }) as DOMRect;
    };

    it('scrolls down when typing pushes the active line under the status bar', async () => {
      await boot({ v2: 'abc' });
      await flushMicrotasks();
      const scrollEl = mockScrollViewport(800);
      mockActiveLineRect(750, 780);
      typeInActive('abcd');
      // Bottom limit is clientHeight - 140 = 660; overshoot is 780 - 660.
      expect(scrollEl.scrollTop).toBe(120);
    });

    it('scrolls up when the active line sits under the wordmark', async () => {
      await boot({ v2: 'abc' });
      await flushMicrotasks();
      const scrollEl = mockScrollViewport(800);
      scrollEl.scrollTop = 500;
      mockActiveLineRect(10, 40);
      typeInActive('abcd');
      // Top clearance is 72; deficit is 72 - 10.
      expect(scrollEl.scrollTop).toBe(438);
    });

    it('leaves scroll alone when the active line is already clear', async () => {
      await boot({ v2: 'abc' });
      await flushMicrotasks();
      const scrollEl = mockScrollViewport(800);
      scrollEl.scrollTop = 100;
      mockActiveLineRect(300, 330);
      typeInActive('abcd');
      expect(scrollEl.scrollTop).toBe(100);
    });

    it('defers to typewriter mode centering', async () => {
      await boot({ v2: 'abc' });
      await flushMicrotasks();
      const scrollEl = mockScrollViewport(800);
      document.body.classList.add('ww-typewriter');
      mockActiveLineRect(750, 780);
      typeInActive('abcd');
      expect(scrollEl.scrollTop).toBe(0);
    });
  });
});
