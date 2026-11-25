// The File Browser's smaller views: the Overview placeholder, the location bar (a breadcrumb of
// the folders opened in this tab) and the navigation pane. The Entries pane is listing.ts.

import { link } from '@efs/sdk/links';
import type { AppHost } from '../../shell/apps.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import { appIcon } from '../../ui/icons.ts';
import { shortId } from './editor.ts';
import type { FolderNav } from './navigation.ts';
import { readerNotice } from './notice.ts';

export type FilesViewKind = 'overview' | 'navigation' | 'location';

/** Breadcrumbs longer than this collapse their middle into a "…" item (never drop a folder). */
const BREADCRUMB_MAX = 4;

export class EfsFilesView extends EfsElement {
  static override properties = {
    kind: { attribute: false },
    host: { attribute: false },
    nav: { attribute: false },
  };
  declare kind: FilesViewKind;
  declare host: AppHost;
  declare nav: FolderNav;

  protected override createRenderRoot() {
    return this;
  }

  /** Back to the root (0) or a folder on the trail, by its link: the URL always says where. */
  #go(depth: number): void {
    const folder = depth > 0 ? this.nav.path.get()[depth - 1]?.folder : undefined;
    this.nav.back(depth);
    this.host.openLink(folder ? link({ kind: 'object', subject: folder.directory as never }) : '');
  }

  #breadcrumb() {
    const t = this.host.translator.t.bind(this.host.translator);
    const path = this.nav.path.get();
    const crumbs = [
      { name: t('files.location.root'), depth: 0, data: false },
      // A folder opened by its link has no name here (names belong to its parent): its short id.
      ...path.map((step, i) => ({
        name: step.name || shortId(step.folder.directory),
        depth: i + 1,
        data: true,
      })),
    ];
    const last = crumbs.length - 1;
    const item = (c: (typeof crumbs)[number]) =>
      c.depth === last
        ? html`<wa-breadcrumb-item aria-current="location"
            ><span translate=${c.data ? 'no' : nothing} dir=${c.data ? 'auto' : nothing}>${c.name}</span></wa-breadcrumb-item
          >`
        : html`<wa-breadcrumb-item @click=${() => this.#go(c.depth)}
            ><span translate=${c.data ? 'no' : nothing} dir=${c.data ? 'auto' : nothing}>${c.name}</span></wa-breadcrumb-item
          >`;
    if (crumbs.length <= BREADCRUMB_MAX) {
      return html`<wa-breadcrumb label=${t('files.location.label')}>
        ${crumbs.map(item)}
      </wa-breadcrumb>`;
    }
    // First, "…" (every folder in between, as a menu), then the last two: nothing is dropped.
    const middle = crumbs.slice(1, -2);
    return html`<wa-breadcrumb label=${t('files.location.label')}>
      ${item(crumbs[0] as (typeof crumbs)[number])}
      <wa-breadcrumb-item>
        <wa-select
          size="s"
          class="efs-breadcrumb-more"
          label=${t('files.location.more')}
          placeholder="…"
          @change=${(event: Event) => {
            const depth = Number((event.target as HTMLSelectElement).value);
            if (Number.isInteger(depth)) this.#go(depth);
          }}
        >
          ${middle.map(
            (c) =>
              html`<wa-option value=${String(c.depth)}
                ><span translate="no" dir="auto">${c.name}</span></wa-option
              >`,
          )}
        </wa-select>
      </wa-breadcrumb-item>
      ${crumbs.slice(-2).map(item)}
    </wa-breadcrumb>`;
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    if (this.kind === 'location') return this.#breadcrumb();
    if (this.kind === 'navigation') {
      return html`<div class="wa-stack wa-gap-s efs-files-navigation">
        <wa-tree selection="single" aria-label=${t('files.navigation.label')}>
          <wa-tree-item @click=${() => this.#go(0)}
            >${appIcon('folder')} ${t('files.location.root')}</wa-tree-item
          >
        </wa-tree>
        <p class="efs-quiet">${t('files.navigation.empty')}</p>
      </div>`;
    }
    const notice = readerNotice(this, this.host, t);
    return html`<div class="wa-stack wa-gap-m efs-files-empty">
      ${notice ?? html`<p class="efs-quiet">${t('files.overview.empty')}</p>`}
    </div>`;
  }
}
