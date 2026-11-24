// Always shows which network and endpoint the client would use ("a default endpoint is named
// input, never invisible authority"). Clicking opens the network settings.

import { EfsElement, html } from '../ui/element.ts';
import type { Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import type { NetworkState } from './network-state.ts';

export const OPEN_SETTINGS_EVENT = 'efs-open-settings';

export function openSettings(from: Element, section: 'appearance' | 'network' | 'data'): void {
  from.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS_EVENT, { bubbles: true, composed: true, detail: { section } }),
  );
}

export class EfsNetworkIndicator extends EfsElement {
  static override properties = {
    network: { attribute: false },
    translator: { attribute: false },
  };
  declare network: NetworkState;
  declare translator: Translator;

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const t = (id: Parameters<Translator['t']>[0], v?: Record<string, string | number>) =>
      this.translator.t(id, v);
    const state = this.network;
    const [variant, icon, text] =
      state.status === 'CONFIGURED'
        ? ([
            'neutral',
            'server',
            t('network.indicator.configured', {
              network: state.network.definition.label,
              endpoint: state.endpointLabel,
            }),
          ] as const)
        : state.status === 'NO_ENDPOINTS'
          ? ([
              'warning',
              'triangle-exclamation',
              t('network.indicator.noEndpoints', {
                network: state.network.definition.label,
              }),
            ] as const)
          : state.status === 'CONFIG_INVALID'
            ? (['danger', 'circle-exclamation', t('network.indicator.configInvalid')] as const)
            : (['warning', 'triangle-exclamation', t('network.indicator.none')] as const);
    return html`<wa-button
      size="s"
      appearance="plain"
      variant=${variant}
      class="efs-network-indicator"
      data-status=${state.status}
      @click=${() => openSettings(this, 'network')}
    >
      <span slot="start">${appIcon(icon)}</span>
      <span class="efs-network-text">${text}</span>
    </wa-button>`;
  }
}
