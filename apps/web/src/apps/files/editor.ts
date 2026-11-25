// Editing a text file opened by object link: edit → review → one approval (per part) → saved.
//
// Typing needs no wallet; preparing a save needs the connected writer (planning reads the chain
// but never prompts). The review dialog shows what the SDK planned, in the PM's words: who sees
// the edit, how many approvals, and (when `visibleInLens` is false) that this view will keep
// showing another author's version. Once the wallet has answered, the save is handed to the
// shell (`saving.track`), which carries it to "Saved" in the page banner, across reloads.
//
// The plan is made in the view's Lens (the link's, else the default), so the base check and
// `visibleInLens` are about exactly what the person is looking at.
//
// Never a second write by accident:
// - A send that throws may have broadcast first. It reads "We couldn't confirm this save yet",
//   the banner re-reads the journal, and no fresh send is offered while the account has a save
//   that isn't settled (the banner continues that one instead).
// - A save refused because the person's own version moved (E_CAS) is never re-planned into a
//   send silently: they see that the file changed, and choose.

import type { Efs, Hex, Lens } from '@efs/sdk';
import type { EfsWriter, SequenceOpts, SequenceProgress } from '@efs/sdk/actions';
import type { EditPlanResult, OpenedFile, RevisionRef } from '@efs/sdk/files';
import type { AppHost } from '../../shell/apps.ts';
import {
  isFault,
  type SaveOutcome,
  saveMessage,
  saveOutcome,
  saveValues,
  thrownOutcome,
} from '../../shell/save-outcome.ts';
import { unsettled } from '../../shell/saves-state.ts';
import { shortAccount } from '../../shell/wallet-state.ts';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId, Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';

type Planned = Extract<EditPlanResult, { status: 'PLANNED' }>;

/** A send that came back NOT_STARTED: what the SDK said, and the sequence to continue. */
interface NotSent {
  readonly outcome: SaveOutcome;
  readonly sequenceId?: Hex;
}

type Phase =
  | { readonly phase: 'editing' }
  | { readonly phase: 'planning' }
  /** The plan, in the review dialog. `sent`: an earlier Send that wasn't sent (refused, busy…). */
  | {
      readonly phase: 'review';
      readonly plan: Planned;
      readonly writer: EfsWriter;
      readonly sent?: NotSent;
    }
  | {
      readonly phase: 'sending';
      readonly plan: Planned;
      readonly approving?: { readonly part: number; readonly total: number };
    }
  /** The send threw: it may or may not have gone out. The banner settles it. */
  | { readonly phase: 'unconfirmed'; readonly noJournal: boolean }
  | { readonly phase: 'base-changed'; readonly head: RevisionRef | null }
  /** The person's own version moved (another tab or device) while they edited another's. */
  | { readonly phase: 'own-changed'; readonly plan: Planned; readonly writer: EfsWriter }
  | { readonly phase: 'plan-failed'; readonly message: MessageId };

/** Sent when the editor closes: cancelled, or handed a save to the shell. */
export interface EditDoneDetail {
  readonly progress?: SequenceProgress;
  /** From the review: whether the view's Lens will show this edit. */
  readonly visibleInLens?: boolean;
  /** The person chose to drop their edit and see the newer version. */
  readonly showLatest?: boolean;
}
export const EDIT_DONE_EVENT = 'efs-edit-done';

/** "0x0000…2266": enough to tell authors apart, in full in the title. */
export const shortId = (id: string): string =>
  id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;

const loadEdit = async () => (await import('@efs/sdk/files')).planEditFile;

/** Why a new send waits: a re-read after a throw, a save to finish or stop, or one in flight. */
type Hold =
  /** Re-reading after a send that threw. */
  | { readonly kind: 'confirming' }
  /** The re-read failed or timed out: never released on that; "Check again". */
  | { readonly kind: 'check-failed' }
  /** This browser won't keep the save journal: saving is off here. */
  | { readonly kind: 'no-journal' }
  /** A send for this file may have gone out and no check has found it yet. */
  | { readonly kind: 'paused' }
  /** A save to finish or stop (PARTIAL, NOT_STARTED). */
  | { readonly kind: 'unsettled' }
  /** One in flight; `minutes` until its deadline when known (else "Check again"). */
  | { readonly kind: 'waiting'; readonly minutes?: number };

