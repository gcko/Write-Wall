import { describe, expect, it, vi } from 'vitest';

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
});
