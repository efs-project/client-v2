// The EFS Markdown subset, parsed to plain data (docs/design/readme-markdown-options.md, (a)).
//
// - Blocks: ATX headings, paragraphs (soft and hard line breaks), fenced code, ordered and
//   unordered lists (nested by indentation), blockquotes, thematic breaks.
// - Inline: emphasis, strong, code spans, links and autolinks, backslash escapes.
// - Left out on purpose: raw HTML (it stays text), images (their alt text stays), tables, setext
//   headings and lazy continuation lines. Where this differs from CommonMark, this file is the
//   EFS Markdown subset.
// - It never produces HTML: markdown-view.ts renders this tree with Lit, which escapes every
//   text value, and decides which links may be links.

export type Inline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'em' | 'strong'; readonly c: readonly Inline[] }
  | { readonly t: 'code'; readonly v: string }
  | { readonly t: 'link'; readonly href: string; readonly c: readonly Inline[] }
  | { readonly t: 'br'; readonly hard: boolean };

export type Block =
  | { readonly t: 'p'; readonly c: readonly Inline[] }
  | { readonly t: 'h'; readonly level: number; readonly c: readonly Inline[] }
  | { readonly t: 'code'; readonly lang: string; readonly v: string }
  | { readonly t: 'quote'; readonly c: readonly Block[] }
  | { readonly t: 'ul'; readonly items: readonly (readonly Block[])[] }
  | { readonly t: 'ol'; readonly start: number; readonly items: readonly (readonly Block[])[] }
  | { readonly t: 'hr' };

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST = /^( {0,3})([-*+]|(\d{1,9})[.)])( +|$)(.*)$/;
const ESCAPABLE = '\\`*_{}[]()#+-.!<>|~';

const blank = (line: string) => line.trim() === '';
const indentOf = (line: string) => line.length - line.trimStart().length;

export function parseMarkdown(src: string): Block[] {
  return blocks(src.replace(/\r\n?/g, '\n').split('\n'));
}

/** Whether a line can end a paragraph by starting another block. */
function interrupts(line: string): boolean {
  if (ATX.test(line) || FENCE.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  const m = LIST.exec(line);
  // An ordered list interrupts a paragraph only from 1 ("2026. was a year" stays text).
  return m !== null && m[5] !== '' && (m[3] === undefined || m[3] === '1');
}

function blocks(lines: readonly string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence && !(fence[2]?.startsWith('`') && fence[3]?.includes('`'))) {
      const indent = fence[1]?.length ?? 0;
      const marker = fence[2] as string;
      const close = new RegExp(
        `^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`,
      );
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i] as string)) {
        const l = lines[i] as string;
        body.push(l.slice(Math.min(indent, indentOf(l))));
        i++;
      }
      i++;
      out.push({
        t: 'code',
        lang: (fence[3] ?? '').trim().split(/\s+/)[0] ?? '',
        v: body.join('\n'),
      });
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      out.push({ t: 'h', level: (atx[1] as string).length, c: parseInline((atx[2] ?? '').trim()) });
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] as string)) {
        inner.push((lines[i] as string).replace(QUOTE, ''));
        i++;
      }
      out.push({ t: 'quote', c: blocks(inner) });
      continue;
    }
    const item = LIST.exec(line);
    if (item && item[5] !== undefined) {
      const ordered = item[3] !== undefined;
      const items: Block[][] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i] as string);
        if (!m || (m[3] !== undefined) !== ordered) break;
        const spaces = (m[4] ?? '').length;
        const offset =
          (m[1] ?? '').length + (m[2] ?? '').length + (spaces > 4 || spaces === 0 ? 1 : spaces);
        const own = [m[5] ?? ''];
        i++;
        while (i < lines.length) {
          const l = lines[i] as string;
          if (blank(l)) {
            let j = i;
            while (j < lines.length && blank(lines[j] as string)) j++;
            if (j < lines.length && indentOf(lines[j] as string) >= offset) {
              for (; i < j; i++) own.push('');
              continue;
            }
            break;
          }
          if (indentOf(l) < offset) break;
          own.push(l.slice(offset));
          i++;
        }
        items.push(blocks(own));
        // Blank lines between two items of the same list don't end it.
        let j = i;
        while (j < lines.length && blank(lines[j] as string)) j++;
        const next = j < lines.length ? LIST.exec(lines[j] as string) : null;
        if (next && (next[3] !== undefined) === ordered) i = j;
        else break;
      }
      out.push(ordered ? { t: 'ol', start: Number(item[3]), items } : { t: 'ul', items });
      continue;
    }
    const para = [line.trimStart()];
    i++;
    while (i < lines.length && !blank(lines[i] as string) && !interrupts(lines[i] as string)) {
      para.push((lines[i] as string).trimStart());
      i++;
    }
    out.push({ t: 'p', c: parseInline(para.join('\n').trimEnd()) });
  }
  return out;
}

/** Appends `node`, joining it to a text node before it. */
function push(out: Inline[], node: Inline): void {
  const last = out.at(-1);
  if (node.t === 'text' && last?.t === 'text')
    out[out.length - 1] = { t: 'text', v: last.v + node.v };
  else out.push(node);
}

