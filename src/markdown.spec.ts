/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { describe, expect, it } from 'vitest';
import {
  computeFenceStates,
  escapeHtml,
  renderInline,
  renderLine,
  toggleTaskLine,
} from './markdown.js';

describe('escapeHtml', () => {
  it('escapes angle brackets, ampersands, and quotes', () => {
    expect(escapeHtml('<script>&"\'')).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });

  it('passes plain text through', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('renderInline', () => {
  it('renders bold', () => {
    expect(renderInline('a **bold** word')).toBe('a <strong>bold</strong> word');
  });

  it('renders emphasis with asterisks and underscores', () => {
    expect(renderInline('*em*')).toBe('<em>em</em>');
    expect(renderInline('_em_')).toBe('<em>em</em>');
  });

  it('renders strikethrough', () => {
    expect(renderInline('~~gone~~')).toBe('<del>gone</del>');
  });

  it('renders inline code and protects its content from other transforms', () => {
    expect(renderInline('run `pnpm **build**` now')).toBe('run <code>pnpm **build**</code> now');
  });

  it('escapes html inside inline code', () => {
    expect(renderInline('`<b>`')).toBe('<code>&lt;b&gt;</code>');
  });

  it('renders http(s) links', () => {
    expect(renderInline('[site](https://example.com)')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>',
    );
    expect(renderInline('[site](http://example.com)')).toContain('href="http://example.com"');
  });

  it('does not render javascript: links', () => {
    const out = renderInline('[x](javascript:alert(1))');
    expect(out).not.toContain('<a ');
  });

  it('escapes html outside code spans', () => {
    expect(renderInline('<img src=x>')).toBe('&lt;img src=x&gt;');
  });

  it('renders bold containing emphasis', () => {
    expect(renderInline('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>');
  });
});

describe('renderLine', () => {
  it('renders headings h1-h3', () => {
    expect(renderLine('# Title', false)).toEqual({ kind: 'h1', html: 'Title' });
    expect(renderLine('## Sub', false)).toEqual({ kind: 'h2', html: 'Sub' });
    expect(renderLine('### Small', false)).toEqual({ kind: 'h3', html: 'Small' });
  });

  it('does not treat #### as a heading', () => {
    expect(renderLine('#### nope', false).kind).toBe('p');
  });

  it('renders unchecked and checked task items', () => {
    expect(renderLine('- [ ] walk', false)).toEqual({
      kind: 'task',
      html: 'walk',
      checked: false,
    });
    expect(renderLine('- [x] walk', false)).toEqual({
      kind: 'task',
      html: 'walk',
      checked: true,
    });
    expect(renderLine('- [X] walk', false).checked).toBe(true);
  });

  it('renders bullet items with - and *', () => {
    expect(renderLine('- item', false)).toEqual({ kind: 'bullet', html: 'item' });
    expect(renderLine('* item', false)).toEqual({ kind: 'bullet', html: 'item' });
  });

  it('renders ordered items and preserves the number', () => {
    expect(renderLine('2. second', false)).toEqual({
      kind: 'ordered',
      html: 'second',
      marker: '2.',
    });
  });

  it('renders horizontal rules for 3+ dashes', () => {
    expect(renderLine('---', false).kind).toBe('hr');
    expect(renderLine('-----', false).kind).toBe('hr');
    expect(renderLine('--', false).kind).toBe('p');
  });

  it('renders blockquote lines', () => {
    expect(renderLine('> quoted', false)).toEqual({ kind: 'quote', html: 'quoted' });
  });

  it('renders fence delimiters and raw code inside fences', () => {
    expect(renderLine('```', false).kind).toBe('fence');
    expect(renderLine('```js', false).kind).toBe('fence');
    expect(renderLine('const a = **1**;', true)).toEqual({
      kind: 'code',
      html: 'const a = **1**;',
    });
    expect(renderLine('<b>', true).html).toBe('&lt;b&gt;');
  });

  it('renders blank lines', () => {
    expect(renderLine('', false).kind).toBe('blank');
    expect(renderLine('   ', false).kind).toBe('blank');
  });

  it('renders paragraphs with inline formatting', () => {
    expect(renderLine('plain **text**', false)).toEqual({
      kind: 'p',
      html: 'plain <strong>text</strong>',
    });
  });

  it('treats list syntax as raw code inside fences', () => {
    expect(renderLine('- item', true).kind).toBe('code');
  });
});

describe('computeFenceStates', () => {
  it('marks lines between fence delimiters as inside', () => {
    const lines = ['a', '```', 'code', '```', 'b'];
    expect(computeFenceStates(lines)).toEqual([false, false, true, false, false]);
  });

  it('leaves an unclosed fence open to the end', () => {
    expect(computeFenceStates(['```', 'x', 'y'])).toEqual([false, true, true]);
  });

  it('handles no fences', () => {
    expect(computeFenceStates(['a', 'b'])).toEqual([false, false]);
  });
});

describe('toggleTaskLine', () => {
  it('checks an unchecked task', () => {
    expect(toggleTaskLine('- [ ] walk')).toBe('- [x] walk');
  });

  it('unchecks a checked task', () => {
    expect(toggleTaskLine('- [x] walk')).toBe('- [ ] walk');
    expect(toggleTaskLine('- [X] walk')).toBe('- [ ] walk');
  });

  it('returns null for non-task lines', () => {
    expect(toggleTaskLine('plain')).toBeNull();
  });
});
