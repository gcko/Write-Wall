/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { computeFenceStates, renderLine, toggleTaskLine } from './markdown.js';

interface EditorOptions {
  container: HTMLElement;
  onInput?: () => void;
  onCaretMove?: () => void;
}

const noop = (): void => undefined;

// Line-based live-markdown editor. The active line (with the caret) shows its
// raw markdown source in an editable div; every other line renders as rich
// text. The source of truth is `lines`; the DOM is a projection of it.
class MarkdownEditor {
  private lines: string[] = [''];
  private active = 0;
  private caretOffset = 0;
  private readonly container: HTMLElement;
  private readonly onInput: () => void;
  private readonly onCaretMove: () => void;

  constructor(options: EditorOptions) {
    this.container = options.container;
    this.onInput = options.onInput ?? noop;
    this.onCaretMove = options.onCaretMove ?? noop;
    this.container.classList.add('ww-editor');
    this.container.addEventListener('click', (event) => {
      this.handleContainerClick(event as MouseEvent);
    });
    this.renderAll();
  }

  get value(): string {
    return this.lines.join('\n');
  }

  set value(text: string) {
    this.lines = text.split('\n');
    if (this.active >= this.lines.length) {
      this.active = this.lines.length - 1;
    }
    this.caretOffset = Math.min(this.caretOffset, this.lines[this.active].length);
    this.renderAll();
  }

  get activeLineElement(): HTMLElement | null {
    return this.container.children[this.active] as HTMLElement | null;
  }

  // Absolute offset over value (textarea-compatible), for cursor persistence.
  get selectionStart(): number {
    let offset = 0;
    for (let i = 0; i < this.active; i++) {
      offset += this.lines[i].length + 1;
    }
    return offset + this.caretOffset;
  }

  setSelectionRange(start: number): void {
    let remaining = Math.max(0, start);
    for (let i = 0; i < this.lines.length; i++) {
      if (remaining <= this.lines[i].length) {
        this.activate(i, remaining);
        return;
      }
      remaining -= this.lines[i].length + 1;
    }
    this.activate(this.lines.length - 1, this.lines[this.lines.length - 1].length);
  }

  focus(): void {
    this.activate(this.active, this.caretOffset);
  }

  private renderAll(): void {
    this.container.textContent = '';
    const fences = computeFenceStates(this.lines);
    this.lines.forEach((_line, index) => {
      this.container.appendChild(this.buildLine(index, fences[index]));
    });
  }

  private buildLine(index: number, inFence: boolean): HTMLElement {
    const el = document.createElement('div');
    el.dataset.index = String(index);
    if (index === this.active) {
      this.buildRaw(el, index);
    } else {
      this.buildRendered(el, index, inFence);
    }
    return el;
  }

  private buildRaw(el: HTMLElement, index: number): void {
    el.className = 'ww-line ww-active';
    el.setAttribute('contenteditable', 'plaintext-only');
    el.textContent = this.lines[index];
    el.addEventListener('input', () => {
      this.lines[index] = el.textContent ?? '';
      this.caretOffset = this.readDomOffset(el);
      this.refreshRendered();
      this.onInput();
    });
    el.addEventListener('keydown', (event) => {
      this.handleKeydown(event as KeyboardEvent, index, el);
    });
    el.addEventListener('paste', (event) => {
      this.handlePaste(event as ClipboardEvent, index, el);
    });
  }

  private buildRendered(el: HTMLElement, index: number, inFence: boolean): void {
    const rendered = renderLine(this.lines[index], inFence);
    el.className = `ww-line ww-${rendered.kind}`;
    if (rendered.kind === 'task') {
      const box = document.createElement('span');
      box.className = `ww-checkbox${rendered.checked ? ' ww-checked' : ''}`;
      const label = document.createElement('span');
      label.className = 'ww-task-label';
      label.innerHTML = rendered.html;
      el.appendChild(box);
      el.appendChild(label);
      if (rendered.checked) {
        el.classList.add('ww-done');
      }
      return;
    }
    if (rendered.kind === 'ordered') {
      const marker = document.createElement('span');
      marker.className = 'ww-marker';
      marker.textContent = rendered.marker ?? '';
      const body = document.createElement('span');
      body.innerHTML = rendered.html;
      el.appendChild(marker);
      el.appendChild(body);
      return;
    }
    el.innerHTML = rendered.html;
  }

