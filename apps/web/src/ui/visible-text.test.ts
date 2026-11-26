import { describe, expect, it } from 'vitest';
import { LABEL_MAX_BYTES, labelText, visibleText } from './visible-text.ts';

describe('visibleText', () => {
  it('shows a bidi override and a zero-width joiner instead of applying them', () => {
    const shown = visibleText('A‮b‍c');
    expect(shown).toBe('A[U+202E]b[U+200D]c');
    expect(shown).not.toMatch(/[‮‍]/);
  });

  it('shows controls, isolates, the BOM and separators; keeps letters, accents and emoji', () => {
    expect(visibleText('x\u0000y⁦z﻿ ')).toBe('x[U+0000]y[U+2066]z[U+FEFF][U+2028]');
    expect(visibleText('Straße/École日本語🚗')).toBe('Straße/École日本語🚗');
  });

  it('caps the length by characters, never splitting one', () => {
    expect(visibleText('🚗'.repeat(70), 64)).toBe(`${'🚗'.repeat(64)}…`);
    expect(visibleText('abc', 3)).toBe('abc');
  });

  it('is unambiguous: a literal "[" is escaped, so "[U+…]" can only be an escape', () => {
    expect(visibleText('[U+202E]')).toBe('[U+005B]U+202E]');
    expect(visibleText('a\u202Eb')).not.toBe(visibleText('a[U+202E]b'));
  });

  it('shows every space character, and combining marks past the second in a row', () => {
    // A plain space stays a space; any other space character is shown.
    expect(visibleText('a b')).toBe('a b');
    expect(visibleText('a b\u00A0c\u3000d')).toBe('a b[U+00A0]c[U+3000]d');
    // e + two acute accents is drawn; a third and fourth are shown.
    expect(visibleText('e\u0301\u0301\u0301\u0301f')).toBe('e\u0301\u0301[U+0301][U+0301]f');
    // A single accent (a decomposed é) stays as it is.
    expect(visibleText('e\u0301')).toBe('e\u0301');
  });
});

describe('labelText (a tag label: its display name)', () => {
  it('leaves a label exactly as written: Persian with a ZWNJ, French with a no-break space', () => {
    const persian = 'عکس\u200Cهای غروب';
    const french = 'Photos\u00A0: coucher de soleil';
    expect(labelText(persian)).toBe(persian);
    expect(labelText(french)).toBe(french);
    expect(labelText('Sunset photos 🌅 [1]')).toBe('Sunset photos 🌅 [1]');
    expect(labelText('e\u0301\u0301\u0301')).toBe('e\u0301\u0301\u0301');
  });

  it('shows a bidi override, a C1 control and a noncharacter, never applies them', () => {
    expect(labelText('a\u202Eb')).toBe('a[U+202E]b');
    expect(labelText('a\u0085b')).toBe('a[U+0085]b');
    expect(labelText('a\uFFFEb\u2067c\u061Cd')).toBe('a[U+FFFE]b[U+2067]c[U+061C]d');
  });

  it("is capped at the chain's 255 bytes, never splitting a character", () => {
    expect(labelText('a'.repeat(300))).toBe(`${'a'.repeat(LABEL_MAX_BYTES)}…`);
    // 85 three-byte characters are 255 bytes; an 86th doesn't fit.
    expect(labelText('日'.repeat(86))).toBe(`${'日'.repeat(85)}…`);
    expect(labelText('日'.repeat(85))).toBe('日'.repeat(85));
  });
});
