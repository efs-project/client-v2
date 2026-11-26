// The dev wallet's own prompt: which dev account (persona) to act as, on the local test chain.
// Called only by the dev wallet (itself loaded on Connect), on Connect or Switch persona. It renders
// a Web Awesome dialog into the page and resolves with the choice, or undefined when closed.
// Startup code on purpose (small, inert until called): see boot/main.ts.

import type { Efs } from '@efs/sdk';
import type { DevAccount } from '../platform/settings/model.ts';
import { html, nothing, render } from '../ui/element.ts';
import type { Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import { shortAccount } from './wallet-state.ts';

/**
 * The accounts in this deployment's default Lens, lowercase (`defaultLensPrincipals`, never a
 * position in the persona list): what they name, join or hide, everyone sees.
 */
export function defaultCurators(efs: Efs | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  if (!efs) return out;
  for (const p of efs.lens.default.principals) {
    const d = efs.lens.displayOf(p);
    if (d.kind !== 'principal') out.add(d.address.toLowerCase());
  }
  return out;
}

export function chooseDevAccount(
  translator: Translator,
  accounts: readonly DevAccount[],
  current: string | undefined,
  curators: ReadonlySet<string> = new Set(),
): Promise<DevAccount | undefined> {
  const t = translator.t.bind(translator);
  const host = document.createElement('div');
  document.body.append(host);
  return new Promise((resolve) => {
    let chosen: DevAccount | undefined;
    const close = () => {
      const dialog = host.querySelector('wa-dialog') as (HTMLElement & { open: boolean }) | null;
      if (dialog) dialog.open = false;
    };
    render(
      html`<wa-dialog
        class="efs-dev-accounts"
        label=${t('devAccounts.title')}
        open
        @wa-after-hide=${(event: Event) => {
          if (event.target !== event.currentTarget) return;
          render(nothing, host);
          host.remove();
          resolve(chosen);
        }}
      >
        <div class="wa-stack wa-gap-s">
          <wa-callout variant="warning" size="small" class="efs-dev-accounts-only">
            <span slot="icon">${appIcon('triangle-exclamation')}</span>
            <p>${t('devAccounts.only')}</p>
          </wa-callout>
          <ul class="efs-entries efs-dev-account-list" role="list">
            ${accounts.map(
              (a) => html`<li class="efs-entry efs-dev-account">
                <button
                  type="button"
                  class="efs-entry-open"
                  aria-current=${a.address === current ? 'true' : 'false'}
                  @click=${() => {
                    chosen = a;
                    close();
                  }}
                >
                  ${appIcon('wallet')}
                  <span class="efs-entry-name" translate="no">${a.name}</span>
                </button>
                <span class="efs-entry-meta efs-quiet" translate="no" dir="ltr"
                  >${shortAccount(a.address)}${a.address === current ? html` · ${t('devAccounts.current')}` : nothing}</span
                >
                ${
                  curators.has(a.address.toLowerCase())
                    ? html`<p class="efs-quiet efs-dev-curator">${t('devAccounts.curator')}</p>`
                    : nothing
                }
              </li>`,
            )}
          </ul>
        </div>
        <wa-button slot="footer" appearance="outlined" @click=${close}
          >${t('review.cancel')}</wa-button
        >
      </wa-dialog>`,
      host,
    );
  });
}
