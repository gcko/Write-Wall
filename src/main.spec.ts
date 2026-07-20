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

const PAGE = `
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
      MAX_WRITE_OPERATIONS_PER_HOUR: number;
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      getBytesInUse: ReturnType<typeof vi.fn>;
    };
    local?: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
    onChanged?: {
      addListener: ReturnType<typeof vi.fn>;
    };
  };
}

const buildChrome = (
  syncItems: Record<string, string | undefined> = {},
  localItems: Record<string, unknown> = {},
  options: { bytesInUse?: number; includeLocal?: boolean } = {},
): ChromeMock => {
  const { bytesInUse = 100, includeLocal = true } = options;
  const chromeMock: ChromeMock = {
    storage: {
      sync: {
        MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
        get: vi.fn((_keys: unknown, cb: (items: Record<string, string | undefined>) => void) => {
          cb(syncItems);
        }),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
        getBytesInUse: vi.fn((_keys: unknown, cb: (inUse: number) => void) => {
          cb(bytesInUse);
        }),
      },
    },
  };
  if (includeLocal) {
    chromeMock.storage.local = {
      get: vi.fn((_keys: unknown, cb: (items: Record<string, unknown>) => void) => {
        cb(localItems);
      }),
      set: vi.fn(() => Promise.resolve()),
    };
  }
  chromeMock.storage.onChanged = { addListener: vi.fn() };
  return chromeMock;
};

const boot = async (
  syncItems: Record<string, string | undefined> = {},
  localItems: Record<string, unknown> = {},
  options: { bytesInUse?: number; includeLocal?: boolean } = {},
) => {
  document.body.innerHTML = PAGE;
  document.documentElement.removeAttribute('data-theme');
  document.body.className = '';
  const chromeMock = buildChrome(syncItems, localItems, options);
  vi.stubGlobal('chrome', chromeMock);
  vi.resetModules();
  await import('./main.js');
  return chromeMock;
};

const pad = () => document.getElementById('pad') as HTMLElement;
const activeLine = () => document.querySelector('.ww-active') as HTMLElement;

const typeInActive = (text: string) => {
  const el = activeLine();
  el.textContent = text;
  el.dispatchEvent(new Event('input'));
};

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ v2: 'legacy words' });
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
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ v2: 'start more' });
      await flushMicrotasks();
      expect(document.getElementById('last-synced')?.textContent).toMatch(/^synced \d/);
    });

    it('saves immediately with mod+s', async () => {
      const chromeMock = await boot({ v2: 'abc' });
      chromeMock.storage.sync.set.mockClear();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true }),
      );
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ v2: 'abc' });
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

    it('cycles count modes on click and persists the mode', async () => {
      const chromeMock = await boot({ v2: 'one two' });
      const countEl = document.getElementById('status-count') as HTMLElement;
      countEl.click();
      expect(countEl.textContent).toBe('7 chars');
      countEl.click();
      expect(countEl.textContent).toBe('100 / 8192 B');
      countEl.click();
      expect(countEl.textContent).toBe('2 words');
      expect(chromeMock.storage.local?.set).toHaveBeenCalledWith({ countMode: 'chars' });
    });

    it('restores a stored count mode', async () => {
      await boot({ v2: 'abc' }, { countMode: 'chars' });
      expect(document.getElementById('status-count')?.textContent).toBe('3 chars');
    });

    it('renders quota percentage and fill width', async () => {
      await boot({ v2: 'x' }, {}, { bytesInUse: 4096 });
      expect(document.getElementById('quota-pct')?.textContent).toBe('50%');
      expect((document.getElementById('quota-fill') as HTMLElement).style.width).toBe('50%');
      expect((document.getElementById('near-limit') as HTMLElement).hidden).toBe(true);
    });

    it('warns when approaching the sync limit', async () => {
      await boot({ v2: 'x' }, {}, { bytesInUse: 7900 });
      const nearLimit = document.getElementById('near-limit') as HTMLElement;
      expect(nearLimit.hidden).toBe(false);
      expect(nearLimit.textContent).toContain('292 B left');
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
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ v2: '' });
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
      typeInActive('hi there!');
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ v2: 'hi there!' });
    });

    it('skips the count label refresh while in bytes mode', async () => {
      await boot({ v2: 'x' }, { countMode: 'bytes' });
      const countEl = document.getElementById('status-count') as HTMLElement;
      expect(countEl.textContent).toBe('100 / 8192 B');
      typeInActive('xy');
      expect(countEl.textContent).toBe('100 / 8192 B');
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
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ v2: 'ab' });
      typeInActive('abc');
      typeInActive('abcd');
      expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(8001);
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ v2: 'abcd' });
    });

    it('persists a clear immediately even during an open throttle window', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot({ v2: 'text' });
      typeInActive('text more');
      chromeMock.storage.sync.set.mockClear();
      (document.getElementById('clear') as HTMLElement).click();
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ v2: '' });
    });

    it('surfaces sync write failures instead of failing silently', async () => {
      const chromeMock = await boot({ v2: 'a' });
      chromeMock.storage.sync.set.mockImplementation(() => Promise.reject(new Error('quota')));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      typeInActive('ab');
      await flushMicrotasks();
      expect(document.getElementById('last-synced')?.textContent).toBe('sync failed');
      expect(document.getElementById('status-count')?.textContent).toContain('not synced');
      warn.mockRestore();
    });

    it('flushes unsynced text on pagehide', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot({ v2: 'a' });
      typeInActive('ab');
      typeInActive('abc');
      chromeMock.storage.sync.set.mockClear();
      window.dispatchEvent(new Event('pagehide'));
      expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ v2: 'abc' });
    });

    it('does not write on pagehide when nothing is unsynced', async () => {
      const chromeMock = await boot({ v2: 'a' });
      await flushMicrotasks();
      chromeMock.storage.sync.set.mockClear();
      window.dispatchEvent(new Event('pagehide'));
      expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();
    });

    it('applies remote storage changes when there are no local edits', async () => {
      const chromeMock = await boot({ v2: 'local' });
      await flushMicrotasks();
      const listener = chromeMock.storage.onChanged?.addListener.mock.calls[0]?.[0] as (
        changes: Record<string, { newValue?: unknown }>,
        area: string,
      ) => void;
      expect(listener).toBeTypeOf('function');
      listener({ v2: { newValue: 'from another device' } }, 'sync');
      const pad = document.getElementById('pad') as HTMLElement;
      expect(pad.textContent).toContain('from another device');
    });

    it('keeps local unsynced edits when a remote change arrives', async () => {
      vi.useFakeTimers();
      const chromeMock = await boot({ v2: 'local' });
      typeInActive('local x');
      typeInActive('local xy');
      const listener = chromeMock.storage.onChanged?.addListener.mock.calls[0]?.[0] as (
        changes: Record<string, { newValue?: unknown }>,
        area: string,
      ) => void;
      listener({ v2: { newValue: 'remote wins?' } }, 'sync');
      const pad = document.getElementById('pad') as HTMLElement;
      expect(pad.textContent).toContain('local xy');
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
