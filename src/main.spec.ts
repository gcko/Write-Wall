import { afterEach, describe, expect, it, vi } from 'vitest';

interface ChromeSync {
  MAX_WRITE_OPERATIONS_PER_HOUR: number;
  getBytesInUse: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

const setupMainTest = (
  items: Record<string, string | undefined>,
  options: {
    includeNumChars?: boolean;
    syncOverrides?: Partial<ChromeSync>;
  } = {},
) => {
  const { includeNumChars = true, syncOverrides = {} } = options;
  let keyupHandler: (() => void) | null = null;
  const textAreaEl = {
    value: '',
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'keyup') {
        keyupHandler = handler;
      }
    }),
  };
  const numCharsEl = { innerText: '' };

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

  const chrome = {
    storage: {
      sync,
    },
  };

  const document = {
    getElementById: vi.fn((id: string) => {
      if (id === 'text') {
        return textAreaEl;
      }
      if (id === 'num-chars') {
        return includeNumChars ? numCharsEl : null;
      }
      return null;
    }),
  };

  return {
    chrome,
    document,
    getKeyupHandler: () => keyupHandler,
    numCharsEl,
    sync,
    textAreaEl,
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
    expect(sync.getBytesInUse).toHaveBeenCalledTimes(1);
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
    const { chrome, document, textAreaEl, sync, getKeyupHandler } = setupMainTest({});
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('document', document);

    await import('./main.js');

    const handler = getKeyupHandler();
    expect(handler).toBeTypeOf('function');

    textAreaEl.value = 'updated';
    handler?.();
    handler?.();

    expect(sync.set).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(sync.getBytesInUse).toHaveBeenCalledTimes(2);

    const delay = (sync.MAX_WRITE_OPERATIONS_PER_HOUR / 3600) * 4000;
    vi.advanceTimersByTime(delay);
    handler?.();

    expect(sync.set).toHaveBeenCalledTimes(2);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('logs a warning when the sync update fails', async () => {
    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // noop for test
    });
    const error = new Error('sync failed');
    const { chrome, document, textAreaEl, sync, getKeyupHandler } = setupMainTest(
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

    const handler = getKeyupHandler();
    textAreaEl.value = 'updated';
    handler?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(sync.set).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
