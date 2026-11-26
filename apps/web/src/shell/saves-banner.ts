// The page banner for saves that need the person or are still settling: "Partially saved (2 of
// 5) — Continue to finish", "Saved · confirming", then "Saved". Continue, Send again and Stop act
// through the writer, so they need the wallet that started the save; a click with no wallet (or
// the wrong network) opens the wallet dialog instead of prompting by itself.
//
// A call that throws never reads as "nothing was sent": the SDK may have broadcast before it
// threw. The banner says it couldn't confirm yet and re-reads the journal and the ledger.

import type { Hex } from '@efs/sdk';
import type { EfsWriter, SequenceProgress } from '@efs/sdk/actions';
import { markEach } from '../platform/marks.ts';
import { onLocalChain } from '../platform/settings/model.ts';
import { state } from '../state/signals.ts';
import { EfsElement, html, live, nothing } from '../ui/element.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import { pressedOnce } from '../ui/press-once.ts';
import type { DraftStore } from './drafts.ts';
import type { NetworkState } from './network-state.ts';
import { heldMessage, touchesOf, twinStanding } from './save-hold.ts';
import {
  answerCopy,
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

/** A chain id as the person knows it: the network in view's label, else "chain N". */
export function chainName(network: NetworkState, id: number, t: Translator['t']): string {
  return 'network' in network && network.network.definition.chainId === id
    ? network.network.definition.label
    : t('saves.chainId', { id: String(id) });
}

/** What a save's row says, in words (the banner's message; the shell announces the same). */
export function describeSave(
  p: SequenceProgress,
  network: NetworkState,
  t: Translator['t'],
): string {
  const outcome = saveOutcome(p);
  return t(
    saveMessage(outcome),
    saveValues(outcome, shortAccount, (id) => chainName(network, id, t)),
  );
}

type RowNotice =
  | { readonly kind: 'confirm-abandon' }
  /** "Review changes" would replace a different unsaved edit of the same file. */
  | { readonly kind: 'confirm-replace' }
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
    drafts: { attribute: false },
    writer: { attribute: false },
    network: { attribute: false },
    translator: { attribute: false },
  };
  declare saves: SavesSession;
  /** Unsaved edits: "Review changes" never replaces one without asking. */
  declare drafts: DraftStore;
  declare writer: WriterSession;
  /** The network in view, to name a chain the wallet must switch back to. */
  declare network: NetworkState;
  declare translator: Translator;

  /** The save whose action is running (its buttons show progress). */
  #busy = state<string | undefined>(undefined);
  /** While a continued save asks the wallet: "Approve part k of N". */
  #approving = state<{ readonly part: number; readonly total: number } | undefined>(undefined);
  /** What the wallet or its node answered while this save still checks the ledger. */
  #answered = state<ReturnType<typeof answerCopy> | undefined>(undefined);
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

  /**
   * Runs a writer call for `p`, after checking the wallet can act for the save's account.
   * Returns the new progress, or undefined when nothing could be confirmed.
   * One call at a time: it claims the banner (`#busy`) before it awaits anything, so a second
   * press before the page re-renders (a double click, Enter then a click) finds it busy and does
   * nothing. Two resumes of one save would each try to send its open part.
   */
  async #act(
    p: SequenceProgress,
    call: (writer: EfsWriter, id: Hex) => Promise<SequenceProgress>,
  ): Promise<SequenceProgress | undefined> {
    if (this.#busy.get() !== undefined) return undefined;
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
      this.#answered.set(undefined);
    }
  }

  #resume(p: SequenceProgress): void {
    void this.#act(p, (writer, id) => {
      markEach('efs:send');
      return writer.resume(id, {
        onProgress: (now, event) => {
          if (event.kind === 'wallet-answer') {
            this.#answered.set(answerCopy(event.reason));
            return;
          }
          const first = event.kind === 'wallet-request' ? event.parts[0] : undefined;
          if (first !== undefined) {
            this.#answered.set(undefined);
            this.#approving.set({ part: first + 1, total: now.total });
          }
        },
      });
    });
  }

  /**
   * "Review changes": stop the old save, then bring the person's edit back on the current file.
   * If they have since started a different unsaved edit of that file, ask first (`replace`):
   * bringing this one back replaces it.
   */
  async #reopen(p: SequenceProgress, replace = false): Promise<void> {
    const draft = this.saves.draftOf(p.sequenceId);
    if (!draft) {
      this.#notice(p.sequenceId, { kind: 'message', id: 'saves.draftNotKept' });
      return;
    }
    const unsaved = this.drafts.get(draft.key ?? draft.route);
    if (!replace && unsaved && unsaved.text !== draft.text) {
      this.#notice(p.sequenceId, { kind: 'confirm-replace' });
      return;
    }
    const stopped = await this.#act(p, (writer, id) => writer.abandon(id));
    if (stopped?.state !== 'ABANDONED') return;
    this.drafts.drop(draft.key ?? draft.route);
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
      .disabled=${live(this.#busy.get() !== undefined)}
      @click=${(e: Event) => {
        if (action === 'reopen') void this.#reopen(p);
        else this.#resume(p);
        // Busy with this save means the press started it (#act claims before it awaits).
        if (this.#busy.get() === p.sequenceId) pressedOnce(e);
      }}
      >${t(label)}</wa-button
    >`;
  }

  #row(p: SequenceProgress, t: Translator['t']) {
    const outcome = saveOutcome(p);
    // Held back by an earlier save of the same publication: the same save again waits; another
    // save of the same bytes may go on once that one is final.
    const listed = this.saves.state.get();
    const standing =
      outcome.kind === 'held'
        ? twinStanding(
            outcome.twin,
            listed.status === 'READY' ? listed.saves : undefined,
            touchesOf(p.effect),
          )
        : undefined;
    const action: SaveAction | undefined =
      standing === 'settled'
        ? p.state === 'PARTIAL'
          ? 'continue'
          : 'send-again'
        : saveAction(outcome);
    const notice = this.#notices.get().get(p.sequenceId);
    const done = outcome.kind === 'saved';
    // The network is deciding: nothing to press, and stopping would be refused (a part is in flight).
    const settling =
      outcome.kind === 'confirming' ||
      outcome.kind === 'checking' ||
      outcome.kind === 'wallet-lost' ||
      outcome.kind === 'undone-checking' ||
      outcome.kind === 'funds-late';
    // A reorg, a lost wallet connection or a funds refusal too late to resend is worth a warning
    // while it settles, with the warning's icon.
    const calm =
      outcome.kind !== 'undone-checking' &&
      outcome.kind !== 'wallet-lost' &&
      outcome.kind !== 'funds-late';
    const variant = done || (settling && calm) ? 'success' : 'warning';
    const local = 'network' in this.network && onLocalChain(this.network.network);
    const message = standing ? t(heldMessage(standing, local)) : describeSave(p, this.network, t);
    const approving = this.#busy.get() === p.sequenceId ? this.#approving.get() : undefined;
    const answered = this.#busy.get() === p.sequenceId ? this.#answered.get() : undefined;
    // Nothing is in flight in these states, so stopping is allowed (the SDK refuses otherwise).
    // A funds refusal is in flight too (Send again resends it): the SDK refuses to stop it.
    const canStop = !done && !settling && outcome.kind !== 'abandoned' && outcome.kind !== 'funds';
    return html`<wa-callout
      variant=${variant}
      size="small"
      class="efs-save"
      data-outcome=${outcome.kind}
      data-sequence=${p.sequenceId}
    >
      <span slot="icon"
        >${appIcon(variant === 'success' ? 'circle-check' : 'triangle-exclamation')}</span
      >
      <div class="wa-split wa-gap-s efs-save-row">
        <p class="efs-save-message">${message}</p>
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
        outcome.kind === 'funds-late' && local
          ? html`<p class="efs-save-wait">${t('save.fundsWaitLocal')}</p>`
          : nothing
      }
      ${
        answered
          ? html`<p role="status">${t(answered.id, answered.values)}</p>`
          : approving
            ? html`<p role="status">${t('saves.approvePart', approving)}</p>`
            : nothing
      }
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
          : notice?.kind === 'confirm-replace'
            ? html`<div class="wa-stack wa-gap-xs efs-save-confirm">
                <p>${t('saves.replaceConfirm')}</p>
                <div class="wa-cluster wa-gap-xs">
                  <wa-button
                    size="s"
                    variant="danger"
                    class="efs-save-replace"
                    ?loading=${this.#busy.get() === p.sequenceId}
                    @click=${() => void this.#reopen(p, true)}
                    >${t('saves.replaceYes')}</wa-button
                  >
                  <wa-button
                    size="s"
                    appearance="outlined"
                    class="efs-save-keep-unsaved"
                    @click=${() => this.#notice(p.sequenceId, undefined)}
                    >${t('saves.replaceNo')}</wa-button
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