/** Seconds past a plan's deadline before the local clock treats it as lapsed (clock skew). */
const LAPSE_MARGIN_S = 60;

export class EfsFileEditor extends EfsElement {
  static override properties = {
    host: { attribute: false },
    efs: { attribute: false },
    file: { attribute: false },
    link: { attribute: false },
    original: { attribute: false },
    draft: { attribute: false },
    lens: { attribute: false },
  };
  declare host: AppHost;
  declare efs: Efs;
  /** The revision on screen when the person pressed Edit (the base of the edit). */
  declare file: OpenedFile;
  /** The file's canonical link (to come back to it from the banner). */
  declare link: string;
  declare original: string;
  /** The person's own text, brought back by "Review changes"; undefined starts from `original`. */
  declare draft: string | undefined;
  /** The view's Lens; undefined is the SDK's default. */
  declare lens: Lens | undefined;

  #text = state('');
  #phase = state<Phase>({ phase: 'editing' });
  /** A re-read this editor needs: running, failed (or timed out), or the journal is off here. */
  #holding = state<'no' | 'checking' | 'failed' | 'no-journal'>('no');
  /** The clock a waiting hold is measured against (ticks while the editor is open). */
  #now = state(Date.now());
  #tick: ReturnType<typeof setInterval> | undefined;
  #base: RevisionRef | undefined;
  #controller = new AbortController();

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#text.set(this.draft ?? this.original);
    this.#base = { kind: 'revision', recordId: this.file.revision };
    this.#controller = new AbortController();
    this.#tick = setInterval(() => this.#now.set(Date.now()), 15_000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#controller.abort();
    if (this.#tick !== undefined) clearInterval(this.#tick);
  }

  override firstUpdated(): void {
    this.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  }

