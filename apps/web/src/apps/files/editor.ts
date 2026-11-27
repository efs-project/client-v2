// Editing a text file opened by object link: edit → review → one approval (per part) → saved.
// The same editor writes a new text file (`create`): no base revision, planCreateFile in place of
// planEditFile, holds on its (folder, name), and the unsaved text kept under that folder and name
// (compose.ts). Everything else (review, send, banner) is the edit path, unchanged.
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

import type { Efs, Hex, Lens, Reason } from '@efs/sdk';
import type { EfsWriter, SequenceOpts, SequenceProgress } from '@efs/sdk/actions';
import type {
  CreateFileReview,
  EditPlanResult,
  FolderPlanResult,
  OpenedFile,
  ParentRef,
  RevisionRef,
} from '@efs/sdk/files';
import type { RealmRef } from '../../boot/route.ts';
import { markEach } from '../../platform/marks.ts';
import { onLocalChain } from '../../platform/settings/model.ts';
import type { AppHost } from '../../shell/apps.ts';
import type { KeptDraft } from '../../shell/drafts.ts';
import {
  heldMessage,
  type SaveHold,
  saveHold,
  type TwinStanding,
  touchesOfInput,
  twinStanding,
} from '../../shell/save-hold.ts';
import {
  answerCopy,
  feeScheduleCopy,
  type SaveOutcome,
  saveMessage,
  saveOutcome,
  saveValues,
  type Twin,
  thrownOutcome,
} from '../../shell/save-outcome.ts';
import { shortAccount } from '../../shell/wallet-state.ts';
import { state } from '../../state/signals.ts';
import { EfsElement, html, live, nothing } from '../../ui/element.ts';
import type { MessageId, Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { pressedOnce } from '../../ui/press-once.ts';
import { approvalsLine } from './approvals.ts';
import { attachNotice } from './attach-notice.ts';
import { newFileKey } from './compose.ts';
import { nameRuleMessage, refusalMessage } from './folder-requests.ts';
import { checkTwin, settleTwin } from './held.ts';
import { authorLabel } from './who.ts';

type EditPlanned = Extract<EditPlanResult, { status: 'PLANNED' }>;
type CreatePlanned = Extract<FolderPlanResult<CreateFileReview>, { status: 'PLANNED' }>;
type Planned = EditPlanned | CreatePlanned;

/** A new file to write (create mode): where, and the name it was given. */
export interface NewFileTarget {
  readonly folder: ParentRef;
  /** The place's chain key, lowercase, as save holds name it (a folder's record, an address's word). */
  readonly key: string;
  readonly folderName: string;
  readonly name: string;
}

/** A send that came back NOT_STARTED: what the SDK said, and the sequence to continue. */
interface NotSent {
  readonly outcome: SaveOutcome;
  readonly sequenceId?: Hex;
  /** The save as runSequence/resume returned it, when the review may hand it over (RESPLIT). */
  readonly progress?: SequenceProgress;
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
      readonly writer: EfsWriter;
      readonly approving?: { readonly part: number; readonly total: number };
      /** What the wallet or its node answered, while the save still checks the ledger. */
      readonly answer?: ReturnType<typeof answerCopy>;
    }
  /** The send threw: it may or may not have gone out. The banner settles it. */
  | { readonly phase: 'unconfirmed'; readonly noJournal: boolean }
  /** `own`: the new HEAD is the person's own version, saved since the edit began (another tab). */
  | { readonly phase: 'base-changed'; readonly head: RevisionRef | null; readonly own?: boolean }
  /**
   * "You first" now shows the person's own version, which was already there when the edit began:
   * a reorder, not a change. Saving over it, or keeping the version they started from, is theirs.
   */
  | { readonly phase: 'reordered'; readonly head: RevisionRef }
  /** The person's own version moved (another tab or device) while they edited another's. */
  | { readonly phase: 'own-changed'; readonly plan: Planned; readonly writer: EfsWriter }
  | {
      readonly phase: 'plan-failed';
      readonly message: MessageId;
      readonly values?: Record<string, string>;
    }
  /** A new file the planner refused (the person's own entry already has that name). */
  | {
      readonly phase: 'refused';
      readonly refused: readonly { readonly code: string; readonly name: string }[];
    };

/** Sent when the editor closes: cancelled, or handed a save to the shell. */
export interface EditDoneDetail {
  readonly progress?: SequenceProgress;
  /** From the review: whether the view's Lens will show this edit. */
  readonly visibleInLens?: boolean;
  /** The person chose to drop their edit and see the newer version. */
  readonly showLatest?: boolean;
  /** A new file handed to the banner: its SubjectId, to open it once it's saved. */
  readonly created?: string;
}
export const EDIT_DONE_EVENT = 'efs-edit-done';

/** Short ids live with the author labels (who.ts); re-exported for the panes that use them. */
export { shortId } from './who.ts';

const loadEdit = async () => (await import('@efs/sdk/files')).planEditFile;

/** Whether `author` is the principal of the writer that planned: judged by the signer. */
const signedBy = (writer: EfsWriter, author: string | undefined): boolean =>
  author !== undefined && writer.principal.toLowerCase() === author.toLowerCase();
const loadCreate = async () => (await import('@efs/sdk/files')).planCreateFile;

/**
 * A plan that didn't come back PLANNED for a reason this editor doesn't name. A deployment whose fee
 * schedule isn't the chain's (UNSUPPORTED_PROFILE, sdk-v2 1054c2c) names both; anything else is
 * "couldn't check the file".
 */
function planUnknown(result: object): Extract<Phase, { phase: 'plan-failed' }> {
  const fee = 'reason' in result ? (result.reason as Reason | undefined)?.feeSchedule : undefined;
  if (!fee) return { phase: 'plan-failed', message: 'files.edit.unknown' };
  const copy = feeScheduleCopy(fee);
  return { phase: 'plan-failed', message: copy.id, values: copy.values };
}
const loadCheckName = async () => (await import('@efs/sdk')).checkName;

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
  /** A save to finish or stop, or one in flight (see shell/save-hold.ts). */
  | SaveHold;

export class EfsFileEditor extends EfsElement {
  static override properties = {
    host: { attribute: false },
    efs: { attribute: false },
    file: { attribute: false },
    link: { attribute: false },
    original: { attribute: false },
    draft: { attribute: false },
    draftKey: { attribute: false },
    resumed: { attribute: false },
    lens: { attribute: false },
    create: { attribute: false },
    realm: { attribute: false },
    route: { attribute: false },
    since: { attribute: false },
  };
  declare host: AppHost;
  declare efs: Efs;
  /** The revision on screen when the person pressed Edit (the base of the edit); none for `create`. */
  declare file: OpenedFile | undefined;
  /** Create mode: the new file to write. */
  declare create: NewFileTarget | undefined;
  /** Create mode: the realm, for the new file's key among unsaved edits. */
  declare realm: RealmRef | undefined;
  /** Create mode: the route to come back to ("Review changes"), where it was started. */
  declare route: string | undefined;
  /** The ledger's admissions when the file on screen was opened (its read's basis). */
  declare since: bigint | undefined;
  /** The file's canonical link (to come back to it from the banner). */
  declare link: string;
  declare original: string;
  /**
   * The person's own text, brought back by "Review changes"; undefined starts from the unsaved
   * edit kept for this file, else from `original`.
   */
  declare draft: string | undefined;
  /** This file's key among unsaved edits (its canonical route; shell/drafts.ts). */
  declare draftKey: string;
  /** Opened because the person came back to this file's unsaved edit (said so, at the top). */
  declare resumed: boolean;
  /** The view's Lens; undefined is the SDK's default. */
  declare lens: Lens | undefined;

  #text = state('');
  #phase = state<Phase>({ phase: 'editing' });
  /** A held save's twin the saves don't list, as its attempt last read (#checkTwin). */
  #twinChecked = state<
    { readonly planId: string; readonly standing: 'settled' | 'waiting' } | undefined
  >(undefined);
  /** The unsaved edit this editor reopened, if it did (said once, at the top). */
  #restored: KeptDraft | undefined;
  /** Cancel with changes: "Discard your edit?" is open. */
  #confirmingDiscard = state(false);
  /** A re-read this editor needs: running, failed (or timed out), or the journal is off here. */
  #holding = state<'no' | 'checking' | 'failed' | 'no-journal'>('no');
  #base: RevisionRef | undefined;
  /** The admissions when this edit began (kept with its base): what a reorder is measured from. */
  #since: bigint | undefined;
  #controller = new AbortController();
  /** Create mode: the name as typed now, and the SDK's checkName once loaded. */
  #name = state('');
  #checkName = state<((input: string) => import('@efs/sdk').NameCheck) | undefined>(undefined);
  /** Create mode: the key the unsaved text is kept under now (it follows the name). */
  #keptAs: string | undefined;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // "Review changes" brings a save's edit back on the version shown now (the banner asked
    // before replacing a different unsaved edit). Otherwise an unsaved edit kept for this file
    // comes back with its own base, so a file that changed meanwhile still says so at Review.
    if (this.create) {
      this.#name.set(this.create.name);
      this.#keptAs = this.#key();
      loadCheckName()
        .then((check) => this.#checkName.set(check))
        .catch((error: unknown) => console.error(error));
    }
    const kept = this.draft === undefined ? this.host.saving.drafts.get(this.#key()) : undefined;
    this.#restored = kept;
    this.#text.set(this.draft ?? kept?.text ?? this.original);
    this.#base = kept && 'base' in kept ? kept.base : this.#fileBase();
    this.#since = kept && 'base' in kept ? kept.since : this.since;
    this.#controller = new AbortController();
    this.#keep();
  }

  /** This edit's key among unsaved edits: the file's route, or a new file's folder and name. */
  #key(): string {
    const c = this.create;
    return c && this.realm ? newFileKey(this.realm, c.folder, this.#name.get()) : this.draftKey;
  }

  /** Create mode: the name as checked now (VALID, or why not). */
  #nameCheck(): import('@efs/sdk').NameCheck | undefined {
    return this.#checkName.get()?.(this.#name.get());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#controller.abort();
  }

  override firstUpdated(): void {
    this.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  }

  /**
   * Keeps the edit (text and base) for this file while it differs from what's shown, so leaving
   * the file and coming back finds it here. Leaving keeps it; only closing the editor drops it.
   */
  #keep(): void {
    const text = this.#text.get();
    const drafts = this.host.saving.drafts;
    const key = this.#key();
    // A new file's key follows its name: the text moves with it.
    if (this.#keptAs !== undefined && this.#keptAs !== key) drafts.drop(this.#keptAs);
    this.#keptAs = this.create ? key : undefined;
    const base = this.#base ?? this.#fileBase();
    if (text === this.original) drafts.drop(key);
    else if (this.create) {
      drafts.keep(key, { text, create: { ...this.create, name: this.#name.get() } });
    } else if (base) {
      drafts.keep(key, {
        text,
        base,
        ...(this.#since !== undefined ? { since: this.#since } : {}),
      });
    }
  }

  #fileBase(): RevisionRef | undefined {
    return this.file ? { kind: 'revision', recordId: this.file.revision } : undefined;
  }

  /**
   * Closes the editor. Every way here ends the edit: saved (the banner keeps its text for
   * "Review changes"), discarded after asking, or never changed.
   */
  #done(detail: EditDoneDetail): void {
    this.host.saving.drafts.drop(this.#key());
    this.dispatchEvent(new CustomEvent(EDIT_DONE_EVENT, { bubbles: true, composed: true, detail }));
  }

  /**
   * About a reopened unsaved edit: that the file changed since it was started (always worth
   * saying: Review will ask before saving over it), else that it's back (only when the person
   * came back to it, not when a refresh rebuilt the editor under them).
   */
  #keptNotice(t: Translator['t']) {
    const kept = this.#restored;
    if (!kept) return nothing;
    if (!('base' in kept) || !this.file) {
      return this.resumed
        ? html`<p class="efs-quiet efs-edit-kept">${t('files.new.kept')}</p>`
        : nothing;
    }
    const moved = kept.base.recordId.toLowerCase() !== this.file.revision.toLowerCase();
    if (!moved && !this.resumed) return nothing;
    const a = this.host.saving.availability.get();
    const mine =
      a.status === 'READY' &&
      this.file.author?.toLowerCase() ===
        this.efs.lens.principalOf(a.account as never).toLowerCase();
    // The view now puts the person's own version first: Review tells a reorder from a change.
    if (moved && mine) {
      return html`<p class="efs-quiet efs-edit-kept">${t('files.edit.keptMine')}</p>`;
    }
    return html`<p class="efs-quiet efs-edit-kept">
      ${t(moved ? 'files.edit.keptChanged' : 'files.edit.kept')}
    </p>`;
  }

  /** Cancel: closes straight away when nothing changed; otherwise asks before discarding. */
  #cancel(): void {
    if (this.#text.get() === this.original) this.#done({});
    else this.#confirmingDiscard.set(true);
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
    const mine = this.file?.file.toLowerCase();
    const place = this.#place();
    // An unconfirmed edit of this file (or a send touching a new file's place), or an unconfirmed
    // send that names nothing, pauses saving. Other places and other files don't.
    const paused = this.host.saving.unconfirmed
      .get()
      .some(
        (u) =>
          (mine !== undefined && u.file?.toLowerCase() === mine) ||
          (place !== undefined &&
            (u.places ?? []).some((p) => p.folder === place.folder && p.name === place.name)) ||
          (u.file === undefined && !u.places),
      );
    if (paused) {
      return { hold: { kind: 'paused' }, lapsed: false };
    }
    const a = this.host.saving.availability.get();
    if (a.status !== 'READY') return { lapsed: false };
    return saveHold(this.host.saving.saves.get(), {
      account: a.account,
      ...(place ? { places: [place] } : this.file ? { file: this.file.file } : {}),
      except,
    });
  }

  /** A save the SDK held back: the same save again, or another save of the same bytes. */
  #twinStanding(twin: Twin | undefined): TwinStanding {
    const place = this.#place();
    const mine = touchesOfInput({
      account: '',
      ...(place ? { places: [place] } : this.file ? { file: this.file.file } : {}),
    });
    const standing = twinStanding(twin, this.host.saving.saves.get(), mine);
    if (standing !== 'unlisted') return standing;
    // Not listed is unknown, never settled: the twin's own attempt decides (#checkTwin).
    const checked = this.#twinChecked.get();
    return checked && twin && checked.planId === twin.planId ? checked.standing : 'unlisted';
  }

  /** A twin the saves don't list, checked by its attempt (the review then decides from that). */
  async #checkTwin(writer: EfsWriter, twin: Twin | undefined): Promise<void> {
    if (!twin) return;
    const standing = await checkTwin(writer, twin);
    this.#twinChecked.set({ planId: twin.planId, standing });
  }

  /** This computer's test chain (every enabled RPC local): waits there are said in minutes. */
  #onLocalChain(): boolean {
    const n = this.host.network.get();
    return 'network' in n && onLocalChain(n.network);
  }

  /** Create mode: the (folder, name) the new file takes. */
  #place(): { readonly folder: string; readonly name: string } | undefined {
    return this.create
      ? { folder: this.create.key.toLowerCase(), name: this.#name.get() }
      : undefined;
  }

  #progressOpts(plan: Planned, writer: EfsWriter): SequenceOpts {
    return {
      onProgress: (now, event) => {
        // Said at once, before the SDK's settle wait (up to 60 s) ends.
        if (event.kind === 'wallet-answer') {
          this.#phase.set({ phase: 'sending', plan, writer, answer: answerCopy(event.reason) });
          return;
        }
        const first = event.kind === 'wallet-request' ? event.parts[0] : undefined;
        if (first !== undefined && now.total > 1) {
          this.#phase.set({
            phase: 'sending',
            plan,
            writer,
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
  async #plan(base: RevisionRef | undefined, afterRace = false): Promise<void> {
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
    if (base) this.#base = base;
    this.#keep();
    const signal = this.#controller.signal;
    try {
      const writer = await this.host.saving.writer();
      if (signal.aborted) return;
      if (!writer) {
        this.#phase.set({ phase: 'editing' });
        return;
      }
      if (this.create) {
        await this.#planCreate(this.create, writer, signal);
        return;
      }
      if (!base || !this.file) return;
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
          this.#phase.set(
            result.head && this.#isReorder(writer, result.headAuthor, result.headAdmission)
              ? { phase: 'reordered', head: result.head }
              : {
                  phase: 'base-changed',
                  head: result.head,
                  ...(result.head && signedBy(writer, result.headAuthor) ? { own: true } : {}),
                },
          );
          return;
        case 'TOO_LARGE':
          this.#phase.set({ phase: 'plan-failed', message: 'files.edit.tooLarge' });
          return;
        default:
          this.#phase.set(planUnknown(result));
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      this.#phase.set({ phase: 'plan-failed', message: 'files.edit.failed' });
    }
  }

  /**
   * Whether a HEAD that isn't this edit's base is only a reorder: the version of the account that
   * planned (the signer, never whichever account is on screen now), set no later than when this
   * edit began (`headAdmission` ≤ the opening basis's admissions). Anything else, or anything
   * unknown, is a change.
   */
  #isReorder(
    writer: EfsWriter,
    author: string | undefined,
    admission: bigint | undefined,
  ): boolean {
    if (admission === undefined || this.#since === undefined || admission > this.#since) {
      return false;
    }
    return signedBy(writer, author);
  }

  /** Create mode: plans the new file at its folder and (current) name, in the folder's Lens. */
  async #planCreate(c: NewFileTarget, writer: EfsWriter, signal: AbortSignal): Promise<void> {
    const planCreateFile = await loadCreate();
    const result = await planCreateFile(
      this.efs,
      writer,
      {
        folder: c.folder,
        name: this.#name.get(),
        content: new TextEncoder().encode(this.#text.get()),
        ...(this.lens ? { lens: this.lens } : {}),
      },
      { signal },
    );
    if (signal.aborted) return;
    switch (result.status) {
      case 'PLANNED':
        this.#phase.set({ phase: 'review', plan: result, writer });
        return;
      case 'REFUSED':
        this.#phase.set({
          phase: 'refused',
          refused: result.refused.map((r) => ({ code: r.code, name: r.entry.name })),
        });
        return;
      case 'TOO_LARGE':
        this.#phase.set({ phase: 'plan-failed', message: 'files.edit.tooLarge' });
        return;
      default:
        this.#phase.set(planUnknown(result));
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

  /**
   * Claims the review of `plan` for its one send, and starts it; false when that review is no
   * longer the current one. A second activation before the page re-renders finds the review gone
   * (or another plan's) and is ignored, never a second save of the same edit.
   */
  #send(plan: Planned, writer: EfsWriter, again?: Hex): boolean {
    const now = this.#phase.get();
    if (now.phase !== 'review' || now.plan !== plan) return false;
    this.#phase.set({ phase: 'sending', plan, writer });
    void this.#sendClaimed(plan, writer, again);
    return true;
  }

  /** Sends the reviewed plan; a save that wasn't sent before is continued, not started again. */
  async #sendClaimed(plan: Planned, writer: EfsWriter, again?: Hex): Promise<void> {
    markEach('efs:send');
    // Checked again at Send, from the journal: a save may have opened (here or in another tab)
    // since the plan was made.
    if (!(await this.#relist()) || this.#hold(again).hold) {
      this.#phase.set({ phase: 'editing' });
      return;
    }
    let progress: SequenceProgress;
    try {
      const opts = this.#progressOpts(plan, writer);
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
      const place = this.#place();
      const touched = place ? { places: [place] } : this.file ? { file: this.file.file } : {};
      this.host.saving.markUnconfirmed(
        thrown.sequenceId ? { ...touched, sequenceId: thrown.sequenceId } : touched,
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
        // A new file: someone (the person, elsewhere) took the name; planning again says so.
        if (this.create || !('base' in plan.review)) await this.#plan(undefined);
        else {
          await this.#plan(this.#base ?? { kind: 'revision', recordId: plan.review.base }, true);
        }
        return;
      }
      if (outcome.kind === 'held') {
        // This call sent nothing, and its new record would linger as "not sent": stop it. Then
        // read the twin again, so the review can say which case this is (Send again, once it
        // may, starts a new save).
        await this.#drop(writer, progress.sequenceId);
        await settleTwin(this.host.saving, writer, outcome.twin);
        if (this.#twinStanding(outcome.twin) === 'unlisted') {
          await this.#checkTwin(writer, outcome.twin);
        }
        this.#phase.set({ phase: 'review', plan, writer, sent: { outcome } });
        return;
      }
      this.#phase.set({
        phase: 'review',
        plan,
        writer,
        sent: { outcome, sequenceId: progress.sequenceId, progress },
      });
      return;
    }
    this.#handOff(progress, plan);
  }

  /**
   * From here the banner owns this save (Saved · confirming → Saved, Partially saved → Continue,
   * a race → changed, a RESPLIT ask), with the edit kept for "Review changes".
   */
  #handOff(progress: SequenceProgress, plan: Planned): void {
    const c = this.create;
    const key = this.#key();
    this.host.saving.track(
      progress,
      c
        ? {
            route: this.route ?? '',
            link: key,
            key,
            text: this.#text.get(),
            create: { ...c, name: this.#name.get() },
          }
        : { route: this.draftKey, link: this.link, text: this.#text.get() },
    );
    this.#done({
      progress,
      visibleInLens: plan.review.visibleInLens,
      ...(plan.review.kind === 'efs.createFileReview' ? { created: plan.review.file.subject } : {}),
    });
  }

  /**
   * Cancel in the review: a save that was started but never sent is dropped quietly. A RESPLIT
   * ask is answered "Not now" instead: nothing is cancelled, the save stays.
   */
  #cancelReview(): void {
    const s = this.#phase.get();
    if (s.phase === 'sending') return;
    if (s.phase === 'review' && s.sent?.outcome.kind === 'resplit') {
      this.#notNow(s);
      return;
    }
    if (s.phase === 'review' && s.sent?.sequenceId) void this.#drop(s.writer, s.sent.sequenceId);
    this.#phase.set({ phase: 'editing' });
  }

  /**
   * "Not now" on a RESPLIT ask (sdk-v2 a03ba84): the save stays as it is (not started, or partly
   * saved), listed in the banner with Continue, and asks no more in this tab. The editor hands it
   * over as it does any save the wallet has seen.
   */
  #notNow(s: Extract<Phase, { phase: 'review' }>): void {
    const progress = s.sent?.progress;
    if (!progress) {
      this.#phase.set({ phase: 'editing' });
      return;
    }
    this.host.saving.putOff(progress.sequenceId);
    this.#handOff(progress, s.plan);
  }

  /** "Prepare again" after a refusal this plan can't get past (stale): a fresh, visible plan. */
  async #prepareAgain(s: Extract<Phase, { phase: 'review' }>): Promise<void> {
    if (s.sent?.sequenceId) await this.#drop(s.writer, s.sent.sequenceId);
    const review = s.plan.review;
    await this.#plan(
      'base' in review ? (this.#base ?? { kind: 'revision', recordId: review.base }) : undefined,
    );
  }

  /** The connected account when the SDK says it is the author (it always is for a plan). */
  #authorLabel(author: string): string {
    const a = this.host.saving.availability.get();
    return a.status === 'READY' &&
      this.efs.lens.principalOf(a.account as never).toLowerCase() === author.toLowerCase()
      ? shortAccount(a.account)
      : authorLabel(this.efs, author, undefined, this.host.names.get());
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
    const author =
      'shownInstead' in r ? (r.shownInstead?.author ?? '—') : (this.file?.author ?? '—');
    const values = sent
      ? saveValues(sent.outcome, shortAccount, (id) => this.#chainName(id, t))
      : {};
    // Sent again (continued) only when the SDK says this same save can go as planned.
    // Held back: which case it is, from the saves listed (and Send again once it may).
    const held = sent?.outcome.kind === 'held' ? this.#twinStanding(sent.outcome.twin) : undefined;
    const canSendAgain =
      !sent ||
      held === 'settled' ||
      sent.outcome.kind === 'refused' ||
      sent.outcome.kind === 'busy' ||
      sent.outcome.kind === 'wallet-mismatch' ||
      sent.outcome.kind === 'nothing-new' ||
      sent.outcome.kind === 'resplit' ||
      (sent.outcome.kind === 'not-sent' && sent.outcome.canRetry);
    // RESPLIT: the save now needs more approvals; Continue resumes it, "Not now" leaves it.
    const resplit = sent?.outcome.kind === 'resplit';
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
                  ${t('review.notVisible', { author: authorLabel(this.efs, author, undefined, this.host.names.get()) })}
                </p>
              </wa-callout>`
        }
        ${
          r.kind === 'efs.createFileReview'
            ? html`<p class="efs-new-review">
                ${t('files.new.review', { name: r.name, folder: this.create?.folderName ?? '' })}
              </p>`
            : nothing
        }
        <p>${t('review.appears')}</p>
        ${this.create ? attachNotice(t, this.create.folder, s.writer.principal) : nothing}
        <p class="efs-review-prompts">
          ${approvalsLine(t, r.prompts)}
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
          ${
            'guard' in r
              ? html`<dt>${t('review.protection')}</dt>
                  <dd>${t(r.guard === 'own-head' ? 'review.guardOwn' : 'review.guardLens')}</dd>`
              : nothing
          }
        </dl>
        ${
          s.phase === 'sending'
            ? html`<p class="wa-cluster wa-gap-xs" role="status"><wa-spinner></wa-spinner>${
                s.answer
                  ? t(s.answer.id, s.answer.values)
                  : s.approving
                    ? t('saves.approvePart', s.approving)
                    : t('review.sending')
              }</p>`
            : nothing
        }
        ${
          sent
            ? html`<wa-callout variant="warning" size="small" class="efs-review-not-sent"
                ><span slot="icon">${appIcon('circle-exclamation')}</span>
                <p role="alert">${
                  held
                    ? t(heldMessage(held, this.#onLocalChain()))
                    : t(saveMessage(sent.outcome), values)
                }</p>
                ${
                  (held === 'waiting' || held === 'unlisted') &&
                  sent.outcome.kind === 'held' &&
                  !sending
                    ? html`<wa-button
                        size="s"
                        appearance="outlined"
                        class="efs-held-check"
                        @click=${() => {
                          const twin = sent.outcome.kind === 'held' ? sent.outcome.twin : undefined;
                          void this.host.saving.refresh();
                          void this.#checkTwin(s.writer, twin);
                        }}
                        >${t('files.edit.checkAgain')}</wa-button
                      >`
                    : nothing
                }</wa-callout
              >`
            : nothing
        }
      </div>
      <wa-button
        slot="footer"
        appearance="outlined"
        class=${resplit ? 'efs-review-not-now' : 'efs-review-cancel'}
        ?disabled=${sending}
        @click=${() => this.#cancelReview()}
        >${t(
          resplit
            ? 'save.notNow'
            : sent?.outcome.kind === 'damaged'
              ? 'saves.discard'
              : 'review.cancel',
        )}</wa-button
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
              .disabled=${live(
                sending || !canSendAgain || this.#hold(sent?.sequenceId).hold !== undefined,
              )}
              @click=${(e: Event) => {
                if (s.phase === 'review' && this.#send(s.plan, s.writer, sent?.sequenceId)) {
                  pressedOnce(e);
                }
              }}
              >${t(resplit ? 'saves.resplitContinue' : sent ? 'saves.sendAgain' : 'review.send')}</wa-button
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
        <p>${
          hold.kind === 'waiting' && hold.minutes !== undefined
            ? t(message, { minutes: hold.minutes, block: String(hold.block ?? '') })
            : t(message)
        }</p>
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
            <p role="alert">
              ${t(s.head ? (s.own ? 'files.edit.ownBaseChanged' : 'files.edit.baseChanged') : 'files.edit.baseGone')}
            </p>
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
      case 'reordered':
        return html`<wa-callout variant="neutral" size="small" class="efs-edit-reordered">
          <span slot="icon">${appIcon('circle-info')}</span>
          <div class="wa-stack wa-gap-xs">
            <p role="alert">${t('files.edit.reordered')}</p>
            <div class="wa-cluster wa-gap-xs">
              <wa-button
                size="s"
                variant="brand"
                class="efs-edit-save-over-mine"
                @click=${() => void this.#plan(s.head)}
                >${t('files.edit.saveOverMine')}</wa-button
              >
              <wa-button
                size="s"
                appearance="outlined"
                class="efs-edit-keep-started"
                @click=${() => this.#phase.set({ phase: 'editing' })}
                >${t('files.edit.keepStarted')}</wa-button
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
          <p role="alert">${t(s.message, s.values)}</p></wa-callout
        >`;
      case 'refused':
        return html`<wa-callout variant="danger" size="small" class="efs-new-refused"
          ><span slot="icon">${appIcon('circle-exclamation')}</span>
          <div class="wa-stack wa-gap-2xs">
            ${s.refused.map(
              (r) =>
                html`<p role="alert">
                  ${t(refusalMessage(r.code), { code: r.code, name: r.name, author: '—' })}
                </p>`,
            )}
          </div></wa-callout
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
    // A new file can be saved empty; an edit needs a change.
    const changed = this.create !== undefined || this.#text.get() !== this.original;
    const busy = s.phase === 'planning' || s.phase === 'sending';
    const name = this.create ? this.#nameCheck() : undefined;
    const nameOk = !this.create || name?.status === 'VALID';
    return html`<div class="wa-stack wa-gap-s efs-editor">
      ${
        this.draft !== undefined
          ? html`<p class="efs-quiet efs-edit-reopened">${t('files.edit.reopened')}</p>`
          : this.#keptNotice(t)
      }
      ${this.create ? this.#nameField(this.create, name, busy, t) : nothing}
      <label class="wa-stack wa-gap-2xs">
        <span>${t(this.create ? 'files.new.label' : 'files.edit.label')}</span>
        <textarea
          class="efs-edit-text"
          translate="no"
          spellcheck="false"
          rows="12"
          .value=${this.#text.get()}
          ?readonly=${busy}
          @input=${(event: Event) => {
            this.#text.set((event.target as HTMLTextAreaElement).value);
            this.#keep();
          }}
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
          ?disabled=${!ready || blocked || !changed || busy || !nameOk}
          @click=${() => void this.#plan(this.#base ?? this.#fileBase())}
          >${t('files.edit.review')}</wa-button
        >
        <wa-button
          size="s"
          appearance="outlined"
          class="efs-edit-cancel"
          ?disabled=${busy}
          @click=${() => this.#cancel()}
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
      ${this.#discardDialog(t)}
    </div>`;
  }

  /** Create mode: the new file's name, editable, checked as typed (its text follows the name). */
  #nameField(
    c: NewFileTarget,
    check: import('@efs/sdk').NameCheck | undefined,
    busy: boolean,
    t: Translator['t'],
  ) {
    const value = this.#name.get();
    const error =
      value === '' || !check || check.status === 'VALID'
        ? undefined
        : t(check.status === 'INVALID' ? nameRuleMessage(check.rule) : 'files.name.rule.character');
    return html`<p class="efs-new-where">${t('files.new.where', { folder: c.folderName })}</p>
      <wa-input
        class="efs-new-name"
        label=${t('files.name.label')}
        .value=${value}
        ?readonly=${busy}
        @input=${(event: Event) => {
          this.#name.set((event.target as HTMLInputElement).value);
          if (this.#phase.get().phase === 'refused') this.#phase.set({ phase: 'editing' });
          this.#keep();
        }}
      ></wa-input>
      ${error ? html`<p class="efs-new-name-error" role="alert">${error}</p>` : nothing}`;
  }

  /**
   * "Discard your edit?": the only way an unsaved edit is thrown away. Keep editing is the
   * default (focused first), and closing the dialog any other way keeps the edit too. Always in
   * the page, opened and closed by `open`, so closing animates and focus goes back to the text.
   */
  #discardDialog(t: Translator['t']) {
    return html`<wa-dialog
      class="efs-edit-discard"
      label=${t('files.edit.discardTitle')}
      ?open=${this.#confirmingDiscard.get()}
      @wa-hide=${(event: Event) => {
        if (event.target === event.currentTarget) this.#confirmingDiscard.set(false);
      }}
      @wa-after-hide=${(event: Event) => {
        // Kept: back to the text, where the person was. The dialog returns focus to Cancel in a
        // timeout queued just before this event, so this one is queued after it.
        if (event.target !== event.currentTarget) return;
        setTimeout(() => {
          if (this.isConnected) {
            this.querySelector<HTMLTextAreaElement>('textarea.efs-edit-text')?.focus();
          }
        });
      }}
    >
      <p>${t('files.edit.discardBody')}</p>
      <wa-button
        slot="footer"
        appearance="outlined"
        class="efs-edit-keep"
        autofocus
        @click=${() => this.#confirmingDiscard.set(false)}
        >${t('files.edit.keepEditing')}</wa-button
      >
      <wa-button
        slot="footer"
        variant="danger"
        class="efs-edit-discard-yes"
        @click=${() => {
          this.#confirmingDiscard.set(false);
          this.#done({});
        }}
        >${t('files.edit.discard')}</wa-button
      >
    </wa-dialog>`;
  }
}
