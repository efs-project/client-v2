// One dialog for every folder operation (New folder, Rename, Remove, Restore): name it if it needs
// a name, plan it with the SDK, review, send, and hand the save to the banner. It keeps the edit
// path's rules (docs/design/writes.md):
// - no wallet before Review; Send only with the connected writer on the network in view;
// - the journal is re-read before Send, and a save holding the same (folder, name) waits;
// - only `mayHaveSent === false` proves nothing was sent (thrownOutcome); anything else pauses
//   these places until a check finds the save;
// - once the wallet has answered, the banner owns the save.

import type { Efs, Lens, NameCheck } from '@efs/sdk';
import type { EfsWriter, SequenceProgress } from '@efs/sdk/actions';
import type { EntryRef, FolderRef } from '@efs/sdk/files';
import type { AppHost } from '../../shell/apps.ts';
import { saveHold } from '../../shell/save-hold.ts';
import {
  type SaveOutcome,
  saveMessage,
  saveOutcome,
  thrownOutcome,
} from '../../shell/save-outcome.ts';
import { shortAccount } from '../../shell/wallet-state.ts';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { shortId } from './editor.ts';
import {
  type AnyFolderPlan,
  type FolderPlanners,
  type FolderRequest,
  folderHold,
  nameRuleMessage,
  placesOf,
  planRequest,
  refusalMessage,
  type ViewPath,
} from './folder-requests.ts';

export const FOLDER_SAVED_EVENT = 'efs-folder-saved';
/** The event's detail: the save the banner now owns, and what it was asked to do. */
export interface FolderSavedDetail {
  readonly sequenceId: string;
  readonly ask: FolderAsk | undefined;
}

/** checkName, loaded with the SDK when a name is first asked for (the app entry stays SDK-free). */
type CheckName = (input: string) => NameCheck;
const loadCheckName = async (): Promise<CheckName> => (await import('@efs/sdk')).checkName;

const loadPlanners = async (): Promise<FolderPlanners> => {
  const files = await import('@efs/sdk/files');
  return {
    planCreateFolder: files.planCreateFolder,
    planMoveEntries: files.planMoveEntries,
    planRemoveEntries: files.planRemoveEntries,
    planRestoreEntries: files.planRestoreEntries,
  };
};

/** What the dialog is asked to do. Create and Rename are named in the dialog first. */
export type FolderAsk =
  | { readonly kind: 'createFolder'; readonly folder: FolderRef; readonly folderName: string }
  | { readonly kind: 'rename'; readonly from: EntryRef }
  | {
      readonly kind: 'remove';
      readonly entry: EntryRef;
      readonly folderName: string;
      readonly isFolder: boolean;
      readonly hide: boolean;
    }
  | {
      readonly kind: 'restore';
      readonly entry: EntryRef;
      /** Required when the entry is a folder: the path to its folder from the view's start. */
      readonly via?: ViewPath;
    };

type Planned = Extract<AnyFolderPlan, { status: 'PLANNED' }>;
type NotSent = { readonly outcome: SaveOutcome; readonly sequenceId?: `0x${string}` };

type Phase =
  | { readonly phase: 'closed' }
  | { readonly phase: 'naming'; readonly value: string }
  | { readonly phase: 'planning'; readonly request: FolderRequest }
  | {
      readonly phase: 'refused';
      readonly request: FolderRequest;
      readonly refused: readonly {
        readonly code: string;
        readonly name: string;
        readonly author?: string;
      }[];
    }
  | { readonly phase: 'plan-failed'; readonly request: FolderRequest; readonly code: string }
  | {
      readonly phase: 'review' | 'sending';
      readonly request: FolderRequest;
      readonly plan: Planned;
      readonly writer: EfsWriter;
      readonly sent?: NotSent;
      /** Why the last Send stopped before sending (the journal couldn't be read). */
      readonly note?: MessageId;
    }
  | { readonly phase: 'unconfirmed' };

export class EfsFolderSave extends EfsElement {
  static override properties = {
    host: { attribute: false },
    efs: { attribute: false },
    lens: { attribute: false },
  };
  declare host: AppHost;
  declare efs: Efs | undefined;
  /** The Lens the person sees the folder through (the place Lens). */
  declare lens: Lens | undefined;

