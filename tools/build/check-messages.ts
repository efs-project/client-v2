// Validates message catalogs with the MF2 reference implementation (messageformat)
// and enforces EFS's narrow message contract. With --write, regenerates the
// pseudo-locale catalogs; without it, fails if they have drifted.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isMarkup, type Model, parseMessage, stringifyMessage, validate } from 'messageformat';

const DIR = fileURLToPath(new URL('../../apps/web/src/ui/messages/', import.meta.url));
const SOURCE = 'en';
// The contract: variables, :number/:integer/:string, and .match selection. No markup,
// attributes or other functions until a reviewed change widens it.
const ALLOWED_FUNCTIONS = new Set(['number', 'integer', 'string']);

type Catalog = Record<string, string>;

const readCatalog = (locale: string): Catalog =>
  JSON.parse(readFileSync(`${DIR}${locale}.json`, 'utf8')) as Catalog;

function patterns(message: Model.Message): Model.Pattern[] {
  return message.type === 'message' ? [message.pattern] : message.variants.map((v) => v.value);
}

function check(locale: string, id: string, source: string): Set<string> {
  const errors: string[] = [];
  let message: Model.Message;
  try {
    message = parseMessage(source);
  } catch (error) {
    throw new Error(`${locale}:${id}: ${String(error)}`);
  }
  const { functions, variables } = validate(message, (type) => errors.push(type));
  for (const fn of functions) if (!ALLOWED_FUNCTIONS.has(fn)) errors.push(`function :${fn}`);
  for (const pattern of patterns(message)) {
    for (const part of pattern) {
      if (typeof part === 'string') continue;
      if (isMarkup(part)) errors.push('markup');
      else if (part.attributes && Object.keys(part.attributes).length > 0)
        errors.push('attributes');
    }
  }
  if (errors.length > 0)
    throw new Error(`${locale}:${id}: outside the message contract: ${errors.join(', ')}`);
  return variables;
}

const ACCENTS: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

const PSEUDO: Record<string, (text: string) => string> = {
  // Accented, ~30% longer and bracketed, so untranslated or clipped text is visible.
  'en-XA': (text) => {
    const accented = [...text].map((ch) => ACCENTS[ch] ?? ch).join('');
    return `⟦${accented}${'·'.repeat(Math.ceil(text.length * 0.3))}⟧`;
  },
  // Right-to-left override, so mirroring bugs are visible without a translation.
  'ar-XB': (text) => `‮${text}‬`,
};

function pseudoLocalize(source: string, transform: (text: string) => string): string {
  const message = parseMessage(source);
  for (const pattern of patterns(message)) {
    for (let i = 0; i < pattern.length; i++) {
      const part = pattern[i];
      if (typeof part === 'string' && part.trim() !== '') pattern[i] = transform(part);
    }
  }
  return stringifyMessage(message);
}

const write = process.argv.includes('--write');
const source = readCatalog(SOURCE);
const sourceVariables = new Map<string, Set<string>>();
for (const [id, text] of Object.entries(source)) sourceVariables.set(id, check(SOURCE, id, text));

let drift = false;
for (const [locale, transform] of Object.entries(PSEUDO)) {
  const generated: Catalog = {};
  for (const [id, text] of Object.entries(source)) generated[id] = pseudoLocalize(text, transform);
  const serialized = `${JSON.stringify(generated, null, 2)}\n`;
  const path = `${DIR}${locale}.json`;
  if (write) {
    writeFileSync(path, serialized);
  } else {
    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {}
    if (current !== serialized) {
      console.error(`${locale}.json is out of date; run pnpm messages`);
      drift = true;
    }
  }
  for (const [id, text] of Object.entries(generated)) {
    const variables = check(locale, id, text);
    const expected = sourceVariables.get(id) ?? new Set();
    if ([...variables].sort().join() !== [...expected].sort().join()) {
      throw new Error(`${locale}:${id}: variables differ from ${SOURCE}`);
    }
  }
}
if (drift) process.exit(1);
console.log(
  `messages: ${Object.keys(source).length} ids, ${Object.keys(PSEUDO).length + 1} catalogs ok`,
);
