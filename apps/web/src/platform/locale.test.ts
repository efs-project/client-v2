import { describe, expect, it } from 'vitest';
import { directionOf, negotiateLocale } from './locale.ts';

const available = ['en', 'en-XA', 'ar-XB'];
const pseudo = ['en-XA', 'ar-XB'];

describe('negotiateLocale', () => {
  it('matches by language and falls back', () => {
    expect(negotiateLocale(['en-GB'], available, pseudo, 'en')).toBe('en');
    expect(negotiateLocale(['fr-FR'], available, pseudo, 'en')).toBe('en');
    expect(negotiateLocale(['not a tag', 'en'], available, pseudo, 'en')).toBe('en');
  });

  it('chooses pseudo-locales only on exact request', () => {
    expect(negotiateLocale(['ar'], available, pseudo, 'en')).toBe('en');
    expect(negotiateLocale(['ar-XB'], available, pseudo, 'en')).toBe('ar-XB');
    expect(negotiateLocale(['en-xa'], available, pseudo, 'en')).toBe('en-XA');
  });
});

describe('directionOf', () => {
  it('knows right-to-left scripts', () => {
    expect(directionOf('ar-XB')).toBe('rtl');
    expect(directionOf('he')).toBe('rtl');
    expect(directionOf('en-XA')).toBe('ltr');
  });
});
