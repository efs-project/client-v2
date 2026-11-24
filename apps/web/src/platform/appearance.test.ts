import { describe, expect, it } from 'vitest';
import { appearanceClasses, effectiveScheme } from './appearance.ts';

describe('appearance', () => {
  it('follows the system only in system mode', () => {
    expect(effectiveScheme('system', true)).toBe('dark');
    expect(effectiveScheme('system', false)).toBe('light');
    expect(effectiveScheme('light', true)).toBe('light');
    expect(effectiveScheme('dark', false)).toBe('dark');
  });

  it('sets theme, palette, brand and scheme classes', () => {
    expect(appearanceClasses('cypher', 'dark')).toEqual([
      'wa-theme-default',
      'wa-palette-default',
      'wa-brand-green',
      'efs-theme-cypher',
      'wa-dark',
    ]);
  });
});
