// The one explanation shown wherever saving would start on a shared IPFS path gateway (the
// wallet dialog, the Preview's Edit): why it's off, and the isolated copy to use instead.

import type { Hosting } from '../platform/hosting.ts';
import { html } from '../ui/element.ts';
import type { Translator } from '../ui/i18n.ts';

/** Why saving is off on a shared IPFS path gateway, with the isolated copy when one is known. */
export function sharedGatewayNotice(
  hosting: Extract<Hosting, { shared: true }>,
  t: Translator['t'],
) {
  return html`<div class="wa-stack wa-gap-s efs-shared-gateway">
    <p>${t('shared.saveOff')}</p>
    ${
      hosting.isolated
        ? html`<p>
            <a href=${hosting.isolated} rel="noopener" class="efs-shared-isolated"
              >${t('shared.openIsolated')}</a
            >
          </p>`
        : html`<p class="efs-quiet">${t('shared.noIsolated')}</p>`
    }
  </div>`;
}
