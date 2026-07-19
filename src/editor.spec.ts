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
});
