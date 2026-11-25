// What the route's link asks the File Browser to show. The link grammar is the SDK's
// (parseLink; object `~efs/o/…`, revision `~efs/v/…`); nothing here parses it by hand.

import type { Lens } from '@efs/sdk';
import { parseLink } from '@efs/sdk/links';
import type { AppLocation } from '../../shell/apps.ts';
import type { PreviewTarget } from './preview-model.ts';

export type LinkState =
  /** No link (an app route, or a realm's root). */
  | { readonly status: 'none' }
  | {
      readonly status: 'target';
      readonly target: PreviewTarget;
      /** The sharer's Lens, when the link carries one; reads use it instead of the default. */
      readonly lens?: Lens;
      /** The canonical link; the app replaces the URL with it when it differs. */
      readonly canonical: string;
    }
  | { readonly status: 'invalid'; readonly rule: string }
  /** A path link: waits for the folder model, never guessed. */
  | { readonly status: 'path' };

export function linkState(location: AppLocation): LinkState {
  if (location.kind !== 'realm' || location.link === '') return { status: 'none' };
  const parsed = parseLink(location.link);
  if (parsed.status === 'INVALID') return { status: 'invalid', rule: parsed.rule };
  if (parsed.status === 'UNSUPPORTED') return { status: 'path' };
  const { target, canonical } = parsed;
  if (target.kind === 'revision') {
    return { status: 'target', target: { kind: 'revision', recordId: target.recordId }, canonical };
  }
  return {
    status: 'target',
    target: { kind: 'file', subject: target.subject },
    ...(target.lens ? { lens: target.lens } : {}),
    canonical,
  };
}
