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
    expect(visibleText('Straße/ École 日本語 🚗')).toBe('Straße/ École 日本語 🚗');
  });

  it('caps the length by characters, never splitting one', () => {
    expect(visibleText('🚗'.repeat(70), 64)).toBe(`${'🚗'.repeat(64)}…`);
    expect(visibleText('abc', 3)).toBe('abc');
  });
});
