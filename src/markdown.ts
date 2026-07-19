/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

type LineKind =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'task'
  | 'bullet'
  | 'ordered'
  | 'hr'
  | 'quote'
  | 'fence'
  | 'code'
  | 'blank'
  | 'p';

interface RenderedLine {
  kind: LineKind;
  html: string;
  checked?: boolean;
  marker?: string;
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const TASK_RE = /^- \[( |x|X)\] (.*)$/;
const ORDERED_RE = /^(\d+)\. (.*)$/;

// Inline transforms run on escaped text. Code spans are lifted out first so
// their content is never re-transformed, then restored at the end.
const renderInline = (text: string): string => {
  const codeSpans: string[] = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\uE000${codeSpans.length - 1}\uE001`;
  });
  out = out
    .replace(/\*\*([^*]+(?:\*[^*]+)*)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
  return out.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => codeSpans[Number(i)] ?? '');
};

const renderLine = (line: string, inFence: boolean): RenderedLine => {
  if (/^```/.test(line)) {
    return { kind: 'fence', html: escapeHtml(line) };
  }
  if (inFence) {
    return { kind: 'code', html: escapeHtml(line) };
  }
  if (line.trim() === '') {
    return { kind: 'blank', html: '' };
  }
  const heading = /^(#{1,3}) (.*)$/.exec(line);
  if (heading) {
    const kind = `h${heading[1].length}` as LineKind;
    return { kind, html: renderInline(heading[2]) };
  }
  const task = TASK_RE.exec(line);
  if (task) {
    return { kind: 'task', html: renderInline(task[2]), checked: task[1] !== ' ' };
  }
  if (/^-{3,}$/.test(line)) {
    return { kind: 'hr', html: '' };
  }
  const bullet = /^[-*] (.*)$/.exec(line);
  if (bullet) {
    return { kind: 'bullet', html: renderInline(bullet[1]) };
  }
  const ordered = ORDERED_RE.exec(line);
  if (ordered) {
    return { kind: 'ordered', html: renderInline(ordered[2]), marker: `${ordered[1]}.` };
  }
  const quote = /^> (.*)$/.exec(line);
  if (quote) {
    return { kind: 'quote', html: renderInline(quote[1]) };
  }
  return { kind: 'p', html: renderInline(line) };
};

// For each line, whether it sits INSIDE an open code fence (delimiters excluded).
const computeFenceStates = (lines: string[]): boolean[] => {
  let open = false;
  return lines.map((line) => {
    if (/^```/.test(line)) {
      open = !open;
      return false;
    }
    return open;
  });
};

const toggleTaskLine = (line: string): string | null => {
  const task = TASK_RE.exec(line);
  if (!task) {
    return null;
  }
  const next = task[1] === ' ' ? 'x' : ' ';
  return `- [${next}] ${task[2]}`;
};

export { computeFenceStates, escapeHtml, renderInline, renderLine, toggleTaskLine };
export type { LineKind, RenderedLine };
