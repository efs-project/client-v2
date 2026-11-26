// Creating at someone else's address: who sees the entry, said in the review before anything is
// signed. The entry is the writer's own, at their own position under that address: it shows for
// anyone whose view includes them, and the address's owner's entry of the same name comes first
// for people viewing the address. Shared by the folder dialog and the editor's review.

import type { ParentRef } from '@efs/sdk/files';
import { shortAccount } from '../../shell/wallet-state.ts';
import { html, nothing } from '../../ui/element.ts';
import type { Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';

/**
 * Whether a write at `at` by `writer` lands at someone else's address: an address whose owner
 * isn't the writer, or whose owner no read has seen (said, rather than assumed away).
 */
export function attachesElsewhere(
  at: ParentRef,
  writer: string,
): at is ParentRef & {
  kind: 'home';
} {
  return at.kind === 'home' && at.owner?.toLowerCase() !== writer.toLowerCase();
}

/** The notice, or nothing when the write isn't at someone else's address. */
export function attachNotice(t: Translator['t'], at: ParentRef, writer: string) {
  if (!attachesElsewhere(at, writer)) return nothing;
  return html`<wa-callout variant="neutral" size="small" class="efs-attach-notice">
    <span slot="icon">${appIcon('house')}</span>
    <p>${t('files.home.attachNotice', { address: shortAccount(at.address) })}</p>
  </wa-callout>`;
}
