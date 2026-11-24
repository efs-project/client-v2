// The contract between the shell and an app. Plain data plus one lazily imported entry, so an
// app's code loads only when it is opened, and everything it starts belongs to a scope the
// shell disposes. This is the seam that later grows into independently released modules; it is
// deliberately not a plugin framework or service locator.

import type { RealmRef } from '../boot/route.ts';
import type { OwnerScope } from '../platform/scope.ts';
import type { ReadonlySignal } from '../state/signals.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import type { NetworkState } from './network-state.ts';
import type { ReaderState } from './reader-state.ts';

/** One pane in a layout: which view, and optionally its share of the width (0–1). */
export interface PaneSpec {
  readonly view: string;
  readonly size?: number;
}

/** Plain, storable data. Configurable layouts later are just a different PaneLayout. */
export interface PaneLayout {
  readonly panes: readonly PaneSpec[];
}

export interface ViewDescriptor {
  readonly id: string;
  readonly title: MessageId;
  /** Creates the view's element. Called once per pane; the element lives in `scope`. */
  create(scope: OwnerScope): HTMLElement;
}

/** Where the app is: its own UI route, or a realm link it is the handler for. */
export type AppLocation =
  | { readonly kind: 'app'; readonly rest: string }
  /** `link` is the SDK's (object, revision, later path); parse it only with the SDK's parseLink. */
  | { readonly kind: 'realm'; readonly realm: RealmRef; readonly link: string };

/** What the shell gives an app. Nothing ambient: no globals, no wallet, no storage handle. */
export interface AppHost {
  readonly translator: Translator;
  readonly network: ReadonlySignal<NetworkState>;
  /** The tab's SDK session. Read through it only when `verifiedEfs()` returns an instance. */
  readonly reader: ReadonlySignal<ReaderState>;
  /** Tries the session again (after an UNKNOWN pin or a failed open). */
  retryReader(): void;
  readonly location: ReadonlySignal<AppLocation>;
  /** Goes to an app route `#/<app>/<rest>`. */
  navigate(rest: string, options?: { readonly replace?: boolean }): void;
  /** Goes to a link (from the SDK's link()) in the current realm, or the default realm. */
  openLink(link: string, options?: { readonly replace?: boolean }): void;
}

export interface AppMount {
  readonly views: ReadonlyMap<string, ViewDescriptor>;
  readonly defaultLayout: PaneLayout;
  /** Slotted into the shell's subheader (the File Browser's breadcrumb goes here). */
  readonly location?: HTMLElement;
  /** Slotted into the shell's navigation region (the File Browser's tree goes here). */
  readonly navigation?: HTMLElement;
}

export interface AppEntry {
  mount(host: AppHost, scope: OwnerScope): AppMount;
}

export interface AppDescriptor {
  readonly id: string;
  readonly title: MessageId;
  /** Must be a literal dynamic import (enforced by the build's graph check). */
  load(): Promise<AppEntry>;
}

/** Drop panes that name views the app doesn't provide, so a stored layout can't break an app. */
export function resolveLayout(
  layout: PaneLayout,
  views: ReadonlyMap<string, ViewDescriptor>,
): PaneSpec[] {
  const panes = layout.panes.filter((pane) => views.has(pane.view));
  return panes.length > 0 ? panes : [...views.keys()].slice(0, 1).map((view) => ({ view }));
}