  // Re-render every non-active line (fence state can ripple across lines).
  private refreshRendered(): void {
    const fences = computeFenceStates(this.lines);
    this.lines.forEach((_line, index) => {
      if (index === this.active) {
        return;
      }
      const fresh = this.buildLine(index, fences[index]);
      const current = this.container.children[index];
      if (current) {
        this.container.replaceChild(fresh, current);
      }
    });
  }

  private activate(index: number, offset: number): void {
    this.active = Math.max(0, Math.min(index, this.lines.length - 1));
    this.caretOffset = Math.max(0, Math.min(offset, this.lines[this.active].length));
    this.renderAll();
    const el = this.activeLineElement;
    if (el) {
      this.placeCaret(el, this.caretOffset);
    }
    this.onCaretMove();
  }

  private placeCaret(el: HTMLElement, offset: number): void {
    el.focus();
    const selection = globalThis.getSelection?.();
    if (!selection) {
      return;
    }
    let node = el.firstChild;
    if (!node) {
      node = document.createTextNode('');
      el.appendChild(node);
    }
    const range = document.createRange();
    range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private readDomOffset(el: HTMLElement): number {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
      return this.caretOffset;
    }
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) {
      return this.caretOffset;
    }
    return range.startOffset;
  }

  private handleKeydown(event: KeyboardEvent, index: number, el: HTMLElement): void {
    const offset = this.readDomOffset(el);
    const line = this.lines[index];
    if (event.key === 'Enter') {
      event.preventDefault();
      this.lines.splice(index, 1, line.slice(0, offset), line.slice(offset));
      this.activate(index + 1, 0);
      this.onInput();
      return;
    }
    if (event.key === 'Backspace' && offset === 0 && index > 0) {
      event.preventDefault();
      const previous = this.lines[index - 1];
      this.lines.splice(index - 1, 2, previous + line);
      this.activate(index - 1, previous.length);
      this.onInput();
      return;
    }
    if (event.key === 'Delete' && offset === line.length && index < this.lines.length - 1) {
      event.preventDefault();
      this.lines.splice(index, 2, line + this.lines[index + 1]);
      this.activate(index, offset);
      this.onInput();
      return;
    }
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      this.activate(index - 1, offset);
      return;
    }
    if (event.key === 'ArrowDown' && index < this.lines.length - 1) {
      event.preventDefault();
      this.activate(index + 1, offset);
      return;
    }
    if (event.key === 'ArrowLeft' && offset === 0 && index > 0) {
      event.preventDefault();
      this.activate(index - 1, this.lines[index - 1].length);
      return;
    }
    if (event.key === 'ArrowRight' && offset === line.length && index < this.lines.length - 1) {
      event.preventDefault();
      this.activate(index + 1, 0);
    }
  }

  private handlePaste(event: ClipboardEvent, index: number, el: HTMLElement): void {
    const text = event.clipboardData?.getData('text/plain');
    if (text == null) {
      return;
    }
    event.preventDefault();
    const offset = this.readDomOffset(el);
    const line = this.lines[index];
    const pasted = text.split('\n');
    pasted[0] = line.slice(0, offset) + pasted[0];
    const tailOffset = pasted[pasted.length - 1].length;
    pasted[pasted.length - 1] += line.slice(offset);
    this.lines.splice(index, 1, ...pasted);
    this.activate(index + pasted.length - 1, tailOffset);
    this.onInput();
  }

  private handleContainerClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (target.closest('a')) {
      return;
    }
    const lineEl = target.closest('.ww-line') as HTMLElement | null;
    if (!lineEl || lineEl.classList.contains('ww-active')) {
      return;
    }
    const index = Number(lineEl.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }
    if (target.classList.contains('ww-checkbox')) {
      const toggled = toggleTaskLine(this.lines[index]);
      if (toggled != null) {
        this.lines[index] = toggled;
        this.refreshRendered();
        this.onInput();
      }
      return;
    }
    this.activate(index, this.lines[index].length);
  }
}

export { MarkdownEditor };
export type { EditorOptions };
