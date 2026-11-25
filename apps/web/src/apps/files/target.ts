// What the route's link asks the File Browser to show. The link grammar is the SDK's
// (parseLink; object `~efs/o/<id>`, path `~efs/o/<folder>/<name>…`, revision `~efs/v/…`);
// nothing here parses it by hand.

import type { Lens, PathLink } from '@efs/sdk';
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
  /**
   * A path from a folder by its id: the names below it, looked up with openPath (the id may not be
   * a folder at all; only the read says). The app opens what the names lead to by its own link.
   */
  | { readonly status: 'path'; readonly link: PathLink; readonly canonical: string }
  | { readonly status: 'invalid'; readonly rule: string }
  /**
   * An address (home) or topic link: readable once homes and tags land in a contracts release,
   * never guessed before then.
   */
  | { readonly status: 'soon'; readonly kind: 'home' | 'topic' };

export function linkState(location: AppLocation): LinkState {
  if (location.kind !== 'realm' || location.link === '') return { status: 'none' };
  const parsed = parseLink(location.link);
  if (parsed.status === 'INVALID') return { status: 'invalid', rule: parsed.rule };
  const { target, canonical } = parsed;
  if (target.kind === 'home' || target.kind === 'topic')
    return { status: 'soon', kind: target.kind };
  if (target.kind === 'path') return { status: 'path', link: target, canonical };
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
