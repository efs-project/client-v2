// Text a person must see as written, never as it would act (PM, 2026-11-26). A tag word or a
// tag's label may hold characters that act instead of showing: a bidi override that reorders the
// sentence around it, an invisible joiner, a control. They come back as parts: runs of text, and
// each hidden code point on its own. Rendered (visible), a hidden code point is its own element,
// a small pill ("U+202E", read as "hidden character U+202E"), so no text, a literal "[U+202E]"
// included, can pass for one. In plain-text contexts (an attribute, the title, the clipboard) it is
// the bracket form, "[U+202E]", where a look-alike is cosmetic, never a spoof of the page.
//
// Two rule sets:
// - a word (wordParts): controls, invisible format characters, surrogates, private-use and
//   unassigned code points, line and paragraph separators, every space but the plain one, and
//   combining marks past the second in a row; capped at 64 characters;
// - a label, a tag's display name (labelParts): lighter, since a label's spaces, joiners and marks
//   are its own. C0 and C1 controls, every format character except ZWNJ and ZWJ (a well-formed
//   emoji tag sequence, a subdivision flag, stays as written), line and paragraph separators,
//   surrogates, private-use code points, noncharacters, and combining marks past the fourth in a
//   row; capped at the chain's 255 bytes.
// Labels arrive through the person's RPC, which can lie, so the chain's own text grammar is not
// the only line of defence.

import { html } from './element.ts';
import type { Translator } from './i18n.ts';

/** A run of text, or one code point shown instead of applied. */
export type VisiblePart = string | { readonly hidden: number };
export type VisibleParts = readonly VisiblePart[];

const WORD_HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
const LABEL_HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
const MARK = /\p{M}/u;
const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const BLACK_FLAG = 0x1f3f4;
const TAG_FIRST = 0xe0020;
const TAG_LAST = 0xe007e;
const CANCEL_TAG = 0xe007f;

/** The chain's limit on a label's text, in UTF-8 bytes. */
export const LABEL_MAX_BYTES = 255;
/** A word shown is cut after this many characters. */
const WORD_MAX = 64;

const isNoncharacter = (cp: number): boolean =>
  (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe;
const utf8Length = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** Appends to `parts`, joining runs of text. */
function push(parts: VisiblePart[], part: VisiblePart): void {
  const last = parts.at(-1);
  if (typeof part === 'string' && typeof last === 'string') parts[parts.length - 1] = last + part;
  else parts.push(part);
}

/** A tag word as shown: see the header. */
export function wordParts(text: string, max = WORD_MAX): VisibleParts {
  const parts: VisiblePart[] = [];
  let n = 0;
  let marks = 0;
  for (const ch of text) {
    if (n === max) {
      push(parts, '…');
      break;
    }
    const cp = ch.codePointAt(0) ?? 0;
    marks = MARK.test(ch) ? marks + 1 : 0;
    const hidden = (WORD_HIDDEN.test(ch) && cp !== 0x20) || marks > 2;
    push(parts, hidden ? { hidden: cp } : ch);
    n++;
  }
  return parts;
}

/** Where a well-formed emoji tag sequence (🏴 + tag characters + CANCEL TAG) starting at `i` ends. */
function tagSequenceEnd(cps: readonly number[], i: number): number | undefined {
  if (cps[i] !== BLACK_FLAG) return undefined;
  let j = i + 1;
  while (j < cps.length && (cps[j] ?? 0) >= TAG_FIRST && (cps[j] ?? 0) <= TAG_LAST) j++;
  return j > i + 1 && cps[j] === CANCEL_TAG ? j : undefined;
}

/** A tag's label as shown: see the header. */
export function labelParts(text: string): VisibleParts {
  const cps = [...text].map((ch) => ch.codePointAt(0) ?? 0);
  const parts: VisiblePart[] = [];
  let bytes = 0;
  let marks = 0;
  for (let i = 0; i < cps.length; i++) {
    // A flag such as 🏴 England is one emoji tag sequence: kept whole, as written.
    const end = tagSequenceEnd(cps, i);
    const run = end === undefined ? [cps[i] ?? 0] : cps.slice(i, end + 1);
    const size = run.reduce((sum, cp) => sum + utf8Length(cp), 0);
    if (bytes + size > LABEL_MAX_BYTES) {
      push(parts, '…');
      break;
    }
    bytes += size;
    if (end !== undefined) {
      push(parts, String.fromCodePoint(...run));
      marks = 0;
      i = end;
      continue;
    }
    const cp = run[0] ?? 0;
    const ch = String.fromCodePoint(cp);
    marks = MARK.test(ch) ? marks + 1 : 0;
    const hidden =
      (LABEL_HIDDEN.test(ch) && cp !== ZWNJ && cp !== ZWJ) || isNoncharacter(cp) || marks > 4;
    push(parts, hidden ? { hidden: cp } : ch);
  }
  return parts;
}

/** A hidden code point's name: "U+202E". */
export const codeName = (cp: number): string =>
  `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** The bracket form, for plain-text contexts (attributes, the title, the clipboard). */
export function plainVisible(parts: VisibleParts): string {
  return parts.map((p) => (typeof p === 'string' ? p : `[${codeName(p.hidden)}]`)).join('');
}

/**
 * Parts as page content: text as text, each hidden code point as its own pill element, so no text
 * can pass for one. Lit text bindings only, never markup.
 */
export function visible(parts: VisibleParts, t: Translator['t']) {
  return parts.map((p) =>
    typeof p === 'string'
      ? p
      : html`<span
          class="efs-hidden-char"
          role="img"
          aria-label=${t('ui.hiddenChar', { code: codeName(p.hidden) })}
          >${codeName(p.hidden)}</span
        >`,
  );
}

/** Plain-text forms (kept for attributes and anything that can't hold an element). */
export const visibleText = (text: string, max = WORD_MAX): string =>
  plainVisible(wordParts(text, max));
export const labelText = (text: string): string => plainVisible(labelParts(text));
