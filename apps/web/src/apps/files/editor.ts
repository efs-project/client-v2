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

/** Optional facts the SDK adds to a thrown fault (sdk-v2: throws say whether a send was possible). */
interface ThrownSave {
  readonly sequenceId?: Hex;
  readonly mayHaveSent?: boolean;
}

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
  /** A send in this editor couldn't be confirmed: said until the banner has settled it. */
  #unconfirmed = state(false);
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
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#controller.abort();
  }

  override firstUpdated(): void {
    this.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  }

  #done(detail: EditDoneDetail): void {
    this.dispatchEvent(new CustomEvent(EDIT_DONE_EVENT, { bubbles: true, composed: true, detail }));
  }

  /** The connected account has a save the banner hasn't settled: no fresh send until it is. */
  #blocked(): boolean {
    const a = this.host.saving.availability.get();
    if (a.status !== 'READY') return false;
    return this.host.saving.saves
      .get()
      .some((p) => unsettled(p) && p.account.toLowerCase() === a.account.toLowerCase());
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
    if (this.host.saving.availability.get().status !== 'READY' || this.#blocked()) {
      this.#phase.set({ phase: 'editing' });
      return;
    }
    this.#base = base;
    this.#phase.set({ phase: 'planning' });
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
      this.host.saving.refresh();
    }
  }

  /** Sends the reviewed plan; a save that wasn't sent before is continued, not started again. */
  async #send(plan: Planned, writer: EfsWriter, again?: Hex): Promise<void> {
    this.#phase.set({ phase: 'sending', plan });
    let progress: SequenceProgress;
    try {
      const opts = this.#progressOpts(plan);
      progress = again
        ? await writer.resume(again, opts)
        : await writer.runSequence(plan.parts, opts);
    } catch (error) {
      console.error(error);
      const thrown = error as ThrownSave;
      if (thrown.mayHaveSent === false) {
        // The SDK proves nothing went out: the same save can be sent again (continued if known).
        const sent: NotSent = {
          outcome: isFault(error, 'JOURNAL_UNAVAILABLE')
            ? { kind: 'no-journal' }
            : { kind: 'not-sent', code: 'FAILED', canRetry: true },
          ...(thrown.sequenceId ? { sequenceId: thrown.sequenceId } : {}),
        };
        this.#phase.set({ phase: 'review', plan, writer, sent });
        return;
      }
      // It may have been sent: never "nothing was saved", never a fresh send from here.
      this.#unconfirmed.set(true);
      this.host.saving.refresh();
      this.#phase.set({ phase: 'unconfirmed', noJournal: isFault(error, 'JOURNAL_UNAVAILABLE') });
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
              ?disabled=${sending || !canSendAgain}
              @click=${() => {
                if (s.phase === 'review') void this.#send(s.plan, s.writer, sent?.sequenceId);
              }}
              >${t(sent ? 'saves.sendAgain' : 'review.send')}</wa-button
            >`
      }
    </wa-dialog>`;
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
    const blocked = this.#blocked();
    const changed = this.#text.get() !== this.original;
    const busy = s.phase === 'planning' || s.phase === 'sending';
    // Once the banner has settled the unconfirmed save (or found nothing open), the note goes.
    if (this.#unconfirmed.get() && !blocked && s.phase === 'editing') {
      queueMicrotask(() => this.#unconfirmed.set(false));
    }
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
        blocked
          ? html`<wa-callout variant="neutral" size="small" class="efs-edit-blocked">
              <span slot="icon">${appIcon('circle-info')}</span>
              <p>${t(this.#unconfirmed.get() ? 'files.edit.unconfirmed' : 'files.edit.blocked')}</p>
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
