// The contract between the shell and an app. Plain data plus one lazily imported entry, so an
// app's code loads only when it is opened, and everything it starts belongs to a scope the
// shell disposes. This is the seam that later grows into independently released modules; it is
// deliberately not a plugin framework or service locator.

import type { EfsWriter, SequenceProgress } from '@efs/sdk/actions';
import type { RealmRef } from '../boot/route.ts';
import type { Hosting } from '../platform/hosting.ts';
import type { OwnerScope } from '../platform/scope.ts';
import type { GatewayKind } from '../platform/settings/public-gateways.ts';
import type { ReadonlySignal } from '../state/signals.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import type { DraftStore } from './drafts.ts';
import type { NetworkState } from './network-state.ts';
import type { ReaderState } from './reader-state.ts';
import type { CheckResult, Draft, Unconfirmed } from './saves-state.ts';
import type { WriterAvailability } from './writer-state.ts';

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
  /** `link` is the SDK's (object, path, revision, …); parse it only with the SDK's parseLink. */
  | { readonly kind: 'realm'; readonly realm: RealmRef; readonly link: string };

/**
 * Saving, as the shell offers it to apps: never the wallet itself. Only the shell's wallet dialog
 * prompts for a connection or a network switch, and only after a click; the writer prompts only
 * when the app sends a plan the person reviewed.
 */
export interface SavingHost {
  /** Whether a save can be prepared now, and if not, why (no wallet, wrong network). */
  readonly availability: ReadonlySignal<WriterAvailability>;
  /** Opens the wallet dialog: Connect, or Switch network. Call only from a click. */
  requestWallet(): void;
  /** The writer for the connected account, created on first use; undefined unless READY. */
  writer(): Promise<EfsWriter | undefined>;
  /** The saves the banner shows (open, confirming, just saved), newest first. */
  readonly saves: ReadonlySignal<readonly SequenceProgress[]>;
  /**
   * Re-reads open saves: after a send that couldn't be confirmed, on "Check again", and before a
   * new send (`settle: false`: the journal only). Resolves with how it went; never hangs.
   */
  refresh(o?: { readonly settle?: boolean; readonly timeoutMs?: number }): Promise<CheckResult>;
  /** Sends that threw before anything could be confirmed, until a check finds their save. */
  readonly unconfirmed: ReadonlySignal<readonly Unconfirmed[]>;
  markUnconfirmed(u: Unconfirmed): void;
  /**
   * Hands a save's progress to the shell, which shows it and carries it to "Saved". `draft` is
   * the person's edit, kept in memory so "Review changes" can bring it back.
   */
  track(progress: SequenceProgress, draft?: Draft): void;
  /**
   * "Not now" on a RESPLIT ask (a save that now needs more approvals): from here it's listed as
   * waiting, with Continue, and asks no more in this tab.
   */
  putOff(sequenceId: `0x${string}`): void;
  /** A draft the banner asked to reopen ("Review changes"). */
  readonly reopening: ReadonlySignal<Draft | undefined>;
  /** Takes the pending reopen when its file (`link`) is the one on screen. */
  takeReopen(link: string): Draft | undefined;
  /**
   * Unsaved edits, one per file, kept in this tab's memory across navigation (never stored).
   * While any exist, the shell asks before the tab is reloaded or closed.
   */
  readonly drafts: DraftStore;
  /** How this copy is hosted: on a shared IPFS path gateway, saving is off (and says why). */
  readonly hosting: Hosting;
}

/** What the shell gives an app. Nothing ambient: no globals, no wallet object, no storage handle. */
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
  readonly saving: SavingHost;
  /**
   * Names by lowercase address, shown beside addresses: the local test chain's dev accounts
   * (personas), when the network offers them; otherwise empty.
   */
  readonly names: ReadonlySignal<ReadonlyMap<string, string>>;
  /**
   * Adds the named public gateways of `kind` to the selected network's list, saved as the
   * person's setting (shown and changeable in Settings). Only ever from the person's own click.
   */
  usePublicGateways(kind: GatewayKind): Promise<'SAVED' | 'FAILED'>;
}

export interface AppMount {
  readonly views: ReadonlyMap<string, ViewDescriptor>;
  readonly defaultLayout: PaneLayout;
  /** Slotted into the shell's subheader (the File Browser's breadcrumb goes here). */
  readonly location?: HTMLElement;
  /** Slotted into the shell's navigation region (the File Browser's tree goes here). */
  readonly navigation?: HTMLElement;
  /**
   * The view that shows what a realm link names (the File Browser's Preview, or its Entries for a
   * folder link). Where panes are tabs (narrow screens), arriving by a link brings this view to
   * the front, once: a signal lets the app say which view only after it knows (undefined: not yet).
   */
  readonly linkView?: string | ReadonlySignal<string | undefined>;
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