  #ask = state<FolderAsk | undefined>(undefined);
  /** The SDK's checkName, once loaded: until then a name can't be reviewed. */
  #checkName = state<CheckName | undefined>(undefined);
  #phase = state<Phase>({ phase: 'closed' });
  #controller: AbortController | undefined;

  /** Keep it was focused for this removal's review (once: the person may move focus on). */
  #keepFocused = false;

  protected override createRenderRoot() {
    return this;
  }

  /**
   * A removal's review opens on Keep it, so Enter or Escape keeps the entry. The review renders
   * after planning, past the dialog's own autofocus, so focus moves here once it's shown.
   */
  override updated(): void {
    const s = this.#phase.get();
    const review = s.phase === 'review' || s.phase === 'sending';
    if (!review) {
      this.#keepFocused = false;
      return;
    }
    if (this.#ask.get()?.kind !== 'remove' || this.#keepFocused) return;
    this.#keepFocused = true;
    void this.updateComplete.then(() => this.#focusKeep());
  }

  #focusKeep(): void {
    this.querySelector<HTMLElement>('wa-button.efs-folder-keep')?.focus();
  }

  /** Opens the dialog for `ask` (from a click). */
  open(ask: FolderAsk): void {
    this.#controller?.abort();
    this.#controller = new AbortController();
    this.#ask.set(ask);
    if ((ask.kind === 'createFolder' || ask.kind === 'rename') && !this.#checkName.get()) {
      loadCheckName()
        .then((check) => this.#checkName.set(check))
        .catch((error: unknown) => console.error(error));
    }
    if (ask.kind === 'createFolder') this.#phase.set({ phase: 'naming', value: '' });
    else if (ask.kind === 'rename') this.#phase.set({ phase: 'naming', value: ask.from.name });
    else void this.#plan(this.#request(ask, ''));
  }

  #close(): void {
    this.#controller?.abort();
    const s = this.#phase.get();
    if (s.phase === 'sending') return;
    if (s.phase === 'review' && s.sent?.sequenceId) void this.#drop(s.writer, s.sent.sequenceId);
    this.#phase.set({ phase: 'closed' });
  }

  #request(ask: FolderAsk, name: string): FolderRequest {
    switch (ask.kind) {
      case 'createFolder':
        return { kind: 'createFolder', folder: ask.folder, name };
      case 'rename':
        return { kind: 'rename', from: ask.from, to: name };
      case 'remove':
        return { kind: 'remove', entries: [ask.entry], hide: ask.hide };
      case 'restore':
        return {
          kind: 'restore',
          entries: [{ ...ask.entry, ...(ask.via ? { via: ask.via } : {}) }],
        };
    }
  }

