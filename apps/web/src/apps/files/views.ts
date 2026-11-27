// The File Browser's location bar: a breadcrumb of the folders opened in this tab. The Entries
// pane is listing.ts, the navigation pane (the folder tree) tree.ts, the Overview overview.ts.

import { link } from '@efs/sdk/links';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import { appIcon } from '../../ui/icons.ts';
import { visible } from '../../ui/visible-text.ts';
import { shortId } from './editor.ts';
import type { TrailName, TrailTop } from './folder-trail.ts';
import { type TrailState, walkFor } from './folder-trail-state.ts';
import type { FolderNav } from './navigation.ts';
import type { PlaceLink } from './topic.ts';
import { wordShown } from './topic-model.ts';
import { authorLabel } from './who.ts';

export type FilesViewKind = 'location';

/** Breadcrumbs longer than this collapse their middle into a "…" item (never drop a folder). */
const BREADCRUMB_MAX = 4;

/** One crumb. Its place in the bar is its index. */
interface Crumb {
  /** Text, or a tag word with its hidden code points as pills (ui/visible-text.ts). */
  readonly name: unknown;
  /** A data value (a name, an id): shown as written, untranslated. */
  readonly data: boolean;
  readonly go: (() => void) | undefined;
  /** Whose name it is, when it isn't the reader's own (a walked folder's name). */
  readonly by?: string;
  /** A walked name an older entry could still outrank: shown with "?", not as final. */
  readonly unsettled?: boolean;
  /** What's above the walked path, in words, for a crumb that stands for it. */
  readonly above?: { readonly hidden: string; readonly icon?: 'rotate-right' };
}

export class EfsFilesView extends EfsElement {
  static override properties = {
    kind: { attribute: false },
    host: { attribute: false },
    nav: { attribute: false },
    place: { attribute: false },
    trail: { attribute: false },
  };
  declare kind: FilesViewKind;
  declare host: AppHost;
  declare nav: FolderNav;
  /** A tag or an address shown in Entries: the bar names it instead of the folder trail. */
  declare place: { get(): PlaceLink | undefined } | undefined;
  /** The path above a folder opened by its link (folder-trail-state.ts). */
  declare trail: TrailState | undefined;

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
        name: visible(wordShown(word), t),
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

