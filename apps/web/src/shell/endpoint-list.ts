// Edits an ordered endpoint list (RPCs or gateways): add, enable/disable, reorder, remove.
// Reordering uses buttons, not drag, so it works by keyboard and touch (WCAG 2.5.7).
// The full URL is shown only here, on the user's own device; everywhere else uses the label.

import {
  checkEndpoint,
  type Endpoint,
  type EndpointKind,
  endpointLabel,
  MAX_ENDPOINTS,
} from '../platform/settings/model.ts';
import { state } from '../state/signals.ts';
import { EfsElement, html, nothing } from '../ui/element.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';

const RULE_MESSAGES: Readonly<Record<string, MessageId>> = {
  url: 'settings.endpoint.error.url',
  scheme: 'settings.endpoint.error.scheme',
  'insecure-remote': 'settings.endpoint.error.insecureRemote',
  credentials: 'settings.endpoint.error.credentials',
  length: 'settings.endpoint.error.length',
};

type Valued = HTMLElement & { value: string };

export class EfsEndpointList extends EfsElement {
  static override properties = {
    endpoints: { attribute: false },
    kind: { attribute: false },
    heading: { attribute: false },
    customized: { attribute: false },
    disabled: { attribute: false },
    translator: { attribute: false },
  };
  declare endpoints: readonly Endpoint[];
  declare kind: EndpointKind;
  declare heading: string;
  declare customized: boolean;
  declare disabled: boolean;
  declare translator: Translator;

  #error = state<MessageId | undefined>(undefined);

  protected override createRenderRoot() {
    return this;
  }

  #emit(next: readonly Endpoint[] | undefined): void {
    this.dispatchEvent(new CustomEvent('efs-endpoints-change', { detail: { endpoints: next } }));
  }

  #move(index: number, delta: number): void {
    const next = [...this.endpoints];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + delta, 0, item);
    this.#emit(next);
  }

  #add(form: HTMLFormElement): void {
    const url = form.querySelector<Valued>('[name="url"]')?.value ?? '';
    const label = (form.querySelector<Valued>('[name="label"]')?.value ?? '').trim();
    const check = checkEndpoint(url, this.kind);
    if (check.status === 'INVALID') {
      this.#error.set(RULE_MESSAGES[check.rule] ?? 'settings.endpoint.error.url');
      return;
    }
    if (this.endpoints.some((e) => e.url === check.url)) {
      this.#error.set('settings.endpoint.error.duplicate');
      return;
    }
    if (this.endpoints.length >= MAX_ENDPOINTS) {
      this.#error.set('settings.endpoint.error.tooMany');
      return;
    }
    this.#error.set(undefined);
    form.reset();
    this.#emit([...this.endpoints, { url: check.url, enabled: true, ...(label ? { label } : {}) }]);
  }

  override render() {
    const t = this.translator.t.bind(this.translator);
    const list = this.endpoints;
    const error = this.#error.get();
    return html`<section class="wa-stack wa-gap-s efs-endpoint-list">
      <h4 class="efs-endpoint-heading">${this.heading}</h4>
      ${
        list.length === 0
          ? html`<p class="efs-quiet">${t('settings.endpoint.empty')}</p>`
          : html`<ol class="wa-stack wa-gap-xs efs-endpoints">
              ${list.map((endpoint, i) => {
                const name = endpointLabel(endpoint);
                return html`<li class="wa-split wa-gap-xs efs-endpoint">
                  <div class="wa-stack wa-gap-3xs efs-endpoint-text">
                    <span translate="no">${name}</span>
                    <code translate="no" dir="ltr" class="efs-endpoint-url">${endpoint.url}</code>
                  </div>
                  <div class="wa-cluster wa-gap-3xs">
                    <wa-switch
                      size="s"
                      ?checked=${endpoint.enabled}
                      ?disabled=${this.disabled}
                      @change=${(event: Event) =>
                        this.#emit(
                          list.map((e, j) =>
                            j === i
                              ? { ...e, enabled: (event.target as HTMLInputElement).checked }
                              : e,
                          ),
                        )}
                      >${t('settings.endpoint.use')}<span class="wa-visually-hidden" translate="no">
                        ${name}</span
                      ></wa-switch
                    >
                    <wa-button
                      size="s"
                      appearance="plain"
                      ?disabled=${this.disabled || i === 0}
                      @click=${() => this.#move(i, -1)}
                      >${appIcon('arrow-up', t('settings.endpoint.moveUp', { name }))}</wa-button
                    >
                    <wa-button
                      size="s"
                      appearance="plain"
                      ?disabled=${this.disabled || i === list.length - 1}
                      @click=${() => this.#move(i, 1)}
                      >${appIcon('arrow-down', t('settings.endpoint.moveDown', { name }))}</wa-button
                    >
                    <wa-button
                      size="s"
                      appearance="plain"
                      variant="danger"
                      ?disabled=${this.disabled}
                      @click=${() => this.#emit(list.filter((_, j) => j !== i))}
                      >${appIcon('trash', t('settings.endpoint.remove', { name }))}</wa-button
                    >
                  </div>
                </li>`;
              })}
            </ol>`
      }
      <form
        class="wa-stack wa-gap-xs"
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          this.#add(event.currentTarget as HTMLFormElement);
        }}
      >
        <wa-input name="url" type="url" required label=${t('settings.endpoint.url')}
          hint=${this.kind === 'rpc' ? t('settings.endpoint.urlHint.rpc') : t('settings.endpoint.urlHint.gateway')}
          ?disabled=${this.disabled}></wa-input>
        <wa-input name="label" label=${t('settings.endpoint.label')} ?disabled=${this.disabled}></wa-input>
        ${error ? html`<p class="efs-field-error" role="alert">${t(error)}</p>` : nothing}
        <div class="wa-cluster wa-gap-xs">
          <wa-button type="submit" size="s" ?disabled=${this.disabled}
            ><span slot="start">${appIcon('plus')}</span>${t('settings.endpoint.add')}</wa-button
          >
          ${
            this.customized
              ? html`<wa-button size="s" appearance="outlined" ?disabled=${this.disabled}
                  @click=${() => this.#emit(undefined)}>${t('settings.endpoint.reset')}</wa-button>`
              : nothing
          }
        </div>
      </form>
    </section>`;
  }
}
