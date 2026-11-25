// The header's wallet control and its dialog. Every wallet prompt starts from a click here
// (Connect, a wallet choice, Switch network); nothing prompts by itself. "Disconnect" forgets the
// connection in this tab: EIP-1193 has no disconnect, so the wallet keeps its own grant.

import type { WalletOption } from '../platform/wallet/discovery.ts';
import { state } from '../state/signals.ts';
import { EfsElement, html, nothing } from '../ui/element.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import type { NetworkState } from './network-state.ts';
import { type SwitchOutcome, shortAccount, type WalletSession } from './wallet-state.ts';

const SWITCH_MESSAGE: Readonly<Record<Exclude<SwitchOutcome, 'SWITCHED'>, MessageId>> = {
  REFUSED: 'wallet.switch.refused',
  PENDING: 'wallet.pending',
  UNKNOWN_CHAIN: 'wallet.switch.unknownChain',
  ERROR: 'wallet.switch.error',
};

export class EfsWallet extends EfsElement {
  static override properties = {
    wallet: { attribute: false },
    network: { attribute: false },
    translator: { attribute: false },
  };
  declare wallet: WalletSession;
  declare network: NetworkState;
  declare translator: Translator;

  #switchNotice = state<MessageId | undefined>(undefined);

  protected override createRenderRoot() {
    return this;
  }

