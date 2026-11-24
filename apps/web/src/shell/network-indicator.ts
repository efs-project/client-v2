// Always shows which network and endpoint the client uses ("a default endpoint is named input,
// never invisible authority"), and whether the deployment pin verified it. Clicking opens the
// network settings, where the details are.

import { EfsElement, html } from '../ui/element.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import type { AppIcon } from '../ui/wa/icon-ids.ts';
import type { NetworkState } from './network-state.ts';
import type { ReaderState } from './reader-state.ts';

export const OPEN_SETTINGS_EVENT = 'efs-open-settings';

export function openSettings(from: Element, section: 'appearance' | 'network' | 'data'): void {
  from.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS_EVENT, { bubbles: true, composed: true, detail: { section } }),
  );
}

type Variant = 'neutral' | 'success' | 'warning' | 'danger';

export interface IndicatorView {
  readonly variant: Variant;
  readonly icon: AppIcon;
  readonly message: MessageId;
  readonly values: Readonly<Record<string, string>>;
  /** True while the session is still opening or pinning. */
  readonly busy?: boolean;
}

/** What the header says, from the configured network and the reader session. Pure, so tested. */
export function indicatorView(network: NetworkState, reader: ReaderState): IndicatorView {
  if (network.status === 'NONE') {
    return {
      variant: 'warning',
      icon: 'triangle-exclamation',
      message: 'network.indicator.none',
      values: {},
    };
  }
  if (network.status === 'UNKNOWN_REALM') {
    return {
      variant: 'danger',
      icon: 'circle-exclamation',
      message: 'network.indicator.unknownRealm',
      values: {},
    };
  }
  if (network.status === 'CONFIG_INVALID') {
    return {
      variant: 'danger',
      icon: 'circle-exclamation',
      message: 'network.indicator.configInvalid',
      values: {},
    };
  }
  const name = { network: network.network.definition.label };
  if (network.status === 'NO_ENDPOINTS') {
    return {
      variant: 'warning',
      icon: 'triangle-exclamation',
      message: 'network.indicator.noEndpoints',
      values: name,
    };
  }
  switch (reader.status) {
    case 'PINNED':
      if (reader.pin.status === 'VERIFIED') {
        // The endpoint that actually served the verified basis, not merely the first configured.
        return {
          variant: 'neutral',
          icon: 'circle-check',
          message: 'network.indicator.verified',
          values: { ...name, endpoint: reader.pin.basis.endpoint },
        };
      }
      if (reader.pin.status === 'MISMATCH') {
        return {
          variant: 'danger',
          icon: 'circle-exclamation',
          message: 'network.indicator.mismatch',
          values: name,
        };
      }
      return {
        variant: 'warning',
        icon: 'triangle-exclamation',
        message: 'network.indicator.unreachable',
        values: name,
      };
    case 'DEPLOYMENT_UNAVAILABLE':
    case 'DEPLOYMENT_INVALID':
    case 'DEPLOYMENT_MISMATCH':
      return {
        variant: 'danger',
        icon: 'circle-exclamation',
        message: 'network.indicator.deploymentProblem',
        values: name,
      };
    case 'LOAD_FAILED':
      return {
        variant: 'warning',
        icon: 'triangle-exclamation',
        message: 'network.indicator.loadFailed',
        values: name,
      };
    default:
      return {
        variant: 'neutral',
        icon: 'server',
        message: 'network.indicator.connecting',
        values: { ...name, endpoint: network.endpointLabel },
        busy: true,
      };
  }
}

export class EfsNetworkIndicator extends EfsElement {
  static override properties = {
    network: { attribute: false },
    reader: { attribute: false },
    translator: { attribute: false },
  };
  declare network: NetworkState;
  declare reader: ReaderState;
  declare translator: Translator;

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const view = indicatorView(this.network, this.reader);
    return html`<wa-button
      size="s"
      appearance="plain"
      variant=${view.variant}
      class="efs-network-indicator"
      data-status=${this.network.status === 'CONFIGURED' ? this.reader.status : this.network.status}
      @click=${() => openSettings(this, 'network')}
    >
      <span slot="start"
        >${view.busy ? html`<wa-spinner></wa-spinner>` : appIcon(view.icon)}</span
      >
      <span class="efs-network-text">${this.translator.t(view.message, view.values)}</span>
    </wa-button>`;
  }
}
