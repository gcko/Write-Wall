/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { throttle } from './utils.js';

const HOUR_IN_SECONDS = 60 * 60;
const FOUR_SECONDS_IN_MIL = 4000;
const CURSOR_KEY = 'cursor';
const THEME_KEY = 'theme';

/* global chrome:readonly */
((chrome) => {
  const CHANGE_DELAY =
      (chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR / HOUR_IN_SECONDS) * FOUR_SECONDS_IN_MIL, // 4 second sync delay
    LEGACY_STORAGE_KEY = 'text',
    STORAGE_KEY = 'v2',
    textAreaEl = document.getElementById('text') as HTMLTextAreaElement,
    copyButtonEl = document.getElementById('copy'),
    clearButtonEl = document.getElementById('clear'),
    themeToggleEl = document.getElementById('theme-toggle'),
    exportButtonEl = document.getElementById('export'),
    countModeEl = document.getElementById('count-mode') as HTMLSelectElement | null,
    storage = chrome.storage,
    storageObject: Record<string, string> = {};
  let remoteStoredText = '';

  type Theme = 'light' | 'dark';

  const getSystemTheme = (): Theme =>
    globalThis.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';

  const applyTheme = (theme: Theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggleEl) {
      themeToggleEl.textContent = theme === 'dark' ? 'Light' : 'Dark';
    }
  };

  const removeExplicitTheme = () => {
    document.documentElement.removeAttribute('data-theme');
    if (themeToggleEl) {
      themeToggleEl.textContent = getSystemTheme() === 'dark' ? 'Light' : 'Dark';
    }
  };

  const updateUsage = () => {
    const numCharEl = document.getElementById('num-chars');
    if (!numCharEl) {
      return;
    }
    const usageMaxEl = document.getElementById('usage-max') as HTMLElement | null;

    const mode = countModeEl?.value ?? 'bytes';
    if (mode === 'chars') {
      numCharEl.innerText = String(textAreaEl.value.length);
      if (usageMaxEl) {
        usageMaxEl.hidden = false;
        usageMaxEl.innerText = 'Char(s)';
      }
      return;
    }
    if (mode === 'words') {
      const trimmed = textAreaEl.value.trim();
      numCharEl.innerText = trimmed.length === 0 ? '0' : String(trimmed.split(/\s+/).length);
      if (usageMaxEl) {
        usageMaxEl.hidden = false;
        usageMaxEl.innerText = 'Word(s)';
      }
      return;
    }

    if (usageMaxEl) {
      usageMaxEl.hidden = false;
      usageMaxEl.innerText = '/ 8192 Bytes';
    }
    storage.sync.getBytesInUse(null, (inUse) => (numCharEl.innerText = String(inUse)));
  };

  const updateLastSynced = () => {
    const lastSyncedEl = document.getElementById('last-synced');
    if (!lastSyncedEl) {
      return;
    }
    const now = new Date();
    lastSyncedEl.innerText = `Synced: ${now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };

  // Set the number of bytes in use
  updateUsage();

  // Load theme preference
  if (storage.local) {
    storage.local.get(THEME_KEY, (localItems: Record<string, unknown>) => {
      const stored = localItems[THEME_KEY] as string | undefined;
      if (stored === 'light' || stored === 'dark') {
        applyTheme(stored);
      } else {
        removeExplicitTheme();
      }
    });
  }

  // get or create key to store data
  storage.sync.get(
    [LEGACY_STORAGE_KEY, STORAGE_KEY],
    (items: Record<string, string | undefined>) => {
      if (items[LEGACY_STORAGE_KEY] != null) {
        // Migrate stored data from the previous version to the new version
        remoteStoredText = items[LEGACY_STORAGE_KEY];
        storageObject[STORAGE_KEY] = remoteStoredText;
        storage.sync.set(storageObject).catch((e: unknown) => {
          console.warn(e);
        });
        // Remove the legacy key
        storage.sync.remove(LEGACY_STORAGE_KEY).catch((e: unknown) => {
          console.warn(e);
        });
      } else if (items[STORAGE_KEY] != null) {
        remoteStoredText = items[STORAGE_KEY];
      }
      // Value defaults to an empty string if there is no stored value
      textAreaEl.value = remoteStoredText;
      updateUsage();
      if (storage.local) {
        storage.local.get(CURSOR_KEY, (localItems: Record<string, unknown>) => {
          const cursor = localItems[CURSOR_KEY] as { start?: number; end?: number } | undefined;
          if (cursor && typeof textAreaEl.setSelectionRange === 'function') {
            const start = cursor.start ?? 0;
            const end = cursor.end ?? start;
            textAreaEl.setSelectionRange(start, end);
          }
          textAreaEl.focus();
        });
      } else {
        textAreaEl.focus();
      }
    },
  );

  const storeCursorPosition = throttle(() => {
    storage.local
      ?.set({
        [CURSOR_KEY]: {
          start: textAreaEl.selectionStart ?? 0,
          end: textAreaEl.selectionEnd ?? 0,
        },
      })
      .catch((e: unknown) => {
        console.warn(e);
      });
  }, 500);

  const throttledStorageUpdate = throttle(() => {
    storageObject[STORAGE_KEY] = textAreaEl.value;
    storage.sync
      .set(storageObject)
      .then(() => {
        updateUsage();
        updateLastSynced();
      })
      .catch((e: unknown) => {
        console.warn(e);
      });
  }, CHANGE_DELAY);

  const immediateStorageUpdate = () => {
    storageObject[STORAGE_KEY] = textAreaEl.value;
    storage.sync
      .set(storageObject)
      .then(() => {
        updateUsage();
        updateLastSynced();
      })
      .catch((e: unknown) => {
        console.warn(e);
      });
  };

  const copyAllText = async () => {
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(textAreaEl.value);
        return;
      }
    } catch (e: unknown) {
      console.warn(e);
    }

    textAreaEl.focus();
    textAreaEl.select();
    try {
      document.execCommand('copy');
    } catch (e: unknown) {
      console.warn(e);
    }
  };

  const updateLocalCount = () => {
    if (countModeEl && countModeEl.value !== 'bytes') {
      updateUsage();
    }
  };

  const exportText = () => {
    const blob = new Blob([textAreaEl.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'write-wall.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  // update storage which in turn updates usage
  textAreaEl.addEventListener('input', throttledStorageUpdate);
  textAreaEl.addEventListener('input', updateLocalCount);
  textAreaEl.addEventListener('input', storeCursorPosition);
  textAreaEl.addEventListener('paste', throttledStorageUpdate);
  textAreaEl.addEventListener('cut', throttledStorageUpdate);
  textAreaEl.addEventListener('keyup', throttledStorageUpdate);
  textAreaEl.addEventListener('keyup', storeCursorPosition);
  textAreaEl.addEventListener('click', storeCursorPosition);
  textAreaEl.addEventListener('keydown', (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      void copyAllText();
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      immediateStorageUpdate();
    }
  });

  if (copyButtonEl) {
    copyButtonEl.addEventListener('click', () => {
      void copyAllText();
    });
  }

  if (exportButtonEl) {
    exportButtonEl.addEventListener('click', exportText);
  }

  if (countModeEl) {
    countModeEl.addEventListener('change', () => {
      updateUsage();
    });
  }

  if (clearButtonEl) {
    clearButtonEl.addEventListener('click', () => {
      if (!globalThis.confirm('Clear all text?')) {
        return;
      }
      textAreaEl.value = '';
      throttledStorageUpdate();
    });
  }

  if (themeToggleEl) {
    themeToggleEl.addEventListener('click', () => {
      const current =
        (document.documentElement.getAttribute('data-theme') as Theme | null) ?? getSystemTheme();
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      storage.local?.set({ [THEME_KEY]: next }).catch((e: unknown) => {
        console.warn(e);
      });
    });
  }

  globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener('change', () => {
    if (!document.documentElement.getAttribute('data-theme')) {
      removeExplicitTheme();
    }
  });
})(chrome);
