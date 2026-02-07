import { afterEach, describe, expect, it, vi } from 'vitest';

describe('service worker action handler', () => {
  it('opens the extension page when no existing tab is found', async () => {
    vi.resetModules();
    let clickHandler: (() => void) | null = null;
    const addListener = vi.fn((handler: () => void) => {
      clickHandler = handler;
    });

    const chrome = {
      action: {
        onClicked: {
          addListener,
        },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: {
        create: vi.fn(() => Promise.resolve()),
        query: vi.fn(() => Promise.resolve([])),
      },
      windows: {
        update: vi.fn(() => Promise.resolve()),
      },
    };

    vi.stubGlobal('chrome', chrome);

    await import('./service_worker.js');

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(clickHandler).toBeTypeOf('function');
    const handler = clickHandler as (() => void) | null;
    if (!handler) {
      throw new Error('Expected click handler to be registered');
    }
    await handler();

    expect(chrome.runtime.getURL).toHaveBeenCalledWith('html/index.html');
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/html/index.html',
    });
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: 'chrome-extension://test/html/index.html',
    });
  });

  it('focuses the existing tab when one is found', async () => {
    vi.resetModules();
    let clickHandler: (() => void) | null = null;
    const addListener = vi.fn((handler: () => void) => {
      clickHandler = handler;
    });

    const chrome = {
      action: {
        onClicked: {
          addListener,
        },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: {
        create: vi.fn(() => Promise.resolve()),
        query: vi.fn(() =>
          Promise.resolve([
            {
              id: 12,
              windowId: 3,
            },
          ]),
        ),
        update: vi.fn(() => Promise.resolve()),
      },
      windows: {
        update: vi.fn(() => Promise.resolve()),
      },
    };

    vi.stubGlobal('chrome', chrome);

    await import('./service_worker.js');

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(clickHandler).toBeTypeOf('function');
    const handler = clickHandler as (() => void) | null;
    if (!handler) {
      throw new Error('Expected click handler to be registered');
    }
    await handler();

    expect(chrome.runtime.getURL).toHaveBeenCalledWith('html/index.html');
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: 'chrome-extension://test/html/index.html',
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(12, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs error when tabs.update rejects', async () => {
    vi.resetModules();
    let clickHandler: (() => void) | null = null;
    const addListener = vi.fn((handler: () => void) => {
      clickHandler = handler;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // noop for test
    });

    const chrome = {
      action: {
        onClicked: {
          addListener,
        },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: {
        create: vi.fn(() => Promise.resolve()),
        query: vi.fn(() =>
          Promise.resolve([
            {
              id: 12,
              windowId: 3,
            },
          ]),
        ),
        update: vi.fn(() => Promise.reject(new Error('tabs.update failed'))),
      },
      windows: {
        update: vi.fn(() => Promise.resolve()),
      },
    };

    vi.stubGlobal('chrome', chrome);
    await import('./service_worker.js');

    const handler = clickHandler as (() => void) | null;
    if (!handler) throw new Error('Expected click handler');
    await handler();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs error when windows.update rejects', async () => {
    vi.resetModules();
    let clickHandler: (() => void) | null = null;
    const addListener = vi.fn((handler: () => void) => {
      clickHandler = handler;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // noop for test
    });

    const chrome = {
      action: {
        onClicked: {
          addListener,
        },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: {
        create: vi.fn(() => Promise.resolve()),
        query: vi.fn(() =>
          Promise.resolve([
            {
              id: 12,
              windowId: 3,
            },
          ]),
        ),
        update: vi.fn(() => Promise.resolve()),
      },
      windows: {
        update: vi.fn(() => Promise.reject(new Error('windows.update failed'))),
      },
    };

    vi.stubGlobal('chrome', chrome);
    await import('./service_worker.js');

    const handler = clickHandler as (() => void) | null;
    if (!handler) throw new Error('Expected click handler');
    await handler();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs error when tabs.create rejects', async () => {
    vi.resetModules();
    let clickHandler: (() => void) | null = null;
    const addListener = vi.fn((handler: () => void) => {
      clickHandler = handler;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // noop for test
    });

    const chrome = {
      action: {
        onClicked: {
          addListener,
        },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: {
        create: vi.fn(() => Promise.reject(new Error('tabs.create failed'))),
        query: vi.fn(() => Promise.resolve([])),
      },
      windows: {
        update: vi.fn(() => Promise.resolve()),
      },
    };

    vi.stubGlobal('chrome', chrome);
    await import('./service_worker.js');

    const handler = clickHandler as (() => void) | null;
    if (!handler) throw new Error('Expected click handler');
    await handler();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs error when tabs.query rejects', async () => {
    vi.resetModules();
    let clickHandler: (() => void) | null = null;
    const addListener = vi.fn((handler: () => void) => {
      clickHandler = handler;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // noop for test
    });

    const chrome = {
      action: {
        onClicked: {
          addListener,
        },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: {
        create: vi.fn(() => Promise.resolve()),
        query: vi.fn(() => Promise.reject(new Error('tabs.query failed'))),
        update: vi.fn(() => Promise.resolve()),
      },
      windows: {
        update: vi.fn(() => Promise.resolve()),
      },
    };

    vi.stubGlobal('chrome', chrome);
    await import('./service_worker.js');

    const handler = clickHandler as (() => void) | null;
    if (!handler) throw new Error('Expected click handler');
    await handler();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
  });

  it('skips window focus when tab has no windowId', async () => {
    vi.resetModules();
    let clickHandler: (() => void) | null = null;
    const addListener = vi.fn((handler: () => void) => {
      clickHandler = handler;
    });

    const chrome = {
      action: {
        onClicked: {
          addListener,
        },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: {
        create: vi.fn(() => Promise.resolve()),
        query: vi.fn(() =>
          Promise.resolve([
            {
              id: 12,
              windowId: null,
            },
          ]),
        ),
        update: vi.fn(() => Promise.resolve()),
      },
      windows: {
        update: vi.fn(() => Promise.resolve()),
      },
    };

    vi.stubGlobal('chrome', chrome);
    await import('./service_worker.js');

    const handler = clickHandler as (() => void) | null;
    if (!handler) throw new Error('Expected click handler');
    await handler();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.tabs.update).toHaveBeenCalledWith(12, { active: true });
    expect(chrome.windows.update).not.toHaveBeenCalled();
  });
});