  #done(detail: EditDoneDetail): void {
    this.dispatchEvent(new CustomEvent(EDIT_DONE_EVENT, { bubbles: true, composed: true, detail }));
  }

  /**
   * Why a new send must wait, if it must: the connected account has a save for this file that
   * isn't settled (for older records, which don't say their file: any file). `except` is the
   * save this review continues. `lapsed`: an earlier save's deadline has passed without it
   * landing, so it no longer holds anything back (said, as a warning).
   */
  #hold(except?: Hex): { readonly hold?: Hold; readonly lapsed: boolean } {
    const holding = this.#holding.get();
    if (holding === 'checking') return { hold: { kind: 'confirming' }, lapsed: false };
    if (holding === 'failed') return { hold: { kind: 'check-failed' }, lapsed: false };
    if (holding === 'no-journal') return { hold: { kind: 'no-journal' }, lapsed: false };
    const mine = this.file.file.toLowerCase();
    if (this.host.saving.unconfirmed.get().some((u) => u.file.toLowerCase() === mine)) {
      return { hold: { kind: 'paused' }, lapsed: false };
    }
    const a = this.host.saving.availability.get();
    if (a.status !== 'READY') return { lapsed: false };
    const now = this.#now.get();
    let waiting: number | undefined;
    let waitingUnknown = false;
    let lapsed = false;
    for (const p of this.host.saving.saves.get()) {
      if (p.sequenceId === except || !unsettled(p)) continue;
      if (p.account.toLowerCase() !== a.account.toLowerCase()) continue;
      // Per file when the save says which (SDK 0.1 records); older records hold every file.
      const file = p.effect?.kind === 'files.edit' ? p.effect.file : undefined;
      if (file && file.toLowerCase() !== mine) continue;
      if (p.state !== 'IN_FLIGHT') return { hold: { kind: 'unsettled' }, lapsed: false };
      // In flight: it can still land until its deadline. Past it at the latest block (the SDK's
      // pastDeadline; until then the local clock plus a margin for skew) it can't, short of a
      // reorg: a send from here would then only be refused as changed. Not "proven not saved".
      const past = (p.current as { pastDeadline?: boolean } | undefined)?.pastDeadline;
      const deadline = this.host.saving.deadlineOf(p);
      if (past === true) lapsed = true;
      else if (deadline === undefined) waitingUnknown = true;
      else if (past === undefined && now > (deadline + LAPSE_MARGIN_S) * 1000) lapsed = true;
      else if (now > (deadline + LAPSE_MARGIN_S) * 1000) lapsed = true;
      else waiting = Math.max(waiting ?? 0, Math.ceil((deadline * 1000 - now) / 60_000));
    }
    if (waitingUnknown) return { hold: { kind: 'waiting' }, lapsed: false };
    if (waiting !== undefined) {
      return { hold: { kind: 'waiting', minutes: Math.max(1, waiting) }, lapsed: false };
    }
    return { lapsed };
  }

  #progressOpts(plan: Planned): SequenceOpts {
    return {
      onProgress: (now, event) => {
        const first = event.kind === 'wallet-request' ? event.parts[0] : undefined;
        if (first !== undefined && now.total > 1) {
          this.#phase.set({
            phase: 'sending',
            plan,
            approving: { part: first + 1, total: now.total },
          });
        }
      },
    };
  }

  /**
   * Plans the edit from `base`. After a lost race (`afterRace`), a plan that still goes through
   * (the person edits another author's version and only their own HEAD moved) is shown as
   * "your own version changed" first, never sent silently over that other save.
   */
  async #plan(base: RevisionRef, afterRace = false): Promise<void> {
    if (this.host.saving.availability.get().status !== 'READY') {
      this.#phase.set({ phase: 'editing' });
      return;
    }
    this.#phase.set({ phase: 'planning' });
    // Another tab may have a save open for this account: read the journal before planning.
    if (!(await this.#relist()) || this.#hold().hold) {
      this.#phase.set({ phase: 'editing' });
      return;
    }
    this.#base = base;
    const signal = this.#controller.signal;
    try {
      const writer = await this.host.saving.writer();
      if (signal.aborted) return;
      if (!writer) {
        this.#phase.set({ phase: 'editing' });
        return;
      }
      const planEditFile = await loadEdit();
      const result = await planEditFile(
        this.efs,
        writer,
        {
          file: { kind: 'file', subject: this.file.file },
          base,
          content: new TextEncoder().encode(this.#text.get()),
          ...(this.lens ? { lens: this.lens } : {}),
        },
        { signal },
      );
      if (signal.aborted) return;
      switch (result.status) {
        case 'PLANNED':
          this.#phase.set(
            afterRace
              ? { phase: 'own-changed', plan: result, writer }
              : { phase: 'review', plan: result, writer },
          );
          return;
        case 'BASE_CHANGED':
          this.#phase.set({ phase: 'base-changed', head: result.head });
          return;
        case 'TOO_LARGE':
          this.#phase.set({ phase: 'plan-failed', message: 'files.edit.tooLarge' });
          return;
        default:
          this.#phase.set({ phase: 'plan-failed', message: 'files.edit.unknown' });
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      this.#phase.set({ phase: 'plan-failed', message: 'files.edit.failed' });
    }
  }

  /**
   * Drops a save that was never sent, and tells the banner at once (so it doesn't hold back the
   * next plan). Logged if the journal won't let go of it; the banner then still offers Stop.
   */
  async #drop(writer: EfsWriter, sequenceId: Hex): Promise<void> {
    try {
      this.host.saving.track(await writer.abandon(sequenceId));
    } catch (error) {
      console.warn('could not drop an unsent save', sequenceId, error);
      void this.host.saving.refresh();
    }
  }

  /**
   * The routine read before a new send: the journal only (no chain reads), so a save opened in
   * another tab counts. False when it couldn't be read: the hold then says so, and stays.
   */
  async #relist(): Promise<boolean> {
    const result = await this.host.saving.refresh({ settle: false });
    if (result === 'read') return true;
    this.#holding.set(result === 'no-journal' ? 'no-journal' : 'failed');
    return false;
  }

  /** "Check again", and the re-read after a send that threw: journal and chain. */
  async #recheck(): Promise<void> {
    this.#holding.set('checking');
    const result = await this.host.saving.refresh();
    this.#holding.set(result === 'read' ? 'no' : result === 'no-journal' ? 'no-journal' : 'failed');
  }

  /** Sends the reviewed plan; a save that wasn't sent before is continued, not started again. */
  async #send(plan: Planned, writer: EfsWriter, again?: Hex): Promise<void> {
    this.#phase.set({ phase: 'sending', plan });
    // Checked again at Send, from the journal: a save may have opened (here or in another tab)
    // since the plan was made.
    if (!(await this.#relist()) || this.#hold(again).hold) {
      this.#phase.set({ phase: 'editing' });
      return;
    }
    let progress: SequenceProgress;
    try {
      const opts = this.#progressOpts(plan);
      progress = again
        ? await writer.resume(again, opts)
        : await writer.runSequence(plan.parts, opts);
    } catch (error) {
      console.error(error);
      const thrown = thrownOutcome(error);
      if (thrown.kind === 'again') {
        // The SDK proves this call sent nothing: the same save is offered again (continued when
        // its record exists).
        const sent: NotSent = thrown.sequenceId
          ? { outcome: thrown.outcome, sequenceId: thrown.sequenceId }
          : { outcome: thrown.outcome };
        this.#phase.set({ phase: 'review', plan, writer, sent });
        return;
      }
      // It may have been sent: never "nothing was saved". Saving this file pauses until a
      // successful check finds the save (then the banner's list decides); a failed or timed-out
      // check never releases it.
      this.host.saving.markUnconfirmed(
        thrown.sequenceId
          ? { file: this.file.file, sequenceId: thrown.sequenceId }
          : { file: this.file.file },
      );
      void this.#recheck();
      this.#phase.set({ phase: 'unconfirmed', noJournal: thrown.noJournal });
      return;
    }
    const outcome = saveOutcome(progress);
    if (progress.state === 'NOT_STARTED') {
      if (outcome.kind === 'changed') {
        // The person's own version moved (E_CAS). Nothing was sent; drop this plan and check the
        // file again: either it shows what changed, or it says their own version changed.
        await this.#drop(writer, progress.sequenceId);
        await this.#plan(this.#base ?? { kind: 'revision', recordId: plan.review.base }, true);
        return;
      }
      this.#phase.set({
        phase: 'review',
        plan,
        writer,
        sent: { outcome, sequenceId: progress.sequenceId },
      });
      return;
    }
    // The wallet answered: from here the banner owns this save (Saved · confirming → Saved,
    // Partially saved → Continue, a race → changed), with the edit kept for "Review changes".
    this.host.saving.track(progress, {
      route: location.hash,
      link: this.link,
      text: this.#text.get(),
    });
    this.#done({ progress, visibleInLens: plan.review.visibleInLens });
  }

  /** Cancel in the review: a save that was started but never sent is dropped quietly. */
  #cancelReview(): void {
    const s = this.#phase.get();
    if (s.phase === 'sending') return;
    if (s.phase === 'review' && s.sent?.sequenceId) void this.#drop(s.writer, s.sent.sequenceId);
    this.#phase.set({ phase: 'editing' });
  }

  /** "Prepare again" after a refusal this plan can't get past (stale): a fresh, visible plan. */
  async #prepareAgain(s: Extract<Phase, { phase: 'review' }>): Promise<void> {
    if (s.sent?.sequenceId) await this.#drop(s.writer, s.sent.sequenceId);
    await this.#plan(this.#base ?? { kind: 'revision', recordId: s.plan.review.base });
  }

  /** The connected account when the SDK says it is the author (it always is for a plan). */
  #authorLabel(author: string): string {
    const a = this.host.saving.availability.get();
    return a.status === 'READY' &&
      this.efs.lens.principalOf(a.account as never).toLowerCase() === author.toLowerCase()
      ? shortAccount(a.account)
      : shortId(author);
  }

  #chainName(id: number, t: Translator['t']): string {
    const n = this.host.network.get();
    return 'network' in n && n.network.definition.chainId === id
      ? n.network.definition.label
      : t('saves.chainId', { id: String(id) });
  }

  #walletNotice(t: Translator['t']) {
    const a = this.host.saving.availability.get();
    if (a.status === 'READY' || a.status === 'NO_SESSION') return nothing;
    const network = this.host.network.get();
    const label = 'network' in network ? network.network.definition.label : '';
    return html`<wa-callout variant="neutral" size="small" class="efs-edit-wallet">
      <span slot="icon">${appIcon('wallet')}</span>
      <div class="wa-split wa-gap-s">
        <p>
          ${a.status === 'WRONG_CHAIN' ? t('files.edit.wrongNetwork', { network: label }) : t('files.edit.needsWallet')}
        </p>
        <wa-button size="s" variant="brand" class="efs-edit-connect" @click=${() => this.host.saving.requestWallet()}
          >${t(a.status === 'WRONG_CHAIN' ? 'files.edit.openWallet' : 'files.edit.connect')}</wa-button
        >
      </div>
    </wa-callout>`;
  }

  #unconfirmedDialog(s: Extract<Phase, { phase: 'unconfirmed' }>, t: Translator['t']) {
    return html`<wa-dialog
      class="efs-edit-review"
      label=${t('review.title')}
      open
      @wa-hide=${(event: Event) => {
        if (event.target === event.currentTarget) this.#phase.set({ phase: 'editing' });
      }}
    >
      <wa-callout variant="warning" size="small" class="efs-review-unconfirmed">
        <span slot="icon">${appIcon('triangle-exclamation')}</span>
        <div class="wa-stack wa-gap-2xs">
          <p role="alert">${t('save.unconfirmed')}</p>
          ${s.noJournal ? html`<p>${t('save.noJournal')}</p>` : nothing}
        </div>
      </wa-callout>
      <wa-button slot="footer" variant="brand" @click=${() => this.#phase.set({ phase: 'editing' })}
        >${t('review.close')}</wa-button
      >
    </wa-dialog>`;
  }

  #review(s: Extract<Phase, { phase: 'review' | 'sending' }>, t: Translator['t']) {
    const r = s.plan.review;
    const sending = s.phase === 'sending';
    const sent = s.phase === 'review' ? s.sent : undefined;
    const author = this.file.author ?? '—';
    const values = sent
      ? saveValues(sent.outcome, shortAccount, (id) => this.#chainName(id, t))
      : {};
    // Sent again (continued) only when the SDK says this same save can go as planned.
    const canSendAgain =
      !sent ||
      sent.outcome.kind === 'refused' ||
      sent.outcome.kind === 'busy' ||
      sent.outcome.kind === 'wallet-mismatch' ||
      sent.outcome.kind === 'nothing-new' ||
      (sent.outcome.kind === 'not-sent' && sent.outcome.canRetry);
    const prepareAgain = sent?.outcome.kind === 'stale';
    return html`<wa-dialog
      class="efs-edit-review"
      label=${t('review.title')}
      open
      @wa-hide=${(event: Event) => {
        // Only the dialog's own close: a hide bubbling from a nested element isn't a cancel.
        if (event.target !== event.currentTarget) return;
        if (sending) event.preventDefault();
        else this.#cancelReview();
      }}
    >
      <div class="wa-stack wa-gap-s">
        ${
          r.visibleInLens
            ? nothing
            : html`<wa-callout variant="warning" class="efs-review-not-visible">
                <span slot="icon">${appIcon('triangle-exclamation')}</span>
                <p>
                  ${t('review.notVisible', { author: shortId(author) })}
                </p>
              </wa-callout>`
        }
        <p>${t('review.appears')}</p>
        <p class="efs-review-prompts">
          ${
            r.prompts.sequential === 1
              ? t('review.promptsOne')
              : t('review.promptsMany', { count: r.prompts.sequential })
          }
        </p>
        <dl class="efs-facts">
          <dt>${t('review.size')}</dt>
          <dd>${t('files.preview.sizeValue', { size: Number(r.size) })}</dd>
          <dt>${t('review.sha256')}</dt>
          <dd><code translate="no" dir="ltr" class="efs-hash">${r.sha256}</code></dd>
          <dt>${t('review.layout')}</dt>
          <dd><code translate="no">${r.layout}</code></dd>
          <dt>${t('review.author')}</dt>
          <dd><code translate="no" dir="ltr" class="efs-hash" title=${r.author}>${this.#authorLabel(r.author)}</code></dd>
          <dt>${t('review.parts')}</dt>
          <dd>${r.parts}</dd>
          <dt>${t('review.revision')}</dt>
          <dd><code translate="no" dir="ltr" class="efs-hash">${r.revision}</code></dd>
          <dt>${t('review.protection')}</dt>
          <dd>${t(r.guard === 'own-head' ? 'review.guardOwn' : 'review.guardLens')}</dd>
        </dl>
        ${
          s.phase === 'sending'
            ? html`<p class="wa-cluster wa-gap-xs" role="status"><wa-spinner></wa-spinner>${
                s.approving ? t('saves.approvePart', s.approving) : t('review.sending')
              }</p>`
            : nothing
        }
        ${
          sent
            ? html`<wa-callout variant="warning" size="small" class="efs-review-not-sent"
                ><span slot="icon">${appIcon('circle-exclamation')}</span>
                <p role="alert">${t(saveMessage(sent.outcome), values)}</p></wa-callout
              >`
            : nothing
        }
      </div>
      <wa-button slot="footer" appearance="outlined" ?disabled=${sending} @click=${() => this.#cancelReview()}
        >${t('review.cancel')}</wa-button
      >
      ${
        prepareAgain && s.phase === 'review'
          ? html`<wa-button slot="footer" variant="brand" @click=${() => void this.#prepareAgain(s)}
              >${t('review.prepareAgain')}</wa-button
            >`
          : html`<wa-button
              slot="footer"
              variant="brand"
              class="efs-review-send"
              ?loading=${sending}
              ?disabled=${sending || !canSendAgain || this.#hold(sent?.sequenceId).hold !== undefined}
              @click=${() => {
                if (s.phase === 'review') void this.#send(s.plan, s.writer, sent?.sequenceId);
              }}
              >${t(sent ? 'saves.sendAgain' : 'review.send')}</wa-button
            >`
      }
    </wa-dialog>`;
  }

  #holdNotice(hold: Hold, t: Translator['t']) {
    const message: MessageId =
      hold.kind === 'confirming'
        ? 'files.edit.unconfirmed'
        : hold.kind === 'check-failed'
          ? 'files.edit.checkFailed'
          : hold.kind === 'no-journal'
            ? 'save.noJournal'
            : hold.kind === 'paused'
              ? 'files.edit.paused'
              : hold.kind === 'unsettled'
                ? 'files.edit.blocked'
                : hold.minutes === undefined
                  ? 'files.edit.waiting'
                  : 'files.edit.waitingFor';
    // A way out wherever the hold waits on a read: never released without one succeeding.
    const canCheck =
      hold.kind === 'check-failed' ||
      hold.kind === 'paused' ||
      (hold.kind === 'waiting' && hold.minutes === undefined);
    return html`<wa-callout variant="neutral" size="small" class="efs-edit-blocked" data-hold=${hold.kind}>
      <span slot="icon">${appIcon('circle-info')}</span>
      <div class="wa-split wa-gap-s">
        <p>${hold.kind === 'waiting' && hold.minutes !== undefined ? t(message, { minutes: hold.minutes }) : t(message)}</p>
        ${
          canCheck
            ? html`<wa-button size="s" class="efs-edit-check-again" @click=${() => void this.#recheck()}
                >${t('files.edit.checkAgain')}</wa-button
              >`
            : nothing
        }
      </div>
    </wa-callout>`;
  }

  #notices(s: Phase, t: Translator['t']) {
    switch (s.phase) {
      case 'base-changed':
        return html`<wa-callout variant="warning" size="small" class="efs-edit-base-changed">
          <span slot="icon">${appIcon('triangle-exclamation')}</span>
          <div class="wa-stack wa-gap-xs">
            <p role="alert">${t(s.head ? 'files.edit.baseChanged' : 'files.edit.baseGone')}</p>
            <div class="wa-cluster wa-gap-xs">
              ${
                s.head
                  ? html`<wa-button size="s" variant="brand" class="efs-edit-save-over" @click=${() => {
                      if (s.head) void this.#plan(s.head);
                    }}>${t('files.edit.saveOver')}</wa-button>`
                  : nothing
              }
              <wa-button size="s" appearance="outlined" @click=${() => this.#done({ showLatest: true })}
                >${t('files.edit.showLatest')}</wa-button
              >
            </div>
          </div>
        </wa-callout>`;
      case 'own-changed':
        return html`<wa-callout variant="warning" size="small" class="efs-edit-own-changed">
          <span slot="icon">${appIcon('triangle-exclamation')}</span>
          <div class="wa-stack wa-gap-xs">
            <p role="alert">${t('files.edit.ownChanged')}</p>
            <div class="wa-cluster wa-gap-xs">
              <wa-button
                size="s"
                variant="brand"
                @click=${() => this.#phase.set({ phase: 'review', plan: s.plan, writer: s.writer })}
                >${t('files.edit.saveAnyway')}</wa-button
              >
              <wa-button size="s" appearance="outlined" @click=${() => this.#done({ showLatest: true })}
                >${t('files.edit.showLatest')}</wa-button
              >
            </div>
          </div>
        </wa-callout>`;
      case 'plan-failed':
        return html`<wa-callout variant="danger" size="small"
          ><span slot="icon">${appIcon('circle-exclamation')}</span>
          <p role="alert">${t(s.message)}</p></wa-callout
        >`;
      default:
        return nothing;
    }
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const s = this.#phase.get();
    const ready = this.host.saving.availability.get().status === 'READY';
    const { hold, lapsed } = this.#hold();
    const blocked = hold !== undefined;
    const changed = this.#text.get() !== this.original;
    const busy = s.phase === 'planning' || s.phase === 'sending';
    return html`<div class="wa-stack wa-gap-s efs-editor">
      ${
        this.draft !== undefined
          ? html`<p class="efs-quiet efs-edit-reopened">${t('files.edit.reopened')}</p>`
          : nothing
      }
      <label class="wa-stack wa-gap-2xs">
        <span>${t('files.edit.label')}</span>
        <textarea
          class="efs-edit-text"
          translate="no"
          spellcheck="false"
          rows="12"
          .value=${this.#text.get()}
          ?readonly=${busy}
          @input=${(event: Event) => this.#text.set((event.target as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
      ${this.#walletNotice(t)}
      ${
        hold
          ? this.#holdNotice(hold, t)
          : lapsed
            ? html`<wa-callout variant="warning" size="small" class="efs-edit-lapsed">
                <span slot="icon">${appIcon('triangle-exclamation')}</span>
                <p>${t('files.edit.lapsed')}</p>
              </wa-callout>`
            : nothing
      }
      ${this.#notices(s, t)}
      <div class="wa-cluster wa-gap-xs">
        <wa-button
          size="s"
          variant="brand"
          class="efs-edit-review-button"
          ?loading=${s.phase === 'planning'}
          ?disabled=${!ready || blocked || !changed || busy}
          @click=${() => void this.#plan(this.#base ?? { kind: 'revision', recordId: this.file.revision })}
          >${t('files.edit.review')}</wa-button
        >
        <wa-button size="s" appearance="outlined" ?disabled=${busy} @click=${() => this.#done({})}
          >${t('files.edit.cancel')}</wa-button
        >
        ${changed ? nothing : html`<span class="efs-quiet">${t('files.edit.unchanged')}</span>`}
      </div>
      ${
        s.phase === 'review' || s.phase === 'sending'
          ? this.#review(s, t)
          : s.phase === 'unconfirmed'
            ? this.#unconfirmedDialog(s, t)
            : nothing
      }
    </div>`;
  }
}