  async #plan(request: FolderRequest): Promise<void> {
    const efs = this.efs;
    const lens = this.lens;
    const signal = this.#controller?.signal;
    if (!efs || !lens || !signal) return;
    this.#phase.set({ phase: 'planning', request });
    try {
      const writer = await this.host.saving.writer();
      if (signal.aborted) return;
      if (!writer) {
        // No wallet on this network (anymore): back to where the person can connect.
        this.#phase.set({ phase: 'plan-failed', request, code: 'NO_WALLET' });
        return;
      }
      const plan = await planRequest(await loadPlanners(), efs, writer, request, lens, signal);
      if (signal.aborted) return;
      if (plan.status === 'PLANNED') this.#phase.set({ phase: 'review', request, plan, writer });
      else if (plan.status === 'REFUSED')
        this.#phase.set({
          phase: 'refused',
          request,
          refused: plan.refused.map((r) => ({
            code: r.code,
            name: r.entry.name,
            ...(r.author ? { author: r.author } : {}),
          })),
        });
      else this.#phase.set({ phase: 'plan-failed', request, code: plan.reason.code });
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      // INTO_ITSELF can be reached through Restore (a folder put back inside itself): said in
      // words. Any other MISUSE is a client bug (names are checked before Review): reported as one.
      const code = (error as { details?: { code?: unknown } }).details?.code;
      this.#phase.set({
        phase: 'plan-failed',
        request,
        code: code === 'INTO_ITSELF' ? 'INTO_ITSELF' : 'CLIENT_ERROR',
      });
    }
  }

  /** Why this reviewed save can't be sent now, if it can't: checked on the signer, never the screen. */
  #hold(request: FolderRequest, writer: EfsWriter, except?: string) {
    return folderHold(
      {
        availability: this.host.saving.availability.get(),
        signer: writer.account,
        unconfirmed: this.host.saving.unconfirmed.get(),
        saves: this.host.saving.saves.get(),
        places: placesOf(request),
        except,
      },
      saveHold,
    );
  }

  async #send(s: Extract<Phase, { phase: 'review' | 'sending' }>): Promise<void> {
    const { request, plan, writer } = s;
    const again = s.sent?.sequenceId;
    this.#phase.set({ ...s, phase: 'sending' });
    const places = placesOf(request);
    // Back to the review, keeping what the last attempt said unless something new replaces it.
    const back = (next: { sent?: NotSent; note?: MessageId } = {}) => {
      const sent = next.sent ?? s.sent;
      this.#phase.set({
        phase: 'review',
        request,
        plan,
        writer,
        ...(sent ? { sent } : {}),
        ...(next.note ? { note: next.note } : {}),
      });
    };
    // Re-read the journal first: a save may have opened here or in another tab since planning.
    const read = await this.host.saving.refresh({ settle: false });
    if (read !== 'read') {
      back({ note: read === 'no-journal' ? 'save.noJournal' : 'files.save.checkFailed' });
      return;
    }
    // Checked again here, on the signer: the screen may show another account by now.
    if (this.#hold(request, writer, again).hold) {
      back();
      return;
    }
    let progress: SequenceProgress;
    try {
      progress = again ? await writer.resume(again) : await writer.runSequence(plan.parts);
    } catch (error) {
      console.error(error);
      const thrown = thrownOutcome(error);
      if (thrown.kind === 'again') {
        back({
          sent: thrown.sequenceId
            ? { outcome: thrown.outcome, sequenceId: thrown.sequenceId }
            : { outcome: thrown.outcome },
        });
        return;
      }
      // It may have been sent: these places pause until a check finds the save.
      this.host.saving.markUnconfirmed(
        thrown.sequenceId ? { places, sequenceId: thrown.sequenceId } : { places },
      );
      void this.host.saving.refresh();
      this.#phase.set({ phase: 'unconfirmed' });
      return;
    }
    if (progress.state === 'NOT_STARTED') {
      const outcome = saveOutcome(progress);
      if (outcome.kind === 'changed') {
        // Something at these names moved (E_CAS) and nothing was sent: drop this plan and plan
        // again, which shows what's there now (or a refusal).
        await this.#drop(writer, progress.sequenceId);
        await this.#plan(request);
        return;
      }
      back({ sent: { outcome, sequenceId: progress.sequenceId } });
      return;
    }
    // The wallet answered: the banner owns the save from here.
    this.host.saving.track(progress);
    this.dispatchEvent(
      new CustomEvent(FOLDER_SAVED_EVENT, {
        detail: { sequenceId: progress.sequenceId, ask: this.#ask.get() },
        bubbles: true,
        composed: true,
      }),
    );
    this.#phase.set({ phase: 'closed' });
  }

  /** "Prepare again": a fresh plan with the wallet as it is now (a stale plan, another account). */
  async #prepareAgain(s: Extract<Phase, { phase: 'review' | 'sending' }>): Promise<void> {
    if (s.sent?.sequenceId) await this.#drop(s.writer, s.sent.sequenceId);
    await this.#plan(s.request);
  }

  async #drop(writer: EfsWriter, sequenceId: `0x${string}`): Promise<void> {
    try {
      this.host.saving.track(await writer.abandon(sequenceId));
    } catch (error) {
      console.warn('could not drop an unsent save', sequenceId, error);
      void this.host.saving.refresh();
    }
  }

  /** Another author, as the review names them: "0x1234…cdef" (in full in the title). */
  #who(author: string): string {
    return shortId(author);
  }

  #naming(ask: FolderAsk, value: string) {
    const t = this.host.translator.t.bind(this.host.translator);
    const checkName = this.#checkName.get();
    const check: NameCheck | undefined = checkName ? checkName(value) : undefined;
    const ready = this.host.saving.availability.get().status === 'READY';
    const unchanged = ask.kind === 'rename' && value === ask.from.name;
    const error =
      value === '' || !check
        ? undefined
        : check.status === 'VALID'
          ? undefined
          : t(
              check.status === 'INVALID'
                ? nameRuleMessage(check.rule)
                : 'files.name.rule.character',
            );
    const review = () => {
      if (check?.status !== 'VALID' || unchanged || !ready) return;
      void this.#plan(this.#request(ask, check.text));
    };
    return html`<div class="wa-stack wa-gap-s">
        <wa-input
          class="efs-folder-name"
          label=${t('files.name.label')}
          .value=${value}
          autofocus
          @input=${(event: Event) =>
            this.#phase.set({ phase: 'naming', value: (event.target as HTMLInputElement).value })}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Enter') review();
          }}
        ></wa-input>
        ${error ? html`<p class="efs-folder-name-error" role="alert">${error}</p>` : nothing}
        ${
          check?.status === 'VALID' && !check.nfc
            ? html`<p class="efs-quiet">${t('files.name.notNfc')}</p>`
            : nothing
        }
        ${
          ready
            ? nothing
            : html`<wa-callout variant="neutral" size="small">
              <span slot="icon">${appIcon('wallet')}</span>
              <p>${t('files.save.connect')}</p>
            </wa-callout>`
        }
      </div>
      <wa-button slot="footer" appearance="outlined" @click=${() => this.#close()}
        >${t('review.cancel')}</wa-button
      >
      ${
        ready
          ? html`<wa-button
            slot="footer"
            variant="brand"
            class="efs-folder-review"
            ?disabled=${check?.status !== 'VALID' || unchanged}
            @click=${review}
            >${t('files.save.review')}</wa-button
          >`
          : html`<wa-button
            slot="footer"
            variant="brand"
            class="efs-folder-connect"
            @click=${() => this.host.saving.requestWallet()}
            >${t('files.save.connectButton')}</wa-button
          >`
      }`;
  }

  #reviewLines(ask: FolderAsk, plan: Planned) {
    const t = this.host.translator.t.bind(this.host.translator);
    const r = plan.review;
    const instead = (
      v: { shownInstead: { author: string } | null; hiddenBy?: string },
      name: string,
    ) =>
      v.shownInstead
        ? html`<wa-callout variant="warning" size="small" class="efs-folder-instead">
            <span slot="icon">${appIcon('triangle-exclamation')}</span>
            <p>${t('files.name.takenLens', { author: this.#who(v.shownInstead.author), name })}</p>
          </wa-callout>`
        : v.hiddenBy
          ? html`<p>${t('files.save.hiddenBy', { author: this.#who(v.hiddenBy), name })}</p>`
          : nothing;
    const after = (shown: { author: string } | null, name: string) =>
      html`<p class="efs-folder-after">
        ${
          shown
            ? t('files.shownAfter.author', { author: this.#who(shown.author), name })
            : t('files.shownAfter.none', { name })
        }
      </p>`;
    switch (r.kind) {
      case 'efs.createFolderReview':
        return html`<p>${t('files.save.createsFolder', { name: r.name, folder: ask.kind === 'createFolder' ? ask.folderName : '' })}</p>
          ${instead(r, r.name)}`;
      case 'efs.moveReview': {
        const m = r.moves[0];
        if (!m) return nothing;
        return html`<p>${t('files.rename.review', { from: m.from.name, to: m.to.name })}</p>
          ${instead(m, m.to.name)} ${after(m.shownAfter, m.from.name)}`;
      }
      case 'efs.removeReview': {
        const e = r.entries[0];
        if (!e || ask.kind !== 'remove') return nothing;
        return html`<ul class="efs-folder-clauses">
          <li>${t('files.remove.here', { name: e.entry.name })}</li>
          <li>${after(e.shownAfter, e.entry.name)}</li>
          <li>${t('files.remove.stays')}</li>
          ${ask.isFolder ? html`<li>${t('files.remove.folder')}</li>` : nothing}
          <li>${t('files.remove.public')}</li>
        </ul>`;
      }
      case 'efs.restoreReview': {
        const e = r.entries[0];
        if (!e) return nothing;
        // alsoPlaced: live placements of this target now, by anyone. Null when the index can't
        // vouch: then nothing is said (never "0").
        return html`<p>${t('files.restore.review', { name: e.entry.name })}</p>
          ${
            e.alsoPlaced !== null && e.alsoPlaced > 0
              ? html`<p class="efs-folder-also">
                  ${t('files.restore.alsoPlaced', { count: e.alsoPlaced })}
                </p>`
              : nothing
          }
          ${instead(e, e.entry.name)}`;
      }
    }
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const s = this.#phase.get();
    const ask = this.#ask.get();
    const open = s.phase !== 'closed' && ask !== undefined;
    const title: MessageId =
      ask?.kind === 'createFolder'
        ? 'files.new.folder'
        : ask?.kind === 'rename'
          ? 'files.rename.title'
          : ask?.kind === 'restore'
            ? 'files.restore'
            : 'files.remove.title';
    const label =
      ask?.kind === 'remove'
        ? t(title, { name: ask.entry.name, folder: ask.folderName })
        : t(title);
    let body: unknown = nothing;
    if (open && ask) {
      switch (s.phase) {
        case 'naming':
          body = this.#naming(ask, s.value);
          break;
        case 'planning':
          body = html`<p class="wa-cluster wa-gap-xs" role="status">
            <wa-spinner></wa-spinner>${t('files.save.planning')}
          </p>`;
          break;
        case 'refused':
          body = html`<div class="wa-stack wa-gap-xs efs-folder-refused" role="alert">
              ${s.refused.map(
                (r) =>
                  html`<p>
                    ${t(refusalMessage(r.code), {
                      code: r.code,
                      name: r.name,
                      author: r.author ? shortId(r.author) : '—',
                    })}
                  </p>`,
              )}
            </div>
            <wa-button slot="footer" variant="brand" @click=${() => this.#close()}
              >${t('files.save.close')}</wa-button
            >`;
          break;
        case 'plan-failed': {
          const noWallet = s.code === 'NO_WALLET';
          const intoItself = s.code === 'INTO_ITSELF';
          const message = noWallet
            ? t('files.save.connect')
            : intoItself
              ? t('files.move.intoSelf')
              : t('files.save.planFailed', { code: s.code });
          body = html`<wa-callout variant=${noWallet ? 'neutral' : 'danger'} size="small">
              <span slot="icon">${appIcon(noWallet ? 'wallet' : 'circle-exclamation')}</span>
              <p>${message}</p>
            </wa-callout>
            <wa-button slot="footer" appearance="outlined" @click=${() => this.#close()}
              >${t('review.cancel')}</wa-button
            >
            ${
              noWallet && this.host.saving.availability.get().status !== 'READY'
                ? html`<wa-button
                    slot="footer"
                    variant="brand"
                    @click=${() => this.host.saving.requestWallet()}
                    >${t('files.save.connectButton')}</wa-button
                  >`
                : intoItself
                  ? nothing
                  : html`<wa-button
                      slot="footer"
                      variant="brand"
                      @click=${() => void this.#plan(s.request)}
                      >${t(noWallet ? 'files.save.review' : 'outcome.retry')}</wa-button
                    >`
            }`;
          break;
        }
        case 'unconfirmed':
          body = html`<p role="status">${t('save.unconfirmed')}</p>
            <wa-button slot="footer" variant="brand" @click=${() => this.#close()}
              >${t('files.save.close')}</wa-button
            >`;
          break;
        case 'review':
        case 'sending': {
          const sending = s.phase === 'sending';
          const sent = s.sent;
          const { hold, lapsed } = this.#hold(s.request, s.writer, sent?.sequenceId);
          const prompts = s.plan.review.prompts.sequential;
          const isRemove = ask.kind === 'remove';
          // Sent again (continued) only when the SDK says this same save can go as planned.
          const canSendAgain =
            !sent ||
            sent.outcome.kind === 'refused' ||
            sent.outcome.kind === 'busy' ||
            sent.outcome.kind === 'wallet-mismatch' ||
            sent.outcome.kind === 'nothing-new' ||
            (sent.outcome.kind === 'not-sent' && sent.outcome.canRetry);
          const prepareAgain = sent?.outcome.kind === 'stale' || hold?.kind === 'account';
          const holdLine =
            hold?.kind === 'paused'
              ? t('files.save.paused')
              : hold?.kind === 'held'
                ? t('files.save.held')
                : hold?.kind === 'wallet'
                  ? t('files.save.connect')
                  : hold?.kind === 'account'
                    ? t('files.save.accountChanged', {
                        connected: shortAccount(hold.connected),
                        signer: shortAccount(hold.signer),
                      })
                    : undefined;
          body = html`<div class="wa-stack wa-gap-s">
              ${this.#reviewLines(ask, s.plan)}
              <p class="efs-review-prompts">
                ${prompts === 1 ? t('review.promptsOne') : t('review.promptsMany', { count: prompts })}
              </p>
              ${
                sending
                  ? html`<p class="wa-cluster wa-gap-xs" role="status">
                    <wa-spinner></wa-spinner>${t('review.sending')}
                  </p>`
                  : nothing
              }
              ${
                sent
                  ? html`<wa-callout variant="warning" size="small" class="efs-review-not-sent">
                    <span slot="icon">${appIcon('circle-exclamation')}</span>
                    <p role="alert">${t(
                      sent.outcome.kind === 'changed'
                        ? 'files.save.changed'
                        : saveMessage(sent.outcome),
                      sent.outcome.kind === 'wallet-mismatch' && sent.outcome.account
                        ? { account: shortAccount(sent.outcome.account), chain: '' }
                        : {},
                    )}</p>
                  </wa-callout>`
                  : nothing
              }
              ${s.note && !sending ? html`<p role="alert" class="efs-folder-note">${t(s.note)}</p>` : nothing}
              ${holdLine && !sending ? html`<p role="status" class="efs-folder-hold">${holdLine}</p>` : nothing}
              ${lapsed && !hold ? html`<p class="efs-quiet">${t('files.save.lapsed')}</p>` : nothing}
            </div>
            <wa-button
              slot="footer"
              appearance="outlined"
              class="efs-folder-keep"
              ?autofocus=${isRemove}
              ?disabled=${sending}
              @click=${() => this.#close()}
              >${t(isRemove ? 'files.remove.keep' : 'review.cancel')}</wa-button
            >
            ${
              hold?.kind === 'wallet' && !sending
                ? html`<wa-button
                    slot="footer"
                    variant="brand"
                    class="efs-folder-connect"
                    @click=${() => this.host.saving.requestWallet()}
                    >${t('files.save.connectButton')}</wa-button
                  >`
                : prepareAgain && s.phase === 'review'
                  ? html`<wa-button
                      slot="footer"
                      variant="brand"
                      class="efs-folder-prepare"
                      @click=${() => void this.#prepareAgain(s)}
                      >${t('review.prepareAgain')}</wa-button
                    >`
                  : html`<wa-button
                      slot="footer"
                      variant=${isRemove ? 'danger' : 'brand'}
                      class="efs-folder-send"
                      ?loading=${sending}
                      ?disabled=${sending || !canSendAgain || hold !== undefined}
                      @click=${() => {
                        if (s.phase === 'review') void this.#send(s);
                      }}
                      >${t(sent ? 'saves.sendAgain' : isRemove ? 'files.remove.yes' : 'review.send')}</wa-button
                    >`
            }`;
          break;
        }
      }
    }
    return html`<wa-dialog
      class="efs-folder-save"
      label=${label}
      ?open=${open}
      @wa-after-show=${(event: Event) => {
        // The dialog's own show focus runs last: a removal's review still opens on Keep it.
        if (event.target !== event.currentTarget) return;
        const phase = this.#phase.get().phase;
        if (this.#ask.get()?.kind === 'remove' && phase === 'review') this.#focusKeep();
      }}
      @wa-hide=${(event: Event) => {
        if (event.target !== event.currentTarget) return;
        if (this.#phase.get().phase === 'sending') event.preventDefault();
        else this.#close();
      }}
    >
      ${body}
    </wa-dialog>`;
  }
}
