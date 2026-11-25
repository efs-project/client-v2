import { formatRealm, splitRealm } from '@efs/sdk/links';

/**
 * The OS route, from the URL fragment. Two families (client ↔ SDK routing contract, PM ledger
 * 2026-11-24; naming review §6):
 *
 * - **Realm links** `#/r/<realm>/<link>`: public, shareable, permanent. `<realm>` is a network id
 *   from efs.config.json (`sepolia`, `local-1`) or the full form `eip155:<chainId>/0x<ledger>`.
 *   `<link>` belongs to the SDK (object `~efs/o/…`, revision `~efs/v/…`, path later) and is passed
 *   through untouched: never parsed here.
 * - **App routes** `#/<app>/<rest>`: an app's own UI state. Bookmarkable, not permanent links.
 *
 * Reservations, so the families can never collide: app ids are 2–32 characters of `[a-z0-9-]`
 * starting with a letter (no dot, which keeps a later ENS-named layer such as `#/alice.eth/…`
 * free); every single-letter first segment is reserved for link forms (`r` is the only one used).
 */
export type OsRoute =
  | { readonly kind: 'default' }
  | { readonly kind: 'app'; readonly app: string; readonly rest: string }
  | {
      readonly kind: 'realm';
      readonly realm: RealmRef;
      readonly link: string;
      /** The same route with the realm in canonical form; the shell replaces the URL with it. */
      readonly canonical: string;
    }
  /** Doesn't follow either family; shown to the person, never guessed at. */
  | { readonly kind: 'malformed'; readonly raw: string }
  /** Longer than MAX_ROUTE_CHARS: refused visibly, never truncated. */
  | { readonly kind: 'too-long'; readonly length: number };

export type RealmRef =
  | { readonly kind: 'alias'; readonly id: string }
  | { readonly kind: 'full'; readonly chainId: number; readonly ledger: string };

/** Fits an object link with a 64-entry Lens (about 4.3 KB) with room to spare. */
export const MAX_ROUTE_CHARS = 8192;
const APP_ID = /^[a-z][a-z0-9-]{1,31}$/;

export function parseRoute(url: URL): OsRoute {
  const hash = url.hash;
  if (hash === '' || hash === '#' || hash === '#/') return { kind: 'default' };
  // In-page anchors (no leading slash) are not routes.
  if (!hash.startsWith('#/')) return { kind: 'default' };
  if (hash.length - 1 > MAX_ROUTE_CHARS) return { kind: 'too-long', length: hash.length - 1 };
  const raw = hash.slice(1);
  const [, first = '', ...rest] = raw.split('/');
  if (first === 'r') return parseRealm(raw, rest.join('/'));
  if (first.length === 1 || !APP_ID.test(first)) return { kind: 'malformed', raw };
  return { kind: 'app', app: first, rest: rest.join('/') };
}

/** The realm grammar is the SDK's (splitRealm from the dependency-free @efs/sdk/links). */
function parseRealm(raw: string, path: string): OsRoute {
  const split = splitRealm(path);
  if (split.status === 'INVALID') return { kind: 'malformed', raw };
  const realm: RealmRef =
    split.status === 'ALIAS'
      ? { kind: 'alias', id: split.alias }
      : { kind: 'full', chainId: split.realm.chainId, ledger: split.realm.ledger.toLowerCase() };
  return { kind: 'realm', realm, link: split.rest, canonical: formatRealmRoute(realm, split.rest) };
}

/** The fragment for an app route. `rest` is passed through untouched; the app owns its encoding. */
export function formatRoute(app: string, rest = ''): string {
  return rest === '' ? `#/${app}` : `#/${app}/${rest}`;
}

/** The fragment for a realm link. `link` comes from the SDK's link(); never built by hand. */
export function formatRealmRoute(realm: RealmRef, link = ''): string {
  const head =
    realm.kind === 'alias'
      ? realm.id
      : formatRealm({ chainId: realm.chainId, ledger: realm.ledger as `0x${string}` });
  return `#/r/${head}/${link}`;
}
