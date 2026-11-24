// The File Browser's views. Until the SDK's reads land they show honest empty states driven by
// the network state. Pane content is keyed on "entries of X", never on directory-only fields,
// so nothing here assumes folders and tags are separate things.

import { openSettings } from '../../shell/network-indicator.ts';
import type { NetworkState } from '../../shell/network-state.ts';
import type { ReadonlySignal } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId, Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';

export type FilesViewKind = 'overview' | 'entries' | 'preview' | 'navigation' | 'location';

const EMPTY: Readonly<Record<'overview' | 'entries' | 'preview', MessageId>> = {
  overview: 'files.overview.empty',
  entries: 'files.entries.empty',
  preview: 'files.preview.empty',
};

export class EfsFilesView extends EfsElement {
  static override properties = {
    kind: { attribute: false },
    network: { attribute: false },
    translator: { attribute: false },
  };
  declare kind: FilesViewKind;
  declare network: ReadonlySignal<NetworkState>;
  declare translator: Translator;

  protected override createRenderRoot() {
    return this;
  }

  #notConnected(t: Translator['t']) {
    const state = this.network.get();
    if (state.status === 'CONFIGURED') return undefined;
    const message: MessageId =
      state.status === 'CONFIG_INVALID'
        ? 'files.network.configInvalid'
        : state.status === 'NO_ENDPOINTS'
          ? 'files.network.noEndpoints'
          : 'files.network.none';
    return html`<wa-callout variant=${state.status === 'CONFIG_INVALID' ? 'danger' : 'warning'}>
      <span slot="icon">${appIcon('triangle-exclamation')}</span>
      <div class="wa-stack wa-gap-s">
        <p>${t(message)}</p>
        ${
          // Only an endpoint problem is fixable in Settings; networks come from the site's config.
          state.status === 'NO_ENDPOINTS'
            ? html`<wa-button
                size="s"
                class="efs-callout-action"
                @click=${() => openSettings(this, 'network')}
                ><span slot="start">${appIcon('gear')}</span>${t('files.network.openSettings')}</wa-button
              >`
            : nothing
        }
      </div>
    </wa-callout>`;
  }

  override render() {
    const t = this.translator.t.bind(this.translator);
    if (this.kind === 'location') {
      return html`<wa-breadcrumb label=${t('files.location.label')}>
        <wa-breadcrumb-item>${t('files.location.root')}</wa-breadcrumb-item>
      </wa-breadcrumb>`;
    }
    if (this.kind === 'navigation') {
      return html`<div class="wa-stack wa-gap-s efs-files-navigation">
        <wa-tree selection="single" aria-label=${t('files.navigation.label')}>
          <wa-tree-item disabled>${appIcon('folder')} ${t('files.location.root')}</wa-tree-item>
        </wa-tree>
        <p class="efs-quiet">${t('files.navigation.empty')}</p>
      </div>`;
    }
    const notConnected = this.#notConnected(t);
    return html`<div class="wa-stack wa-gap-m efs-files-empty">
      ${notConnected ?? html`<p class="efs-quiet">${t(EMPTY[this.kind])}</p>`}
    </div>`;
  }
}
