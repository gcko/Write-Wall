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
    // Strip PUA sentinels used as code-span placeholders to prevent silent data loss.
    // See renderInline() for context:  and  are used as temporary markers
    // during inline transform. If user input contains these characters (rare but possible
    // from pasted font glyphs or accessibility tools), they would match the restore regex
    // at line 59, causing silent character deletion. This guard ensures such input is safe.
    .replace(/[]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const TASK_RE = /^- \[( |x|X)\] (.*)$/;
const ORDERED_RE = /^(\d+)\. (.*)$/;

// Emphasis regex order: *** (bold+em) before ** (bold) before * (em) to avoid
// partial matches. * and _ require non-space edges; _ additionally requires
// word boundaries so snake_case identifiers stay literal.
const applyEmphasis = (text: string): string =>
  text
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold: allow internal single asterisks for cases like **a *b* c**
    .replace(/\*\*([^*\n]+(?:\*[^*\n]+)*)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')
    .replace(/\*((?:[^\s*][^*\n]*?[^\s*])|[^\s*])\*/g, '<em>$1</em>')
    .replace(
      /(^|[^A-Za-z0-9_])_((?:[^\s_][^_\n]*?[^\s_])|[^\s_])_(?=[^A-Za-z0-9_]|$)/g,
      '$1<em>$2</em>',
    );

// Inline transforms run on escaped text. Code spans and links are lifted out
// into slots FIRST \u2014 code so its content is never re-transformed, links so
// emphasis markers inside URLs (underscores, asterisks) can't corrupt the
// href \u2014 then emphasis runs, then slots are restored.
const renderInline = (text: string): string => {
  const slots: string[] = [];
  const stash = (html: string): string => {
    slots.push(html);
    return `\uE000${slots.length - 1}\uE001`;
  };
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code: string) =>
    stash(`<code>${code}</code>`),
  );
  // URL charset allows one level of balanced parens (wiki-style links).
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g,
    (_m, label: string, url: string) =>
      stash(
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${applyEmphasis(label)}</a>`,
      ),
  );
  out = applyEmphasis(out);
  return out.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => slots[Number(i)] ?? '');
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

export type { LineKind, RenderedLine };
export { computeFenceStates, escapeHtml, renderInline, renderLine, toggleTaskLine };
