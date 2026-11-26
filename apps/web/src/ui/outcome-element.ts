// <efs-outcome>: one qualified result (a read, bytes, write or pin status) as a person sees it.
// The tone, message and retry hint come from ui/outcome.ts; an unrecognized status renders as a
// warning, never as success, empty or absent. The raw status code (and the reason code, when the
// result has one) is shown untranslated, so a report or an Inspector can name it exactly.
// UNKNOWN BEHIND (the SDK's read floor) has its own copy, and on a local test chain a "Start over"
// that forgets the floor (`reset`, given by the host only there) and reads again.

import { EfsElement, html, nothing } from './element.ts';
import type { Translator } from './i18n.ts';
import { appIcon } from './icons.ts';
import { describeOutcome, type OutcomeKind, outcomeActions, type Tone } from './outcome.ts';
import type { AppIcon } from './wa/icon-ids.ts';

export const RETRY_EVENT = 'efs-retry';

const ICON: Readonly<Record<Tone, AppIcon>> = {
  success: 'circle-check',
  neutral: 'circle-info',
  warning: 'triangle-exclamation',
  danger: 'circle-exclamation',
};

export class EfsOutcome extends EfsElement {
  static override properties = {
    kind: { attribute: false },
    code: { attribute: false },
    reason: { attribute: false },
    reset: { attribute: false },
    translator: { attribute: false },
    retryable: { type: Boolean },
    compact: { type: Boolean },
  };
  declare kind: OutcomeKind;
  declare code: string;
  /** The result's reason code, when it has one (`result.reason?.code`). */
  declare reason: string | undefined;
  /** Forgets the read floor: given only on a local test chain (shell/read-floor.ts). */
  declare reset: (() => void) | undefined;
  declare translator: Translator;
  /** Shows "Try again" when the status allows a transient retry. The host handles RETRY_EVENT. */
  declare retryable: boolean;
  /** One line, no callout box: for status lines inside other surfaces. */
  declare compact: boolean;

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const t = this.translator.t.bind(this.translator);
    const view = describeOutcome(this.kind, this.code, this.reason);
    const actions = outcomeActions(view, {
      retryable: this.retryable,
      canReset: this.reset !== undefined,
    });
    const again = () =>
      this.dispatchEvent(new CustomEvent(RETRY_EVENT, { bubbles: true, composed: true }));
    const buttons = actions.map((a) =>
      a === 'retry'
        ? html`<wa-button size="s" class="efs-outcome-retry" @click=${again}
            ><span slot="start">${appIcon('rotate-right')}</span>${t('outcome.retry')}</wa-button
          >`
        : html`<wa-button
            size="s"
            appearance="outlined"
            class="efs-outcome-start-over"
            @click=${() => {
              this.reset?.();
              again();
            }}
            >${t('outcome.startOver')}</wa-button
          >`,
    );
    const retry = buttons.length > 0 ? buttons : nothing;
    const body = html`<span class="efs-outcome-message">${t(view.message)}</span>
      <code class="efs-outcome-code" translate="no" dir="ltr">${view.code}</code>${
        view.reason
          ? html` <code class="efs-outcome-reason" translate="no" dir="ltr">${view.reason}</code>`
          : nothing
      }`;
    if (this.compact) {
      return html`<p class="efs-outcome-line" data-tone=${view.tone} role="status">
        ${appIcon(ICON[view.tone])} ${body} ${retry}
      </p>`;
    }
    return html`<wa-callout variant=${view.tone} class="efs-outcome" data-tone=${view.tone}>
      <span slot="icon">${appIcon(ICON[view.tone])}</span>
      <div class="wa-stack wa-gap-xs">
        <p>${body}</p>
        ${retry === nothing ? nothing : html`<div class="wa-cluster wa-gap-xs">${retry}</div>`}
      </div>
    </wa-callout>`;
  }
}
