// Why a File Browser pane can't read yet, from the network configuration and the reader
// session. Returns undefined only when the session is pinned and VERIFIED: reads never run
// against a deployment that hasn't been checked.

import type { AppHost } from '../../shell/apps.ts';
import { openSettings } from '../../shell/network-indicator.ts';
import { html, nothing } from '../../ui/element.ts';
import type { MessageId, Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';

export function readerNotice(from: Element, host: AppHost, t: Translator['t']) {
  const network = host.network.get();
  const settingsButton = html`<wa-button
    size="s"
    class="efs-callout-action"
    @click=${() => openSettings(from, 'network')}
    ><span slot="start">${appIcon('gear')}</span>${t('files.network.openSettings')}</wa-button
  >`;
  const callout = (
    variant: 'warning' | 'danger',
    message: MessageId,
    values: Record<string, string> = {},
    actions: unknown = nothing,
  ) => html`<wa-callout variant=${variant} class="efs-reader-notice">
    <span slot="icon"
      >${appIcon(variant === 'danger' ? 'circle-exclamation' : 'triangle-exclamation')}</span
    >
    <div class="wa-stack wa-gap-s">
      <p>${t(message, values)}</p>
      ${actions}
    </div>
  </wa-callout>`;

  if (network.status === 'NONE') return callout('warning', 'files.network.none');
  if (network.status === 'CONFIG_INVALID') return callout('danger', 'files.network.configInvalid');
  if (network.status === 'UNKNOWN_REALM') {
    const { realm } = network;
    const id = realm.kind === 'alias' ? realm.id : `eip155:${realm.chainId}/${realm.ledger}`;
    return callout(
      'danger',
      'files.network.unknownRealm',
      {},
      html`<p><code translate="no" dir="ltr">${id}</code></p>`,
    );
  }
  if (network.status === 'NO_ENDPOINTS') {
    // Only an endpoint problem is fixable in Settings; networks come from the site's config.
    return callout('warning', 'files.network.noEndpoints', {}, settingsButton);
  }
  const reader = host.reader.get();
  const name = { network: network.network.definition.label };
  switch (reader.status) {
    case 'PINNED':
      if (reader.pin.status === 'VERIFIED') return undefined;
      if (reader.pin.status === 'MISMATCH') {
        return callout('danger', 'files.reader.mismatch', name, settingsButton);
      }
      return callout(
        'warning',
        'files.reader.unreachable',
        name,
        html`<div class="wa-cluster wa-gap-xs">
          <wa-button size="s" @click=${() => host.retryReader()}
            ><span slot="start">${appIcon('rotate-right')}</span>${t('outcome.retry')}</wa-button
          >
          ${settingsButton}
        </div>`,
      );
    case 'DEPLOYMENT_UNAVAILABLE':
    case 'DEPLOYMENT_INVALID':
    case 'DEPLOYMENT_MISMATCH':
    case 'LOAD_FAILED':
      return callout('danger', 'files.reader.problem', name, settingsButton);
    default:
      return html`<p class="wa-cluster wa-gap-xs efs-reader-notice" role="status">
        <wa-spinner></wa-spinner>${t('files.reader.connecting', name)}
      </p>`;
  }
}
