import { parse } from 'acorn';

/** The classic fallback must parse even when modern app modules cannot. */
export function checkBootProbe(code: string): string[] {
  try {
    parse(code, { ecmaVersion: 5, sourceType: 'script' });
    return [];
  } catch (error) {
    return [`classic probe is not ES5: ${String(error)}`];
  }
}
