// Text a person must see as written, never as it would act: a word a link spelled (sdk-v2
// 96b2a58 parseLink `word`) may hold the very characters that broke the rule. Controls, invisible
// format characters (bidi overrides and isolates, zero-width joiners, the BOM), line and paragraph
// separators, private-use and unassigned code points show as "[U+202E]" instead of acting, and
// the text is capped. Render the result as Lit text, inside a <bdi>, never as markup or a URL.

const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;

/** At most `max` characters of `text`, each hidden one as "[U+XXXX]", then "…" if cut. */
export function visibleText(text: string, max = 64): string {
  let out = '';
  let n = 0;
  for (const ch of text) {
    if (n === max) return `${out}…`;
    const cp = ch.codePointAt(0) ?? 0;
    out += HIDDEN.test(ch) ? `[U+${cp.toString(16).toUpperCase().padStart(4, '0')}]` : ch;
    n++;
  }
  return out;
}
