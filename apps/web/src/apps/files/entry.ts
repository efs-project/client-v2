// The File Browser app: the OS's first app. Its default layout reproduces v1's three panes
// (overview / entries / preview) as plain data, so a configurable layout later is a settings
// change. Loaded lazily by the shell; everything it starts belongs to the scope it is given.

import type { OwnerScope } from '../../platform/scope.ts';
import type { AppEntry, AppHost, AppMount, PaneLayout, ViewDescriptor } from '../../shell/apps.ts';
import { effect } from '../../state/effect.ts';
import { computed } from '../../state/signals.ts';
import { registerFilesElements } from './define.ts';
import type { EfsFilesListing } from './listing.ts';
import { createFolderNav, type FolderNav } from './navigation.ts';
import type { EfsFilesPreview } from './preview.ts';
import { linkState } from './target.ts';
import type { EfsFilesView, FilesViewKind } from './views.ts';

const DEFAULT_LAYOUT: PaneLayout = {
  panes: [{ view: 'overview' }, { view: 'entries' }, { view: 'preview' }],
};

function view(host: AppHost, kind: FilesViewKind, nav: FolderNav): HTMLElement {
  const element = document.createElement('efs-files-view') as EfsFilesView;
  element.kind = kind;
  element.host = host;
  element.nav = nav;
  return element;
}

function listing(host: AppHost, nav: FolderNav, scope: OwnerScope): HTMLElement {
  const element = document.createElement('efs-files-listing') as EfsFilesListing;
  element.host = host;
  element.nav = nav;
  element.start(scope);
  return element;
}

function preview(host: AppHost, nav: FolderNav, scope: OwnerScope): HTMLElement {
  const element = document.createElement('efs-files-preview') as EfsFilesPreview;
  element.host = host;
  element.nav = nav;
  const link = computed(() => linkState(host.location.get()));
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
  mount(host: AppHost, _scope: OwnerScope): AppMount {
    registerFilesElements();
    // Where the person is in the folder tree: this tab's memory, shared by the panes.
    const nav = createFolderNav();
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
          create: (scope) => listing(host, nav, scope),
        },
      ],
      [
        'preview',
        {
          id: 'preview',
          title: 'files.preview.title',
          create: (scope) => preview(host, nav, scope),
        },
      ],
    ]);
    return {
      views,
      defaultLayout: DEFAULT_LAYOUT,
      location: view(host, 'location', nav),
      navigation: view(host, 'navigation', nav),
      // A file link opens on the Preview, also on a phone.
      linkView: 'preview',
    };
  },
};

export default entry;
