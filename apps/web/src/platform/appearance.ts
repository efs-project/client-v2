// Color scheme and theme. Web Awesome selects its scheme with explicit classes (wa-light /
// wa-dark), so "follow the system" is applied here from prefers-color-scheme and kept live.
// The choice is mirrored to localStorage only so the classic boot probe can set the scheme
// before first paint; IndexedDB settings remain the source of truth.

import type { OwnerScope } from './scope.ts';
import type { ColorMode, ThemeId } from './settings/model.ts';
import { COLOR_MODES, THEMES } from './settings/model.ts';

export interface Appearance {
  readonly mode: ColorMode;
  readonly theme: ThemeId;
}

export type Scheme = 'light' | 'dark';

/** Read by public/boot-probe.js; keep the key and shape in step with it. */
export const APPEARANCE_MIRROR_KEY = 'efs.appearance';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function effectiveScheme(mode: ColorMode, systemPrefersDark: boolean): Scheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

/** Each EFS theme's brand hue, via Web Awesome's own remapping class. Keep in step with the probe. */
const BRAND: Readonly<Record<ThemeId, string>> = { cypher: 'green', paper: 'indigo' };

/** The classes on <html> for a given appearance. Only these are managed here. */
export function appearanceClasses(theme: ThemeId, scheme: Scheme): string[] {
  return [
    'wa-theme-default',
    'wa-palette-default',
    `wa-brand-${BRAND[theme]}`,
    `efs-theme-${theme}`,
    `wa-${scheme}`,
  ];
}

const MANAGED = /^(wa-theme-|wa-palette-|wa-brand-|efs-theme-|wa-light$|wa-dark$)/;

export function applyAppearance(
  root: HTMLElement,
  appearance: Appearance,
  prefersDark: boolean,
): Scheme {
  const scheme = effectiveScheme(appearance.mode, prefersDark);
  for (const name of [...root.classList]) if (MANAGED.test(name)) root.classList.remove(name);
  root.classList.add(...appearanceClasses(appearance.theme, scheme));
  root.style.colorScheme = scheme;
  return scheme;
}

/** Keeps "system" mode live as the OS preference changes. */
export function followSystemScheme(
  scope: OwnerScope,
  onChange: (prefersDark: boolean) => void,
): boolean {
  const query = matchMedia(DARK_QUERY);
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  scope.defer(() => query.removeEventListener('change', listener));
  return query.matches;
}

export function mirrorAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(
      APPEARANCE_MIRROR_KEY,
      JSON.stringify({ mode: appearance.mode, theme: appearance.theme }),
    );
  } catch {
    // Storage blocked: the probe falls back to the system preference. Nothing else depends on it.
  }
}

/** Reads the mirror back (used to start from the same state the probe painted). */
export function readMirroredAppearance(): Appearance | undefined {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(APPEARANCE_MIRROR_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return undefined;
    const { mode, theme } = raw as { mode?: unknown; theme?: unknown };
    const m = COLOR_MODES.find((x) => x === mode);
    const t = THEMES.find((x) => x === theme);
    return m && t ? { mode: m, theme: t } : undefined;
  } catch {
    return undefined;
  }
}
