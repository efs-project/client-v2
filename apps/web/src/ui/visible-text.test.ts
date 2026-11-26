import { describe, expect, it } from 'vitest';
import { tRich } from './rich.ts';
import {
  LABEL_MAX_BYTES,
  labelParts,
  labelText,
  plainVisible,
  visibleText,
  wordParts,
} from './visible-text.ts';

const hidden = (cp: number) => ({ hidden: cp });

describe('wordParts (a tag word)', () => {
  it('shows a bidi override and a zero-width joiner as hidden code points, never applied', () => {
    expect(wordParts('a\u202Eb\u200Dc')).toEqual(['a', hidden(0x202e), 'b', hidden(0x200d), 'c']);
    expect(visibleText('a\u202Eb\u200Dc')).toBe('a[U+202E]b[U+200D]c');
  });

  it('keeps "[" as written: a literal "[U+202E]" is text, never a hidden code point', () => {
    expect(wordParts('[U+202E]')).toEqual(['[U+202E]']);
    expect(wordParts('a\u202Eb')).not.toEqual(wordParts('a[U+202E]b'));
  });

  it('keeps a plain space; shows every other space, controls, the BOM and separators', () => {
    expect(wordParts('a b')).toEqual(['a b']);
    expect(plainVisible(wordParts('a\u00A0b\u3000c\u0000d\uFEFF\u2028'))).toBe(
      'a[U+00A0]b[U+3000]c[U+0000]d[U+FEFF][U+2028]',
    );
    expect(wordParts('Straße/École日本語🚗')).toEqual(['Straße/École日本語🚗']);
  });

  it('shows combining marks past the second in a row; caps by characters', () => {
    expect(plainVisible(wordParts('e\u0301\u0301\u0301\u0301f'))).toBe(
      'e\u0301\u0301[U+0301][U+0301]f',
    );
    expect(plainVisible(wordParts('🚗'.repeat(70)))).toBe(`${'🚗'.repeat(64)}…`);
  });
});

describe('labelParts (a tag label: its display name)', () => {
  it('leaves a label as written: Persian ZWNJ, French NBSP, a ZWJ family, "[", marks', () => {
    for (const label of [
      'عکس\u200Cهای غروب',
      'Photos\u00A0: coucher de soleil',
      'Family 👨\u200D👩\u200D👧',
      'Photos [2024]',
      '[WIP] Draft',
      'e\u0301\u0301\u0301\u0301',
    ]) {
      expect(labelParts(label)).toEqual([label]);
    }
  });

  it('keeps a well-formed emoji tag sequence (🏴 England) whole; shows a stray tag character', () => {
    const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
    expect(labelParts(`Go ${england}!`)).toEqual([`Go ${england}!`]);
    expect(labelParts('a\u{E0041}b')).toEqual(['a', hidden(0xe0041), 'b']);
  });

  it('shows RLO, C1 controls, ZWSP, the soft hyphen, noncharacters and a 5th mark in a row', () => {
    expect(labelText('a\u202Eb')).toBe('a[U+202E]b');
    expect(labelText('a\u0085b\u200Bc\u00ADd￾e')).toBe('a[U+0085]b[U+200B]c[U+00AD]d[U+FFFE]e');
    expect(labelText('e\u0301\u0301\u0301\u0301\u0301')).toBe('e\u0301\u0301\u0301\u0301[U+0301]');
  });

  it("is capped at the chain's 255 bytes, never splitting a character or a flag", () => {
    expect(labelText('a'.repeat(300))).toBe(`${'a'.repeat(LABEL_MAX_BYTES)}…`);
    expect(labelText('日'.repeat(86))).toBe(`${'日'.repeat(85)}…`);
    expect(labelText('日'.repeat(85))).toBe('日'.repeat(85));
  });
});

describe('tRich (a message with shown arguments)', () => {
  // A stand-in translator: {$name} replaced, as MF2 would (without its isolates).
  const t = ((id: string, values: Record<string, string | number> = {}) =>
    id.replace(/\{\$(\w+)\}/g, (_, k: string) => String(values[k] ?? ''))) as never;

  it('puts each parts argument back, rendered, between the message text', () => {
    const out = tRich(t, 'Tagged {$path}.' as never, { path: ['/a', hidden(0x202e), 'b'] });
    expect(out[0]).toBe('Tagged ');
    expect(Array.isArray(out[1])).toBe(true);
    expect((out[1] as unknown[])[0]).toBe('/a');
    expect(out[2]).toBe('.');
  });

  it('never lets a plain argument forge a placeholder', () => {
    const out = tRich(t, '{$name} and {$path}' as never, {
      name: 'x\uE000y',
      path: ['/p'],
    });
    expect(out[0]).toBe('x�y and ');
    expect((out[1] as unknown[])[0]).toBe('/p');
  });
});
