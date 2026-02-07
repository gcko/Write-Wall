import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface ChromeSync {
  MAX_WRITE_OPERATIONS_PER_HOUR: number;
  getBytesInUse: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

interface ChromeLocal {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

const setupMainTest = (
  items: Record<string, string | undefined>,
  options: {
    includeClearButton?: boolean;
    includeNumChars?: boolean;
    localOverrides?: Partial<ChromeLocal>;
    syncOverrides?: Partial<ChromeSync>;
  } = {},
) => {
  const {
    includeClearButton = true,
    includeNumChars = true,
    localOverrides = {},
    syncOverrides = {},
  } = options;
  const handlers = new Map<string, Array<(event?: unknown) => void>>();
  const textAreaEl = {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (event?: unknown) => void) => {
      const existing = handlers.get(event);
      if (existing) {
        existing.push(handler);
      } else {
        handlers.set(event, [handler]);
      }
    }),
  };
  const clearHandlers = new Map<string, () => void>();
  const copyHandlers = new Map<string, () => void>();
  const exportHandlers = new Map<string, () => void>();
  const countModeHandlers = new Map<string, () => void>();
  const countModeEl = {
    value: 'bytes',
    addEventListener: vi.fn((event: string, handler: () => void) => {
      countModeHandlers.set(event, handler);
    }),
  };
  const exportButtonEl = {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      exportHandlers.set(event, handler);
    }),
  };
  const copyButtonEl = {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      copyHandlers.set(event, handler);
    }),
  };
  const clearButtonEl = {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      clearHandlers.set(event, handler);
    }),
  };
  const numCharsEl = { innerText: '' };
  const usageMaxEl = { hidden: false, innerText: '' };
  const lastSyncedEl = { innerText: 'Synced: --' };

  const getBytesInUse = vi.fn((_: unknown, callback: (inUse: number) => void) => {
    callback(42);
  });
  const get = vi.fn((_: unknown, callback: (items: Record<string, string | undefined>) => void) => {
    callback(items);
  });
  const set = vi.fn(() => Promise.resolve());
  const remove = vi.fn(() => Promise.resolve());

  const sync: ChromeSync = {
    MAX_WRITE_OPERATIONS_PER_HOUR: 3600,
    getBytesInUse,
    get,
    set,
    remove,
    ...syncOverrides,
  };
  const local: ChromeLocal = {
    get: vi.fn((_: unknown, callback: (items: Record<string, unknown>) => void) => {
      callback({});
    }),
    set: vi.fn(() => Promise.resolve()),
    ...localOverrides,
  };

  const chrome = {
    storage: {
      sync,
      local,
    },
  };

  const document = {
    getElementById: vi.fn((id: string) => {
      if (id === 'text') {
        return textAreaEl;
      }
      if (id === 'copy') {
        return copyButtonEl;
      }
      if (id === 'export') {
        return exportButtonEl;
      }
      if (id === 'count-mode') {
        return countModeEl;
      }
      if (id === 'clear') {
        return includeClearButton ? clearButtonEl : null;
      }
      if (id === 'num-chars') {
        return includeNumChars ? numCharsEl : null;
      }
      if (id === 'usage-max') {
        return usageMaxEl;
      }
      if (id === 'last-synced') {
        return lastSyncedEl;
      }
      return null;
    }),
    createElement: vi.fn(() => ({
      href: '',
      download: '',
      click: vi.fn(),
    })),
  };

  return {
    chrome,
    document,
    getCopyHandler: (event: string) => copyHandlers.get(event) ?? null,
    getExportHandler: (event: string) => exportHandlers.get(event) ?? null,
    getClearHandler: (event: string) => clearHandlers.get(event) ?? null,
    getHandler: (event: string) => {
      const list = handlers.get(event);
      if (!list) {
        return null;
      }
      return (payload?: unknown) => {
        for (const handler of list) {
          handler(payload);
        }
      };
    },
    getCountModeHandler: (event: string) => countModeHandlers.get(event) ?? null,
    countModeEl,
    local,
    lastSyncedEl,
    numCharsEl,
    sync,
    textAreaEl,
    usageMaxEl,
  };
};

