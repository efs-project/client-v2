// Shows an app's panes. On wide containers they sit side by side in nested <wa-split-panel>s
// (keyboard-resizable dividers); on narrow ones a tab per pane shows one at a time. Each view
// element is created once and moved between the two arrangements, so its state survives.
//
// Never while a dialog is open in a pane (PM, 2026-11-27: a phone rotated mid-review). Moving an
// open <wa-dialog> takes its native dialog out of the top layer, and Web Awesome stops its
// rendered-watcher and Escape handling on disconnect and never restarts them: the review would
// sit hidden in a background tab, or shown but not modal, with no Escape. So the arrangement
// holds while a pane's dialog is open (the modal covers the page anyway), and switches once it
// closes: the pane that held it comes to the front, and focus stays where it was.

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
  /** Whether the last render was side by side (so a switch to tabs is a move). */
  #shownWide: boolean | undefined;
  /** The pane whose open dialog held the arrangement: it comes to the front once it closes. */
  #held: number | undefined;
  /** The element focused before a switch, to put focus back if the move dropped it. */
  #focused: Element | null = null;

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
    // A dialog closing may let a held switch happen (after its own focus return, queued first).
    this.addEventListener('wa-after-hide', this.#onDialogClosed);
  }

  #onDialogClosed = (): void => {
    setTimeout(() => this.requestUpdate());
  };

  /**
   * The pane holding an open dialog, or undefined: the one with focus first (several may), else
   * the first. Views render in light DOM, so a pane's dialogs are its descendants.
   */
  #openDialogPane(): number | undefined {
    const panes = this.panes ?? [];
    let first: number | undefined;
    for (const [i, pane] of panes.entries()) {
      const element = this.#elements.get(pane.view);
      const dialog = element?.querySelector('wa-dialog[open]');
      if (!dialog) continue;
      if (element?.contains(document.activeElement)) return i;
      first ??= i;
    }
    return first;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('wa-after-hide', this.#onDialogClosed);
    this.#observer?.disconnect();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#elements.clear();
  }

  /** A new link: its view comes to the front (once; the person's tab choice stands after that). */
  override willUpdate(): void {
    this.#focused = this.contains(document.activeElement) ? document.activeElement : null;
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

  /** After a switch, focus goes back to what had it if moving the panes dropped it. */
  override updated(): void {
    const focused = this.#focused;
    this.#focused = null;
    if (!focused?.isConnected || this.contains(document.activeElement)) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    (focused as HTMLElement).focus?.();
  }

  override render() {
    const panes = this.panes ?? [];
    if (panes.length === 0) return nothing;
    let wide = this.#wide.get() || panes.length === 1;
    if (!wide && this.#shownWide) {
      // Narrowed while side by side: hold while a pane's dialog is open, then front that pane.
      const held = this.#openDialogPane();
      if (held !== undefined) {
        this.#held = held;
        wide = true;
      } else if (this.#held !== undefined) {
        this.#active = this.#held;
        this.#held = undefined;
      }
    }
    this.#shownWide = wide;
    if (wide) return this.#split(panes);
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
