import { describe, expect, it } from 'vitest';
import { type Block, type Inline, parseInline, parseMarkdown } from './markdown.ts';

const text = (v: string): Inline => ({ t: 'text', v });
const p = (...c: Inline[]): Block => ({ t: 'p', c });

describe('the EFS Markdown subset: blocks', () => {
  const cases: [string, string, Block[]][] = [
    [
      'a paragraph, soft breaks joined',
      'one\ntwo',
      [p(text('one'), { t: 'br', hard: false }, text('two'))],
    ],
    ['blank lines split paragraphs', 'a\n\n\nb', [p(text('a')), p(text('b'))]],
    [
      'ATX headings, closing hashes dropped',
      '# Title\n### Sub ###',
      [
        { t: 'h', level: 1, c: [text('Title')] },
        { t: 'h', level: 3, c: [text('Sub')] },
      ],
    ],
    ['seven hashes is a paragraph', '####### no', [p(text('####### no'))]],
    ['a hash without a space is text', '#tag', [p(text('#tag'))]],
    ['thematic breaks', '***\n- - -\n___', [{ t: 'hr' }, { t: 'hr' }, { t: 'hr' }]],
    [
      'fenced code keeps its text exactly',
      '```js\nconst a = 1;\n  <b>x</b>\n```',
      [{ t: 'code', lang: 'js', v: 'const a = 1;\n  <b>x</b>' }],
    ],
    ['an unclosed fence runs to the end', '~~~\nopen', [{ t: 'code', lang: '', v: 'open' }]],
    [
      'a blockquote holds blocks',
      '> # Q\n> said',
      [{ t: 'quote', c: [{ t: 'h', level: 1, c: [text('Q')] }, p(text('said'))] }],
    ],
    [
      'unordered lists, any bullet',
      '- a\n* b\n+ c',
      [{ t: 'ul', items: [[p(text('a'))], [p(text('b'))], [p(text('c'))]] }],
    ],
    [
      'ordered lists keep their start',
      '3. three\n4. four',
      [{ t: 'ol', start: 3, items: [[p(text('three'))], [p(text('four'))]] }],
    ],
    [
      'nested lists by indentation',
      '- a\n  - b\n- c',
      [
        {
          t: 'ul',
          items: [[p(text('a')), { t: 'ul', items: [[p(text('b'))]] }], [p(text('c'))]],
        },
      ],
    ],
    ['raw HTML is text', '<script>alert(1)</script>', [p(text('<script>alert(1)</script>'))]],
  ];
  for (const [name, input, blocks] of cases) {
    it(name, () => expect(parseMarkdown(input)).toEqual(blocks));
  }
});

describe('the EFS Markdown subset: inline', () => {
  const cases: [string, string, Inline[]][] = [
    [
      'emphasis and strong',
      '*a* _b_ **c** __d__',
      [
        { t: 'em', c: [text('a')] },
        text(' '),
        { t: 'em', c: [text('b')] },
        text(' '),
        { t: 'strong', c: [text('c')] },
        text(' '),
        { t: 'strong', c: [text('d')] },
      ],
    ],
    ['underscores inside words are text', 'snake_case_name', [text('snake_case_name')]],
    ['code spans are literal', 'a `*b*` c', [text('a '), { t: 'code', v: '*b*' }, text(' c')]],
    ['double backticks hold a backtick', '`` a`b ``', [{ t: 'code', v: 'a`b' }]],
    [
      'links keep their text and href',
      '[docs](https://x.example/a "t")',
      [{ t: 'link', href: 'https://x.example/a', c: [text('docs')] }],
    ],
    [
      'autolinks',
      '<https://x.example>',
      [{ t: 'link', href: 'https://x.example', c: [text('https://x.example')] }],
    ],
    ['images show their alt text only', '![a cat](https://x.example/c.png)', [text('a cat')]],
    ['backslash escapes', '\\*not em\\*', [text('*not em*')]],
    ['an unmatched delimiter is text', 'a * b', [text('a * b')]],
    [
      'a hard break: two spaces, or a backslash',
      'a  \nb\\\nc',
      [text('a'), { t: 'br', hard: true }, text('b'), { t: 'br', hard: true }, text('c')],
    ],
  ];
  for (const [name, input, inlines] of cases) {
    it(name, () => expect(parseInline(input)).toEqual(inlines));
  }
});

describe('the EFS Markdown subset: edges', () => {
  it('link text may hold brackets; a destination may hold balanced parentheses', () => {
    expect(parseInline('[a [b] c](https://x.example/a_(b))')).toEqual([
      { t: 'link', href: 'https://x.example/a_(b)', c: [text('a [b] c')] },
    ]);
  });
  it('emphasis holds code and strong', () => {
    expect(parseInline('*a `b` **c** d*')).toEqual([
      {
        t: 'em',
        c: [
          text('a '),
          { t: 'code', v: 'b' },
          text(' '),
          { t: 'strong', c: [text('c')] },
          text(' d'),
        ],
      },
    ]);
  });
  it('unmatched openers stay text', () => {
    expect(parseInline('[not a link')).toEqual([text('[not a link')]);
    expect(parseInline('**half*')).toEqual([text('**half*')]);
    expect(parseInline('`open')).toEqual([text('`open')]);
  });
  it('a list item can hold two paragraphs; an unindented line ends the list', () => {
    expect(parseMarkdown('- one\n\n  more\n- two\nafter')).toEqual([
      { t: 'ul', items: [[p(text('one')), p(text('more'))], [p(text('two'))]] },
      p(text('after')),
    ]);
  });
  it('an ordered list interrupts a paragraph only from 1', () => {
    expect(parseMarkdown('In\n2026. it was')).toEqual([
      p(text('In'), { t: 'br', hard: false }, text('2026. it was')),
    ]);
    expect(parseMarkdown('Steps\n1. go')).toEqual([
      p(text('Steps')),
      { t: 'ol', start: 1, items: [[p(text('go'))]] },
    ]);
  });
  it('a backtick fence whose info has a backtick is text', () => {
    expect(parseMarkdown('``` a`b')).toEqual([p(text('``` a`b'))]);
  });
  it('a code span takes precedence over emphasis', () => {
    expect(parseInline('*a `b*` c*')).toEqual([
      { t: 'em', c: [text('a '), { t: 'code', v: 'b*' }, text(' c')] },
    ]);
  });
  it('a blockquote can hold a list', () => {
    expect(parseMarkdown('> - a\n> - b')).toEqual([
      { t: 'quote', c: [{ t: 'ul', items: [[p(text('a'))], [p(text('b'))]] }] },
    ]);
  });
  it('a bare "#" is an empty heading; CRLF lines read as LF', () => {
    expect(parseMarkdown('#\r\ntext')).toEqual([{ t: 'h', level: 1, c: [] }, p(text('text'))]);
  });
});
