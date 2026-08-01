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
  private goalColumn = 0; // Track visual column for arrow up/down navigation
  // Set by operations that change text content, so the next activate() does a
  // full re-render (fence state can ripple). Pure caret moves swap two lines.
  private needsFullRender = false;
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
    const previous = this.lines;
    this.lines = text.split('\n');
    if (this.active >= this.lines.length) {
      this.active = this.lines.length - 1;
    }
    this.caretOffset = Math.min(this.caretOffset, this.lines[this.active].length);
    this.patchFrom(previous);
  }

  // External replacement (remote sync apply): patch the changed lines and keep
  // the caret at the same absolute offset, clamped to the new document.
  applyExternal(text: string): void {
    const absolute = this.selectionStart;
    this.value = text;
    this.setSelectionRange(Math.min(absolute, text.length));
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

  // 'open'/'close' role for each ``` delimiter line, null elsewhere — lets
  // CSS draw the fence box's top and bottom borders correctly (including for
  // empty fences, where the two delimiters are adjacent).
  private fenceRoles(lines: string[] = this.lines): (null | 'open' | 'close')[] {
    let open = false;
    return lines.map((line) => {
      if (/^```/.test(line)) {
        open = !open;
        return open ? 'open' : 'close';
      }
      return null;
    });
  }

  private renderAll(): void {
    this.container.textContent = '';
    const fences = computeFenceStates(this.lines);
    const roles = this.fenceRoles();
    this.lines.forEach((_line, index) => {
      this.container.appendChild(this.buildLine(index, fences[index], roles[index]));
    });
  }

  // Minimal DOM update after a whole-value replacement: trim the common
  // prefix/suffix, splice the differing middle, then refresh any retained line
  // whose fence context changed (fence state and roles ripple across lines).
  // Falls back to a full render whenever the DOM is not a projection of
  // `previous`, which is the only case the trim cannot reason about.
  private patchFrom(previous: string[]): void {
    const next = this.lines;
    if (this.container.children.length !== previous.length) {
      this.renderAll();
      return;
    }
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) {
      prefix++;
    }
    if (prefix === previous.length && previous.length === next.length) {
      return; // identical text: nothing to do
    }
    let suffix = 0;
    while (
      suffix < previous.length - prefix &&
      suffix < next.length - prefix &&
      previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix++;
    }
    const fences = computeFenceStates(next);
    const roles = this.fenceRoles();
    const end = next.length - suffix;
    for (let i = previous.length - suffix - 1; i >= prefix; i--) {
      this.container.children[i].remove();
    }
    const anchor = this.container.children[prefix] ?? null;
    for (let i = prefix; i < end; i++) {
      this.container.insertBefore(this.buildLine(i, fences[i], roles[i]), anchor);
    }
    // Reindex the retained lines and rebuild the ones whose fence context (or
    // active state) changed. Retained tail lines map back to their old index
    // through the length delta.
    const previousFences = computeFenceStates(previous);
    const previousRoles = this.fenceRoles(previous);
    const delta = next.length - previous.length;
    for (let i = 0; i < next.length; i++) {
      if (i >= prefix && i < end) {
        continue;
      }
      const el = this.container.children[i] as HTMLElement;
      // Only the retained tail shifts, and only when the line count changed.
      if (delta !== 0 && i >= end) {
        el.dataset.index = String(i);
      }
      const was = i < prefix ? i : i - delta;
      if (
        fences[i] !== previousFences[was] ||
        roles[i] !== previousRoles[was] ||
        i === this.active
      ) {
        this.container.replaceChild(this.buildLine(i, fences[i], roles[i]), el);
      }
    }
  }

  private buildLine(index: number, inFence: boolean, role: null | 'open' | 'close'): HTMLElement {
    const el = document.createElement('div');
    el.dataset.index = String(index);
    if (index === this.active) {
      this.buildRaw(el, index, inFence || role != null);
    } else {
      this.buildRendered(el, index, inFence, role);
    }
    return el;
  }

  private buildRaw(el: HTMLElement, index: number, inCodeBlock = false): void {
    el.className = inCodeBlock ? 'ww-line ww-active ww-active-code' : 'ww-line ww-active';
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
    // Native caret moves (arrows inside a wrapped line, Home/End) bypass
    // handleKeydown's interceptions, so re-sync the cached offset afterwards.
    el.addEventListener('keyup', (event) => {
      const keyName = (event as KeyboardEvent).key;
      if (
        keyName === 'ArrowUp' ||
        keyName === 'ArrowDown' ||
        keyName === 'ArrowLeft' ||
        keyName === 'ArrowRight' ||
        keyName === 'Home' ||
        keyName === 'End'
      ) {
        this.caretOffset = this.readDomOffset(el);
        if (keyName !== 'ArrowUp' && keyName !== 'ArrowDown') {
          this.goalColumn = this.caretOffset;
        }
        this.onCaretMove();
      }
    });
    el.addEventListener('paste', (event) => {
      this.handlePaste(event as ClipboardEvent, index, el);
    });
  }

  private buildRendered(
    el: HTMLElement,
    index: number,
    inFence: boolean,
    role: null | 'open' | 'close' = null,
  ): void {
    const rendered = renderLine(this.lines[index], inFence);
    el.className = `ww-line ww-${rendered.kind}`;
    if (rendered.kind === 'fence' && role != null) {
      el.classList.add(`ww-fence-${role}`);
    }
    if (rendered.kind === 'task') {
      const box = document.createElement('span');
      box.className = `ww-checkbox${rendered.checked ? ' ww-checked' : ''}`;
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-checked', rendered.checked ? 'true' : 'false');
      box.setAttribute('tabindex', '0');
      // Allow Space/Enter to toggle the checkbox. Read the line index from the
      // dataset at event time: patching can reindex a retained line node.
      box.addEventListener('keydown', (event: KeyboardEvent) => {
        if ((event.code === 'Space' || event.key === 'Enter') && event.target === box) {
          event.preventDefault();
          this.toggleTask(Number(el.dataset.index));
        }
      });
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

  private toggleTask(index: number): void {
    const toggled = toggleTaskLine(this.lines[index]);
    if (toggled != null) {
      this.lines[index] = toggled;
      this.refreshRendered();
      this.onInput();
    }
  }

  // Re-render every non-active line (fence state can ripple across lines).
  private refreshRendered(): void {
    const fences = computeFenceStates(this.lines);
    const roles = this.fenceRoles();
    this.lines.forEach((_line, index) => {
      if (index === this.active) {
        return;
      }
      const fresh = this.buildLine(index, fences[index], roles[index]);
      const current = this.container.children[index];
      if (current) {
        this.container.replaceChild(fresh, current);
      }
    });
  }

  // Swap just the two affected lines on a pure caret move — keeps every other
  // DOM node stable (focus-mode transitions animate; no full-tree churn).
  private swapActive(previous: number): void {
    const fences = computeFenceStates(this.lines);
    const roles = this.fenceRoles();
    for (const idx of new Set([previous, this.active])) {
      const current = this.container.children[idx];
      if (current) {
        this.container.replaceChild(this.buildLine(idx, fences[idx], roles[idx]), current);
      }
    }
  }

  private activate(index: number, offset: number, preserveGoalColumn = false): void {
    const previous = this.active;
    this.active = Math.max(0, Math.min(index, this.lines.length - 1));
    this.caretOffset = Math.max(0, Math.min(offset, this.lines[this.active].length));
    if (!preserveGoalColumn) {
      this.goalColumn = offset;
    } else {
      // Clamp goal column to the length of the new line
      this.caretOffset = Math.min(this.goalColumn, this.lines[this.active].length);
    }
    if (this.needsFullRender || this.container.children.length !== this.lines.length) {
      this.needsFullRender = false;
      this.renderAll();
    } else {
      this.swapActive(previous);
    }
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
    // If no child nodes, create a text node to place the caret.
    if (!node) {
      node = document.createTextNode('');
      el.appendChild(node);
    }
    // If the first child is an element node (e.g., <br> from contenteditable), prepend a text node.
    if (node.nodeType !== Node.TEXT_NODE) {
      const textNode = document.createTextNode('');
      el.insertBefore(textNode, node);
      node = textNode;
    }
    const range = document.createRange();
    const maxOffset = Math.min(offset, node.textContent?.length ?? 0);
    range.setStart(node, maxOffset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Line-absolute offset for a (container, offset) DOM position: sums the
  // text of preceding sibling nodes so multi-text-node lines (IME, browser
  // edits) resolve correctly instead of trusting range offsets blindly.
  private nodeAbsoluteOffset(el: HTMLElement, container: Node, offset: number): number {
    if (container === el) {
      let sum = 0;
      for (let i = 0; i < offset && i < el.childNodes.length; i++) {
        sum += el.childNodes[i].textContent?.length ?? 0;
      }
      return sum;
    }
    let sum = 0;
    for (const child of Array.from(el.childNodes)) {
      if (child === container || child.contains(container)) {
        return sum + offset;
      }
      sum += child.textContent?.length ?? 0;
    }
    return this.caretOffset;
  }

  private readDomRange(el: HTMLElement): { start: number; end: number } {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
      return { start: this.caretOffset, end: this.caretOffset };
    }
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) {
      return { start: this.caretOffset, end: this.caretOffset };
    }
    const start = this.nodeAbsoluteOffset(el, range.startContainer, range.startOffset);
    const end = el.contains(range.endContainer)
      ? this.nodeAbsoluteOffset(el, range.endContainer, range.endOffset)
      : start;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  private readDomOffset(el: HTMLElement): number {
    return this.readDomRange(el).start;
  }

  // Rect of the collapsed caret, or null when the environment provides no
  // selection or no layout information (e.g. jsdom in tests).
  private caretClientRect(el: HTMLElement): DOMRect | null {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : [];
    if (rects.length > 0 && rects[0].height > 0) {
      return rects[0];
    }
    // No rect for the collapsed position (empty line): the line box itself
    // is the caret's row, so first and last row coincide.
    const fallback = el.getBoundingClientRect();
    return fallback.height > 0 ? fallback : null;
  }

  // A wrapped logical line spans several visual rows. Arrow up/down should
  // only leave the line when the caret sits on the boundary row facing the
  // move; otherwise the browser's native caret motion walks the wrapped
  // rows. Without layout information every row counts as a boundary.
  private caretOnBoundaryRow(el: HTMLElement, edge: 'first' | 'last'): boolean {
    const caret = this.caretClientRect(el);
    if (!caret || caret.height === 0) {
      return true;
    }
    const line = el.getBoundingClientRect();
    if (line.height === 0) {
      return true;
    }
    return edge === 'first'
      ? caret.top - line.top < caret.height / 2
      : line.bottom - caret.bottom < caret.height / 2;
  }

  private handleKeydown(event: KeyboardEvent, index: number, el: HTMLElement): void {
    const { start: offset, end } = this.readDomRange(el);
    const hasSelection = end > offset;
    const line = this.lines[index];
    if (event.key === 'Enter') {
      event.preventDefault();
      this.needsFullRender = true;
      this.lines.splice(index, 1, line.slice(0, offset), line.slice(end));
      this.activate(index + 1, 0);
      this.onInput();
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && hasSelection) {
      event.preventDefault();
      this.needsFullRender = true;
      this.lines[index] = line.slice(0, offset) + line.slice(end);
      this.activate(index, offset);
      this.onInput();
      return;
    }
    if (event.key === 'Backspace' && offset === 0 && index > 0) {
      event.preventDefault();
      this.needsFullRender = true;
      const previous = this.lines[index - 1];
      this.lines.splice(index - 1, 2, previous + line);
      this.activate(index - 1, previous.length);
      this.onInput();
      return;
    }
    if (event.key === 'Delete' && offset === line.length && index < this.lines.length - 1) {
      event.preventDefault();
      this.needsFullRender = true;
      this.lines.splice(index, 2, line + this.lines[index + 1]);
      this.activate(index, offset);
      this.onInput();
      return;
    }
    if (event.key === 'ArrowUp') {
      if (index > 0 && this.caretOnBoundaryRow(el, 'first')) {
        event.preventDefault();
        this.activate(index - 1, offset, true);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      if (index < this.lines.length - 1 && this.caretOnBoundaryRow(el, 'last')) {
        event.preventDefault();
        this.activate(index + 1, offset, true);
      }
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
    const { start: offset, end } = this.readDomRange(el);
    this.needsFullRender = true;
    const line = this.lines[index];
    const pasted = text.split('\n');
    pasted[0] = line.slice(0, offset) + pasted[0];
    const tailOffset = pasted[pasted.length - 1].length;
    pasted[pasted.length - 1] += line.slice(end);
    this.lines.splice(index, 1, ...pasted);
    this.activate(index + pasted.length - 1, tailOffset);
    this.onInput();
  }

  // Nearest line index for a container-level click at clientY. Clicks in the
  // margin gap between two lines resolve to whichever line edge is closer;
  // clicks below the last line resolve to it. Falls back to the last line
  // when the environment provides no layout information.
  private lineIndexFromY(y: number): number {
    const children = this.container.children;
    if (children.length === 0 || this.container.getBoundingClientRect().height === 0) {
      return this.lines.length - 1;
    }
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (y > rect.bottom) {
        continue;
      }
      if (y >= rect.top || i === 0) {
        return i;
      }
      const previous = children[i - 1].getBoundingClientRect();
      return y - previous.bottom <= rect.top - y ? i - 1 : i;
    }
    return children.length - 1;
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
    if (!lineEl) {
      // Clicks land on the container itself when they hit the margin gap
      // between lines or the empty area below the last line. Map the click
      // to the nearest line instead of assuming end-of-document.
      if (target === this.container) {
        const index = this.lineIndexFromY(event.clientY);
        this.activate(index, this.lines[index].length);
      }
      return;
    }
    if (lineEl.classList.contains('ww-active')) {
      return;
    }
    const index = Number(lineEl.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }
    if (target.classList.contains('ww-checkbox')) {
      this.toggleTask(index);
      return;
    }
    this.activate(index, this.lines[index].length);
  }
}

export type { EditorOptions };
export { MarkdownEditor };
