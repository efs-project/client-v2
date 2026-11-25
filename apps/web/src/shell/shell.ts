// The OS shell: one <wa-page> (header, location bar, navigation, main) hosting one app at a
// time. It knows nothing about files: the active app supplies its location bar, navigation and
// panes. Each app is loaded lazily and lives in its own scope, disposed when it is replaced.

import {
  formatRealmRoute,
  formatRoute,
  type OsRoute,
  parseRoute,
  type RealmRef,
} from '../boot/route.ts';
import type { Hosting } from '../platform/hosting.ts';
import { createScope, type OwnerScope } from '../platform/scope.ts';
import { defaultNetwork, EMPTY_CONFIG } from '../platform/settings/model.ts';
import { effect } from '../state/effect.ts';
import { computed, state } from '../state/signals.ts';
import { EfsElement, html, nothing } from '../ui/element.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import {
  type AppDescriptor,
  type AppHost,
  type AppLocation,
  type AppMount,
  resolveLayout,
} from './apps.ts';
import type { DraftStore } from './drafts.ts';
import { OPEN_SETTINGS_EVENT } from './network-indicator.ts';
import type { OsState } from './os-state.ts';
import type { ReaderSession } from './reader-state.ts';
import { saveOutcome } from './save-outcome.ts';
import { describeSave } from './saves-banner.ts';
import type { SavesSession } from './saves-state.ts';
import type { EfsSettingsPanel } from './settings-panel.ts';
import type { WalletSession } from './wallet-state.ts';
import type { EfsWallet } from './wallet-ui.ts';
import type { WriterSession } from './writer-state.ts';

/** Below this width (CSS px) the page uses its mobile layout: navigation in a drawer. */
const MOBILE_BREAKPOINT_PX = 920;

type AppSlot =
  | { readonly status: 'loading'; readonly app: AppDescriptor }
  | { readonly status: 'ready'; readonly app: AppDescriptor; readonly mount: AppMount }
  | { readonly status: 'failed'; readonly app: AppDescriptor }
  | { readonly status: 'unknown'; readonly requested: string }
  | { readonly status: 'too-long' };

export class EfsShell extends EfsElement {
  static override properties = {
    os: { attribute: false },
    reader: { attribute: false },
    wallet: { attribute: false },
    writer: { attribute: false },
    saves: { attribute: false },
    drafts: { attribute: false },
    hosting: { attribute: false },
    translator: { attribute: false },
    apps: { attribute: false },
  };
  declare os: OsState;
  declare reader: ReaderSession;
  declare wallet: WalletSession;
  declare writer: WriterSession;
  declare saves: SavesSession;
  /** Unsaved edits, kept in this tab's memory across navigation. */
  declare drafts: DraftStore;
  /** How this copy is hosted (a shared IPFS path gateway runs read-only). */
  declare hosting: Hosting;
  declare translator: Translator;
  declare apps: readonly AppDescriptor[];

