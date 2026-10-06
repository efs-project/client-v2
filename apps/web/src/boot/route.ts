/**
 * Internal route value. EFS link formats are deliberately unfrozen, so C0 only
 * distinguishes "no route" from "a route this build cannot open yet" and never
 * interprets the text. Not exported outside the app.
 */
export type BootRoute =
  | { readonly kind: 'none' }
  | { readonly kind: 'unsupported'; readonly raw: string; readonly truncated: boolean };

const MAX_ROUTE_CHARS = 2048;

export function parseRoute(url: URL): BootRoute {
  const hash = url.hash;
  if (!hash.startsWith('#/')) return { kind: 'none' };
  const raw = hash.slice(1);
  return raw.length > MAX_ROUTE_CHARS
    ? { kind: 'unsupported', raw: raw.slice(0, MAX_ROUTE_CHARS), truncated: true }
    : { kind: 'unsupported', raw, truncated: false };
}
