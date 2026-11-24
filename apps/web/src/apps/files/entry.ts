// The File Browser app: the OS's first app. Its default layout reproduces v1's three panes
// (overview / entries / preview) as plain data, so a configurable layout later is a settings
// change. Loaded lazily by the shell; everything it starts belongs to the scope it is given.

import type { OwnerScope } from '../../platform/scope.ts';
import type { AppEntry, AppHost, AppMount, PaneLayout, ViewDescriptor } from '../../shell/apps.ts';
import { registerFilesElements } from './define.ts';
import type { EfsFilesView, FilesViewKind } from './views.ts';

const DEFAULT_LAYOUT: PaneLayout = {
  panes: [{ view: 'overview' }, { view: 'entries' }, { view: 'preview' }],
};

function view(host: AppHost, kind: FilesViewKind): HTMLElement {
  const element = document.createElement('efs-files-view') as EfsFilesView;
  element.kind = kind;
  element.network = host.network;
  element.translator = host.translator;
  return element;
}

export const entry: AppEntry = {
  mount(host: AppHost, _scope: OwnerScope): AppMount {
    registerFilesElements();
    const views = new Map<string, ViewDescriptor>([
      [
        'overview',
        { id: 'overview', title: 'files.overview.title', create: () => view(host, 'overview') },
      ],
      [
        'entries',
        { id: 'entries', title: 'files.entries.title', create: () => view(host, 'entries') },
      ],
      [
        'preview',
        { id: 'preview', title: 'files.preview.title', create: () => view(host, 'preview') },
      ],
    ]);
    return {
      views,
      defaultLayout: DEFAULT_LAYOUT,
      location: view(host, 'location'),
      navigation: view(host, 'navigation'),
    };
  },
};

export default entry;
