// The OS shell: one <wa-page> (header, location bar, navigation, main) hosting one app at a
// time. It knows nothing about files: the active app supplies its location bar, navigation and
// panes. Each app is loaded lazily and lives in its own scope, disposed when it is replaced.

import { formatRoute, type OsRoute } from '../boot/route.ts';
import { createScope, type OwnerScope } from '../platform/scope.ts';
import { computed, state } from '../state/signals.ts';
import { EfsElement, html, nothing } from '../ui/element.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import { type AppDescriptor, type AppHost, type AppMount, resolveLayout } from './apps.ts';
import { OPEN_SETTINGS_EVENT } from './network-indicator.ts';
import type { OsState } from './os-state.ts';
import type { EfsSettingsPanel } from './settings-panel.ts';

type AppSlot =
  | { readonly status: 'loading'; readonly app: AppDescriptor }
  | { readonly status: 'ready'; readonly app: AppDescriptor; readonly mount: AppMount }
  | { readonly status: 'failed'; readonly app: AppDescriptor }
  | { readonly status: 'unknown'; readonly requested: string };

export class EfsShell extends EfsElement {
  static override properties = {
    os: { attribute: false },
    translator: { attribute: false },
    apps: { attribute: false },
  };
  declare os: OsState;
  declare translator: Translator;
  declare apps: readonly AppDescriptor[];

  #slot = state<AppSlot | undefined>(undefined);
  #appScope: OwnerScope | undefined;
  #loadGeneration = 0;
  #shellScope: OwnerScope | undefined;

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
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#appScope?.dispose();
    this.#shellScope?.dispose();
  }

  #targetApp(route: OsRoute): AppDescriptor | string {
    if (route.kind === 'default') return this.apps[0] as AppDescriptor;
    if (route.kind === 'malformed') return route.raw;
    return this.apps.find((a) => a.id === route.app) ?? route.app;
  }

  /** Called when the route may name a different app. Loads it only if it changed. */
  #syncApp(): void {
    const target = this.#targetApp(this.os.route.get());
    const current = this.#slot.get();
    if (typeof target === 'string') {
      if (current?.status !== 'unknown' || current.requested !== target) {
        this.#appScope?.dispose();
        this.#slot.set({ status: 'unknown', requested: target });
      }
      return;
    }
    // Same app (loading, ready, or failed): nothing to do. A failed load is retried only from its
    // own "Try again" button, never by re-rendering.
    if (current && current.status !== 'unknown' && current.app.id === target.id) return;
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
    const route = computed(() => {
      const r = this.os.route.get();
      return r.kind === 'app' && r.app === app.id ? r.rest : '';
    });
    return {
      translator: this.translator,
      network: this.os.network,
      route,
      navigate: (rest, options) => {
        const hash = formatRoute(app.id, rest);
        if (options?.replace) {
          history.replaceState(history.state, '', hash);
          this.os.route.set({ kind: 'app', app: app.id, rest, truncated: false });
        } else {
          location.hash = hash;
        }
      },
    };
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
    if (slot.status === 'unknown') {
      return html`<wa-callout variant="warning" class="efs-callout">
        <span slot="icon">${appIcon('triangle-exclamation')}</span>
        <div class="wa-stack wa-gap-s">
          <p>${t('shell.app.unknown')}</p>
          <p><code translate="no" dir="ltr">${slot.requested}</code></p>
          <a href=${formatRoute(this.apps[0]?.id ?? '')}>${t('shell.app.openDefault')}</a>
        </div>
      </wa-callout>`;
    }
    return html`<efs-pane-host
      .panes=${resolveLayout(slot.mount.defaultLayout, slot.mount.views)}
      .views=${slot.mount.views}
      .translator=${this.translator}
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
    const title: MessageId | undefined =
      slot && slot.status !== 'unknown' ? slot.app.title : undefined;
    return html`<wa-page mobile-breakpoint="920" class="efs-page" @click=${this.#onPageClick}>
        <span slot="skip-to-content">${t('shell.skipLink')}</span>
        <header slot="header" class="wa-split efs-header">
          <div class="wa-cluster wa-gap-s">
            <a class="efs-wordmark" href=${formatRoute(this.apps[0]?.id ?? '')} translate="no">EFS</a>
            ${title ? html`<h1 class="efs-app-title">${t(title)}</h1>` : nothing}
          </div>
          <div class="wa-cluster wa-gap-2xs">
            <efs-network-indicator
              .network=${this.os.network.get()}
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
      <efs-settings-panel .os=${this.os} .translator=${this.translator}></efs-settings-panel>`;
  }
}
