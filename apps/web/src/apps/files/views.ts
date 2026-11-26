// The File Browser's location bar: a breadcrumb of the folders opened in this tab. The Entries
// pane is listing.ts, the navigation pane (the folder tree) tree.ts, the Overview overview.ts.

import { link } from '@efs/sdk/links';
import type { AppHost } from '../../shell/apps.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import { shortId } from './editor.ts';
import type { FolderNav } from './navigation.ts';
import type { PlaceLink } from './topic.ts';
import { wordText } from './topic-model.ts';

export type FilesViewKind = 'location';

/** Breadcrumbs longer than this collapse their middle into a "…" item (never drop a folder). */
const BREADCRUMB_MAX = 4;

export class EfsFilesView extends EfsElement {
  static override properties = {
    kind: { attribute: false },
    host: { attribute: false },
    nav: { attribute: false },
    place: { attribute: false },
  };
  declare kind: FilesViewKind;
  declare host: AppHost;
  declare nav: FolderNav;
  /** A tag or an address shown in Entries: the bar names it instead of the folder trail. */
  declare place: { get(): PlaceLink | undefined } | undefined;

  protected override createRenderRoot() {
    return this;
  }

  /** Back to the root (0) or a folder on the trail, by its link: the URL always says where. */
  #go(depth: number): void {
    const folder = depth > 0 ? this.nav.path.get()[depth - 1]?.folder : undefined;
    this.nav.back(depth);
    this.host.openLink(folder ? link({ kind: 'object', subject: folder.directory as never }) : '');
  }

  /** A tag's words (each opens its own tag), or an address. The first crumb says which it is. */
  #placeCrumbs(place: PlaceLink) {
    const t = this.host.translator.t.bind(this.host.translator);
    if (place.status === 'home') {
      return [
        { name: t('files.home.mark'), depth: 0, data: false, go: undefined },
        { name: shortId(place.address), depth: 1, data: true, go: undefined },
      ];
    }
    return [
      { name: t('files.topic.mark'), depth: 0, data: false, go: undefined },
      ...place.segments.map((word, i) => ({
        name: wordText(word),
        depth: i + 1,
        data: true,
        go: () => {
          // The words as typed are the words (no fold until one is ruled): the SDK builds the link.
          const words = place.segments.slice(0, i + 1);
          try {
            this.host.openLink(link({ kind: 'topic', segments: words, words }));
          } catch (error) {
            console.error(error);
          }
        },
      })),
    ];
  }

  #breadcrumb() {
    const t = this.host.translator.t.bind(this.host.translator);
    const place = this.place?.get();
    const path = this.nav.path.get();
    const base = this.nav.base.get();
    const crumbs: {
      readonly name: string;
      readonly depth: number;
      readonly data: boolean;
      readonly go: (() => void) | undefined;
    }[] = place
      ? this.#placeCrumbs(place)
      : [
          // The trail's start: the realm's root, or the address the person came in through.
          base
            ? {
                name: shortId(base.address),
                depth: 0,
                data: true,
                go: () => {
                  this.nav.back(0);
                  this.host.openLink(link({ kind: 'home', address: base.address, names: [] }));
                },
              }
            : { name: t('files.location.root'), depth: 0, data: false, go: () => this.#go(0) },
          // A folder opened by its link has no name here (names belong to its parent): its short id.
          ...path.map((step, i) => ({
            name: step.name || shortId(step.folder.directory),
            depth: i + 1,
            data: true,
            go: () => this.#go(i + 1),
          })),
        ];
    const last = crumbs.length - 1;
    const item = (c: (typeof crumbs)[number]) =>
      c.depth === last
        ? html`<wa-breadcrumb-item aria-current="location"
            ><span translate=${c.data ? 'no' : nothing} dir=${c.data ? 'auto' : nothing}>${c.name}</span></wa-breadcrumb-item
          >`
        : html`<wa-breadcrumb-item @click=${() => c.go?.()}
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
            if (Number.isInteger(depth)) crumbs[depth]?.go?.();
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
    return this.#breadcrumb();
  }
}