/** The text of inlines, for an image's alt text. */
function plain(nodes: readonly Inline[]): string {
  return nodes
    .map((n) =>
      n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : 'c' in n ? plain(n.c) : '',
    )
    .join('');
}

/** `[text](href "title")` at `at`: its text, href and where it ends; undefined when it isn't one. */
function linkAt(src: string, at: number): { text: string; href: string; end: number } | undefined {
  let depth = 0;
  let close = -1;
  for (let j = at; j < src.length; j++) {
    const ch = src[j];
    if (ch === '\\') {
      j++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) {
      close = j;
      break;
    }
  }
  if (close < 0 || src[close + 1] !== '(') return undefined;
  const rest = src.slice(close + 2);
  const m =
    /^[ \t]*(?:<([^<>\n]*)>|([^\s()<>]*(?:\([^\s()<>]*\)[^\s()<>]*)*))(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)/.exec(
      rest,
    );
  if (!m) return undefined;
  return { text: src.slice(at + 1, close), href: m[1] ?? m[2] ?? '', end: close + 2 + m[0].length };
}

const word = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** The length of the run of `ch` starting at `at`. */
function runOf(src: string, at: number, ch: string): number {
  let n = 0;
  while (src[at + n] === ch) n++;
  return n;
}

/**
 * Where an emphasis run of `len` (1: em, 2: strong) opened before `from` closes: a run of exactly
 * `len`, not after whitespace (and for "_" not inside a word). Code spans and escapes are skipped,
 * and so is a whole nested span of the other length, so "*a **b** c*" closes at the last "*".
 */
function closer(src: string, from: number, len: number, ch: string): number {
  let j = from;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '`') {
      const r = runOf(src, j, '`');
      let k = src.indexOf('`'.repeat(r), j + r);
      while (k >= 0 && runOf(src, k, '`') !== r)
        k = src.indexOf('`'.repeat(r), k + runOf(src, k, '`'));
      j = k >= 0 ? k + r : j + r;
      continue;
    }
    if (c !== ch) {
      j++;
      continue;
    }
    const n = runOf(src, j, ch);
    if (n === len) {
      const before = src[j - 1];
      if (before !== undefined && !/\s/.test(before) && (ch === '*' || !word(src[j + n]))) return j;
      j += n;
      continue;
    }
    // A nested span of the other length: skip all of it, when it closes.
    const other = n === 1 || n === 2 ? n : 0;
    if (other !== 0 && other !== len) {
      const end = closer(src, j + other, other, ch);
      if (end >= 0) {
        j = end + other;
        continue;
      }
    }
    j += n;
  }
  return -1;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) push(out, { t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    const next = src[i + 1];
    if (ch === '\\' && next === '\n') {
      flush();
      out.push({ t: 'br', hard: true });
      i += 2;
      continue;
    }
    if (ch === '\\' && next !== undefined && ESCAPABLE.includes(next)) {
      buf += next;
      i += 2;
      continue;
    }
    if (ch === '\n') {
      const hard = / {2,}$/.test(buf);
      buf = buf.replace(/ +$/, '');
      flush();
      out.push({ t: 'br', hard });
      i++;
      while (src[i] === ' ') i++;
      continue;
    }
    if (ch === '`') {
      const run = (/^`+/.exec(src.slice(i)) as RegExpExecArray)[0];
      let j = i + run.length;
      let end = -1;
      while (j < src.length) {
        const k = src.indexOf('`', j);
        if (k < 0) break;
        const r = (/^`+/.exec(src.slice(k)) as RegExpExecArray)[0];
        if (r.length === run.length) {
          end = k;
          break;
        }
        j = k + r.length;
      }
      if (end >= 0) {
        let v = src.slice(i + run.length, end).replace(/\n/g, ' ');
        if (v.length > 1 && v.startsWith(' ') && v.endsWith(' ') && v.trim() !== '')
          v = v.slice(1, -1);
        flush();
        out.push({ t: 'code', v });
        i = end + run.length;
        continue;
      }
      buf += run;
      i += run.length;
      continue;
    }
    if (ch === '!' && next === '[') {
      const l = linkAt(src, i + 1);
      if (l) {
        buf += plain(parseInline(l.text));
        i = l.end;
        continue;
      }
    }
    if (ch === '[') {
      const l = linkAt(src, i);
      if (l) {
        flush();
        out.push({ t: 'link', href: l.href, c: parseInline(l.text) });
        i = l.end;
        continue;
      }
    }
    if (ch === '<') {
      const m = /^<(https?:\/\/[^\s<>]+)>/.exec(src.slice(i));
      if (m) {
        flush();
        out.push({ t: 'link', href: m[1] as string, c: [{ t: 'text', v: m[1] as string }] });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const run = ch === next ? ch + ch : ch;
      const after = src[i + run.length];
      const opens = after !== undefined && !/\s/.test(after) && (ch === '*' || !word(src[i - 1]));
      const k = opens ? closer(src, i + run.length, run.length, ch) : -1;
      if (k > i + run.length) {
        flush();
        out.push({
          t: run.length === 2 ? 'strong' : 'em',
          c: parseInline(src.slice(i + run.length, k)),
        });
        i = k + run.length;
        continue;
      }
      buf += run;
      i += run.length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}
