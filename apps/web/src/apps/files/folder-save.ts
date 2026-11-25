// One dialog for every folder operation (New folder, Rename, Move, Remove, Restore): name it or
// pick where it goes if it needs that, plan it with the SDK, review, send, and hand the save to the
// banner. It keeps the edit
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
import { approvalsLine } from './approvals.ts';
import { shortId } from './editor.ts';
import type { PickerSelection } from './folder-picker.ts';
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
  withoutIndices,
} from './folder-requests.ts';
import type { NavStep } from './navigation.ts';

export const FOLDER_SAVED_EVENT = 'efs-folder-saved';
/** The dialog closed and the control that opened it is gone: its pane should take focus. */
export const FOCUS_LOST_EVENT = 'efs-folder-focus-lost';
/** "New text file", named: the editor takes it from here (the listing starts the composer). */
export const COMPOSE_EVENT = 'efs-compose';
export interface ComposeDetail {
  readonly folder: FolderRef;
  readonly folderName: string;
  readonly name: string;
}
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
    planCreateFile: files.planCreateFile,
    planCreateFolder: files.planCreateFolder,
    planMoveEntries: files.planMoveEntries,
    planRemoveEntries: files.planRemoveEntries,
    planRestoreEntries: files.planRestoreEntries,
    planUnhideEntries: files.planUnhideEntries,
  };
};

/** What the dialog is asked to do. Create and Rename are named in the dialog first. */
export type FolderAsk =
  | { readonly kind: 'createFolder'; readonly folder: FolderRef; readonly folderName: string }
  /** Named here, then written in the editor (no plan in this dialog). */
  | { readonly kind: 'createFile'; readonly folder: FolderRef; readonly folderName: string }
  /** Upload: a file's bytes, named here (its own name first), planned and sent from here. */
  | {
      readonly kind: 'upload';
      readonly folder: FolderRef;
      readonly folderName: string;
      /** The file's own name, offered first. */
      readonly name: string;
      readonly bytes: Uint8Array;
      /** From the bytes (upload-model.ts); "" unknown. */
      readonly mediaType: string;
      readonly typeFrom: 'signature' | 'text' | 'unknown';
    }
  | { readonly kind: 'rename'; readonly from: EntryRef }
  /** One entry, or a selection, all from the folder on screen. */
  | {
      readonly kind: 'move';
      readonly entries: readonly MoveItem[];
      /** Where the picker opens: the trail to the folder the entries are in. */
      readonly start: readonly NavStep[];
    }
  | {
      readonly kind: 'remove';
      readonly entries: readonly SelectedEntry[];
      readonly folderName: string;
      readonly hide: boolean;
    }
  | {
      readonly kind: 'restore';
      readonly entries: readonly RestoreItem[];
    }
  /** Unblock the person's own lone blocks (NEVER_BOUND rows in "Show removed"). */
  | { readonly kind: 'unhide'; readonly entries: readonly EntryRef[] };

/** An entry the person picked: what it is, and whether it's a folder. */
export interface SelectedEntry {
  readonly entry: EntryRef;
  readonly isFolder: boolean;
}
/** An entry to move; a folder carries itself (it can't go inside itself, and needs a path). */
export interface MoveItem {
  readonly entry: EntryRef;
  readonly moving?: FolderRef;
}
/** An entry to restore; a folder needs the path to its folder from the view's start (`via`). */
export interface RestoreItem {
  readonly entry: EntryRef;
  readonly via?: ViewPath;
  /** It was removed and blocked (a mask): restoring it unblocks the name. */
  readonly blocked?: boolean;
}

type Planned = Extract<AnyFolderPlan, { status: 'PLANNED' }>;
type NotSent = { readonly outcome: SaveOutcome; readonly sequenceId?: `0x${string}` };

