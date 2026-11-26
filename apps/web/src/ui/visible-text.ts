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

/** The chain's limit on a label's text, in UTF-8 bytes. */
export const LABEL_MAX_BYTES = 255;

/**
 * A code point with no legitimate use in a label, shown as "[U+XXXX]": C0 and C1 controls, the
 * bidi controls (ALM, LRM, RLM, the embeddings and overrides, the isolates) and noncharacters.
 */
function hiddenInLabel(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x061c ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    (cp >= 0xfdd0 && cp <= 0xfdef) ||
    (cp & 0xfffe) === 0xfffe
  );
}

const utf8Length = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/**
 * A tag's label (its display name, "Sunset photos") as shown (PM, 2026-11-26). Labels arrive
 * through the person's RPC, which can lie, so the chain's text grammar is not the only defence:
 * controls, bidi controls and noncharacters are shown as "[U+XXXX]", and the text is capped at the
 * chain's 255 bytes. Everything else stays exactly as written: a no-break space, a zero-width
 * non-joiner (Persian), combining marks, emoji. Render as Lit text, inside the message's isolate
 * or a <bdi>.
 */
export function labelText(text: string): string {
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += utf8Length(cp);
    if (bytes > LABEL_MAX_BYTES) return `${out}…`;
    out += hiddenInLabel(cp) ? escaped(cp) : ch;
  }
  return out;
}
