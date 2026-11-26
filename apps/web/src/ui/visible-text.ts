// Text a person must see as written, never as it would act: a word a link spelled (sdk-v2
// 96b2a58 parseLink `word`, or any tag word typed into a link) may hold the very characters that
// broke the rule. These show as "[U+202E]" instead of acting, and the text is capped:
// - controls, invisible format characters (bidi overrides and isolates, zero-width joiners, the
//   BOM), surrogates, private-use and unassigned code points, line and paragraph separators;
// - every space character but the plain one, U+0020 (a no-break or ideographic space would pass
//   for a plain one; a plain space is what it looks like, so it stays);
// - combining marks beyond the second in a row (a pile of marks would draw over its neighbours);
// - a literal "[" itself, so "[U+…]" in the output can only ever be an escape.
// Render the result as Lit text, inside a <bdi>, never as markup or a URL.

const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}[]/u;
const MARK = /\p{M}/u;
/** Combining marks kept as drawn in one run; any more are escaped. */
const MARKS_SHOWN = 2;

const escaped = (cp: number): string => `[U+${cp.toString(16).toUpperCase().padStart(4, '0')}]`;

/** At most `max` characters of `text`, each hidden one as "[U+XXXX]", then "…" if cut. */
export function visibleText(text: string, max = 64): string {
  let out = '';
  let n = 0;
  let marks = 0;
  for (const ch of text) {
    if (n === max) return `${out}…`;
    const cp = ch.codePointAt(0) ?? 0;
    marks = MARK.test(ch) ? marks + 1 : 0;
    out += (HIDDEN.test(ch) && cp !== 0x20) || marks > MARKS_SHOWN ? escaped(cp) : ch;
    n++;
  }
  return out;
}
