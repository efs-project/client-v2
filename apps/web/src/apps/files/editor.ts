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

import type { Efs, Hex, Lens } from '@efs/sdk';
import type { EfsWriter, SequenceProgress } from '@efs/sdk/actions';
import type { EditPlanResult, OpenedFile, RevisionRef } from '@efs/sdk/files';
import type { AppHost } from '../../shell/apps.ts';
import { isFault, type SaveOutcome, saveMessage, saveOutcome } from '../../shell/save-outcome.ts';
import { shortAccount } from '../../shell/wallet-state.ts';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId, Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';

type Planned = Extract<EditPlanResult, { status: 'PLANNED' }>;

type Phase =
  | { readonly phase: 'editing' }
  | { readonly phase: 'planning' }
  /** The plan, in the review dialog. `sent`: an earlier Send that wasn't sent (refused, busy…). */
  | {
      readonly phase: 'review';
      readonly plan: Planned;
      readonly writer: EfsWriter;
      readonly sent?: { readonly sequenceId?: Hex; readonly outcome: SaveOutcome };
    }
  | { readonly phase: 'sending'; readonly plan: Planned }
  | { readonly phase: 'base-changed'; readonly head: RevisionRef | null }
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

export class EfsFileEditor extends EfsElement {
  static override properties = {
    host: { attribute: false },
    efs: { attribute: false },
    file: { attribute: false },
    original: { attribute: false },
    lens: { attribute: false },
  };
  declare host: AppHost;
  declare efs: Efs;
  /** The revision on screen when the person pressed Edit (the base of the edit). */
  declare file: OpenedFile;
  declare original: string;
  /** The view's Lens; undefined is the SDK's default. */
  declare lens: Lens | undefined;

  #draft = state('');
  #phase = state<Phase>({ phase: 'editing' });
  #base: RevisionRef | undefined;
  #controller = new AbortController();

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#draft.set(this.original);
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

