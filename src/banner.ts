/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License. To view
 * a copy of this license, visit https://creativecommons.org/licenses/by-sa/4.0/
 */

interface BannerActions {
  onRestore?: () => void;
}

// Persistent, dismissible message strip for data events (conflict republish,
// sync incomplete, document too large). Cosmetic feedback stays on the
// status-bar flash; anything about the user's data goes through here.
class Banner {
  private readonly root: HTMLElement;
  private readonly textEl: HTMLElement | null;
  private readonly restoreEl: HTMLButtonElement | null;

  constructor(root: HTMLElement, actions: BannerActions = {}) {
    this.root = root;
    this.textEl = root.querySelector('#banner-text');
    this.restoreEl = root.querySelector('#banner-restore');
    root.querySelector('#banner-dismiss')?.addEventListener('click', () => {
      this.hide();
    });
    this.restoreEl?.addEventListener('click', () => {
      actions.onRestore?.();
      this.hide();
    });
  }

  show(message: string, options: { restore?: boolean } = {}): void {
    if (this.textEl) {
      this.textEl.textContent = message;
    }
    if (this.restoreEl) {
      this.restoreEl.hidden = options.restore !== true;
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  // Whether a Restore affordance is on screen right now. `show()` resets the
  // button on every call, so a caller that must not strip an existing one
  // reads this and passes it straight back in as `restore`.
  get restoreVisible(): boolean {
    return !this.root.hidden && this.restoreEl != null && !this.restoreEl.hidden;
  }
}

export type { BannerActions };
export { Banner };
