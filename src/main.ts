/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { Banner } from './banner.js';
import { MarkdownEditor } from './editor.js';
import {
  applySettings,
  clampSize,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PadSettings,
} from './settings.js';
import { SYNC_QUOTA_BYTES } from './sync_format.js';
import { SyncStore } from './sync_store.js';
import { throttle } from './utils.js';

const HOUR_IN_MS = 60 * 60 * 1000;
const IMMEDIATE_FLUSH_GUARD_MS = 1000;
const BACKUP_MIRROR_MS = 20000;
const CURSOR_KEY = 'cursor';
const THEME_KEY = 'theme';
const SETTINGS_KEY = 'settings';
const COUNT_MODE_KEY = 'countMode';
const NEAR_LIMIT_PCT = 80;
const FLASH_MS = 1600;

/* global chrome:readonly */
((chrome) => {
  // One write op per 2s is the sync quota ceiling (1800/hour); run at half
  // that rate so immediate flushes (Ctrl+S, tab switches) have headroom.
  const CHANGE_DELAY =
      Math.ceil(HOUR_IN_MS / chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR) * 2, // 4000 ms
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
    // A detached fallback keeps the banner harmless on a page that omits it
    // (the minimal DOM the extension can be embedded in during tests).
    bannerEl = document.getElementById('banner') ?? document.createElement('div'),
    storage = chrome.storage;
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

  // The whole 100 KB area is the budget now that a document is sharded across
  // items; the 8,192-byte per-item cap is an internal packing detail.
  const syncLimitBytes = (): number => storage.sync.QUOTA_BYTES ?? SYNC_QUOTA_BYTES;

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
    const limit = syncLimitBytes();
    storage.sync.getBytesInUse(null, (inUse) => {
      statusCountEl.textContent = `${inUse} / ${limit} B`;
      statusCountEl.setAttribute(
        'aria-label',
        `${inUse} of ${limit} bytes — click to cycle count mode`,
      );
    });
  };

  const updateQuota = (): void => {
    const limit = syncLimitBytes();
    storage.sync.getBytesInUse(null, (inUse) => {
      const pct = Math.max(0, Math.min(100, Math.round((inUse / limit) * 100)));
      if (quotaFillEl) {
        quotaFillEl.style.width = `${pct}%`;
      }
      if (quotaPctEl) {
        quotaPctEl.textContent = `${pct}%`;
      }
      if (nearLimitEl) {
        nearLimitEl.hidden = pct < NEAR_LIMIT_PCT;
        nearLimitEl.textContent = `approaching sync limit — ${limit - inUse} B left`;
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

  // Keep the active line inside the band that is clear of the wordmark and
  // status-bar overlays; the browser's own caret scrolling only brings text
  // to the viewport edge, where those overlays hide it.
  const scrollEl = document.getElementById('scroll');
  const CARET_CLEARANCE_TOP = 72;
  const CARET_CLEARANCE_BOTTOM = 140;
  const keepActiveLineVisible = (): void => {
    if (!scrollEl || document.body.classList.contains('ww-typewriter')) {
      return;
    }
    const lineEl = editor.activeLineElement;
    if (!lineEl) {
      return;
    }
    const rect = lineEl.getBoundingClientRect();
    if (rect.height === 0 && rect.bottom === 0) {
      return; // no layout information available
    }
    const bottomLimit = scrollEl.clientHeight - CARET_CLEARANCE_BOTTOM;
    if (rect.bottom > bottomLimit) {
      scrollEl.scrollTop += rect.bottom - bottomLimit;
    } else if (rect.top < CARET_CLEARANCE_TOP) {
      scrollEl.scrollTop -= CARET_CLEARANCE_TOP - rect.top;
    }
  };

  // Shared write path. Every sync write in the page funnels through the store,
  // which owns sharding, revisions, and conflict handling; the outcome is
  // surfaced through onStatus rather than here.
  const writeToSync = (): void => {
    const written = editor.value;
    syncStore
      .write(written)
      .then((ok: boolean) => {
        if (ok && editor.value === written) {
          dirty = false;
        }
      })
      .catch((e: unknown) => {
        console.warn(e);
      });
  };

  // Trailing edge matters: without it, edits made inside the throttle window
  // would never sync unless another input arrived later.
  const throttledStorageUpdate = throttle(writeToSync, CHANGE_DELAY, { trailing: true });

  // Leading-edge with trailing coalesce: key-repeat Ctrl+S and rapid tab
  // switches cannot burn the write-op quota.
  const immediateStorageUpdate = throttle(writeToSync, IMMEDIATE_FLUSH_GUARD_MS, {
    trailing: true,
  });

  // Local mirror of the text, independent of whether sync accepted it. Cheap
  // (chrome.storage.local has no write-op quota) so it can lag far behind the
  // keystroke and still be the thing that survives a bad sync state.
  const mirrorToBackup = (): void => {
    syncStore.backupNow(editor.value).catch((e: unknown) => {
      console.warn(e);
    });
  };

  const throttledBackup = throttle(mirrorToBackup, BACKUP_MIRROR_MS, { trailing: true });

  const editor = new MarkdownEditor({
    container: padEl,
    onInput: () => {
      dirty = true;
      // Ordered before the write: it drops any half-delivered remote batch, so
      // a torn update can never be reconciled on top of the text being typed.
      syncStore.noteLocalEdit();
      throttledStorageUpdate();
      throttledBackup();
      if (countMode !== 'bytes') {
        countLabel();
      }
      storeCursorPosition();
      keepActiveLineVisible();
    },
    onCaretMove: () => {
      storeCursorPosition();
      typewriterScroll();
      keepActiveLineVisible();
    },
  });

  // Data events (conflicts, incomplete syncs, oversized documents) persist in
  // the banner until dismissed; the status-bar flash stays for cosmetic
  // confirmations only, which are fine to miss.
  const banner = new Banner(bannerEl, {
    onRestore: () => {
      syncStore
        .readNewestBackup()
        .then((backup: string | null) => {
          if (backup != null) {
            editor.applyExternal(backup);
            dirty = true;
            throttledStorageUpdate();
          }
        })
        .catch((e: unknown) => {
          console.warn(e);
        });
    },
  });

  const syncStore = new SyncStore({
    storage,
    onDocument: (text, origin) => {
      editor.applyExternal(text);
      updateUsage();
      updateLastSynced();
      if (origin === 'conflict-republish') {
        banner.show('restored full text over an edit from an outdated device', { restore: true });
      }
    },
    onStatus: (status) => {
      if (status.kind === 'synced') {
        updateUsage();
        updateLastSynced();
        return;
      }
      if (lastSyncedEl) {
        lastSyncedEl.textContent = 'sync failed';
      }
      if (status.kind === 'too-large') {
        banner.show('document too large to sync (~95 KB limit) — trim or export it');
      } else if (status.kind === 'sync-incomplete') {
        banner.show('sync incomplete — waiting for the rest of the document from other devices');
      } else if (status.kind === 'republished') {
        banner.show('protected your text from an outdated device — backup kept', { restore: true });
      } else {
        banner.show(`not synced — ${status.message ?? 'unknown error'}`);
      }
    },
    isDirty: () => dirty,
    getText: () => editor.value,
    onWritable: () => {
      if (dirty) {
        immediateStorageUpdate();
      }
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

  const showLoadedText = (text: string): void => {
    editor.value = text;
    updateUsage();
    if (storage.local) {
      storage.local.get(CURSOR_KEY, (localItems: Record<string, unknown>) => {
        const cursor = localItems[CURSOR_KEY] as { start?: number; end?: number } | undefined;
        editor.setSelectionRange(cursor?.start ?? editor.value.length);
      });
    } else {
      editor.focus();
    }
  };

  // start() reads, migrates, and repairs synced state; it rejects only when
  // even the repair write is impossible (an oversized recovered document), in
  // which case the newest local mirror is the best text we still hold. Sync
  // stays blocked or unblocked by the store's own state either way.
  syncStore
    .start()
    .then(showLoadedText)
    .catch((e: unknown) => {
      console.warn(e);
      banner.show('could not read synced text — showing the newest local backup');
      return syncStore.readNewestBackup().then((backup: string | null) => {
        showLoadedText(backup ?? '');
      });
    })
    .catch((e: unknown) => {
      console.warn(e);
      showLoadedText('');
    });

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

  // Best-effort flush of unsynced text when the page goes away or is hidden.
  // The trailing edge of both write throttles can be lost once the page is
  // gone, and the immediate path is itself rate-guarded, so this flush can
  // still be dropped — the local mirror below is the actual safety net.
  const flushIfDirty = (): void => {
    if (dirty) {
      immediateStorageUpdate();
      mirrorToBackup();
    }
  };
  globalThis.addEventListener?.('pagehide', flushIfDirty);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushIfDirty();
    }
  });

  // A remote document can arrive split across several onChanged batches, so
  // the store settles them before deciding anything; it also owns the
  // local-edits-win rule and the conflict repair.
  storage.onChanged?.addListener?.((changes, areaName) => {
    syncStore.handleChanges(changes, areaName);
  });
})(chrome);
