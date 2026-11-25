// The page banner for saves that need the person or are still settling: "Partially saved (2 of
// 5) — Continue to finish", "Saved · confirming", then "Saved". Continue, Send again and Stop act
// through the writer, so they need the wallet that started the save; a click with no wallet (or
// the wrong network) opens the wallet dialog instead of prompting by itself.

import type { SequenceProgress } from '@efs/sdk/actions';
import { state } from '../state/signals.ts';
import { EfsElement, html, nothing } from '../ui/element.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import { isFault, type SaveAction, saveAction, saveMessage, saveOutcome } from './save-outcome.ts';
import type { SavesSession } from './saves-state.ts';
import { shortAccount } from './wallet-state.ts';
import type { WriterSession } from './writer-state.ts';

/** Asks the shell for the wallet dialog (Connect, or Switch network). */
export const REQUEST_WALLET_EVENT = 'efs-request-wallet';

type RowNotice =
  | { readonly kind: 'confirm-abandon' }
  | { readonly kind: 'other-account' }
  | { readonly kind: 'message'; readonly id: MessageId };

export class EfsSavesBanner extends EfsElement {
  static override properties = {
    saves: { attribute: false },
    writer: { attribute: false },
    translator: { attribute: false },
  };
  declare saves: SavesSession;
  declare writer: WriterSession;
  declare translator: Translator;

  /** The save whose action is running (its buttons show progress). */
  #busy = state<string | undefined>(undefined);
  #notices = state<ReadonlyMap<string, RowNotice>>(new Map());

  protected override createRenderRoot() {
    return this;
  }

  #notice(id: string, notice: RowNotice | undefined): void {
    const next = new Map(this.#notices.get());
    if (notice) next.set(id, notice);
    else next.delete(id);
    this.#notices.set(next);
  }

  /** Runs a writer call for `p`, after checking the wallet can act for the save's account. */
  async #act(p: SequenceProgress, call: 'resume' | 'abandon'): Promise<void> {
    const ready = this.writer.availability.get();
    if (ready.status !== 'READY') {
      this.dispatchEvent(new CustomEvent(REQUEST_WALLET_EVENT, { bubbles: true, composed: true }));
      return;
    }
    // Only a writer for the account that started a save can continue it (the SDK refuses others).
    if (ready.account.toLowerCase() !== p.account.toLowerCase()) {
      this.#notice(p.sequenceId, { kind: 'other-account' });
      return;
    }
    this.#notice(p.sequenceId, undefined);
    this.#busy.set(p.sequenceId);
    try {
      const writer = await this.writer.writer();
      if (!writer) return;
      this.saves.track(await writer[call](p.sequenceId));
    } catch (error) {
      console.error(error);
      this.#notice(p.sequenceId, {
        kind: 'message',
        id: isFault(error, 'JOURNAL_UNAVAILABLE') ? 'save.noJournal' : 'saves.failed',
      });
    } finally {
      this.#busy.set(undefined);
    }
  }

  #primary(p: SequenceProgress, action: SaveAction | undefined, t: Translator['t']) {
    const label: MessageId | undefined =
      action === 'continue'
        ? 'saves.continue'
        : action === 'send-again'
          ? 'saves.sendAgain'
          : action === 'retry'
            ? 'saves.retry'
            : undefined;
    if (!label) return nothing;
    return html`<wa-button
      size="s"
      variant="brand"
      class="efs-save-continue"
      ?loading=${this.#busy.get() === p.sequenceId}
      ?disabled=${this.#busy.get() !== undefined}
      @click=${() => void this.#act(p, 'resume')}
      >${t(label)}</wa-button
    >`;
  }

  #row(p: SequenceProgress, t: Translator['t']) {
    const outcome = saveOutcome(p);
    const action = saveAction(outcome);
    const notice = this.#notices.get().get(p.sequenceId);
    const done = outcome.kind === 'saved';
    const settling = outcome.kind === 'confirming' || outcome.kind === 'checking';
    const variant = done || settling ? 'success' : 'warning';
    const values =
      outcome.kind === 'partial' ? { committed: outcome.committed, total: outcome.total } : {};
    // Nothing is in flight in these states, so stopping is allowed (the SDK refuses otherwise).
    const canStop = !done && !settling && outcome.kind !== 'abandoned';
    return html`<wa-callout
      variant=${variant}
      size="small"
      class="efs-save"
      data-outcome=${outcome.kind}
      data-sequence=${p.sequenceId}
    >
      <span slot="icon"
        >${appIcon(done || settling ? 'circle-check' : 'triangle-exclamation')}</span
      >
      <div class="wa-split wa-gap-s efs-save-row">
        <p role="status" class="efs-save-message">${t(saveMessage(outcome), values)}</p>
        <div class="wa-cluster wa-gap-xs">
          ${this.#primary(p, action, t)}
          ${
            canStop && notice?.kind !== 'confirm-abandon'
              ? html`<wa-button
                  size="s"
                  appearance="outlined"
                  class="efs-save-stop"
                  ?disabled=${this.#busy.get() !== undefined}
                  @click=${() => this.#notice(p.sequenceId, { kind: 'confirm-abandon' })}
                  >${t('saves.abandon')}</wa-button
                >`
              : nothing
          }
          ${
            done
              ? html`<wa-button
                  size="s"
                  appearance="plain"
                  class="efs-save-dismiss"
                  @click=${() => this.saves.dismiss(p.sequenceId)}
                  >${appIcon('xmark', t('saves.dismiss'))}</wa-button
                >`
              : nothing
          }
        </div>
      </div>
      ${
        notice?.kind === 'confirm-abandon'
          ? html`<div class="wa-stack wa-gap-xs efs-save-confirm">
              <p>${t('saves.abandonConfirm')}</p>
              <div class="wa-cluster wa-gap-xs">
                <wa-button
                  size="s"
                  variant="danger"
                  class="efs-save-abandon"
                  ?loading=${this.#busy.get() === p.sequenceId}
                  @click=${() => void this.#act(p, 'abandon')}
                  >${t('saves.abandonYes')}</wa-button
                >
                <wa-button size="s" appearance="outlined" @click=${() => this.#notice(p.sequenceId, undefined)}
                  >${t('saves.abandonNo')}</wa-button
                >
              </div>
            </div>`
          : notice?.kind === 'other-account'
            ? html`<p role="alert">
                ${t('saves.otherAccount', { account: shortAccount(p.account) })}
              </p>`
            : notice?.kind === 'message'
              ? html`<p role="alert">${t(notice.id)}</p>`
              : nothing
      }
    </wa-callout>`;
  }

  override render() {
    const t = this.translator.t.bind(this.translator);
    const s = this.saves.state.get();
    if (s.status === 'LOAD_FAILED') {
      return html`<section class="efs-saves" aria-label=${t('saves.label')}>
        <wa-callout variant="danger" size="small">
          <span slot="icon">${appIcon('circle-exclamation')}</span>
          <div class="wa-split wa-gap-s efs-save-row">
            <p>${t('saves.loadFailed')}</p>
            <wa-button size="s" @click=${() => location.reload()}
              ><span slot="start">${appIcon('rotate-right')}</span>${t('outcome.retry')}</wa-button
            >
          </div>
        </wa-callout>
      </section>`;
    }
    if (s.status !== 'READY') return nothing;
    return html`<section class="wa-stack wa-gap-2xs efs-saves" aria-label=${t('saves.label')}>
      ${s.saves.map((p) => this.#row(p, t))}
    </section>`;
  }
}