describe('main UI bootstrap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('defaults to an empty string when there is no stored text', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, sync } = setupMainTest({});
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    expect(textAreaEl.value).toBe('');
    expect(sync.set).not.toHaveBeenCalled();
    expect(sync.remove).not.toHaveBeenCalled();
  });

  it('hydrates the textarea from the v2 key', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, sync, numCharsEl } = setupMainTest({ v2: 'hello' });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    expect(textAreaEl.value).toBe('hello');
    expect(sync.set).not.toHaveBeenCalled();
    expect(sync.remove).not.toHaveBeenCalled();
    expect(sync.getBytesInUse).toHaveBeenCalledTimes(2);
    expect(numCharsEl.innerText).toBe('42');
  });

  it('migrates legacy storage into v2', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, sync } = setupMainTest({ text: 'legacy' });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    expect(textAreaEl.value).toBe('legacy');
    expect(sync.set).toHaveBeenCalledWith({ v2: 'legacy' });
    expect(sync.remove).toHaveBeenCalledWith('text');
  });

  it('skips usage updates when the counter element is missing', async () => {
    vi.resetModules();
    const { chrome, document, sync } = setupMainTest({ v2: 'hello' }, { includeNumChars: false });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    expect(sync.getBytesInUse).not.toHaveBeenCalled();
  });

  it('logs warnings when legacy migration fails', async () => {
    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // noop for test
    });
    const error = new Error('migration failed');
    const { chrome, document, sync } = setupMainTest(
      { text: 'legacy' },
      {
        syncOverrides: {
          set: vi.fn(() => Promise.reject(error)),
          remove: vi.fn(() => Promise.reject(error)),
        },
      },
    );
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    await Promise.resolve();
    await Promise.resolve();

    expect(sync.set).toHaveBeenCalledTimes(1);
    expect(sync.remove).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('writes to sync storage on keyup with throttling', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { chrome, document, textAreaEl, sync, getHandler } = setupMainTest({});
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    const handler = getHandler('keyup');
    expect(handler).toBeTypeOf('function');

    textAreaEl.value = 'updated';
    handler?.();
    handler?.();

    expect(sync.set).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(sync.getBytesInUse).toHaveBeenCalledTimes(3);

    const delay = (sync.MAX_WRITE_OPERATIONS_PER_HOUR / 3600) * 4000;
    vi.advanceTimersByTime(delay);
    handler?.();

    expect(sync.set).toHaveBeenCalledTimes(2);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('writes to sync storage on input events', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { chrome, document, textAreaEl, sync, getHandler } = setupMainTest({});
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    const handler = getHandler('input');
    expect(handler).toBeTypeOf('function');

    textAreaEl.value = 'updated';
    handler?.();

    expect(sync.set).toHaveBeenCalledTimes(1);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('registers paste and cut handlers', async () => {
    vi.resetModules();
    const { chrome, document, getHandler } = setupMainTest({});
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    expect(getHandler('paste')).toBeTypeOf('function');
    expect(getHandler('cut')).toBeTypeOf('function');
  });

  it('logs a warning when the sync update fails', async () => {
    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // noop for test
    });
    const error = new Error('sync failed');
    const { chrome, document, textAreaEl, sync, getHandler } = setupMainTest(
      {},
      {
        syncOverrides: {
          set: vi.fn(() => Promise.reject(error)),
        },
      },
    );
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    const handler = getHandler('keyup');
    textAreaEl.value = 'updated';
    handler?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(sync.set).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the text when confirmed', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { chrome, document, textAreaEl, sync, getClearHandler } = setupMainTest({
      v2: 'hello',
    });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    await import('./main.js');

    textAreaEl.value = 'updated';
    const handler = getClearHandler('click');
    handler?.();

    expect(textAreaEl.value).toBe('');
    expect(sync.set).toHaveBeenCalledTimes(1);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('does not clear the text when confirmation is declined', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, sync, getClearHandler } = setupMainTest({
      v2: 'hello',
    });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );

    await import('./main.js');

    textAreaEl.value = 'updated';
    const handler = getClearHandler('click');
    handler?.();

    expect(textAreaEl.value).toBe('updated');
    expect(sync.set).not.toHaveBeenCalled();
  });

  it('copies text to the clipboard via the copy button', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, getCopyHandler } = setupMainTest({
      v2: 'hello',
    });
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    textAreaEl.value = 'copied';
    const handler = getCopyHandler('click');
    handler?.();

    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('copied');
  });

  it('falls back to execCommand when clipboard is unavailable', async () => {
    vi.resetModules();
    const execCommand = vi.fn();
    const { chrome, document, textAreaEl, getCopyHandler } = setupMainTest({
      v2: 'hello',
    });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', {
      ...document,
      execCommand,
    });

    await import('./main.js');

    textAreaEl.value = 'copied';
    const handler = getCopyHandler('click');
    handler?.();

    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('copies text on Ctrl/Cmd+Shift+C', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, getHandler } = setupMainTest({
      v2: 'hello',
    });
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    const handler = getHandler('keydown');
    const preventDefault = vi.fn();
    textAreaEl.value = 'shortcut';
    handler?.({ key: 'C', ctrlKey: true, metaKey: false, shiftKey: true, preventDefault });

    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('shortcut');
  });

  it('exports the text as a file when requested', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, getExportHandler } = setupMainTest({
      v2: 'hello',
    });
    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const OriginalURL = globalThis.URL;
    class MockURL extends OriginalURL {}
    (MockURL as unknown as typeof URL).createObjectURL = createObjectURL;
    (MockURL as unknown as typeof URL).revokeObjectURL = revokeObjectURL;
    vi.stubGlobal('URL', MockURL);
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', {
      ...document,
      createElement: vi.fn(() => anchor),
    });

    await import('./main.js');

    textAreaEl.value = 'exported';
    const handler = getExportHandler('click');
    handler?.();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe('write-wall.txt');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('updates the counter to chars when selected', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, numCharsEl, countModeEl, getCountModeHandler } =
      setupMainTest({
        v2: 'hello',
      });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    textAreaEl.value = 'hello';
    countModeEl.value = 'chars';
    const handler = getCountModeHandler('change');
    handler?.();

    expect(numCharsEl.innerText).toBe('5');
  });

  it('updates the usage label when switching modes', async () => {
    vi.resetModules();
    const { chrome, document, countModeEl, getCountModeHandler, usageMaxEl } = setupMainTest({
      v2: 'hello',
    });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    countModeEl.value = 'chars';
    const handler = getCountModeHandler('change');
    handler?.();

    expect(usageMaxEl.hidden).toBe(false);
    expect(usageMaxEl.innerText).toBe('Char(s)');

    countModeEl.value = 'bytes';
    handler?.();

    expect(usageMaxEl.hidden).toBe(false);
    expect(usageMaxEl.innerText).toBe('/ 8192 Bytes');

    countModeEl.value = 'words';
    handler?.();

    expect(usageMaxEl.hidden).toBe(false);
    expect(usageMaxEl.innerText).toBe('Word(s)');
  });

  it('updates the counter to words when selected', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, numCharsEl, countModeEl, getCountModeHandler } =
      setupMainTest({
        v2: 'hello',
      });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    textAreaEl.value = 'hello world';
    countModeEl.value = 'words';
    const handler = getCountModeHandler('change');
    handler?.();

    expect(numCharsEl.innerText).toBe('2');
  });

  it('updates the counter on input when not in bytes mode', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, numCharsEl, countModeEl, getHandler } = setupMainTest({
      v2: 'hello',
    });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    countModeEl.value = 'chars';
    textAreaEl.value = 'updated';
    const handler = getHandler('input');
    handler?.();

    expect(numCharsEl.innerText).toBe('7');
  });

  it('restores cursor position from local storage', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl } = setupMainTest(
      { v2: 'hello' },
      {
        localOverrides: {
          get: vi.fn((_: unknown, callback: (items: Record<string, unknown>) => void) => {
            callback({
              cursor: { start: 2, end: 4 },
            });
          }),
        },
      },
    );
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    expect(textAreaEl.setSelectionRange).toHaveBeenCalledWith(2, 4);
  });

  it('stores cursor position in local storage', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, local, getHandler } = setupMainTest({
      v2: 'hello',
    });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    textAreaEl.selectionStart = 1;
    textAreaEl.selectionEnd = 3;
    const handler = getHandler('input');
    handler?.();

    expect(local.set).toHaveBeenCalledWith({
      cursor: { start: 1, end: 3 },
    });
  });

  it('focuses the textarea after loading', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl } = setupMainTest({ v2: 'hello' });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    expect(textAreaEl.focus).toHaveBeenCalledTimes(1);
  });

  it('updates the last synced indicator after saving', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, lastSyncedEl, getHandler } = setupMainTest({});
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    textAreaEl.value = 'updated';
    const handler = getHandler('keyup');
    handler?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(lastSyncedEl.innerText).not.toBe('Synced: --');
  });

  it('forces an immediate save on Ctrl/Cmd+S', async () => {
    vi.resetModules();
    const { chrome, document, textAreaEl, sync, getHandler } = setupMainTest({});
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    textAreaEl.value = 'updated';
    const preventDefault = vi.fn();
    const handler = getHandler('keydown');
    handler?.({ key: 's', ctrlKey: true, metaKey: false, shiftKey: false, preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(sync.set).toHaveBeenCalledTimes(1);
  });

  it('ships a placeholder hint in the UI', () => {
    const html = readFileSync(new URL('../public/html/index.html', import.meta.url), 'utf8');
    expect(html).toContain('placeholder="Type here... auto-syncs across Chrome."');
  });
});