  async #plan(base: RevisionRef): Promise<void> {
    if (this.host.saving.availability.get().status !== 'READY') return;
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
          content: new TextEncoder().encode(this.#draft.get()),
          ...(this.lens ? { lens: this.lens } : {}),
        },
        { signal },
      );
      if (signal.aborted) return;
      switch (result.status) {
        case 'PLANNED':
          this.#phase.set({ phase: 'review', plan: result, writer });
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

  /** Sends the reviewed plan; a save that wasn't sent before is continued, not started again. */
  async #send(plan: Planned, writer: EfsWriter, retry?: Hex): Promise<void> {
    this.#phase.set({ phase: 'sending', plan });
    let progress: SequenceProgress;
    try {
      progress = retry ? await writer.resume(retry) : await writer.runSequence(plan.parts);
    } catch (error) {
      if (!isFault(error, 'JOURNAL_UNAVAILABLE')) console.error(error);
      const outcome: SaveOutcome = isFault(error, 'JOURNAL_UNAVAILABLE')
        ? { kind: 'no-journal' }
        : { kind: 'not-sent', code: 'FAILED' };
      this.#phase.set({
        phase: 'review',
        plan,
        writer,
        sent: retry ? { sequenceId: retry, outcome } : { outcome },
      });
      return;
    }
    const outcome = saveOutcome(progress);
    if (progress.state === 'NOT_STARTED') {
      if (outcome.kind === 'changed' || outcome.kind === 'stale') {
        // Nothing was sent and this plan can't be sent: drop it and check the file again, which
        // shows what changed (BASE_CHANGED) and lets the person save over it.
        await writer.abandon(progress.sequenceId).catch(() => undefined);
        void this.#plan(this.#base ?? { kind: 'revision', recordId: plan.review.base });
        return;
      }
      this.#phase.set({
        phase: 'review',
        plan,
        writer,
        sent: { sequenceId: progress.sequenceId, outcome },
      });
      return;
    }
    // The wallet answered: from here the banner owns this save (Saved · confirming → Saved,
    // Partially saved → Continue, a race → changed).
    this.host.saving.track(progress);
    this.#done({ progress, visibleInLens: plan.review.visibleInLens });
  }

  /** Cancel in the review: a save that was started but never sent is dropped quietly. */
  #cancelReview(): void {
    const s = this.#phase.get();
    if (s.phase === 'sending') return;
    if (s.phase === 'review' && s.sent?.sequenceId) {
      void s.writer.abandon(s.sent.sequenceId).catch(() => undefined);
    }
    this.#phase.set({ phase: 'editing' });
  }

  /** The connected account when the SDK says it is the author (it always is for a plan). */
  #authorLabel(author: string): string {
    const a = this.host.saving.availability.get();
    return a.status === 'READY' &&
      this.efs.lens.principalOf(a.account as never).toLowerCase() === author.toLowerCase()
      ? shortAccount(a.account)
      : shortId(author);
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

  #review(s: Extract<Phase, { phase: 'review' | 'sending' }>, t: Translator['t']) {
    const r = s.plan.review;
    const sending = s.phase === 'sending';
    const sent = s.phase === 'review' ? s.sent : undefined;
    const author = this.file.author ?? '—';
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
        ${sending ? html`<p class="wa-cluster wa-gap-xs" role="status"><wa-spinner></wa-spinner>${t('review.sending')}</p>` : nothing}
        ${sent ? html`<wa-callout variant="warning" size="small"><span slot="icon">${appIcon('circle-exclamation')}</span><p role="alert">${t(saveMessage(sent.outcome))}</p></wa-callout>` : nothing}
      </div>
      <wa-button slot="footer" appearance="outlined" ?disabled=${sending} @click=${() => this.#cancelReview()}
        >${t('review.cancel')}</wa-button
      >
      <wa-button
        slot="footer"
        variant="brand"
        class="efs-review-send"
        ?loading=${sending}
        ?disabled=${sending || sent?.outcome.kind === 'no-journal'}
        @click=${() => {
          if (s.phase === 'review') void this.#send(s.plan, s.writer, sent?.sequenceId);
        }}
        >${t(sent ? 'saves.sendAgain' : 'review.send')}</wa-button
      >
    </wa-dialog>`;
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const s = this.#phase.get();
    const ready = this.host.saving.availability.get().status === 'READY';
    const changed = this.#draft.get() !== this.original;
    const busy = s.phase === 'planning' || s.phase === 'sending';
    return html`<div class="wa-stack wa-gap-s efs-editor">
      <label class="wa-stack wa-gap-2xs">
        <span>${t('files.edit.label')}</span>
        <textarea
          class="efs-edit-text"
          translate="no"
          spellcheck="false"
          rows="12"
          .value=${this.#draft.get()}
          ?readonly=${busy}
          @input=${(event: Event) => this.#draft.set((event.target as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
      ${this.#walletNotice(t)}
      ${
        s.phase === 'base-changed'
          ? html`<wa-callout variant="warning" size="small" class="efs-edit-base-changed">
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
            </wa-callout>`
          : s.phase === 'plan-failed'
            ? html`<wa-callout variant="danger" size="small"
                ><span slot="icon">${appIcon('circle-exclamation')}</span>
                <p role="alert">${t(s.message)}</p></wa-callout
              >`
            : nothing
      }
      <div class="wa-cluster wa-gap-xs">
        <wa-button
          size="s"
          variant="brand"
          class="efs-edit-review-button"
          ?loading=${s.phase === 'planning'}
          ?disabled=${!ready || !changed || busy}
          @click=${() => void this.#plan(this.#base ?? { kind: 'revision', recordId: this.file.revision })}
          >${t('files.edit.review')}</wa-button
        >
        <wa-button size="s" appearance="outlined" ?disabled=${busy} @click=${() => this.#done({})}
          >${t('files.edit.cancel')}</wa-button
        >
        ${changed ? nothing : html`<span class="efs-quiet">${t('files.edit.unchanged')}</span>`}
      </div>
      ${s.phase === 'review' || s.phase === 'sending' ? this.#review(s, t) : nothing}
    </div>`;
  }
}
