/**
 * The OS-level route: `#/<app>/<rest>`. Internal and deliberately unfrozen: it names which app
 * is active and hands that app its own `rest`, which the app interprets (the File Browser uses
 * the SDK's link grammar). Nothing here is a public link format.
 */
export type OsRoute =
  | { readonly kind: 'default' }
  | {
      readonly kind: 'app';
      readonly app: string;
      readonly rest: string;
      readonly truncated: boolean;
    }
  | { readonly kind: 'malformed'; readonly raw: string; readonly truncated: boolean };

const MAX_ROUTE_CHARS = 2048;
const APP_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function parseRoute(url: URL): OsRoute {
  const hash = url.hash;
  if (hash === '' || hash === '#' || hash === '#/') return { kind: 'default' };
  // In-page anchors (no leading slash) are not routes.
  if (!hash.startsWith('#/')) return { kind: 'default' };
  const truncated = hash.length - 1 > MAX_ROUTE_CHARS;
  const raw = hash.slice(1, MAX_ROUTE_CHARS + 1);
  const [, app = '', ...restParts] = raw.split('/');
  if (!APP_ID.test(app)) return { kind: 'malformed', raw, truncated };
  return { kind: 'app', app, rest: restParts.join('/'), truncated };
}

/** The hash for an app location. `rest` is passed through untouched; apps own its encoding. */
export function formatRoute(app: string, rest = ''): string {
  return rest === '' ? `#/${app}` : `#/${app}/${rest}`;
}