  #dialog(): (HTMLElement & { open: boolean }) | null {
    return this.querySelector('wa-dialog.efs-wallet-dialog');
  }

  #open(): void {
    const dialog = this.#dialog();
    if (dialog) dialog.open = true;
  }

  #connect = () => {
    this.#switchNotice.set(undefined);
    this.#open();
    void this.wallet.connect();
  };

  /** The chain the page needs, when a network is in view. */
  #wanted(): { chainId: number; label: string } | undefined {
    const n = this.network;
    return 'network' in n
      ? { chainId: n.network.definition.chainId, label: n.network.definition.label }
      : undefined;
  }

  #name(option: WalletOption, t: Translator['t']): string {
    return option.name || t('wallet.browserWallet');
  }

  #button(t: Translator['t']) {
    const s = this.wallet.state.get();
    if (s.status === 'CONNECTED') {
      const wanted = this.#wanted();
      const wrong = wanted !== undefined && wanted.chainId !== s.chainId;
      return html`<wa-button
        size="s"
        appearance="outlined"
        variant=${wrong ? 'warning' : 'neutral'}
        class="efs-wallet-button"
        data-status="CONNECTED"
        @click=${() => this.#open()}
      >
        <span slot="start">${appIcon(wrong ? 'triangle-exclamation' : 'wallet')}</span>
        <span translate="no" dir="ltr" class="efs-wallet-account">${shortAccount(s.account)}</span>
        ${wrong ? html`<span class="wa-visually-hidden">${t('wallet.wrongNetworkShort')}</span>` : nothing}
      </wa-button>`;
    }
    const busy = s.status === 'DISCOVERING' || s.status === 'CONNECTING';
    return html`<wa-button
      size="s"
      variant="brand"
      class="efs-wallet-button"
      data-status=${s.status}
      ?loading=${busy}
      @click=${this.#connect}
    >
      <span slot="start">${appIcon('wallet')}</span>
      <span class="efs-wallet-text">${t('wallet.connect')}</span>
    </wa-button>`;
  }

  #body(t: Translator['t']) {
    const s = this.wallet.state.get();
    const retry = html`<wa-button size="s" @click=${this.#connect}
      ><span slot="start">${appIcon('rotate-right')}</span>${t('outcome.retry')}</wa-button
    >`;
    switch (s.status) {
      case 'DISCONNECTED':
        return html`<p>${t('wallet.intro')}</p>
          <div><wa-button variant="brand" @click=${this.#connect}>${t('wallet.connect')}</wa-button></div>`;
      case 'DISCOVERING':
        return html`<p class="wa-cluster wa-gap-xs" role="status"><wa-spinner></wa-spinner>${t('wallet.discovering')}</p>`;
      case 'CHOOSING':
        return html`<p>${t('wallet.choose')}</p>
          <ul class="wa-stack wa-gap-xs efs-wallet-options" role="list">
            ${s.options.map(
              (option) => html`<li>
                <wa-button class="efs-wallet-option" @click=${() => void this.wallet.choose(option)}>
                  ${
                    option.icon
                      ? html`<img slot="start" src=${option.icon} alt="" width="24" height="24" />`
                      : html`<span slot="start">${appIcon('wallet')}</span>`
                  }
                  <span translate="no">${this.#name(option, t)}</span>
                </wa-button>
              </li>`,
            )}
          </ul>`;
      case 'NO_WALLET':
        return html`<p>${t('wallet.none')}</p>
          <div>${retry}</div>`;
      case 'CONNECTING':
        return html`<p class="wa-cluster wa-gap-xs" role="status">
          <wa-spinner></wa-spinner>${t('wallet.connecting', { wallet: this.#name(s.option, t) })}
        </p>`;
      case 'REFUSED':
        return html`<p>${t('wallet.refused', { wallet: this.#name(s.option, t) })}</p>
          <div>${retry}</div>`;
      case 'PENDING':
        return html`<p>${t('wallet.pending')}</p>
          <div>${retry}</div>`;
      case 'ERROR':
        return html`<p>${t('wallet.error')}</p>
          <p class="efs-quiet"><code translate="no">${s.detail}</code></p>
          <div>${retry}</div>`;
      case 'LOAD_FAILED':
        return html`<p>${t('wallet.loadFailed')}</p>
          <div>
            <wa-button size="s" @click=${() => location.reload()}
              ><span slot="start">${appIcon('rotate-right')}</span>${t('outcome.retry')}</wa-button
            >
          </div>`;
      case 'CONNECTED': {
        const wanted = this.#wanted();
        const notice = this.#switchNotice.get();
        return html`<dl class="efs-facts">
            <dt>${t('wallet.account')}</dt>
            <dd><code translate="no" dir="ltr" class="efs-hash">${s.account}</code></dd>
            <dt>${t('wallet.wallet')}</dt>
            <dd translate="no">${this.#name(s.option, t)}</dd>
          </dl>
          ${
            wanted && wanted.chainId !== s.chainId
              ? html`<wa-callout variant="warning">
                  <span slot="icon">${appIcon('triangle-exclamation')}</span>
                  <div class="wa-stack wa-gap-xs">
                    <p>
                      ${t('wallet.wrongNetwork', {
                        network: wanted.label,
                        wanted: String(wanted.chainId),
                        actual: String(s.chainId),
                      })}
                    </p>
                    <div>
                      <wa-button
                        size="s"
                        variant="brand"
                        @click=${async () => {
                          const outcome = await this.wallet.switchChain(wanted.chainId);
                          this.#switchNotice.set(
                            outcome === 'SWITCHED' ? undefined : SWITCH_MESSAGE[outcome],
                          );
                        }}
                        >${t('wallet.switch', { network: wanted.label })}</wa-button
                      >
                    </div>
                    ${notice ? html`<p role="status">${t(notice, { network: wanted.label })}</p>` : nothing}
                  </div>
                </wa-callout>`
              : wanted
                ? html`<p>${t('wallet.onNetwork', { network: wanted.label })}</p>`
                : nothing
          }
          <p class="efs-quiet">${t('wallet.disconnectHint')}</p>
          <div>
            <wa-button size="s" appearance="outlined" @click=${() => this.wallet.disconnect()}
              >${t('wallet.disconnect')}</wa-button
            >
          </div>`;
      }
    }
  }

  override render() {
    const t = this.translator.t.bind(this.translator);
    return html`${this.#button(t)}
      <wa-dialog class="efs-wallet-dialog" label=${t('wallet.title')} light-dismiss>
        <div class="wa-stack wa-gap-m">${this.#body(t)}</div>
      </wa-dialog>`;
  }
}
