/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { MarkdownEditor } from './editor.js';
import {
  applySettings,
  clampSize,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PadSettings,
} from './settings.js';
import { throttle } from './utils.js';

const HOUR_IN_SECONDS = 60 * 60;
const FOUR_SECONDS_IN_MIL = 4000;
const CURSOR_KEY = 'cursor';
const THEME_KEY = 'theme';
const SETTINGS_KEY = 'settings';
const COUNT_MODE_KEY = 'countMode';
const QUOTA_BYTES = 8192;
const NEAR_LIMIT_PCT = 90;
const FLASH_MS = 1600;

/* global chrome:readonly */
((chrome) => {
  const CHANGE_DELAY =
      (chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR / HOUR_IN_SECONDS) * FOUR_SECONDS_IN_MIL, // 4 second sync delay
    LEGACY_STORAGE_KEY = 'text',
    STORAGE_KEY = 'v2',
    padEl = document.getElementById('pad') as HTMLElement,
    statusCountEl = document.getElementById('status-count'),
    lastSyncedEl = document.getElementById('last-synced'),
    quotaFillEl = document.getElementById('quota-fill') as HTMLElement | null,
    quotaPctEl = document.getElementById('quota-pct'),
    nearLimitEl = document.getElementById('near-limit'),
    copyButtonEl = document.getElementById('copy'),
    clearButtonEl = document.getElementById('clear'),
    exportButtonEl = document.getElementById('export'),
    drawerEl = document.getElementById('drawer'),
    drawerToggleEl = document.getElementById('drawer-toggle'),
    storage = chrome.storage,
    storageObject: Record<string, string> = {};
  let remoteStoredText = '';
  let settings: PadSettings = { ...DEFAULT_SETTINGS };
  let countMode: 'bytes' | 'chars' | 'words' = 'words';
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let flashMessage = '';

  type Theme = 'light' | 'dark';

  const getSystemTheme = (): Theme =>
    globalThis.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';

  const getEffectiveTheme = (): Theme =>
    (document.documentElement.getAttribute('data-theme') as Theme | null) ?? getSystemTheme();

  const countWords = (text: string): number => {
    const trimmed = text.trim();
    return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  };

  const countLabel = (): void => {
    if (!statusCountEl) {
      return;
    }
    if (flashMessage !== '') {
      statusCountEl.textContent = flashMessage;
      statusCountEl.setAttribute('aria-label', `${flashMessage} — click to cycle count mode`);
      return;
    }
    if (countMode === 'chars') {
      const charCount = editor.value.length;
      statusCountEl.textContent = `${charCount} chars`;
      statusCountEl.setAttribute(
        'aria-label',
        `${charCount} characters — click to cycle count mode`,
      );
      return;
    }
    if (countMode === 'words') {
      const wordCount = countWords(editor.value);
      statusCountEl.textContent = `${wordCount} words`;
      statusCountEl.setAttribute('aria-label', `${wordCount} words — click to cycle count mode`);
      return;
    }
    storage.sync.getBytesInUse(null, (inUse) => {
      statusCountEl.textContent = `${inUse} / ${QUOTA_BYTES} B`;
      statusCountEl.setAttribute(
        'aria-label',
        `${inUse} of ${QUOTA_BYTES} bytes — click to cycle count mode`,
      );
    });
  };

  const updateQuota = (): void => {
    storage.sync.getBytesInUse(null, (inUse) => {
      const pct = Math.max(0, Math.min(100, Math.round((inUse / QUOTA_BYTES) * 100)));
      if (quotaFillEl) {
        quotaFillEl.style.width = `${pct}%`;
      }
      if (quotaPctEl) {
        quotaPctEl.textContent = `${pct}%`;
      }
      if (nearLimitEl) {
        nearLimitEl.hidden = pct < NEAR_LIMIT_PCT;
        nearLimitEl.textContent = `approaching sync limit — ${QUOTA_BYTES - inUse} B left`;
      }
    });
  };

  const updateUsage = (): void => {
    countLabel();
    updateQuota();
  };

  const flash = (message: string): void => {
    flashMessage = message;
    countLabel();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashMessage = '';
      countLabel();
    }, FLASH_MS);
  };

  const updateLastSynced = (): void => {
    if (!lastSyncedEl) {
      return;
    }
    const now = new Date();
    lastSyncedEl.textContent = `synced ${now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };

  // Tracks whether the editor holds text that has not reached sync storage.
  let dirty = false;

  const storeCursorPosition = throttle(
    () => {
      storage.local
        ?.set({
          [CURSOR_KEY]: {
            start: editor.selectionStart,
            end: editor.selectionStart,
          },
        })
        .catch((e: unknown) => {
          console.warn(e);
        });
    },
    500,
    { trailing: true },
  );

  const typewriterScroll = (): void => {
    if (!document.body.classList.contains('ww-typewriter')) {
      return;
    }
    editor.activeLineElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  // Shared write path. On failure (most commonly the 8,192-byte per-item
  // quota) the user gets a visible signal instead of a silent console.warn —
  // the meter alone can't show it, since getBytesInUse only reports
  // successfully committed bytes.
  const writeToSync = (): void => {
    const written = editor.value;
    storageObject[STORAGE_KEY] = written;
    storage.sync
      .set(storageObject)
      .then(() => {
        if (editor.value === written) {
          dirty = false;
        }
        remoteStoredText = written;
        updateUsage();
        updateLastSynced();
      })
      .catch((e: unknown) => {
        console.warn(e);
        if (lastSyncedEl) {
          lastSyncedEl.textContent = 'sync failed';
        }
        flash('not synced — over the 8,192 byte limit?');
      });
  };

  // Trailing edge matters: without it, edits made inside the throttle window
  // would never sync unless another input arrived later.
  const throttledStorageUpdate = throttle(writeToSync, CHANGE_DELAY, { trailing: true });

  const immediateStorageUpdate = (): void => {
    writeToSync();
  };

  const editor = new MarkdownEditor({
    container: padEl,
    onInput: () => {
      dirty = true;
      throttledStorageUpdate();
      if (countMode !== 'bytes') {
        countLabel();
      }
      storeCursorPosition();
    },
    onCaretMove: () => {
      storeCursorPosition();
      typewriterScroll();
    },
  });

  const refreshDrawerState = (): void => {
    if (!drawerEl) {
      return;
    }
    for (const button of drawerEl.querySelectorAll<HTMLButtonElement>('[data-font]')) {
      button.classList.toggle('ww-on', button.dataset.font === settings.font);
    }
    for (const button of drawerEl.querySelectorAll<HTMLButtonElement>('[data-width]')) {
      button.classList.toggle('ww-on', Number(button.dataset.width) === settings.width);
    }
    for (const button of drawerEl.querySelectorAll<HTMLButtonElement>('[data-lh]')) {
      button.classList.toggle('ww-on', Number(button.dataset.lh) === settings.lineHeight);
    }
    const theme = getEffectiveTheme();
    for (const button of drawerEl.querySelectorAll<HTMLButtonElement>('[data-set-theme]')) {
      button.classList.toggle('ww-on', button.dataset.setTheme === theme);
    }
    const sizeLabelEl = document.getElementById('size-label');
    if (sizeLabelEl) {
      sizeLabelEl.textContent = `${settings.size}px`;
    }
    const focusBtn = document.getElementById('mode-focus');
    if (focusBtn) {
      focusBtn.classList.toggle('ww-on', settings.focus);
      focusBtn.setAttribute('aria-pressed', settings.focus ? 'true' : 'false');
    }
    const typewriterBtn = document.getElementById('mode-typewriter');
    if (typewriterBtn) {
      typewriterBtn.classList.toggle('ww-on', settings.typewriter);
      typewriterBtn.setAttribute('aria-pressed', settings.typewriter ? 'true' : 'false');
    }
  };

  const saveSettings = (patch: Partial<PadSettings>): void => {
    settings = { ...settings, ...patch };
    applySettings(settings, document.documentElement, document.body);
    refreshDrawerState();
    storage.local?.set({ [SETTINGS_KEY]: settings }).catch((e: unknown) => {
      console.warn(e);
    });
  };

  const applyTheme = (theme: Theme): void => {
    document.documentElement.setAttribute('data-theme', theme);
    refreshDrawerState();
  };

  const removeExplicitTheme = (): void => {
    document.documentElement.removeAttribute('data-theme');
    refreshDrawerState();
  };

  const setDrawerOpen = (open: boolean): void => {
    if (!drawerEl || !drawerToggleEl) {
      return;
    }
    drawerEl.hidden = !open;
    drawerToggleEl.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('ww-drawer-open', open);
  };

  const copyAllText = async (): Promise<void> => {
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(editor.value);
        flash('copied to clipboard');
        return;
      }
    } catch (e: unknown) {
      console.warn(e);
    }

    const helper = document.createElement('textarea');
    helper.value = editor.value;
    document.body.appendChild(helper);
    helper.select();
    try {
      document.execCommand('copy');
      flash('copied to clipboard');
    } catch (e: unknown) {
      console.warn(e);
    }
    helper.remove();
    editor.focus();
  };

  const exportText = (): void => {
    const blob = new Blob([editor.value], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'write-wall.md';
    link.click();
    URL.revokeObjectURL(url);
    flash('exported write-wall.md');
  };

  // ── Initial load ─────────────────────────────────────────────

  updateUsage();

  if (storage.local) {
    storage.local.get(
      [THEME_KEY, SETTINGS_KEY, COUNT_MODE_KEY],
      (localItems: Record<string, unknown>) => {
        const storedTheme = localItems[THEME_KEY] as string | undefined;
        if (storedTheme === 'light' || storedTheme === 'dark') {
          applyTheme(storedTheme);
        } else {
          removeExplicitTheme();
        }
        const storedMode = localItems[COUNT_MODE_KEY] as string | undefined;
        if (storedMode === 'bytes' || storedMode === 'chars' || storedMode === 'words') {
          countMode = storedMode;
        }
        settings = normalizeSettings(localItems[SETTINGS_KEY]);
        applySettings(settings, document.documentElement, document.body);
        refreshDrawerState();
        countLabel();
      },
    );
  } else {
    applySettings(settings, document.documentElement, document.body);
    refreshDrawerState();
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
      editor.value = remoteStoredText;
      updateUsage();
      if (storage.local) {
        storage.local.get(CURSOR_KEY, (localItems: Record<string, unknown>) => {
          const cursor = localItems[CURSOR_KEY] as { start?: number; end?: number } | undefined;
          editor.setSelectionRange(cursor?.start ?? editor.value.length);
        });
      } else {
        editor.focus();
      }
    },
  );

  // ── Wiring ───────────────────────────────────────────────────

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      void copyAllText();
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      immediateStorageUpdate();
    }
    if (event.key === 'Escape' && drawerEl && !drawerEl.hidden) {
      setDrawerOpen(false);
      drawerToggleEl?.focus();
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

  if (clearButtonEl) {
    clearButtonEl.addEventListener('click', () => {
      if (!globalThis.confirm('Clear all text?')) {
        return;
      }
      editor.value = '';
      // Immediate write: a throttled call could be silently dropped inside an
      // open throttle window, leaving the old text in sync storage while the
      // UI reports "cleared".
      immediateStorageUpdate();
      flash('cleared');
    });
  }

  if (statusCountEl) {
    statusCountEl.addEventListener('click', () => {
      countMode = countMode === 'words' ? 'chars' : countMode === 'chars' ? 'bytes' : 'words';
      storage.local?.set({ [COUNT_MODE_KEY]: countMode }).catch((e: unknown) => {
        console.warn(e);
      });
      countLabel();
    });
  }

  if (drawerToggleEl && drawerEl) {
    drawerToggleEl.addEventListener('click', () => {
      setDrawerOpen(Boolean(drawerEl.hidden));
    });
  }

  if (drawerEl) {
    drawerEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      if (!button) {
        return;
      }
      if (button.dataset.font) {
        saveSettings({ font: button.dataset.font as PadSettings['font'] });
        return;
      }
      if (button.dataset.width) {
        saveSettings({ width: Number(button.dataset.width) });
        return;
      }
      if (button.dataset.lh) {
        saveSettings({ lineHeight: Number(button.dataset.lh) });
        return;
      }
      if (button.dataset.setTheme) {
        const theme = button.dataset.setTheme as Theme;
        applyTheme(theme);
        storage.local?.set({ [THEME_KEY]: theme }).catch((e: unknown) => {
          console.warn(e);
        });
        return;
      }
      if (button.id === 'size-down') {
        saveSettings({ size: clampSize(settings.size - 1) });
        return;
      }
      if (button.id === 'size-up') {
        saveSettings({ size: clampSize(settings.size + 1) });
        return;
      }
      if (button.id === 'mode-focus') {
        saveSettings({ focus: !settings.focus });
        return;
      }
      if (button.id === 'mode-typewriter') {
        saveSettings({ typewriter: !settings.typewriter });
        typewriterScroll();
      }
    });
  }

  globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener('change', () => {
    if (!document.documentElement.getAttribute('data-theme')) {
      removeExplicitTheme();
    }
  });

  // Best-effort flush of unsynced text when the page goes away or is hidden —
  // the throttle's trailing edge can't fire after the page is gone.
  const flushIfDirty = (): void => {
    if (dirty) {
      immediateStorageUpdate();
    }
  };
  globalThis.addEventListener?.('pagehide', flushIfDirty);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushIfDirty();
    }
  });

  // Apply remote edits (another device wrote v2) when there are no local
  // unsynced changes; with local edits pending, local wins — same conflict
  // behavior as before, but the common two-device case now stays in sync.
  storage.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== 'sync' || !(STORAGE_KEY in changes)) {
      return;
    }
    const newValue = changes[STORAGE_KEY].newValue;
    if (typeof newValue !== 'string' || newValue === editor.value || dirty) {
      return;
    }
    remoteStoredText = newValue;
    storageObject[STORAGE_KEY] = newValue;
    editor.value = newValue;
    updateUsage();
    updateLastSynced();
  });
})(chrome);