  #slot = state<AppSlot | undefined>(undefined);
  #appScope: OwnerScope | undefined;
  #loadGeneration = 0;
  #shellScope: OwnerScope | undefined;
  /**
   * What the page last said about saves, in one live region that is always in the document:
   * a region inserted together with its text (the banner appears only once there are saves) is
   * not reliably read out. Polite: it never interrupts what the person is doing.
   */
  #announcement = state('');
  /** Each save's outcome when last announced, so only changes are spoken. */
  #announced = new Map<string, string>();
  /**
   * <wa-page> starts as "desktop" and switches only after its first resize measurement, so a
   * phone would briefly lay out the desktop columns (wider than the screen). Its first render gets
   * the right view from the window; from then on its own measurement decides.
   */
  #initialView = innerWidth < MOBILE_BREAKPOINT_PX ? 'mobile' : 'desktop';

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#shellScope = createScope();
    const onOpen = (event: Event) =>
      this.querySelector<EfsSettingsPanel>('efs-settings-panel')?.open(
        (event as CustomEvent<{ section?: 'appearance' | 'network' | 'data' }>).detail?.section,
      );
    this.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    this.#shellScope.defer(() => this.removeEventListener(OPEN_SETTINGS_EVENT, onOpen));
    // Unsaved edits live only in this tab: ask before a reload or closing the tab loses them.
    // Listening only while one exists keeps the page eligible for the back/forward cache
    // otherwise. (iOS Safari has no beforeunload: there, nothing asks.)
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    let guarding = false;
    effect(this.#shellScope, () => {
      const unsaved = this.drafts.count.get() > 0;
      if (unsaved === guarding) return;
      guarding = unsaved;
      if (unsaved) addEventListener('beforeunload', guard);
      else removeEventListener('beforeunload', guard);
    });
    this.#shellScope.defer(() => removeEventListener('beforeunload', guard));
    // Save outcomes as they change ("Saved · confirming", "Saved", "Partially saved (2 of 5)…").
    effect(this.#shellScope, () => {
      const s = this.saves.state.get();
      const saves = s.status === 'READY' ? s.saves : [];
      const network = this.os.network.get();
      const t = this.translator.t.bind(this.translator);
      const next = new Map<string, string>();
      let spoken: string | undefined;
      for (const p of saves) {
        const kind = saveOutcome(p).kind;
        next.set(p.sequenceId, kind);
        if (this.#announced.get(p.sequenceId) !== kind) spoken = describeSave(p, network, t);
      }
      this.#announced = next;
      if (spoken !== undefined) {
        const text = spoken;
        queueMicrotask(() => this.#announcement.set(text));
      }
    });
    // Realm links are kept in canonical form (lowercase ledger, trailing slash), in place.
    effect(this.#shellScope, () => {
      const route = this.os.route.get();
      if (route.kind === 'realm' && location.hash !== route.canonical) {
        queueMicrotask(() => this.#go(route.canonical, true));
      }
    });
    // The bare root opens the default realm: #/ becomes #/r/<default>/ (replace, not push).
    effect(this.#shellScope, () => {
      if (this.os.route.get().kind !== 'default') return;
      const config = this.os.config.get();
      const network = defaultNetwork(
        config.status === 'OK' ? config.config : EMPTY_CONFIG,
        this.os.settings.get(),
      );
      if (network)
        queueMicrotask(() => this.#go(formatRealmRoute({ kind: 'alias', id: network.id }), true));
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#appScope?.dispose();
    this.#shellScope?.dispose();
  }

  /** Navigates to a fragment; `replace` keeps history meaningful for automatic redirects. */
  #go(hash: string, replace = false): void {
    if (replace) {
      history.replaceState(history.state, '', hash);
      this.os.route.set(parseRoute(new URL(location.href)));
    } else {
      location.hash = hash;
    }
  }

  /** The realm the view is in: the route's, else the default network's. */
  #currentRealm(): RealmRef | undefined {
    const route = this.os.route.get();
    if (route.kind === 'realm') return route.realm;
    const config = this.os.config.get();
    const network = defaultNetwork(
      config.status === 'OK' ? config.config : EMPTY_CONFIG,
      this.os.settings.get(),
    );
    return network ? { kind: 'alias', id: network.id } : undefined;
  }

  #targetApp(route: OsRoute): AppDescriptor | string | 'too-long' {
    // Realm links open in the default app (the File Browser handles links).
    if (route.kind === 'default' || route.kind === 'realm') return this.apps[0] as AppDescriptor;
    if (route.kind === 'too-long') return 'too-long';
    if (route.kind === 'malformed') return route.raw;
    return this.apps.find((a) => a.id === route.app) ?? route.app;
  }

  /** Called when the route may name a different app. Loads it only if it changed. */
  #syncApp(): void {
    const target = this.#targetApp(this.os.route.get());
    const current = this.#slot.get();
    if (target === 'too-long') {
      if (current?.status !== 'too-long') {
        this.#appScope?.dispose();
        this.#slot.set({ status: 'too-long' });
      }
      return;
    }
    if (typeof target === 'string') {
      if (current?.status !== 'unknown' || current.requested !== target) {
        this.#appScope?.dispose();
        this.#slot.set({ status: 'unknown', requested: target });
      }
      return;
    }
    // Same app (loading, ready, or failed): nothing to do. A failed load is retried only from its
    // own "Try again" button, never by re-rendering.
    if (current && 'app' in current && current.app.id === target.id) return;
    void this.#load(target);
  }

  async #load(app: AppDescriptor): Promise<void> {
    const generation = ++this.#loadGeneration;
    this.#appScope?.dispose();
    const scope = this.#shellScope ? this.#shellScope.child() : createScope();
    this.#appScope = scope;
    this.#slot.set({ status: 'loading', app });
    try {
      const entry = await app.load();
      if (generation !== this.#loadGeneration || scope.signal.aborted) return;
      const mount = entry.mount(this.#hostFor(app), scope);
      this.#slot.set({ status: 'ready', app, mount });
    } catch (error) {
      if (generation !== this.#loadGeneration) return;
      this.#slot.set({ status: 'failed', app });
      console.error(error);
    }
  }

  #hostFor(app: AppDescriptor): AppHost {
    const location = computed<AppLocation>(() => {
      const r = this.os.route.get();
      if (r.kind === 'realm') return { kind: 'realm', realm: r.realm, link: r.link };
      return { kind: 'app', rest: r.kind === 'app' && r.app === app.id ? r.rest : '' };
    });
    return {
      translator: this.translator,
      network: this.os.network,
      reader: this.reader.state,
      retryReader: () => this.reader.retry(),
      location,
      navigate: (rest, options) => this.#go(formatRoute(app.id, rest), options?.replace),
      openLink: (link, options) => {
        const realm = this.#currentRealm();
        if (realm) this.#go(formatRealmRoute(realm, link), options?.replace);
      },
      saving: this.#saving(),
    };
  }

  #saving(): AppHost['saving'] {
    const saves = this.saves;
    return {
      availability: this.writer.availability,
      requestWallet: () => this.#requestWallet(),
      writer: () => this.writer.writer(),
      saves: computed(() => {
        const s = saves.state.get();
        return s.status === 'READY' ? s.saves : [];
      }),
      refresh: (o) => saves.refresh(o),
      unconfirmed: saves.unconfirmed,
      markUnconfirmed: (u) => saves.markUnconfirmed(u),
      track: (progress, draft) => saves.track(progress, draft),
      reopening: saves.reopening,
      takeReopen: (link) => saves.takeReopen(link),
      drafts: this.drafts,
      hosting: this.hosting,
    };
  }

  #requestWallet(): void {
    this.querySelector<EfsWallet>('efs-wallet')?.request();
  }

  #main(slot: AppSlot | undefined, t: Translator['t']) {
    if (!slot || slot.status === 'loading') {
      return html`<div class="efs-center wa-stack wa-gap-s" role="status">
        <wa-spinner></wa-spinner><p>${t('shell.app.loading')}</p>
      </div>`;
    }
    if (slot.status === 'failed') {
      return html`<wa-callout variant="danger" class="efs-callout">
        <span slot="icon">${appIcon('circle-exclamation')}</span>
        <div class="wa-stack wa-gap-s">
          <p>${t('shell.app.failed')}</p>
          <!-- Browsers keep a failed module fetch in their module map, so an in-page retry of the
               same chunk can't succeed; reloading is the retry that works everywhere. -->
          <wa-button size="s" @click=${() => location.reload()}
            ><span slot="start">${appIcon('rotate-right')}</span>${t('shell.app.retry')}</wa-button
          >
        </div>
      </wa-callout>`;
    }
    if (slot.status === 'too-long') {
      return html`<wa-callout variant="warning" class="efs-callout">
        <span slot="icon">${appIcon('triangle-exclamation')}</span>
        <div class="wa-stack wa-gap-s">
          <p>${t('shell.route.tooLong')}</p>
          <a href="#/">${t('shell.app.openDefault')}</a>
        </div>
      </wa-callout>`;
    }
    if (slot.status === 'unknown') {
      return html`<wa-callout variant="warning" class="efs-callout">
        <span slot="icon">${appIcon('triangle-exclamation')}</span>
        <div class="wa-stack wa-gap-s">
          <p>${t('shell.app.unknown')}</p>
          <p><code translate="no" dir="ltr">${slot.requested}</code></p>
          <a href="#/">${t('shell.app.openDefault')}</a>
        </div>
      </wa-callout>`;
    }
    // Arriving by a link (a shared file link, say) shows what it names, even where panes are tabs.
    const route = this.os.route.get();
    const link = route.kind === 'realm' && route.link !== '' ? route.link : undefined;
    return html`<efs-pane-host
      .panes=${resolveLayout(slot.mount.defaultLayout, slot.mount.views)}
      .views=${slot.mount.views}
      .translator=${this.translator}
      .frontView=${slot.mount.linkView}
      .frontKey=${link}
    ></efs-pane-host>`;
  }

  /**
   * <wa-page>'s skip link is `<a href="#main-content">`. Followed natively it would rewrite the
   * hash, which is the OS route; move focus to the main region ourselves instead.
   */
  #onPageClick = (event: Event) => {
    const skip = event
      .composedPath()
      .find((node) => node instanceof HTMLAnchorElement && node.part.contains('skip-to-content'));
    if (!skip) return;
    event.preventDefault();
    this.querySelector<HTMLElement>('#efs-main')?.focus();
  };

  override render() {
    this.#syncApp();
    const t = this.translator.t.bind(this.translator);
    const slot = this.#slot.get();
    const mount = slot?.status === 'ready' ? slot.mount : undefined;
    const title: MessageId | undefined = slot && 'app' in slot ? slot.app.title : undefined;
    const saves = this.saves.state.get();
    return html`<wa-page
        mobile-breakpoint=${MOBILE_BREAKPOINT_PX}
        view=${this.#initialView}
        class="efs-page"
        @click=${this.#onPageClick}
      >
        <span slot="skip-to-content">${t('shell.skipLink')}</span>
        ${
          // Rendered only when there is something to show: <wa-page> keeps an empty banner hidden.
          saves.status === 'READY' || saves.status === 'LOAD_FAILED'
            ? html`<efs-saves-banner
                slot="banner"
                .saves=${this.saves}
                .drafts=${this.drafts}
                .writer=${this.writer}
                .network=${this.os.network.get()}
                .translator=${this.translator}
                @efs-request-wallet=${() => this.#requestWallet()}
              ></efs-saves-banner>`
            : nothing
        }
        <header slot="header" class="wa-split efs-header">
          <div class="wa-cluster wa-gap-s">
            <a class="efs-wordmark" href="#/" translate="no">EFS</a>
            ${title ? html`<h1 class="efs-app-title">${t(title)}</h1>` : nothing}
          </div>
          <div class="wa-cluster wa-gap-2xs">
            <efs-wallet
              .wallet=${this.wallet}
              .network=${this.os.network.get()}
              .hosting=${this.hosting}
              .translator=${this.translator}
            ></efs-wallet>
            <efs-network-indicator
              .network=${this.os.network.get()}
              .reader=${this.reader.state.get()}
              .translator=${this.translator}
            ></efs-network-indicator>
            <wa-button
              appearance="plain"
              class="efs-settings-button"
              @click=${() => this.querySelector<EfsSettingsPanel>('efs-settings-panel')?.open()}
              >${appIcon('gear', t('shell.settings.open'))}</wa-button
            >
          </div>
        </header>
        <div slot="subheader" class="wa-cluster wa-gap-xs efs-subheader">
          ${
            mount?.navigation
              ? html`<wa-button data-toggle-nav appearance="plain" class="wa-mobile-only"
                  >${appIcon('bars', t('shell.navigation.open'))}</wa-button
                >`
              : nothing
          }
          ${mount?.location ?? nothing}
        </div>
        ${
          mount?.navigation
            ? html`<nav slot="navigation" class="efs-navigation" aria-label=${t('shell.navigation.label')}>
                ${mount.navigation}
              </nav>`
            : nothing
        }
        <main id="efs-main" class="efs-main" tabindex="-1">${this.#main(slot, t)}</main>
      </wa-page>
      <p class="wa-visually-hidden efs-announcer" role="status" aria-live="polite">
        ${this.#announcement.get()}
      </p>
      <efs-settings-panel
        .os=${this.os}
        .reader=${this.reader}
        .translator=${this.translator}
      ></efs-settings-panel>`;
  }
}
