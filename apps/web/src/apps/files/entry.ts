// The File Browser app: the OS's first app. Its default layout reproduces v1's three panes
// (overview / entries / preview) as plain data, so a configurable layout later is a settings
// change. Loaded lazily by the shell; everything it starts belongs to the scope it is given.

import { link as linkOf } from '@efs/sdk/links';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppEntry, AppHost, AppMount, PaneLayout, ViewDescriptor } from '../../shell/apps.ts';
import { effect } from '../../state/effect.ts';
import { computed, type ReadonlySignal, type Signal, state } from '../../state/signals.ts';
import { type Composer, createComposer } from './compose.ts';
import { registerFilesElements } from './define.ts';
import type { ListingState } from './folder-model.ts';
import type { EfsFilesListing } from './listing.ts';
import { createFolderNav, type FolderNav } from './navigation.ts';
import { type ObjectKindState, objectKindState } from './object-kind.ts';
import type { EfsFilesOverview } from './overview.ts';
import type { EfsFilesPreview } from './preview.ts';
import { watchTagSaves } from './tag-edits.ts';
import { type LinkState, linkState } from './target.ts';
import type { EfsFilesTopic, PlaceLink, PlaceOpened } from './topic.ts';
import type { EfsFilesTree } from './tree.ts';
import type { EfsFilesView, FilesViewKind } from './views.ts';
import type { EfsFilesWord } from './word.ts';

const DEFAULT_LAYOUT: PaneLayout = {
  panes: [{ view: 'overview' }, { view: 'entries' }, { view: 'preview' }],
};

/**
 * What the panes share: where the person is, the route's link, what kind of thing it names, and
 * the new text file being written, if any.
 */
interface Shared {
  readonly nav: FolderNav;
  readonly link: ReadonlySignal<LinkState>;
  readonly object: ObjectKindState;
  readonly composer: Composer;
  /** What the Entries pane lists now: the Overview finds the folder's README in it. */
  readonly shown: Signal.State<ListingState | undefined>;
  /**
   * The tag or address the Entries pane lists instead of a folder: the route's, or the one a row
   * was opened from while that row's link is open (the list stays beside its Preview).
   */
  readonly place: ReadonlySignal<PlaceLink | undefined>;
  readonly opened: Signal.State<PlaceOpened | undefined>;
  /**
   * A one-word tag shown as its own list rather than as its word's page (its canonical link): the
   * word page's "Open" on the plain tag, for as long as that tag is shown.
   */
  readonly plain: Signal.State<string | undefined>;
  /** Moves each time a tag save from this tab settles: tag lists read again (tag-edits.ts). */
  readonly tagEdits: ReadonlySignal<number>;
  /** Opens a tag's own list: for one word, the plain tag rather than its word's page. */
  readonly openTag: (words: readonly string[]) => void;
}

/** The Overview pane: the folder's README, or its summary. */
function overview(host: AppHost, shared: Shared, scope: OwnerScope): HTMLElement {
  const element = document.createElement('efs-files-overview') as EfsFilesOverview;
  element.host = host;
  element.nav = shared.nav;
  element.shown = shared.shown;
  element.place = shared.place;
  element.start(scope);
  return element;
}

function view(
  host: AppHost,
  kind: FilesViewKind,
  nav: FolderNav,
  place: ReadonlySignal<PlaceLink | undefined>,
): HTMLElement {
  const element = document.createElement('efs-files-view') as EfsFilesView;
  element.kind = kind;
  element.host = host;
  element.nav = nav;
  element.place = place;
  return element;
}

/** The navigation pane: the folder tree, following the trail. */
function tree(host: AppHost, nav: FolderNav, scope: OwnerScope): HTMLElement {
  const element = document.createElement('efs-files-tree') as EfsFilesTree;
  element.host = host;
  element.nav = nav;
  element.start(scope);
  return element;
}

/**
 * The Entries pane: a folder's listing, a tag's (or an address's) list, or a word's page (a
 * one-word tag). All stay mounted; the listing reads nothing while it's hidden.
 */
function entries(host: AppHost, shared: Shared, scope: OwnerScope): HTMLElement {
  const box = document.createElement('div');
  box.className = 'efs-entries-host';
  const list = document.createElement('efs-files-listing') as EfsFilesListing;
  list.host = host;
  list.nav = shared.nav;
  list.object = shared.object;
  list.composer = shared.composer;
  list.shown = shared.shown;
  // Only a tag replaces the folder listing: an address lists its own entries there (like a
  // folder), with what's tagged at it below.
  const tagged = computed(() => shared.place.get()?.status === 'topic');
  list.suspended = tagged;
  const topic = document.createElement('efs-files-topic') as EfsFilesTopic;
  topic.host = host;
  topic.nav = shared.nav;
  topic.opened = shared.opened;
  topic.plain = shared.plain;
  // A one-word tag is its word's page, unless its own list was asked for (plain).
  const isWord = computed(() => {
    const p = shared.place.get();
    return p?.status === 'topic' && p.segments.length === 1 && shared.plain.get() !== p.canonical;
  });
  topic.place = computed(() => {
    const p = shared.place.get();
    // Names under an address resolve to their own link (the object resolver): nothing lists here.
    if (isWord.get() || (p?.status === 'home' && p.names.length > 0)) return undefined;
    return p;
  });
  const word = document.createElement('efs-files-word') as EfsFilesWord;
  word.host = host;
  word.nav = shared.nav;
  word.place = computed(() => (isWord.get() ? shared.place.get() : undefined));
  word.opened = shared.opened;
  word.plain = shared.plain;
  box.append(list, topic, word);
  effect(scope, () => {
    list.hidden = tagged.get();
    topic.hidden = topic.place.get() === undefined;
    word.hidden = !isWord.get();
  });
  // Leaving the plain tag (another place, or none) ends it.
  effect(scope, () => {
    const p = shared.place.get();
    const plain = shared.plain.get();
    if (plain !== undefined && p?.canonical !== plain)
      queueMicrotask(() => shared.plain.set(undefined));
  });
  list.start(scope);
  topic.start(scope);
  word.start(scope);
  return box;
}

