import { describe, expect, it } from 'vitest';
import { visibleText } from './visible-text.ts';

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
