// A message whose arguments may be shown parts (ui/visible-text.ts): a tag word or a label with
// its hidden code points as pills, inside a translated sentence. The message is formatted with a
// private-use placeholder for each such argument, then each placeholder is replaced by its parts,
// rendered. No data can forge a placeholder: wordParts and labelParts show every private-use code
// point, a plain argument has them replaced here, and the catalogue check refuses them in
// translations (tools/build/check-messages.ts). The message's own bidi isolate stays around each
// argument.

import type { MessageId, Translator } from './i18n.ts';
import { type VisibleParts, visible } from './visible-text.ts';

const FIRST = 0xe000;
const PLACEHOLDER = /[\uE000-\uE0FF]/gu;

export type RichValues = Readonly<Record<string, string | number | VisibleParts>>;

/** `t(id, values)` as page content, with each parts argument rendered (pills for hidden code points). */
export function tRich(t: Translator['t'], id: MessageId, values: RichValues) {
  const plain: Record<string, string | number> = {};
  const rich: VisibleParts[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') plain[key] = value.replace(PLACEHOLDER, '�');
    else if (typeof value === 'number') plain[key] = value;
    else {
      plain[key] = String.fromCodePoint(FIRST + rich.length);
      rich.push(value);
    }
  }
  const text = t(id, plain);
  const out: unknown[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const at = m.index ?? 0;
    out.push(text.slice(last, at));
    const parts = rich[(m[0].codePointAt(0) ?? FIRST) - FIRST];
    out.push(parts ? visible(parts, t) : '�');
    last = at + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}