  /** "named by …" for a walked name that isn't the reader's own. */
  #by(named: TrailName | undefined): string | undefined {
    if (!named?.by) return undefined;
    return authorLabel(
      verifiedEfs(this.host.reader.get()),
      named.by,
      undefined,
      this.host.names.get(),
    );
  }

  /** The crumb standing for what's above a walked path, when the walk didn't reach the root. */
  #aboveCrumb(top: TrailTop): Crumb | undefined {
    const t = this.host.translator.t.bind(this.host.translator);
    switch (top.kind) {
      case 'root':
      case 'home':
        return undefined;
      case 'unknown':
        return {
          name: '…',
          data: false,
          go: undefined,
          above: { hidden: t('files.location.above') },
        };
      case 'elsewhere':
        return {
          name: '…',
          data: false,
          go: undefined,
          above: { hidden: t('files.location.elsewhere') },
        };
      case 'loop':
        return {
          name: t('files.location.loop'),
          data: false,
          go: undefined,
          above: { hidden: t('files.location.loopHidden') },
        };
      case 'failed':
        return {
          name: '…',
          data: false,
          go: () => this.trail?.retry(),
          above: { hidden: t('files.location.failed'), icon: 'rotate-right' },
        };
    }
  }

  /** The bar's folder crumbs: the trail's start, a walked path above it, then the trail. */
  #folderCrumbs(): Crumb[] {
    const t = this.host.translator.t.bind(this.host.translator);
    const path = this.nav.path.get();
    const base = this.nav.base.get();
    // A folder opened by its link (no trail): the walk up from it, as far as it went.
    const walked = walkFor(this.nav, this.trail);
    const crumbs: Crumb[] = [];
    const top = walked?.top;
    if (base) {
      crumbs.push({
        name: shortId(base.address),
        data: true,
        go: () => {
          this.nav.back(0);
          this.host.openLink(link({ kind: 'home', address: base.address, names: [] }));
        },
      });
    } else if (top?.kind === 'home') {
      // The walk ended at an address: the trail starts there (its link reads its owner).
      const address = top.address;
      crumbs.push({
        name: shortId(address),
        data: true,
        go: () => this.host.openLink(link({ kind: 'home', address: address as never, names: [] })),
      });
    } else {
      crumbs.push({ name: t('files.location.root'), data: false, go: () => this.#go(0) });
    }
    if (walked) {
      const above = top ? this.#aboveCrumb(top) : undefined;
      if (above) crumbs.push(above);
      // The walked folders above the one on screen: each opens by its link (and walks from there).
      for (const f of walked.folders.slice(0, -1)) {
        const directory = f.folder.directory;
        const by = this.#by(f.name);
        crumbs.push({
          name: f.name?.text ?? shortId(directory),
          data: true,
          go: () => this.host.openLink(link({ kind: 'object', subject: directory as never })),
          ...(by ? { by } : {}),
          ...(f.name && !f.name.settled ? { unsettled: true } : {}),
        });
      }
    }
    path.forEach((step, i) => {
      // The folder opened by its link: its walked name, else its short id (names belong to its parent).
      const named = i === 0 && walked ? walked.folders.at(-1)?.name : step.named;
      const by = this.#by(named);
      crumbs.push({
        name: (step.name || named?.text) ?? shortId(step.folder.directory),
        data: true,
        go: () => this.#go(i + 1),
        ...(by ? { by } : {}),
        ...(named && !named.settled ? { unsettled: true } : {}),
      });
    });
    return crumbs;
  }

  #breadcrumb() {
    const t = this.host.translator.t.bind(this.host.translator);
    const place = this.place?.get();
    const crumbs: Crumb[] = place
      ? this.#placeCrumbs(place).map(({ name, data, go }) => ({ name, data, go }))
      : this.#folderCrumbs();
    const last = crumbs.length - 1;
    const label = (c: Crumb, at: number) => {
      const marks = html`${
        c.unsettled
          ? html`<span class="efs-crumb-unsettled" aria-hidden="true">?</span
            ><span class="wa-visually-hidden">${t('files.location.unsettled')}</span>`
          : nothing
      }${
        c.by
          ? at === last
            ? html` <span class="efs-crumb-by">${t('files.location.namedBy', { author: c.by })}</span>`
            : html`<span class="wa-visually-hidden">${t('files.location.namedBy', { author: c.by })}</span>`
          : nothing
      }`;
      if (c.above) {
        // "…" is said in words; a word ("Loop") stays in the name, with the words after it.
        return html`${c.above.icon ? appIcon(c.above.icon) : nothing}<span
            aria-hidden=${c.name === '…' ? 'true' : nothing}
            >${c.name}</span
          ><span class="wa-visually-hidden"> ${c.above.hidden}</span>`;
      }
      return html`<span translate=${c.data ? 'no' : nothing} dir=${c.data ? 'auto' : nothing}
          >${c.name}</span
        >${marks}`;
    };
    const item = (c: Crumb, at: number) =>
      at === last
        ? html`<wa-breadcrumb-item aria-current="location">${label(c, at)}</wa-breadcrumb-item>`
        : c.go
          ? html`<wa-breadcrumb-item
              class=${c.above ? 'efs-crumb-above efs-crumb-retry' : nothing}
              @click=${() => c.go?.()}
              >${label(c, at)}</wa-breadcrumb-item
            >`
          : html`<wa-breadcrumb-item class="efs-crumb-above">${label(c, at)}</wa-breadcrumb-item>`;
    if (crumbs.length <= BREADCRUMB_MAX) {
      return html`<wa-breadcrumb label=${t('files.location.label')}>
        ${crumbs.map(item)}
      </wa-breadcrumb>`;
    }
    // First, "…" (every folder in between, as a menu), then the last two: nothing is dropped.
    const middle = crumbs.slice(1, -2);
    // A menu option says it all in text: the name, "?" if not settled, and whose name it is.
    const option = (c: Crumb) =>
      c.above
        ? c.above.hidden
        : html`${c.name}${c.unsettled ? '?' : ''}${
            c.by ? ` (${t('files.location.namedBy', { author: c.by })})` : ''
          }`;
    return html`<wa-breadcrumb label=${t('files.location.label')}>
      ${item(crumbs[0] as Crumb, 0)}
      <wa-breadcrumb-item>
        <wa-select
          size="s"
          class="efs-breadcrumb-more"
          label=${t('files.location.more')}
          placeholder="…"
          @change=${(event: Event) => {
            const at = Number((event.target as HTMLSelectElement).value);
            if (Number.isInteger(at)) crumbs[at]?.go?.();
          }}
        >
          ${middle.map(
            (c, i) =>
              html`<wa-option value=${String(i + 1)} ?disabled=${!c.go}
                ><span translate=${c.above ? nothing : 'no'} dir="auto">${option(c)}</span></wa-option
              >`,
          )}
        </wa-select>
      </wa-breadcrumb-item>
      ${crumbs.slice(-2).map((c, i) => item(c, crumbs.length - 2 + i))}
    </wa-breadcrumb>`;
  }

  override render() {
    return this.#breadcrumb();
  }
}
