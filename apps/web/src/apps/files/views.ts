// The File Browser's placeholder views. Until listings land (after the tags-vs-folders ruling)
// they show honest states driven by the network and the reader session. Pane content is keyed on "entries of X", never on directory-only fields,
// so nothing here assumes folders and tags are separate things.

import type { AppHost } from '../../shell/apps.ts';
import { EfsElement, html } from '../../ui/element.ts';
import type { MessageId } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { readerNotice } from './notice.ts';

export type FilesViewKind = 'overview' | 'entries' | 'navigation' | 'location';

const EMPTY: Readonly<Record<'overview' | 'entries', MessageId>> = {
  overview: 'files.overview.empty',
  entries: 'files.entries.empty',
};

export class EfsFilesView extends EfsElement {
  static override properties = {
    kind: { attribute: false },
    host: { attribute: false },
  };
  declare kind: FilesViewKind;
  declare host: AppHost;

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
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
    const notice = readerNotice(this, this.host, t);
    return html`<div class="wa-stack wa-gap-m efs-files-empty">
      ${notice ?? html`<p class="efs-quiet">${t(EMPTY[this.kind])}</p>`}
    </div>`;
  }
}
