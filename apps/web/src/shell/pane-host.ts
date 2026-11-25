// Shows an app's panes. On wide containers they sit side by side in nested <wa-split-panel>s
// (keyboard-resizable dividers); on narrow ones a tab per pane shows one at a time. Each view
// element is created once and moved between the two arrangements, so its state survives.

import { createScope, type OwnerScope } from '../platform/scope.ts';
import { state } from '../state/signals.ts';
import { EfsElement, html, nothing } from '../ui/element.ts';
import type { Translator } from '../ui/i18n.ts';
import type { PaneSpec, ViewDescriptor } from './apps.ts';

/** Below this width per pane, panes switch to one-at-a-time tabs. */
const MIN_PANE_REM = 18;

export class EfsPaneHost extends EfsElement {
  static override properties = {
    panes: { attribute: false },
    views: { attribute: false },
    translator: { attribute: false },
    frontView: { attribute: false },
    frontKey: { attribute: false },
  };
  declare panes: readonly PaneSpec[];
  declare views: ReadonlyMap<string, ViewDescriptor>;
  declare translator: Translator;
  /**
   * The view to bring to the front, as a tab, each time `frontKey` changes to a new value: the
   * app's `linkView` while the route names a link (the link is the key). So a shared file link
   * opens on its Preview, and the person can still switch tabs freely afterwards.
   */
  declare frontView: string | undefined;
  declare frontKey: string | undefined;

  #scope: OwnerScope | undefined;
  #elements = new Map<string, HTMLElement>();
  /** Narrow (tabs) until measured: a first paint wider than a phone would scroll sideways. */
  #wide = state(false);
  /**
   * The tab shown when narrow. A plain field, not a signal: it changes in `willUpdate`, which
   * runs inside the signal-tracked update, where writing a signal isn't allowed.
   */
  #active = 0;
  /** The link whose view was last brought to the front. */
  #fronted: string | undefined;
  #observer: ResizeObserver | undefined;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = createScope();
    const fits = (width: number) => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      return width >= (this.panes?.length ?? 1) * MIN_PANE_REM * rem;
    };
    // Decide before the first render when the width is already known (it usually is).
    this.#wide.set(fits(this.clientWidth));
    this.#observer = new ResizeObserver(([entry]) => {
      if (entry) this.#wide.set(fits(entry.contentRect.width));
    });
    this.#observer.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer?.disconnect();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#elements.clear();
  }

  /** A new link: its view comes to the front (once; the person's tab choice stands after that). */
  override willUpdate(): void {
    if (this.frontKey === this.#fronted) return;
    this.#fronted = this.frontKey;
    if (this.frontKey === undefined || this.frontView === undefined) return;
    const index = (this.panes ?? []).findIndex((pane) => pane.view === this.frontView);
    if (index >= 0) this.#active = index;
  }

  #element(view: string): HTMLElement | undefined {
    const descriptor = this.views.get(view);
    if (!descriptor || !this.#scope) return undefined;
    let element = this.#elements.get(view);
    if (!element) {
      element = descriptor.create(this.#scope.child());
      this.#elements.set(view, element);
    }
    return element;
  }

  #pane(spec: PaneSpec) {
    const descriptor = this.views.get(spec.view);
    if (!descriptor) return nothing;
    return html`<div class="efs-pane" data-view=${spec.view}>
      <h2 class="efs-pane-title">${this.translator.t(descriptor.title)}</h2>
      <div class="efs-pane-body">${this.#element(spec.view)}</div>
    </div>`;
  }

  /** start | (start | (start | end)): equal shares unless a pane says otherwise. */
  #split(panes: readonly PaneSpec[]): unknown {
    const [first, ...rest] = panes;
    if (!first) return nothing;
    if (rest.length === 0) return this.#pane(first);
    const position = (first.size ?? 1 / panes.length) * 100;
    return html`<wa-split-panel position=${position} class="efs-split">
      <div slot="start" class="efs-split-slot">${this.#pane(first)}</div>
      <div slot="end" class="efs-split-slot">${this.#split(rest)}</div>
    </wa-split-panel>`;
  }

  override render() {
    const panes = this.panes ?? [];
    if (panes.length === 0) return nothing;
    if (this.#wide.get() || panes.length === 1) return this.#split(panes);
    const active = Math.min(this.#active, panes.length - 1);
    return html`<wa-tab-group
      class="efs-pane-tabs"
      active=${`pane-${active}`}
      @wa-tab-show=${(event: CustomEvent<{ name: string }>) => {
        this.#active = Number(event.detail.name.replace('pane-', '')) || 0;
        this.requestUpdate();
      }}
    >
      ${panes.map((pane, i) => {
        const descriptor = this.views.get(pane.view);
        return descriptor
          ? html`<wa-tab slot="nav" panel=${`pane-${i}`}>${this.translator.t(descriptor.title)}</wa-tab>`
          : nothing;
      })}
      ${panes.map(
        (pane, i) => html`<wa-tab-panel name=${`pane-${i}`}>${this.#pane(pane)}</wa-tab-panel>`,
      )}
    </wa-tab-group>`;
  }
}
