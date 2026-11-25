// The page banner for saves that need the person or are still settling: "Partially saved (2 of
// 5) — Continue to finish", "Saved · confirming", then "Saved". Continue, Send again and Stop act
// through the writer, so they need the wallet that started the save; a click with no wallet (or
// the wrong network) opens the wallet dialog instead of prompting by itself.
//
// A call that throws never reads as "nothing was sent": the SDK may have broadcast before it
// threw. The banner says it couldn't confirm yet and re-reads the journal and the ledger.

import type { Hex } from '@efs/sdk';
import type { EfsWriter, SequenceProgress } from '@efs/sdk/actions';
import { state } from '../state/signals.ts';
import { EfsElement, html, nothing } from '../ui/element.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import type { NetworkState } from './network-state.ts';
import {
  isFault,
  type SaveAction,
  saveAction,
  saveMessage,
  saveOutcome,
  saveValues,
} from './save-outcome.ts';
import type { SavesSession } from './saves-state.ts';
import { shortAccount } from './wallet-state.ts';
import type { WriterSession } from './writer-state.ts';

/** Asks the shell for the wallet dialog (Connect, or Switch network). */
export const REQUEST_WALLET_EVENT = 'efs-request-wallet';

type RowNotice =
  | { readonly kind: 'confirm-abandon' }
  | { readonly kind: 'other-account' }
  | { readonly kind: 'message'; readonly id: MessageId };

const PRIMARY: Partial<Record<SaveAction, MessageId>> = {
  continue: 'saves.continue',
  'send-again': 'saves.sendAgain',
  retry: 'saves.retry',
  reopen: 'saves.reopen',
};

export class EfsSavesBanner extends EfsElement {
  static override properties = {
    saves: { attribute: false },
    writer: { attribute: false },
    network: { attribute: false },
    translator: { attribute: false },
  };
  declare saves: SavesSession;
  declare writer: WriterSession;
  /** The network in view, to name a chain the wallet must switch back to. */
  declare network: NetworkState;
  declare translator: Translator;

  /** The save whose action is running (its buttons show progress). */
  #busy = state<string | undefined>(undefined);
  /** While a continued save asks the wallet: "Approve part k of N". */
  #approving = state<{ readonly part: number; readonly total: number } | undefined>(undefined);
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

  #chainName(id: number, t: Translator['t']): string {
    const n = this.network;
    return 'network' in n && n.network.definition.chainId === id
      ? n.network.definition.label
      : t('saves.chainId', { id: String(id) });
  }

  /**
   * Runs a writer call for `p`, after checking the wallet can act for the save's account.
   * Returns the new progress, or undefined when nothing could be confirmed.
   */
  async #act(
    p: SequenceProgress,
    call: (writer: EfsWriter, id: Hex) => Promise<SequenceProgress>,
  ): Promise<SequenceProgress | undefined> {
    const ready = this.writer.availability.get();
    if (ready.status !== 'READY') {
      this.dispatchEvent(new CustomEvent(REQUEST_WALLET_EVENT, { bubbles: true, composed: true }));
      return undefined;
    }
    // Only a writer for the account that started a save can continue it (the SDK refuses others).
    if (ready.account.toLowerCase() !== p.account.toLowerCase()) {
      this.#notice(p.sequenceId, { kind: 'other-account' });
      return undefined;
    }
    this.#notice(p.sequenceId, undefined);
    this.#busy.set(p.sequenceId);
    try {
      const writer = await this.writer.writer();
      if (!writer) return undefined;
      const next = await call(writer, p.sequenceId);
      this.saves.track(next);
      return next;
    } catch (error) {
      // It may have been sent before the throw: say so, and let the journal and ledger decide.
      console.error(error);
      this.#notice(p.sequenceId, {
        kind: 'message',
        id: isFault(error, 'JOURNAL_UNAVAILABLE') ? 'save.noJournal' : 'save.unconfirmed',
      });
      void this.saves.refresh();
      return undefined;
    } finally {
      this.#busy.set(undefined);
      this.#approving.set(undefined);
    }
  }

  #resume(p: SequenceProgress): void {
    void this.#act(p, (writer, id) =>
      writer.resume(id, {
        onProgress: (now, event) => {
          const first = event.kind === 'wallet-request' ? event.parts[0] : undefined;
          if (first !== undefined) this.#approving.set({ part: first + 1, total: now.total });
        },
      }),
    );
  }

  /** "Review changes": stop the old save, then bring the person's edit back on the current file. */
  async #reopen(p: SequenceProgress): Promise<void> {
    const draft = this.saves.draftOf(p.sequenceId);
    if (!draft) {
      this.#notice(p.sequenceId, { kind: 'message', id: 'saves.draftNotKept' });
      return;
    }
    const stopped = await this.#act(p, (writer, id) => writer.abandon(id));
    if (stopped?.state !== 'ABANDONED') return;
    this.saves.reopen(draft);
    if (location.hash !== draft.route) location.hash = draft.route;
  }

  #primary(p: SequenceProgress, action: SaveAction | undefined, t: Translator['t']) {
    const label = action ? PRIMARY[action] : undefined;
    if (!label) return nothing;
    return html`<wa-button
      size="s"
      variant="brand"
      class=${action === 'reopen' ? 'efs-save-reopen' : 'efs-save-continue'}
      ?loading=${this.#busy.get() === p.sequenceId}
      ?disabled=${this.#busy.get() !== undefined}
      @click=${() => (action === 'reopen' ? void this.#reopen(p) : this.#resume(p))}
      >${t(label)}</wa-button
    >`;
  }

  #row(p: SequenceProgress, t: Translator['t']) {
    const outcome = saveOutcome(p);
    const action = saveAction(outcome);
    const notice = this.#notices.get().get(p.sequenceId);
    const done = outcome.kind === 'saved';
    // The network is deciding: nothing to press, and stopping would be refused (a part is in flight).
    const settling =
      outcome.kind === 'confirming' ||
      outcome.kind === 'checking' ||
      outcome.kind === 'undone-checking';
    const variant =
      done || (settling && outcome.kind !== 'undone-checking') ? 'success' : 'warning';
    const values = saveValues(outcome, shortAccount, (id) => this.#chainName(id, t));
    const approving = this.#busy.get() === p.sequenceId ? this.#approving.get() : undefined;
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
      ${approving ? html`<p role="status">${t('saves.approvePart', approving)}</p>` : nothing}
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
                  @click=${() => void this.#act(p, (writer, id) => writer.abandon(id))}
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
