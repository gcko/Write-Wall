import { describe, expect, it, vi } from 'vitest';

describe('service worker action handler', () => {
  it('opens the extension page when the action icon is clicked', async () => {
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
      },
    };

    vi.stubGlobal('chrome', chrome);

    await import('./service_worker.js');

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(clickHandler).toBeTypeOf('function');

    clickHandler?.();

    expect(chrome.runtime.getURL).toHaveBeenCalledWith('html/index.html');
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/html/index.html',
    });
  });
});
