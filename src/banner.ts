/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
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
}

export type { BannerActions };
export { Banner };