function preview(host: AppHost, shared: Shared, scope: OwnerScope): HTMLElement {
  const element = document.createElement('efs-files-preview') as EfsFilesPreview;
  element.host = host;
  element.nav = shared.nav;
  element.object = shared.object;
  element.composer = shared.composer;
  element.tagEdits = shared.tagEdits;
  element.openTag = shared.openTag;
  const link = shared.link;
  element.target = link;
  // Shared links are normalized (e.g. uppercase hex) to the SDK's canonical form, in place; so are
  // tag paths, folded by the SDK (a typed /Cars/Tesla shows as /cars/tesla), so a copied link is
  // the canonical one.
  effect(scope, () => {
    const now = link.get();
    const location = host.location.get();
    if (
      (now.status === 'target' || now.status === 'topic') &&
      location.kind === 'realm' &&
      now.canonical !== location.link
    ) {
      queueMicrotask(() => host.openLink(now.canonical, { replace: true }));
    }
  });
  element.start(scope);
  return element;
}

export const entry: AppEntry = {
  mount(host: AppHost, scope: OwnerScope): AppMount {
    registerFilesElements();
    // Where the person is in the folder tree (this tab's memory), the route's link, and whether
    // an object link names a folder or a file (one openObject read): shared by the panes.
    const nav = createFolderNav();
    const link = computed(() => linkState(host.location.get()));
    const opened = state<PlaceOpened | undefined>(undefined);
    const place = computed<PlaceLink | undefined>(() => {
      const l = link.get();
      if (l.status === 'topic' || l.status === 'home') return l;
      const o = opened.get();
      return l.status === 'target' && o && o.link === l.canonical ? o.place : undefined;
    });
    const composer = createComposer();
    const plain = state<string | undefined>(undefined);
    // A one-word tag opened for its own list: plain is set once the route shows it (setting it
    // before would be cleared, since leaving the plain tag ends it).
    let wantPlain: string | undefined;
    const openTag = (words: readonly string[]) => {
      wantPlain = words.length === 1 ? words[0] : undefined;
      try {
        host.openLink(linkOf({ kind: 'topic', segments: words, words }));
      } catch (error) {
        console.error(error);
      }
    };
    effect(scope, () => {
      const p = place.get();
      if (wantPlain === undefined || p?.status !== 'topic') return;
      if (p.segments.length !== 1 || p.segments[0] !== wantPlain) return;
      wantPlain = undefined;
      const canonical = p.canonical;
      queueMicrotask(() => plain.set(canonical));
    });
    const shared: Shared = {
      nav,
      link,
      object: objectKindState(host, link, nav, scope),
      composer,
      shown: state<ListingState | undefined>(undefined),
      place,
      opened,
      plain,
      tagEdits: watchTagSaves(host, scope),
      openTag,
    };
    // A new file is written where it was started: leaving that place ends the composer (its text
    // stays kept, and the folder's listing offers it back).
    effect(scope, () => {
      const c = composer.current.get();
      const location = host.location.get();
      if (c && (location.kind !== 'realm' || location.link !== c.route)) {
        queueMicrotask(() => composer.end());
      }
    });
    const views = new Map<string, ViewDescriptor>([
      [
        'overview',
        {
          id: 'overview',
          title: 'files.overview.title',
          create: (s) => overview(host, shared, s),
        },
      ],
      [
        'entries',
        {
          id: 'entries',
          title: 'files.entries.title',
          create: (s) => entries(host, shared, s),
        },
      ],
      [
        'preview',
        {
          id: 'preview',
          title: 'files.preview.title',
          create: (s) => preview(host, shared, s),
        },
      ],
    ]);
    return {
      views,
      defaultLayout: DEFAULT_LAYOUT,
      location: view(host, 'location', nav, place),
      navigation: tree(host, nav, scope),
      // A link opens on what it names, also on a phone: a folder on its Entries, a file on its
      // Preview; undefined until openObject has said which.
      linkView: computed(() => {
        if (composer.current.get()) return 'preview';
        const l = link.get();
        if (l.status === 'topic' || l.status === 'home') return 'entries';
        const kind = shared.object.kind.get().status;
        if (kind === 'folder') return 'entries';
        return kind === 'pending' ? undefined : 'preview';
      }),
    };
  },
};

export default entry;
