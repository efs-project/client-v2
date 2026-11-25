// The File Browser app: the OS's first app. Its default layout reproduces v1's three panes
// (overview / entries / preview) as plain data, so a configurable layout later is a settings
// change. Loaded lazily by the shell; everything it starts belongs to the scope it is given.

import type { OwnerScope } from '../../platform/scope.ts';
import type { AppEntry, AppHost, AppMount, PaneLayout, ViewDescriptor } from '../../shell/apps.ts';
import { effect } from '../../state/effect.ts';
import { computed, type ReadonlySignal } from '../../state/signals.ts';
import { registerFilesElements } from './define.ts';
import type { EfsFilesListing } from './listing.ts';
import { createFolderNav, type FolderNav } from './navigation.ts';
import { type ObjectKindState, objectKindState } from './object-kind.ts';
import type { EfsFilesPreview } from './preview.ts';
import { type LinkState, linkState } from './target.ts';
import type { EfsFilesView, FilesViewKind } from './views.ts';

const DEFAULT_LAYOUT: PaneLayout = {
  panes: [{ view: 'overview' }, { view: 'entries' }, { view: 'preview' }],
};

/** What the panes share: where the person is, the route's link, and what kind of thing it names. */
interface Shared {
  readonly nav: FolderNav;
  readonly link: ReadonlySignal<LinkState>;
  readonly object: ObjectKindState;
}

function view(host: AppHost, kind: FilesViewKind, nav: FolderNav): HTMLElement {
  const element = document.createElement('efs-files-view') as EfsFilesView;
  element.kind = kind;
  element.host = host;
  element.nav = nav;
  return element;
}

function listing(host: AppHost, shared: Shared, scope: OwnerScope): HTMLElement {
  const element = document.createElement('efs-files-listing') as EfsFilesListing;
  element.host = host;
  element.nav = shared.nav;
  element.object = shared.object;
  element.start(scope);
  return element;
}

function preview(host: AppHost, shared: Shared, scope: OwnerScope): HTMLElement {
  const element = document.createElement('efs-files-preview') as EfsFilesPreview;
  element.host = host;
  element.nav = shared.nav;
  element.object = shared.object;
  const link = shared.link;
  element.target = link;
  // Shared links are normalized (e.g. uppercase hex) to the SDK's canonical form, in place.
  effect(scope, () => {
    const now = link.get();
    const location = host.location.get();
    if (now.status === 'target' && location.kind === 'realm' && now.canonical !== location.link) {
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
    const shared: Shared = { nav, link, object: objectKindState(host, link, nav, scope) };
    const views = new Map<string, ViewDescriptor>([
      [
        'overview',
        {
          id: 'overview',
          title: 'files.overview.title',
          create: () => view(host, 'overview', nav),
        },
      ],
      [
        'entries',
        {
          id: 'entries',
          title: 'files.entries.title',
          create: (s) => listing(host, shared, s),
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
      location: view(host, 'location', nav),
      navigation: view(host, 'navigation', nav),
      // A link opens on what it names, also on a phone: a folder on its Entries, a file on its
      // Preview; undefined until openObject has said which.
      linkView: computed(() => {
        const kind = shared.object.kind.get().status;
        if (kind === 'folder') return 'entries';
        return kind === 'pending' ? undefined : 'preview';
      }),
    };
  },
};

export default entry;
