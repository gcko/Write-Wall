// @vitest-environment jsdom
/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Banner } from './banner.js';

const buildRoot = (): HTMLElement => {
  document.body.innerHTML = `
    <div id="banner" hidden>
      <span id="banner-text"></span>
      <button id="banner-restore" hidden>restore backup</button>
      <button id="banner-dismiss" aria-label="dismiss">×</button>
    </div>`;
  return document.getElementById('banner') as HTMLElement;
};

describe('Banner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows a message and stays visible until dismissed', () => {
    const banner = new Banner(buildRoot());
    banner.show('sync incomplete — waiting for other devices');
    expect(banner.visible).toBe(true);
    expect(document.getElementById('banner-text')?.textContent).toContain('sync incomplete');
    (document.getElementById('banner-dismiss') as HTMLButtonElement).click();
    expect(banner.visible).toBe(false);
  });

  it('wires the restore button only when requested', () => {
    const onRestore = vi.fn();
    const banner = new Banner(buildRoot(), { onRestore });
    banner.show('replaced by another device', { restore: true });
    const restore = document.getElementById('banner-restore') as HTMLButtonElement;
    expect(restore.hidden).toBe(false);
    restore.click();
    expect(onRestore).toHaveBeenCalledTimes(1);
    banner.show('plain message');
    expect(restore.hidden).toBe(true);
  });

  it('tolerates a root without text, restore, or dismiss elements', () => {
    document.body.innerHTML = '<div id="banner" hidden></div>';
    const banner = new Banner(document.getElementById('banner') as HTMLElement);
    banner.show('no children to update', { restore: true });
    expect(banner.visible).toBe(true);
    banner.hide();
    expect(banner.visible).toBe(false);
  });
});
