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
import { MarkdownEditor } from './editor.js';

const setup = (initial = '') => {
  document.body.innerHTML = '<div id="pad"></div>';
  const container = document.getElementById('pad') as HTMLElement;
  const onInput = vi.fn();
  const onCaretMove = vi.fn();
  const editor = new MarkdownEditor({ container, onInput, onCaretMove });
  if (initial !== '') {
    editor.value = initial;
  }
  return { container, editor, onInput, onCaretMove };
};

const key = (el: HTMLElement, keyName: string) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }));
};

describe('MarkdownEditor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('starts with one empty active line', () => {
    const { container, editor } = setup();
    expect(editor.value).toBe('');
    expect(container.children).toHaveLength(1);
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
  });

  it('renders non-active lines as rich text', () => {
    const { container, editor } = setup('# Title\nplain **bold**\n- [x] done\n');
    editor.setSelectionRange(editor.value.length);
    expect(container.children).toHaveLength(4);
    expect(container.children[0].className).toContain('ww-h1');
    expect(container.children[0].innerHTML).toBe('Title');
    expect(container.children[1].innerHTML).toContain('<strong>bold</strong>');
    const task = container.children[2] as HTMLElement;
    expect(task.className).toContain('ww-task');
    expect(task.className).toContain('ww-done');
    expect(task.querySelector('.ww-checkbox')?.className).toContain('ww-checked');
  });

  it('value getter joins lines with newlines', () => {
    const { editor } = setup('a\nb');
    expect(editor.value).toBe('a\nb');
  });

  it('activates a rendered line on click and shows raw markdown', () => {
    const { container, editor } = setup('# Title\nsecond');
    editor.setSelectionRange(editor.value.length);
    const first = container.children[0] as HTMLElement;
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const active = container.children[0] as HTMLElement;
    expect(active.classList.contains('ww-active')).toBe(true);
    expect(active.textContent).toBe('# Title');
  });

  it('updates the model on input in the active line', () => {
    const { container, editor, onInput } = setup('hello');
    editor.setSelectionRange(0);
    const active = container.children[0] as HTMLElement;
    active.textContent = 'hello world';
    active.dispatchEvent(new Event('input', { bubbles: false }));
    expect(editor.value).toBe('hello world');
    expect(onInput).toHaveBeenCalled();
  });

  it('splits the line on Enter at the caret', () => {
    const { container, editor, onInput } = setup('helloworld');
    editor.setSelectionRange(5);
    key(container.children[0] as HTMLElement, 'Enter');
    expect(editor.value).toBe('hello\nworld');
    expect(container.children).toHaveLength(2);
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
    expect(onInput).toHaveBeenCalled();
  });

  it('merges with the previous line on Backspace at offset 0', () => {
    const { container, editor } = setup('hello\nworld');
    editor.setSelectionRange(6);
    key(container.children[1] as HTMLElement, 'Backspace');
    expect(editor.value).toBe('helloworld');
    expect(editor.selectionStart).toBe(5);
  });

  it('merges with the next line on Delete at end of line', () => {
    const { container, editor } = setup('hello\nworld');
    editor.setSelectionRange(5);
    key(container.children[0] as HTMLElement, 'Delete');
    expect(editor.value).toBe('helloworld');
  });

  it('moves the active line with ArrowUp and ArrowDown', () => {
    const { container, editor } = setup('one\ntwo');
    editor.setSelectionRange(5);
    key(container.children[1] as HTMLElement, 'ArrowUp');
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    key(container.children[0] as HTMLElement, 'ArrowDown');
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
  });

  it('wraps to adjacent lines with ArrowLeft and ArrowRight at boundaries', () => {
    const { container, editor } = setup('ab\ncd');
    editor.setSelectionRange(3);
    key(container.children[1] as HTMLElement, 'ArrowLeft');
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(2);
    key(container.children[0] as HTMLElement, 'ArrowRight');
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(3);
  });

  it('maps absolute selection offsets across lines', () => {
    const { editor } = setup('ab\ncde\nf');
    editor.setSelectionRange(5);
    expect(editor.selectionStart).toBe(5);
    editor.setSelectionRange(999);
    expect(editor.selectionStart).toBe(editor.value.length);
  });

  it('toggles a task checkbox on click without activating the line', () => {
    const { container, editor, onInput } = setup('- [ ] walk\nother');
    editor.setSelectionRange(editor.value.length);
    const box = container.querySelector('.ww-checkbox') as HTMLElement;
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editor.value).toBe('- [x] walk\nother');
    expect(onInput).toHaveBeenCalled();
    expect(container.children[0].classList.contains('ww-active')).toBe(false);
  });

  it('renders lines inside a code fence as code', () => {
    const { container, editor } = setup('```\n- not a bullet\n```\nafter');
    editor.setSelectionRange(editor.value.length);
    expect(container.children[1].className).toContain('ww-code');
    expect(container.children[0].className).toContain('ww-fence');
  });

  it('splices multi-line pastes into the model', () => {
    const { container, editor } = setup('ab');
    editor.setSelectionRange(1);
    const active = container.children[0] as HTMLElement;
    const event = new Event('paste', { bubbles: false, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => 'X\nY' },
    });
    active.dispatchEvent(event);
    expect(editor.value).toBe('aX\nYb');
    expect(editor.selectionStart).toBe(4);
  });

  it('re-renders following lines when a fence is typed', () => {
    const { container, editor } = setup('```\n- item');
    editor.setSelectionRange(0);
    const active = container.children[0] as HTMLElement;
    expect(container.children[1].className).toContain('ww-code');
    active.textContent = 'x';
    active.dispatchEvent(new Event('input'));
    expect(container.children[1].className).toContain('ww-bullet');
  });

  it('clamps state when value is replaced with shorter text', () => {
    const { editor } = setup('one\ntwo\nthree');
    editor.setSelectionRange(12);
    editor.value = 'short';
    expect(editor.value).toBe('short');
    expect(editor.selectionStart).toBeLessThanOrEqual(5);
  });

  it('renders ordered lines with their marker', () => {
    const { container, editor } = setup('2. second\nx');
    editor.setSelectionRange(editor.value.length);
    const line = container.children[0] as HTMLElement;
    expect(line.querySelector('.ww-marker')?.textContent).toBe('2.');
  });

  it('works without onInput/onCaretMove callbacks', () => {
    document.body.innerHTML = '<div id="solo"></div>';
    const container = document.getElementById('solo') as HTMLElement;
    const editor = new MarkdownEditor({ container });
    editor.value = 'ab';
    editor.setSelectionRange(1);
    key(container.children[0] as HTMLElement, 'Enter');
    expect(editor.value).toBe('a\nb');
  });

  it('tolerates a missing selection API', () => {
    const { container, editor } = setup('abc');
    const original = globalThis.getSelection;
    vi.stubGlobal('getSelection', () => null);
    editor.focus();
    key(container.children[0] as HTMLElement, 'Enter');
    expect(editor.value).toContain('\n');
    vi.stubGlobal('getSelection', original);
    vi.unstubAllGlobals();
  });

  it('falls back to the cached offset when the selection has no ranges', () => {
    const { container, editor } = setup('abcd');
    editor.setSelectionRange(2);
    const original = globalThis.getSelection;
    vi.stubGlobal('getSelection', () => ({
      rangeCount: 0,
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    }));
    key(container.children[0] as HTMLElement, 'Enter');
    expect(editor.value).toBe('ab\ncd');
    vi.stubGlobal('getSelection', original);
    vi.unstubAllGlobals();
  });

  it('ignores clicks on links and on the container background', () => {
    const { container, editor } = setup('[site](https://example.com)\nother');
    editor.setSelectionRange(editor.value.length);
    const anchor = container.querySelector('a') as HTMLElement;
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.children[0].classList.contains('ww-active')).toBe(false);
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.children[0].classList.contains('ww-active')).toBe(false);
  });

  it('ignores paste events without clipboard data', () => {
    const { container, editor } = setup('ab');
    editor.setSelectionRange(1);
    const active = container.children[0] as HTMLElement;
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    active.dispatchEvent(event);
    expect(editor.value).toBe('ab');
  });

  const selectInActive = (el: HTMLElement, start: number, end: number) => {
    const node = el.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  it('replaces a selection on Enter instead of duplicating it', () => {
    const { container, editor } = setup('hello world');
    editor.setSelectionRange(0);
    const active = container.children[0] as HTMLElement;
    selectInActive(active, 3, 8);
    key(active, 'Enter');
    expect(editor.value).toBe('hel\nrld');
  });

  it('deletes a selection on Backspace without merging lines', () => {
    const { container, editor } = setup('first\nsecond');
    editor.setSelectionRange(6);
    const active = container.children[1] as HTMLElement;
    selectInActive(active, 0, 3);
    key(active, 'Backspace');
    expect(editor.value).toBe('first\nond');
  });

  it('deletes a selection on Delete without merging lines', () => {
    const { container, editor } = setup('first\nsecond');
    editor.setSelectionRange(6);
    const active = container.children[1] as HTMLElement;
    selectInActive(active, 2, 6);
    key(active, 'Delete');
    expect(editor.value).toBe('first\nse');
  });

  it('resolves offsets across multiple text nodes in the active line', () => {
    const { container, editor } = setup('abcdef');
    editor.setSelectionRange(0);
    const active = container.children[0] as HTMLElement;
    active.textContent = '';
    active.appendChild(document.createTextNode('abc'));
    active.appendChild(document.createTextNode('def'));
    const range = document.createRange();
    range.setStart(active.childNodes[1], 2);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    key(active, 'Enter');
    expect(editor.value).toBe('abcde\nf');
  });

  it('activates the end of the document when clicking empty space below', () => {
    const { container, editor } = setup('one\ntwo\nthree');
    editor.setSelectionRange(0);
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.children[2].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(editor.value.length);
  });

  it('marks fence delimiters with open and close roles', () => {
    const { container, editor } = setup('```\ncode\n```\nafter');
    editor.setSelectionRange(editor.value.length);
    expect(container.children[0].classList.contains('ww-fence-open')).toBe(true);
    expect(container.children[2].classList.contains('ww-fence-close')).toBe(true);
  });

  it('marks both delimiters of an empty fence', () => {
    const { container, editor } = setup('```\n```\nafter');
    editor.setSelectionRange(editor.value.length);
    expect(container.children[0].classList.contains('ww-fence-open')).toBe(true);
    expect(container.children[1].classList.contains('ww-fence-close')).toBe(true);
  });

  it('styles the active line as code when inside a fence', () => {
    const { container, editor } = setup('```\ninside\n```');
    editor.setSelectionRange(5);
    expect(container.children[1].classList.contains('ww-active-code')).toBe(true);
  });

  it('keeps other line elements stable on pure caret moves', () => {
    const { container, editor } = setup('one\ntwo\nthree\nfour');
    editor.setSelectionRange(0);
    const stable = container.children[3];
    key(container.children[0] as HTMLElement, 'ArrowDown');
    expect(container.children[3]).toBe(stable);
  });

  it('focus() re-activates the current line', () => {
    const { container, editor, onCaretMove } = setup('abc');
    onCaretMove.mockClear();
    editor.focus();
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    expect(onCaretMove).toHaveBeenCalled();
  });

  it('preserves goal column on arrow up/down to lines of different lengths', () => {
    const { container, editor } = setup('short\nmuch longer line');
    // Place caret at end of first line (offset 5)
    editor.setSelectionRange(5);
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    // Arrow down to longer line; caret should try to stay at column 5
    key(container.children[0] as HTMLElement, 'ArrowDown');
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(11); // "short\n" + 5 = 11
    // Arrow down then up should restore position
    key(container.children[1] as HTMLElement, 'ArrowUp');
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(5); // back to end of first line
  });

  it('keyboard toggles task checkbox with Space key', () => {
    const { container, editor, onInput } = setup('placeholder\n- [x] done task');
    // Activate first line so second line is rendered with checkbox visible
    editor.setSelectionRange(0);
    onInput.mockClear();
    const checkbox = container.querySelector('.ww-checkbox') as HTMLElement | null;
    if (checkbox) {
      checkbox.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }),
      );
      expect(editor.value).toContain('- [ ] done task');
      expect(onInput).toHaveBeenCalled();
    }
  });

  it('keyboard toggles task checkbox with Enter key', () => {
    const { container, editor, onInput } = setup('x\n- [ ] unchecked');
    // Activate first line so second line is rendered
    editor.setSelectionRange(0);
    onInput.mockClear();
    const checkbox = container.querySelector('.ww-checkbox') as HTMLElement | null;
    if (checkbox) {
      checkbox.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      expect(editor.value).toContain('- [x] unchecked');
      expect(onInput).toHaveBeenCalled();
    }
  });

  it('handles setSelectionRange beyond document length', () => {
    const { container, editor } = setup('abc');
    editor.setSelectionRange(999);
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(3); // clamped to end
  });

  it('clamps arrow up/down to first and last lines', () => {
    const { container, editor } = setup('first\nsecond');
    editor.setSelectionRange(0);
    key(container.children[0] as HTMLElement, 'ArrowUp');
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    editor.setSelectionRange(editor.value.length);
    key(container.children[1] as HTMLElement, 'ArrowDown');
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
  });

  it('clamps goal column when moving to a shorter line', () => {
    const { container, editor } = setup('very long line here\nshort');
    // Position at end of long line (offset 19)
    editor.setSelectionRange(19);
    // Move down to shorter line; should clamp to end of that line (offset 5)
    key(container.children[0] as HTMLElement, 'ArrowDown');
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
    // Caret should be clamped to "short".length = 5
    const offsetInSecondLine = editor.selectionStart - 20; // "very long line here\n" = 20 chars
    expect(offsetInSecondLine).toBe(5);
  });

  it('ignores keydown on checkbox if not from the checkbox itself', () => {
    const { container, editor, onInput } = setup('x\n- [x] task');
    editor.setSelectionRange(0);
    onInput.mockClear();
    const checkbox = container.querySelector('.ww-checkbox') as HTMLElement | null;
    if (checkbox) {
      // Create an event but set a different target
      const event = new KeyboardEvent('keydown', {
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: { other: 'element' }, enumerable: true });
      checkbox.dispatchEvent(event);
      // Task should not have changed since the event target wasn't the checkbox
      expect(editor.value).toContain('- [x] task');
      expect(onInput).not.toHaveBeenCalled();
    }
  });

  it('handles multiple arrow key sequences', () => {
    const { container, editor } = setup('line1\nline2\nline3');
    editor.setSelectionRange(0);
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    key(container.children[0] as HTMLElement, 'ArrowDown');
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
    key(container.children[1] as HTMLElement, 'ArrowDown');
    expect(container.children[2].classList.contains('ww-active')).toBe(true);
    key(container.children[2] as HTMLElement, 'ArrowUp');
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
  });

  it('handles ArrowLeft at start of line merging with previous line', () => {
    const { container, editor, onInput } = setup('prev\ncurr');
    editor.setSelectionRange(5); // start of second line
    onInput.mockClear();
    key(container.children[1] as HTMLElement, 'ArrowLeft');
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(4); // end of first line
  });

  it('handles ArrowRight at end of line merging with next line', () => {
    const { container, editor } = setup('curr\nnext');
    editor.setSelectionRange(4); // end of first line
    key(container.children[0] as HTMLElement, 'ArrowRight');
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(5); // start of second line
  });

  it('restores text from remote storage that differs from current', () => {
    const { editor } = setup('initial');
    const newText = 'updated text from sync';
    editor.value = newText;
    expect(editor.value).toBe(newText);
  });

  it('renders code fences with proper open/close markers', () => {
    const { container, editor } = setup('before\n```\ncode\n```\nafter');
    editor.setSelectionRange(0);
    expect(container.children[1].classList.contains('ww-fence-open')).toBe(true);
    expect(container.children[3].classList.contains('ww-fence-close')).toBe(true);
  });

  it('activates line within a code fence as ww-active-code', () => {
    const { container, editor } = setup('```\ncode\n```');
    // Activate the code line (middle line)
    editor.setSelectionRange(4);
    const activeLine = container.children[1] as HTMLElement;
    expect(activeLine.classList.contains('ww-active')).toBe(true);
    expect(activeLine.classList.contains('ww-active-code')).toBe(true);
  });

  // ── Visual-row aware arrow navigation (wrapped lines) ─────────

  const rect = (top: number, bottom: number): DOMRect =>
    ({
      top,
      bottom,
      height: bottom - top,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
    }) as DOMRect;

  // Fake selection whose caret reports the given client rects — jsdom has no
  // layout, so wrapped-line geometry must be simulated.
  const stubCaretSelection = (el: HTMLElement, offset: number, caretRects: DOMRect[]) => {
    const node = el.firstChild ?? el;
    vi.stubGlobal('getSelection', () => ({
      rangeCount: 1,
      getRangeAt: () => ({
        startContainer: node,
        startOffset: offset,
        endContainer: node,
        endOffset: offset,
        cloneRange() {
          return this;
        },
        collapse: () => undefined,
        getClientRects: () => caretRects,
      }),
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    }));
  };

  const dispatchKey = (el: HTMLElement, keyName: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', {
      key: keyName,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event;
  };

  it('keeps the caret inside a wrapped line on ArrowDown from a middle row', () => {
    const { container, editor } = setup('a long wrapped paragraph\nnext');
    editor.setSelectionRange(5);
    const active = container.children[0] as HTMLElement;
    active.getBoundingClientRect = () => rect(0, 90);
    stubCaretSelection(active, 5, [rect(30, 45)]);
    const event = dispatchKey(active, 'ArrowDown');
    expect(event.defaultPrevented).toBe(false);
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('leaves a wrapped line on ArrowDown from its last visual row', () => {
    const { container, editor } = setup('a long wrapped paragraph\nnext');
    editor.setSelectionRange(5);
    const active = container.children[0] as HTMLElement;
    active.getBoundingClientRect = () => rect(0, 90);
    stubCaretSelection(active, 20, [rect(62, 88)]);
    const event = dispatchKey(active, 'ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('keeps the caret inside a wrapped line on ArrowUp from a middle row', () => {
    const { container, editor } = setup('prev\na long wrapped paragraph');
    editor.setSelectionRange(10);
    const active = container.children[1] as HTMLElement;
    active.getBoundingClientRect = () => rect(100, 190);
    stubCaretSelection(active, 5, [rect(130, 145)]);
    const event = dispatchKey(active, 'ArrowUp');
    expect(event.defaultPrevented).toBe(false);
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('leaves a wrapped line on ArrowUp from its first visual row', () => {
    const { container, editor } = setup('prev\na long wrapped paragraph');
    editor.setSelectionRange(10);
    const active = container.children[1] as HTMLElement;
    active.getBoundingClientRect = () => rect(100, 190);
    stubCaretSelection(active, 2, [rect(100, 126)]);
    const event = dispatchKey(active, 'ArrowUp');
    expect(event.defaultPrevented).toBe(true);
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('treats a line without caret rects as a single visual row', () => {
    const { container, editor } = setup('one\ntwo');
    editor.setSelectionRange(5);
    const active = container.children[1] as HTMLElement;
    active.getBoundingClientRect = () => rect(0, 30);
    stubCaretSelection(active, 0, []);
    const event = dispatchKey(active, 'ArrowUp');
    expect(event.defaultPrevented).toBe(true);
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    vi.unstubAllGlobals();
  });

  // ── Click-to-nearest-line mapping ─────────────────────────────

  const mockLineRects = (container: HTMLElement, rects: DOMRect[], containerHeight = 500) => {
    container.getBoundingClientRect = () => rect(0, containerHeight);
    Array.from(container.children).forEach((child, i) => {
      (child as HTMLElement).getBoundingClientRect = () => rects[i];
    });
  };

  const clickAt = (container: HTMLElement, clientY: number) => {
    container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY }));
  };

  it('activates the closer line when clicking the margin gap between lines', () => {
    const { container, editor } = setup('one\ntwo\nthree');
    editor.setSelectionRange(0);
    const rects = [rect(0, 30), rect(60, 90), rect(120, 150)];
    mockLineRects(container, rects);
    clickAt(container, 40); // gap: 10px below line 0, 20px above line 1
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(3);

    mockLineRects(container, rects);
    clickAt(container, 55); // gap: 25px below line 0, 5px above line 1
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(7);
  });

  it('activates the line whose box contains a container-level click', () => {
    const { container, editor } = setup('one\ntwo\nthree');
    editor.setSelectionRange(0);
    mockLineRects(container, [rect(0, 30), rect(60, 90), rect(120, 150)]);
    clickAt(container, 75);
    expect(container.children[1].classList.contains('ww-active')).toBe(true);
  });

  it('activates the first line when clicking above it', () => {
    const { container, editor } = setup('one\ntwo');
    editor.setSelectionRange(editor.value.length);
    mockLineRects(container, [rect(20, 50), rect(80, 110)]);
    clickAt(container, 5);
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
  });

  it('activates the end of the document when clicking below the last line', () => {
    const { container, editor } = setup('one\ntwo\nthree');
    editor.setSelectionRange(0);
    mockLineRects(container, [rect(0, 30), rect(60, 90), rect(120, 150)]);
    clickAt(container, 400);
    expect(container.children[2].classList.contains('ww-active')).toBe(true);
    expect(editor.selectionStart).toBe(editor.value.length);
  });

  // ── Caret offset re-sync after native caret movement ─────────

  it('re-syncs the cached caret offset on keyup after native movement keys', () => {
    const { container, editor, onCaretMove } = setup('hello world');
    editor.setSelectionRange(0);
    const active = container.children[0] as HTMLElement;
    // Simulate the browser having moved the caret natively to offset 5.
    const range = document.createRange();
    range.setStart(active.firstChild as Text, 5);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    onCaretMove.mockClear();
    active.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(editor.selectionStart).toBe(5);
    expect(onCaretMove).toHaveBeenCalled();
  });

  it('ignores keyup from non-movement keys', () => {
    const { container, editor, onCaretMove } = setup('hello');
    editor.setSelectionRange(2);
    const active = container.children[0] as HTMLElement;
    onCaretMove.mockClear();
    active.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    expect(onCaretMove).not.toHaveBeenCalled();
    expect(editor.selectionStart).toBe(2);
  });
});

describe('MarkdownEditor line patching', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('patches only changed lines instead of rebuilding all', () => {
    const { container, editor } = setup('alpha\nbravo\ncharlie');
    const untouched = container.children[2];
    const changed = container.children[1];
    editor.applyExternal('alpha\nBRAVO\ncharlie');
    expect(editor.value).toBe('alpha\nBRAVO\ncharlie');
    expect(container.children[2]).toBe(untouched);
    expect(container.children[1]).not.toBe(changed);
    expect(container.children[1].textContent).toBe('BRAVO');
  });

  it('leaves the DOM untouched when the text is identical', () => {
    const { container, editor } = setup('same\ntext');
    const nodes = Array.from(container.children);
    editor.applyExternal('same\ntext');
    expect(Array.from(container.children)).toEqual(nodes);
  });

  it('handles line insertion and removal', () => {
    const { container, editor } = setup('one\ntwo');
    editor.applyExternal('one\nmid\ntwo');
    expect(editor.value).toBe('one\nmid\ntwo');
    expect(container.children).toHaveLength(3);
    editor.applyExternal('one');
    expect(editor.value).toBe('one');
    expect(container.children).toHaveLength(1);
  });

  it('reindexes retained lines after an insertion', () => {
    const { container, editor } = setup('head\n- [ ] task');
    editor.applyExternal('head\nNEW\n- [ ] task');
    expect((container.children[2] as HTMLElement).dataset.index).toBe('2');
    const checkbox = container.querySelector('.ww-checkbox') as HTMLElement;
    checkbox.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }),
    );
    expect(editor.value).toBe('head\nNEW\n- [x] task');
  });

  it('refreshes retained lines whose fence state changed', () => {
    const { container, editor } = setup('a\nb\nc');
    editor.applyExternal('```\nb\nc');
    expect(container.children[1].className).toContain('ww-code');
    expect(container.children[2].className).toContain('ww-code');
  });

  it('refreshes retained fence delimiters whose role flipped', () => {
    const { container, editor } = setup('x\n```code\ny');
    editor.applyExternal('```\n```code\ny');
    expect(container.children[1].classList.contains('ww-fence-close')).toBe(true);
    expect(container.children[1].classList.contains('ww-fence-open')).toBe(false);
  });

  it('falls back to a full render when the DOM and the model disagree', () => {
    const { container, editor } = setup('one\ntwo');
    container.removeChild(container.children[0]);
    editor.applyExternal('three\nfour');
    expect(container.children).toHaveLength(2);
    expect(container.children[1].textContent).toBe('four');
  });

  it('preserves the absolute caret offset across an external apply', () => {
    const { editor } = setup('first\nsecond');
    editor.setSelectionRange(8); // line 'second', offset 2
    editor.applyExternal('CHANGED\nsecond');
    expect(editor.selectionStart).toBe(8); // same absolute offset, remapped
  });

  it('keeps the active line editable when it sits inside the replaced window', () => {
    const { container, editor } = setup('one\ntwo\nthree');
    editor.setSelectionRange(5); // line 'two', offset 1
    editor.applyExternal('one\nTWO\nthree');
    const active = container.children[1] as HTMLElement;
    expect(active.classList.contains('ww-active')).toBe(true);
    expect(active.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(active.textContent).toBe('TWO');
  });

  it('clamps the caret when the document shrinks', () => {
    const { editor } = setup('long line here');
    editor.setSelectionRange(14);
    editor.applyExternal('ab');
    expect(editor.selectionStart).toBeLessThanOrEqual(2);
  });

  it('clamps the active line when the value setter shrinks the document', () => {
    const { container, editor } = setup('one\ntwo\nthree');
    editor.setSelectionRange(9); // line 'three'
    editor.value = 'solo';
    expect(editor.value).toBe('solo');
    expect(container.children).toHaveLength(1);
    expect(container.children[0].classList.contains('ww-active')).toBe(true);
  });
});
