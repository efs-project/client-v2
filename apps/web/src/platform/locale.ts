export type Direction = 'ltr' | 'rtl';

const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi']);

function canonical(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/**
 * Picks the first requested locale we have, by exact tag and then by language.
 * Locales in `exactOnly` (pseudo-locales) are only chosen on an exact request.
 */
export function negotiateLocale(
  requested: readonly string[],
  available: readonly string[],
  exactOnly: readonly string[],
  fallback: string,
): string {
  const byLower = new Map(available.map((tag) => [tag.toLowerCase(), tag]));
  for (const raw of requested) {
    const tag = canonical(raw);
    if (!tag) continue;
    const exact = byLower.get(tag.toLowerCase());
    if (exact) return exact;
    const language = new Intl.Locale(tag).language;
    const match = available.find(
      (candidate) =>
        !exactOnly.includes(candidate) && new Intl.Locale(candidate).language === language,
    );
    if (match) return match;
  }
  return fallback;
}

export function directionOf(tag: string): Direction {
  const locale = new Intl.Locale(tag) as Intl.Locale & {
    getTextInfo?: () => { direction?: string };
    textInfo?: { direction?: string };
  };
  const info = locale.getTextInfo?.() ?? locale.textInfo;
  if (info?.direction === 'rtl' || info?.direction === 'ltr') return info.direction;
  return RTL_LANGUAGES.has(locale.language) ? 'rtl' : 'ltr';
}