type Phase =
  | { readonly phase: 'closed' }
  | { readonly phase: 'naming'; readonly value: string }
  | { readonly phase: 'picking' }
  | { readonly phase: 'planning'; readonly request: FolderRequest }
  | {
      readonly phase: 'refused';
      readonly request: FolderRequest;
      readonly refused: readonly {
        /** The item's index in the request (what "Leave these out" drops). */
        readonly index: number;
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
  /** The folder the Move picker is on (where "Move here" puts the entry). */
  #pick = state<PickerSelection | undefined>(undefined);
  /** The destination's name as picked, for the move review. */
  #moveLabel = '';
  /** Plans made since this opening (shown as data-plans; see #plan). */
  #plans = 0;
  /**
   * The person pressed a key or a pointer inside the dialog since it opened: only then can a
   * focus elsewhere be theirs (never the browser's or Web Awesome's own focus on open).
   */
  #personInput = false;
  /**
   * "New text file", named: handed to the editor once the dialog has closed. The dialog gives
   * focus back to its trigger as it closes, so the editor opening any sooner would lose its
   * focus (and the first keystrokes) to the toolbar.
   */
  #composing: ComposeDetail | undefined;
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

  #onInput = (): void => {
    this.#personInput = true;
  };

  #focusKeep(): void {
    // A freshly rendered <wa-button> ignores focus() until its own first render is done (its inner
    // button isn't there yet): wait for it, not just for this dialog's update. Firefox showed it.
    const keep = this.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>(
      'wa-button.efs-folder-keep',
    );
    void Promise.resolve(keep?.updateComplete).then(() => keep?.focus());
  }

  /** Opens the dialog for `ask` (from a click). */
  open(ask: FolderAsk): void {
    this.#controller?.abort();
    this.#controller = new AbortController();
    this.#plans = 0;
    this.dataset.plans = '0';
    this.#personInput = false;
    this.#ask.set(ask);
    const named =
      ask.kind === 'createFolder' ||
      ask.kind === 'createFile' ||
      ask.kind === 'upload' ||
      ask.kind === 'rename';
    if (named && !this.#checkName.get()) {
      loadCheckName()
        .then((check) => this.#checkName.set(check))
        .catch((error: unknown) => console.error(error));
    }
    if (ask.kind === 'createFolder' || ask.kind === 'createFile') {
      this.#phase.set({ phase: 'naming', value: '' });
    } else if (ask.kind === 'upload') this.#phase.set({ phase: 'naming', value: ask.name });
    else if (ask.kind === 'rename') this.#phase.set({ phase: 'naming', value: ask.from.name });
    else if (ask.kind === 'move') this.#pickAgain();
    else void this.#plan(this.#request(ask, ''));
  }

  /**
   * "Remove and block this name instead": the same removal planned as a mask (`hide: true`).
   * Offered only to the place's owner (an app rule; the chain lets anyone mask their own
   * position), judged by the account that planned. A save prepared but never sent is dropped.
   */
  async #blockInstead(s: Extract<Phase, { phase: 'review' | 'sending' }>): Promise<void> {
    const ask = this.#ask.get();
    if (ask?.kind !== 'remove') return;
    if (s.sent?.sequenceId) await this.#drop(s.writer, s.sent.sequenceId);
    const blocked = { ...ask, hide: true };
    this.#ask.set(blocked);
    await this.#plan(this.#request(blocked, ''));
  }

  /** Whether the account that planned owns the folder these entries are in. */
  #ownsPlace(ask: FolderAsk, writer: EfsWriter): boolean {
    if (ask.kind !== 'remove') return false;
    const owner = ask.entries[0]?.entry.folder.owner;
    return owner !== undefined && owner.toLowerCase() === writer.principal.toLowerCase();
  }

  /** Back to the Move picker (it opens where the entry is). */
  #pickAgain(): void {
    this.#pick.set(undefined);
    this.#phase.set({ phase: 'picking' });
  }

  /**
   * "Leave these out": the ask drops the same items as the request, so the review (folders among
   * them, the count) and the notice after the save describe what's actually planned.
   */
  #dropRefused(indices: readonly number[]): void {
    const ask = this.#ask.get();
    if (
      ask?.kind !== 'move' &&
      ask?.kind !== 'remove' &&
      ask?.kind !== 'restore' &&
      ask?.kind !== 'unhide'
    )
      return;
    const drop = new Set(indices);
    const entries = ask.entries.filter((_, i) => !drop.has(i));
    this.#ask.set({ ...ask, entries } as FolderAsk);
  }

  /** "Move here": plans the move into the folder the picker is on. */
  #moveHere(ask: Extract<FolderAsk, { kind: 'move' }>): void {
    const pick = this.#pick.get();
    if (!pick || pick.why || this.host.saving.availability.get().status !== 'READY') return;
    this.#moveLabel = pick.label;
    const folders = ask.entries.some((e) => e.moving !== undefined);
    void this.#plan({
      kind: 'move',
      moves: ask.entries.map((e) => ({ from: e.entry, isFolder: e.moving !== undefined })),
      to: pick.folder,
      ...(folders ? { via: pick.via } : {}),
    });
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
      case 'createFile':
        throw new Error('a new file is planned in the editor');
      case 'upload':
        return {
          kind: 'createFile',
          folder: ask.folder,
          name,
          content: ask.bytes,
          mediaType: ask.mediaType,
        };
      case 'rename':
        return { kind: 'rename', from: ask.from, to: name };
      case 'move':
        throw new Error('a move is planned from the picker (#moveHere)');
      case 'remove':
        return { kind: 'remove', entries: ask.entries.map((e) => e.entry), hide: ask.hide };
      case 'restore':
        return {
          kind: 'restore',
          entries: ask.entries.map((e) => ({ ...e.entry, ...(e.via ? { via: e.via } : {}) })),
        };
      case 'unhide':
        return { kind: 'unhide', entries: ask.entries };
    }
  }

  async #plan(request: FolderRequest): Promise<void> {
    const efs = this.efs;
    const lens = this.lens;
    const signal = this.#controller?.signal;
    if (!efs || !lens || !signal) return;
    // How many plans this opening made, on the element (data-plans): a second plan racing the
    // first could overwrite a review that's already being sent, so the tests count them.
    this.#plans++;
    this.dataset.plans = String(this.#plans);
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
            index: r.index,
            code: r.code,
            name: r.entry.name,
            ...(r.author ? { author: r.author } : {}),
          })),
        });
      else {
        this.#phase.set({
          phase: 'plan-failed',
          request,
          code: plan.status === 'TOO_LARGE' ? 'TOO_LARGE' : plan.reason.code,
        });
      }
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

  #picking(ask: Extract<FolderAsk, { kind: 'move' }>) {
    const t = this.host.translator.t.bind(this.host.translator);
    const availability = this.host.saving.availability.get();
    const reader = availability.status === 'READY' ? availability.account : undefined;
    const pick = this.#pick.get();
    return html`<efs-files-folder-picker
        .efs=${this.efs}
        .reader=${reader}
        .translator=${this.host.translator}
        .start=${ask.start}
        .source=${ask.entries[0]?.entry.folder}
        .moving=${ask.entries.flatMap((e) => (e.moving ? [e.moving] : []))}
        @efs-picker-change=${(event: Event) =>
          this.#pick.set((event as CustomEvent<PickerSelection>).detail)}
      ></efs-files-folder-picker>
      ${pick?.why ? html`<p class="efs-quiet efs-move-why">${t(pick.why)}</p>` : nothing}
      ${
        reader
          ? nothing
          : html`<wa-callout variant="neutral" size="small">
              <span slot="icon">${appIcon('wallet')}</span>
              <p>${t('files.save.connect')}</p>
            </wa-callout>`
      }
      <wa-button slot="footer" appearance="outlined" @click=${() => this.#close()}
        >${t('review.cancel')}</wa-button
      >
      ${
        reader
          ? html`<wa-button
              slot="footer"
              variant="brand"
              class="efs-move-here"
              ?disabled=${!pick || pick.why !== undefined}
              @click=${() => this.#moveHere(ask)}
              >${t('files.move.here')}</wa-button
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

  /** The name typed so far (the naming phase's value), else `fallback`. */
  #nameNow(fallback: string): string {
    const s = this.#phase.get();
    return s.phase === 'naming' ? s.value : fallback;
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
    const writes = ask.kind === 'createFile';
    // Enter can come before checkName has loaded (it loads with the SDK when the dialog opens):
    // it waits for it, then checks the name as it is now, so a fast typist's Enter is never lost.
    const review = async () => {
      const check = (this.#checkName.get() ?? (await loadCheckName()))(this.#nameNow(value));
      if (this.#ask.get() !== ask || this.#phase.get().phase !== 'naming') return;
      if (check.status !== 'VALID' || (ask.kind === 'rename' && check.text === ask.from.name))
        return;
      if (writes) {
        // Named: the editor writes it (no wallet needed to type), once this dialog has closed.
        this.#composing = { folder: ask.folder, folderName: ask.folderName, name: check.text };
        this.#phase.set({ phase: 'closed' });
        return;
      }
      if (this.host.saving.availability.get().status !== 'READY') return;
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
            if (event.key === 'Enter') void review();
          }}
        ></wa-input>
        ${error ? html`<p class="efs-folder-name-error" role="alert">${error}</p>` : nothing}
        ${
          check?.status === 'VALID' && !check.nfc
            ? html`<p class="efs-quiet">${t('files.name.notNfc')}</p>`
            : nothing
        }
        ${
          ready || writes
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
        writes
          ? html`<wa-button
              slot="footer"
              variant="brand"
              class="efs-folder-write"
              ?disabled=${check?.status !== 'VALID'}
              @click=${review}
              >${t('files.new.continue')}</wa-button
            >`
          : ready
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
      case 'efs.createFileReview':
        return html`<p>
            ${t('files.upload.review', { name: r.name, folder: ask.kind === 'upload' ? ask.folderName : '' })}
          </p>
          <p class="efs-upload-type">
            ${
              r.mediaType
                ? t(
                    ask.kind === 'upload' && ask.typeFrom === 'signature'
                      ? 'files.upload.typeSignature'
                      : 'files.upload.typeText',
                    { type: r.mediaType },
                  )
                : t('files.upload.typeUnknown')
            }
          </p>
          <p>${t('files.upload.size', { size: Number(r.size) })}</p>
          ${instead(r, r.name)}`;
      case 'efs.createFolderReview':
        return html`<p>${t('files.save.createsFolder', { name: r.name, folder: ask.kind === 'createFolder' ? ask.folderName : '' })}</p>
          ${instead(r, r.name)}`;
      case 'efs.moveReview': {
        const m = r.moves[0];
        if (!m) return nothing;
        if (ask.kind === 'move') {
          const folders = ask.entries.some((e) => e.moving !== undefined);
          const many = r.moves.length > 1;
          return html`${
            many
              ? html`<p>${t('files.move.reviewMany', { count: r.moves.length, folder: this.#moveLabel })}</p>
                  <ul class="efs-folder-items">
                    ${r.moves.map(
                      (x) => html`<li>
                        <span translate="no" dir="auto">${x.from.name}</span>
                        ${instead(x, x.to.name)} ${after(x.shownAfter, x.from.name)}
                      </li>`,
                    )}
                  </ul>`
              : html`<p>${t('files.move.reviewLine', { name: m.from.name, folder: this.#moveLabel })}</p>
                  ${instead(m, m.to.name)} ${after(m.shownAfter, m.from.name)}`
          }
            <p>${t('files.move.review', { folder: this.#moveLabel })}</p>
            ${folders ? html`<p class="efs-quiet">${t('files.move.checkedUnderLens')}</p>` : nothing}`;
        }
        return html`<p>${t('files.rename.review', { from: m.from.name, to: m.to.name })}</p>
          ${instead(m, m.to.name)} ${after(m.shownAfter, m.from.name)}`;
      }
      case 'efs.removeReview': {
        const e = r.entries[0];
        if (!e || ask.kind !== 'remove') return nothing;
        const folders = ask.entries.some((x) => x.isFolder);
        const items =
          r.entries.length > 1
            ? html`<li>
                ${t('files.remove.hereMany', { count: r.entries.length })}
                <ul class="efs-folder-items">
                  ${r.entries.map(
                    (x) => html`<li>
                      <span translate="no" dir="auto">${x.entry.name}</span>
                      ${after(x.shownAfter, x.entry.name)}
                    </li>`,
                  )}
                </ul>
              </li>`
            : html`<li>
                  ${t(ask.hide ? 'files.remove.blockHere' : 'files.remove.here', { name: e.entry.name })}
                </li>
                <li>${after(e.shownAfter, e.entry.name)}</li>`;
        const many = r.entries.length > 1;
        return html`<ul class="efs-folder-clauses">
          ${items}
          ${
            ask.hide
              ? html`<li class="efs-folder-block-detail">
                    ${many ? t('files.remove.blockDetailMany') : t('files.remove.blockDetail', { name: e.entry.name })}
                  </li>
                  <li class="efs-folder-block-rule">${t('files.remove.blockAppRule')}</li>`
              : nothing
          }
          <li>${t('files.remove.stays')}</li>
          ${folders ? html`<li>${t('files.remove.folder')}</li>` : nothing}
          <li>${t(ask.hide ? 'files.remove.publicBlocked' : 'files.remove.public')}</li>
        </ul>`;
      }
      case 'efs.restoreReview': {
        // alsoPlaced: live placements of this target now, by anyone. Null when the index can't
        // vouch: then nothing is said (never "0").
        const one = (e: (typeof r.entries)[number]) => html`${
          e.alsoPlaced !== null && e.alsoPlaced > 0
            ? html`<p class="efs-folder-also">
                ${t('files.restore.alsoPlaced', { count: e.alsoPlaced })}
              </p>`
            : nothing
        }
          ${instead(e, e.entry.name)}`;
        const e = r.entries[0];
        if (!e) return nothing;
        const unblocks =
          ask.kind === 'restore' && ask.entries.some((x) => x.blocked)
            ? html`<p class="efs-folder-unblock">${t('files.restore.unblocks')}</p>`
            : nothing;
        if (r.entries.length === 1) {
          return html`<p>${t('files.restore.review', { name: e.entry.name })}</p>
            ${unblocks} ${one(e)}`;
        }
        return html`<p>${t('files.restore.reviewMany', { count: r.entries.length })}</p>
          ${unblocks}
          <ul class="efs-folder-items">
            ${r.entries.map(
              (x) =>
                html`<li><span translate="no" dir="auto">${x.entry.name}</span> ${one(x)}</li>`,
            )}
          </ul>`;
      }
      case 'efs.unhideReview': {
        // Your block goes; what shows at the name afterwards is the next author's, or nothing.
        const e = r.entries[0];
        if (!e) return nothing;
        if (r.entries.length === 1) {
          return html`<p>${t('files.unhide.review', { name: e.entry.name })}</p>
            ${after(e.shownAfter, e.entry.name)}`;
        }
        return html`<p>${t('files.unhide.reviewMany', { count: r.entries.length })}</p>
          <ul class="efs-folder-items">
            ${r.entries.map(
              (x) => html`<li>
                <span translate="no" dir="auto">${x.entry.name}</span>
                ${after(x.shownAfter, x.entry.name)}
              </li>`,
            )}
          </ul>`;
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
        : ask?.kind === 'createFile'
          ? 'files.new.textFile'
          : ask?.kind === 'upload'
            ? 'files.upload.title'
            : ask?.kind === 'rename'
              ? 'files.rename.title'
              : ask?.kind === 'move'
                ? 'files.move.title'
                : ask?.kind === 'restore'
                  ? 'files.restore'
                  : ask?.kind === 'unhide'
                    ? 'files.unhide.title'
                    : 'files.remove.title';
    const many = (ask?.kind === 'remove' || ask?.kind === 'move') && ask.entries.length > 1;
    const first =
      ask?.kind === 'remove' || ask?.kind === 'move' ? ask.entries[0]?.entry : undefined;
    const label =
      ask?.kind === 'remove'
        ? many
          ? t(ask.hide ? 'files.remove.blockTitleMany' : 'files.remove.titleMany', {
              count: ask.entries.length,
              folder: ask.folderName,
            })
          : t(ask.hide ? 'files.remove.blockTitle' : title, {
              name: first?.name ?? '',
              folder: ask.folderName,
            })
        : ask?.kind === 'move'
          ? many
            ? t('files.move.titleMany', { count: ask.entries.length })
            : t(title, { name: first?.name ?? '' })
          : t(title);
    let body: unknown = nothing;
    if (open && ask) {
      switch (s.phase) {
        case 'naming':
          body = this.#naming(ask, s.value);
          break;
        case 'picking':
          if (ask.kind === 'move') body = this.#picking(ask);
          break;
        case 'planning':
          body = html`<p class="wa-cluster wa-gap-xs" role="status">
            <wa-spinner></wa-spinner>${t('files.save.planning')}
          </p>`;
          break;
        case 'refused': {
          // A selection plans all or nothing: what's left without the refused items is offered,
          // never sent as part of the selection silently.
          const rest = withoutIndices(
            s.request,
            s.refused.map((r) => r.index),
          );
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
            ${
              rest
                ? html`<wa-button
                    slot="footer"
                    appearance="outlined"
                    class="efs-folder-leave-out"
                    @click=${() => {
                      this.#dropRefused(s.refused.map((r) => r.index));
                      void this.#plan(rest);
                    }}
                    >${t('files.refused.leaveOut')}</wa-button
                  >`
                : nothing
            }
            ${
              ask.kind === 'move'
                ? html`<wa-button
                    slot="footer"
                    appearance="outlined"
                    class="efs-move-again"
                    @click=${() => this.#pickAgain()}
                    >${t('files.move.again')}</wa-button
                  >`
                : nothing
            }
            <wa-button slot="footer" variant="brand" @click=${() => this.#close()}
              >${t('files.save.close')}</wa-button
            >`;
          break;
        }
        case 'plan-failed': {
          const noWallet = s.code === 'NO_WALLET';
          const intoItself = s.code === 'INTO_ITSELF';
          const tooLarge = s.code === 'TOO_LARGE';
          const message = noWallet
            ? t('files.save.connect')
            : intoItself
              ? t('files.move.intoSelf')
              : tooLarge
                ? t('files.upload.tooLarge')
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
                : intoItself || tooLarge
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
          const prompts = s.plan.review.prompts;
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
                ${approvalsLine(t, prompts)}
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
                  : html`${
                      isRemove &&
                      ask.kind === 'remove' &&
                      !ask.hide &&
                      !sending &&
                      this.#ownsPlace(ask, s.writer)
                        ? html`<wa-button
                            slot="footer"
                            appearance="outlined"
                            class="efs-folder-block"
                            @click=${() => void this.#blockInstead(s)}
                            >${t('files.remove.block')}</wa-button
                          >`
                        : nothing
                    }
                    <wa-button
                      slot="footer"
                      variant=${isRemove ? 'danger' : 'brand'}
                      class="efs-folder-send"
                      ?loading=${sending}
                      ?disabled=${sending || !canSendAgain || hold !== undefined}
                      @click=${() => {
                        if (s.phase === 'review') void this.#send(s);
                      }}
                      >${t(
                        sent
                          ? 'saves.sendAgain'
                          : isRemove
                            ? ask.kind === 'remove' && ask.hide
                              ? 'files.remove.blockYes'
                              : 'files.remove.yes'
                            : ask.kind === 'unhide'
                              ? 'files.unhide.yes'
                              : 'review.send',
                      )}</wa-button
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
        // The dialog's own show focus runs last: a removal's review still opens on Keep it. But
        // never over a choice the person already made: if they moved to another control in the
        // review while it was still showing (by key or pointer), focus stays where they put it.
        if (event.target !== event.currentTarget) return;
        const phase = this.#phase.get().phase;
        if (this.#ask.get()?.kind !== 'remove' || phase !== 'review') return;
        // Theirs only after their own key or pointer inside the dialog: a focus the browser or
        // Web Awesome placed on open (even on Remove) is never a choice, and Keep it takes it.
        const active = document.activeElement;
        const chose =
          this.#personInput &&
          active !== null &&
          active !== event.currentTarget &&
          this.contains(active) &&
          !active.matches('wa-button.efs-folder-keep');
        if (!chose) this.#focusKeep();
      }}
      @keydown=${this.#onInput}
      @pointerdown=${this.#onInput}
      @wa-hide=${(event: Event) => {
        if (event.target !== event.currentTarget) return;
        if (this.#phase.get().phase === 'sending') event.preventDefault();
        else this.#close();
      }}
      @wa-after-hide=${(event: Event) => {
        if (event.target !== event.currentTarget) return;
        const dialog = event.currentTarget as HTMLElement;
        const detail = this.#composing;
        this.#composing = undefined;
        if (!detail) {
          // The dialog gives focus back to what opened it; when that's gone (a removed or moved
          // row, a notice that closed), focus would drop to the page: the Entries pane takes it.
          setTimeout(() => {
            const active = document.activeElement;
            if (active && active !== document.body && !dialog.contains(active)) return;
            this.dispatchEvent(
              new CustomEvent(FOCUS_LOST_EVENT, { bubbles: true, composed: true }),
            );
          });
          return;
        }
        // After the dialog's own focus return (queued just before this event), so the editor's
        // focus on its text is the last word.
        setTimeout(() =>
          this.dispatchEvent(
            new CustomEvent<ComposeDetail>(COMPOSE_EVENT, {
              detail,
              bubbles: true,
              composed: true,
            }),
          ),
        );
      }}
    >
      ${body}
    </wa-dialog>`;
  }
}
