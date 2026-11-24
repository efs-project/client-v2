// The apps this build ships. Each loads lazily; the first is the default for an empty route.
import type { AppDescriptor } from '../shell/apps.ts';

export const APPS: readonly AppDescriptor[] = [
  {
    id: 'files',
    title: 'app.files.title',
    load: () => import('./files/entry.ts').then((m) => m.entry),
  },
];
