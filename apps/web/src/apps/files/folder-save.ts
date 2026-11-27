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
import type { EfsWriter, SequenceOpts, SequenceProgress } from '@efs/sdk/actions';
import type { CreateFileReview, EntryRef, FolderRef, ParentRef } from '@efs/sdk/files';
import type { TagPlace, TagReview, TagTarget } from '@efs/sdk/tags';
import { markEach } from '../../platform/marks.ts';
import { onLocalChain } from '../../platform/settings/model.ts';
import type { AppHost } from '../../shell/apps.ts';
import { readFloorReset } from '../../shell/read-floor.ts';
import {
  heldMessage,
  saveHold,
  statementKey,
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
import { tRich } from '../../ui/rich.ts';
import { labelParts, type VisibleParts } from '../../ui/visible-text.ts';
import { approvalsLine } from './approvals.ts';
import { attachNotice } from './attach-notice.ts';
import type { PickerSelection } from './folder-picker.ts';
import {
  type AnyFolderPlan,
  type FolderPlanners,
  type FolderRequest,
  folderHold,
  folderKey,
  nameRuleMessage,
  type ParentKeyOf,
  placesOf,
  planRequest,
  refusalMessage,
  type ViewPath,
  withoutIndices,
} from './folder-requests.ts';
import { checkTwin, settleTwin } from './held.ts';
import {
  checkLocator,
  fingerprint,
  isHttps,
  LINK_MAX_BYTES,
  type LocatorCheck,
  type SdkLocatorCheck,
} from './link-model.ts';
import type { NavStep } from './navigation.ts';
import type { TagPick } from './tag-picker.ts';
import { pathParts } from './topic-model.ts';
import { authorLabel } from './who.ts';

export const FOLDER_SAVED_EVENT = 'efs-folder-saved';
/** The dialog closed and the control that opened it is gone: its pane should take focus. */
export const FOCUS_LOST_EVENT = 'efs-folder-focus-lost';
/** "New text file", named: the editor takes it from here (the listing starts the composer). */
export const COMPOSE_EVENT = 'efs-compose';
export interface ComposeDetail {
  readonly folder: ParentRef;
  /** The place's chain key, lowercase, as save holds name it (a folder's record, an address's word). */
  readonly key: string;
  readonly folderName: string;
  readonly name: string;
}
/** The event's detail: the save the banner now owns, and what it was asked to do. */
export interface FolderSavedDetail {
  readonly sequenceId: string;
  readonly ask: FolderAsk | undefined;
  /** What was sent: a tag save's words and stance, for whoever shows or re-reads tags. */
  readonly request: FolderRequest;
}

/** checkName, loaded with the SDK when a name is first asked for (the app entry stays SDK-free). */
type CheckName = (input: string) => NameCheck;
const loadCheckName = async (): Promise<CheckName> => (await import('@efs/sdk')).checkName;

/** What a refused address says, by the rule it breaks (link-model.ts). */
const LOCATOR_RULE: Record<Exclude<LocatorCheck, 'ok' | 'empty' | 'pending'>, MessageId> = {
  scheme: 'files.link.schemeRule',
  chars: 'files.link.charsRule',
  shape: 'files.link.shapeRule',
};

/** checkText (the chain's text grammar, for a tag's name), loaded when a name is first typed. */
type CheckText = (text: string) => { ok: true } | { ok: false; code: number; rule: string };
const loadCheckText = async (): Promise<CheckText> => (await import('@efs/sdk/tags')).checkText;

const loadPlanners = async (): Promise<FolderPlanners> => {
  const [files, tags] = await Promise.all([import('@efs/sdk/files'), import('@efs/sdk/tags')]);
  return {
    planTag: tags.planTag,
    planDeny: tags.planDeny,
    planUntag: tags.planUntag,
    planLabel: tags.planLabel,
    planSame: tags.planSame,
    planBroader: tags.planBroader,
    planCreateFile: files.planCreateFile,
    planCreateFolder: files.planCreateFolder,
    planMoveEntries: files.planMoveEntries,
    planRemoveEntries: files.planRemoveEntries,
    planRestoreEntries: files.planRestoreEntries,
    planUnhideEntries: files.planUnhideEntries,
    planHideEntries: files.planHideEntries,
  };
};

/** What the dialog is asked to do. Create and Rename are named in the dialog first. */
export type FolderAsk =
  | { readonly kind: 'createFolder'; readonly folder: ParentRef; readonly folderName: string }
  /** Named here, then written in the editor (no plan in this dialog). */
  | { readonly kind: 'createFile'; readonly folder: ParentRef; readonly folderName: string }
  /** Upload: a file's bytes, named here (its own name first), planned and sent from here. */
  | {
      readonly kind: 'upload';
      readonly folder: ParentRef;
      readonly folderName: string;
      /** The file's own name, offered first. */
      readonly name: string;
      /** The file picked: fingerprinted here when it's linked instead of stored. */
      readonly file: Blob;
      /** Its bytes; absent for a file too large to read here, which can only be linked. */
      readonly bytes?: Uint8Array;
      /** From the bytes (upload-model.ts), or as the device reports it (`browser`); "" unknown. */
      readonly mediaType: string;
      readonly typeFrom: 'signature' | 'text' | 'unknown' | 'browser';
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
  | { readonly kind: 'unhide'; readonly entries: readonly EntryRef[] }
  /** "Block this name here": others' entries, offered by the place's owner. */
  | { readonly kind: 'hide'; readonly entries: readonly EntryRef[]; readonly folderName: string }
  /**
   * Tag things (a file, a folder, an address), chosen where they're shown: the place is picked in
   * the dialog. `names`: each target as it was shown, for the review and any refusal.
   */
  | {
      readonly kind: 'tag';
      readonly targets: readonly TagTarget[];
      readonly names: readonly string[];
      /** "Remove my tag" from a list: the place is known, so it plans at once (no picker). */
      readonly place?: TagPlace;
      readonly stance?: 'untag';
    }
  /**
   * "Name this tag": the person's own name for the tag in their language. `current`: their name
   * there now, if any (offered for editing, and "Remove my name"). `tag` and `langName`: how the
   * tag and the language are shown.
   */
  | {
      readonly kind: 'label';
      readonly place: readonly string[];
      readonly lang: string;
      readonly langName: string;
      readonly tag: string;
      readonly current?: string;
    }
  /**
   * "Same as…" or "Under…" another tag, picked in the dialog. A listed statement of the person's
   * own (`remove`: its two sides as it was said) plans its removal at once.
   */
  | {
      readonly kind: 'join';
      readonly how: 'same' | 'broader';
      readonly place: readonly string[];
      readonly tag: string;
      readonly remove?: { readonly subject: readonly string[]; readonly other: readonly string[] };
    };

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

/** What a tag review does, from its own statements: a number below 0 is "Not this", none is untag. */
function tagStance(r: TagReview): 'tag' | 'deny' | 'untag' {
  const n = r.statements[0]?.number;
  return n === null || n === undefined ? 'untag' : n < 0 ? 'deny' : 'tag';
}

const TAG_SEND: Readonly<Record<'tag' | 'deny' | 'untag', MessageId>> = {
  tag: 'files.tag.sendTag',
  deny: 'files.tag.sendDeny',
  untag: 'files.tag.sendUntag',
};
type NotSent = {
  readonly outcome: SaveOutcome;
  readonly sequenceId?: `0x${string}`;
  /** The save as runSequence/resume returned it, when the review may hand it over (RESPLIT). */
  readonly progress?: SequenceProgress;
};

type Phase =
  | { readonly phase: 'closed' }
  | { readonly phase: 'naming'; readonly value: string }
  /** An upload stored elsewhere and linked: its name, and the address typed so far. */
  | { readonly phase: 'linking'; readonly name: string; readonly locator: string }
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
  | {
      readonly phase: 'plan-failed';
      readonly request: FolderRequest;
      readonly code: string;
      /** UNSUPPORTED_PROFILE: the deployment's fee schedule and the chain's, said by name. */
      readonly feeSchedule?: { readonly document: string; readonly chain: string | null };
    }
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

/** An upload's bytes; a file too large to read here has none, and is only ever linked. */
function uploadBytes(ask: Extract<FolderAsk, { kind: 'upload' }>): Uint8Array {
  if (!ask.bytes) throw new Error('a file too large to read here can only be linked');
  return ask.bytes;
}

/** A linked file's fingerprint, made on this device. */
type Fingerprint =
  | { readonly status: 'reading' }
  | { readonly status: 'done'; readonly length: bigint; readonly sha256: `0x${string}` }
  | { readonly status: 'failed' }
  | { readonly status: 'tooBig' };

export class EfsFolderSave extends EfsElement {
  static override properties = {
    host: { attribute: false },
    efs: { attribute: false },
    lens: { attribute: false },
    keyOf: { attribute: false },
  };
  declare host: AppHost;
  declare efs: Efs | undefined;
  /**
   * The chain key of a parent the person writes in (an address's padded word, read lazily by the
   * listing): what holds key on. Without it, an address's places are held fail-closed.
   */
  declare keyOf: ParentKeyOf | undefined;
  /** The Lens the person sees the folder through (the place Lens). */
  declare lens: Lens | undefined;

  #ask = state<FolderAsk | undefined>(undefined);
  /** The folder the Move picker is on (where "Move here" puts the entry). */
  #pick = state<PickerSelection | undefined>(undefined);
  /** The tag being chosen in the tag picker: its words (once valid) and its stance. */
  #tagPick = state<TagPick | undefined>(undefined);
  /** The destination's name as picked, for the move review. */
  #moveLabel = '';
  /** Plans made since this opening (shown as data-plans; see #plan). */
  #plans = 0;
  /** A held save's twin the saves don't list, as its attempt last read (#checkTwin). */
  #twinChecked = state<
    { readonly planId: string; readonly standing: 'settled' | 'waiting' } | undefined
  >(undefined);
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
  #checkText = state<CheckText | undefined>(undefined);
  /** The SDK's checkLocator, loaded when an address is first asked for. */
  #checkLocator = state<SdkLocatorCheck | undefined>(undefined);
  /** The fingerprint of the upload being linked (one ask at a time). */
  #fingerprint = state<{ readonly of: FolderAsk; readonly value: Fingerprint } | undefined>(
    undefined,
  );
  #phase = state<Phase>({ phase: 'closed' });
  /** What the wallet or its node answered, while the save still checks the ledger. */
  #answered = state<ReturnType<typeof answerCopy> | undefined>(undefined);
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
    else if (ask.kind === 'label') {
      if (!this.#checkText.get()) {
        loadCheckText()
          .then((check) => this.#checkText.set(check))
          .catch((error: unknown) => console.error(error));
      }
      this.#phase.set({ phase: 'naming', value: ask.current ?? '' });
    } else if (ask.kind === 'move') this.#pickAgain();
    else if (ask.kind === 'tag') {
      if (ask.place && ask.stance === 'untag') {
        void this.#plan({ kind: 'tag', place: ask.place, targets: ask.targets, stance: 'untag' });
      } else {
        this.#tagPick.set(undefined);
        this.#phase.set({ phase: 'picking' });
      }
    } else if (ask.kind === 'join') {
      const said = ask.remove;
      if (said) {
        void this.#plan(
          ask.how === 'same'
            ? { kind: 'same', place: said.subject, other: said.other, remove: true }
            : { kind: 'broader', place: said.subject, broader: said.other, remove: true },
        );
      } else {
        this.#tagPick.set(undefined);
        this.#phase.set({ phase: 'picking' });
      }
    } else void this.#plan(this.#request(ask, ''));
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
    // A RESPLIT ask closed is "Not now": nothing is cancelled, the save stays (sdk-v2 a03ba84).
    const progress = s.phase === 'review' ? s.sent?.progress : undefined;
    if (s.phase === 'review' && s.sent?.outcome.kind === 'resplit' && progress) {
      this.host.saving.putOff(progress.sequenceId);
      this.#handOff(progress, s.request);
      return;
    }
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
          content: uploadBytes(ask),
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
      case 'hide':
        return { kind: 'hide', entries: ask.entries };
      case 'tag':
        throw new Error('a tag is planned from the tag picker');
      case 'label':
        return { kind: 'label', place: ask.place, lang: ask.lang, text: name };
      case 'join':
        throw new Error('a join is planned from its picker');
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
      else if (plan.status === 'REFUSED' && plan.kind === 'efs.topicStatementPlan')
        // A tag's name: one statement, refused as a whole (its own codes, named apart).
        this.#phase.set({
          phase: 'refused',
          request,
          refused: [
            {
              index: 0,
              code: `${request.kind === 'label' ? 'LABEL' : 'JOIN'}_${plan.code}`,
              name: '',
            },
          ],
        });
      else if (plan.status === 'REFUSED')
        this.#phase.set({
          phase: 'refused',
          request,
          refused: plan.refused.map((r) =>
            'entry' in r
              ? {
                  index: r.index,
                  code: r.code,
                  name: r.entry.name,
                  ...(r.author ? { author: r.author } : {}),
                }
              : { index: r.index, code: r.code, name: this.#targetName(r.index) },
          ),
        });
      else {
        const fee = plan.status === 'TOO_LARGE' ? undefined : plan.reason.feeSchedule;
        this.#phase.set({
          phase: 'plan-failed',
          request,
          code: plan.status === 'TOO_LARGE' ? 'TOO_LARGE' : plan.reason.code,
          ...(fee ? { feeSchedule: { document: fee.document, chain: fee.chain } } : {}),
        });
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      // INTO_ITSELF can be reached through Restore (a folder put back inside itself): said in
      // words. Any other MISUSE is a client bug (names are checked before Review): reported as one.
      const code = (error as { details?: { code?: unknown } }).details?.code;
      // A linked file the SDK refuses (its address, as the chain would store it): said as that.
      const linked = request.kind === 'createFile' && !(request.content instanceof Uint8Array);
      this.#phase.set({
        phase: 'plan-failed',
        request,
        code: code === 'INTO_ITSELF' ? 'INTO_ITSELF' : linked ? 'BAD_LOCATOR' : 'CLIENT_ERROR',
      });
    }
  }

  /** Why this reviewed save can't be sent now, if it can't: checked on the signer, never the screen. */
  /**
   * The statements a tag save makes (its review's topic and things): a tag save is held by them,
   * never by a folder name, since a tag doesn't place anything. Undefined for a folder save.
   */
  #statementsOf(plan: Planned): string[] | undefined {
    const review = plan.review;
    return review.kind === 'efs.tagReview'
      ? review.statements.map((x) => statementKey(review.place.id, x.thing))
      : review.kind === 'efs.topicStatementReview'
        ? review.purpose === 'label'
          ? [statementKey(review.subject.id, `label:${review.lang ?? ''}`)]
          : // The tags.same / tags.broader effect's own key (shell/save-hold.ts).
            [statementKey(review.subject.id, `tags.${review.purpose}:${review.other?.id ?? ''}`)]
        : undefined;
  }

  /** A save the SDK held back: the same save again, or another save of the same bytes. */
  #twinStanding(request: FolderRequest, plan: Planned, twin: Twin | undefined): TwinStanding {
    const statements = this.#statementsOf(plan);
    const places = placesOf(request, this.keyOf);
    const mine = touchesOfInput({
      account: '',
      ...(statements ? { statements } : places ? { places } : {}),
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

  /** "Check again" while a held save waits: the saves, and an unlisted twin's attempt. */
  #checkAgain(writer: EfsWriter, twin: Twin | undefined, t: Translator['t']) {
    return html`<wa-button
      size="s"
      appearance="outlined"
      class="efs-held-check"
      @click=${() => {
        void this.host.saving.refresh();
        void this.#checkTwin(writer, twin);
      }}
      >${t('files.edit.checkAgain')}</wa-button
    >`;
  }

  /** This computer's test chain (every enabled RPC local): waits there are said in minutes. */
  #onLocalChain(): boolean {
    const n = this.host.network.get();
    return 'network' in n && onLocalChain(n.network);
  }

  #hold(request: FolderRequest, writer: EfsWriter, plan: Planned, except?: string) {
    const statements = this.#statementsOf(plan);
    return folderHold(
      {
        availability: this.host.saving.availability.get(),
        signer: writer.account,
        unconfirmed: this.host.saving.unconfirmed.get(),
        saves: this.host.saving.saves.get(),
        places: placesOf(request, this.keyOf),
        ...(statements ? { statements } : {}),
        except,
      },
      saveHold,
    );
  }

  /**
   * Claims this review for its one send, and starts it; false when the review is no longer the
   * current one. The button's handler sees the phase as it was rendered, so a second activation
   * before the page re-renders (WebKit delivered one) must find this exact review gone: two sends
   * of one plan would be two saves of it.
   */
  #send(s: Extract<Phase, { phase: 'review' | 'sending' }>): boolean {
    if (this.#phase.get() !== s || s.phase !== 'review') return false;
    this.#phase.set({ ...s, phase: 'sending' });
    void this.#sendClaimed(s);
    return true;
  }

  async #sendClaimed(s: Extract<Phase, { phase: 'review' | 'sending' }>): Promise<void> {
    markEach('efs:send');
    const { request, plan, writer } = s;
    const again = s.sent?.sequenceId;
    const places = placesOf(request, this.keyOf);
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
    if (this.#hold(request, writer, plan, again).hold) {
      back();
      return;
    }
    let progress: SequenceProgress;
    try {
      // A wallet's answer (a funds refusal, a lost connection) is said at once, before the SDK's
      // settle wait (up to 60 s) ends.
      this.#answered.set(undefined);
      const opts: SequenceOpts = {
        onProgress: (_now, event) => {
          if (event.kind === 'wallet-answer') this.#answered.set(answerCopy(event.reason));
        },
      };
      progress = again
        ? await writer.resume(again, opts)
        : await writer.runSequence(plan.parts, opts);
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
      // Places that can't be keyed (undefined) pause everything: an unconfirmed naming none.
      this.host.saving.markUnconfirmed({
        ...(places ? { places } : {}),
        ...(thrown.sequenceId ? { sequenceId: thrown.sequenceId } : {}),
      });
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
      if (outcome.kind === 'held') {
        // This call sent nothing, and its new record would linger as "not sent": stop it. Then
        // read the twin again, so the review can say which case this is (Send again, once it
        // may, starts a new save).
        await this.#drop(writer, progress.sequenceId);
        const read = await settleTwin(this.host.saving, writer, outcome.twin);
        if (this.#twinStanding(request, plan, outcome.twin) === 'unlisted') {
          await this.#checkTwin(writer, outcome.twin);
        }
        back(
          read === 'read'
            ? { sent: { outcome } }
            : { sent: { outcome }, note: 'files.save.checkFailed' },
        );
        return;
      }
      back({ sent: { outcome, sequenceId: progress.sequenceId, progress } });
      return;
    }
    this.#handOff(progress, request);
  }

  /** The wallet answered (or the person said "Not now" to a RESPLIT ask): the banner owns it. */
  #handOff(progress: SequenceProgress, request: FolderRequest): void {
    this.host.saving.track(progress);
    this.dispatchEvent(
      new CustomEvent(FOLDER_SAVED_EVENT, {
        detail: {
          sequenceId: progress.sequenceId,
          ask: this.#ask.get(),
          request,
        } satisfies FolderSavedDetail,
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

  /**
   * "Same as…" / "Under…": the other tag, picked as a tag's place is (suggestions from its last
   * word), with no stance. Review plans the statement; "Remove mine" plans taking yours back.
   */
  #joinPicking(ask: Extract<FolderAsk, { kind: 'join' }>) {
    const t = this.host.translator.t.bind(this.host.translator);
    const reader = this.host.saving.availability.get().status === 'READY';
    const words = this.#tagPick.get()?.words;
    const self =
      words !== undefined &&
      words.length === ask.place.length &&
      words.every((w, i) => w === ask.place[i]);
    const ready = reader && words !== undefined && !self;
    const plan = (remove: boolean) => {
      if (!words || self) return;
      void this.#plan(
        ask.how === 'same'
          ? { kind: 'same', place: ask.place, other: words, ...(remove ? { remove } : {}) }
          : { kind: 'broader', place: ask.place, broader: words, ...(remove ? { remove } : {}) },
      );
    };
    return html`<efs-files-tag-picker
        .efs=${this.efs}
        .translator=${this.host.translator}
        .stances=${false}
        .pathLabel=${t(ask.how === 'same' ? 'files.join.samePath' : 'files.join.underPath', {
          tag: ask.tag,
        })}
        @efs-tag-change=${(event: Event) =>
          this.#tagPick.set((event as CustomEvent<TagPick>).detail)}
      ></efs-files-tag-picker>
      ${self ? html`<p class="efs-folder-name-error" role="alert">${t('files.join.self')}</p>` : nothing}
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
                appearance="outlined"
                variant="danger"
                class="efs-join-remove"
                ?disabled=${!ready}
                @click=${() => plan(true)}
                >${t('files.join.removeMine')}</wa-button
              >
              <wa-button
                slot="footer"
                variant="brand"
                class="efs-join-review"
                ?disabled=${!ready}
                @click=${() => plan(false)}
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

  /** The tag picker: where the tag goes, and whether it applies; Review plans it. */
  #tagPicking(ask: Extract<FolderAsk, { kind: 'tag' }>) {
    const t = this.host.translator.t.bind(this.host.translator);
    const reader = this.host.saving.availability.get().status === 'READY';
    const pick = this.#tagPick.get();
    return html`<efs-files-tag-picker
        .efs=${this.efs}
        .translator=${this.host.translator}
        @efs-tag-change=${(event: Event) =>
          this.#tagPick.set((event as CustomEvent<TagPick>).detail)}
      ></efs-files-tag-picker>
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
              class="efs-tag-review"
              ?disabled=${!pick?.words}
              @click=${() => {
                const words = this.#tagPick.get()?.words;
                if (!words) return;
                void this.#plan({
                  kind: 'tag',
                  place: words,
                  targets: ask.targets,
                  stance: this.#tagPick.get()?.stance ?? 'tag',
                });
              }}
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

  /** A tag's review: what it says, the tags it creates, that it's public, and "Not this"'s reach. */
  #tagReview(ask: Extract<FolderAsk, { kind: 'tag' }>, r: TagReview) {
    const t = this.host.translator.t.bind(this.host.translator);
    const name = ask.names.join(', ');
    // The words as shown (pills for hidden code points); an address as its short form.
    const path: VisibleParts =
      r.place.kind === 'topic' ? pathParts(r.place.words) : [shortAccount(r.place.address)];
    const stance = tagStance(r);
    const parent =
      r.place.kind === 'topic' && r.place.words.length > 1
        ? pathParts(r.place.words.slice(0, -1))
        : undefined;
    const line =
      stance === 'tag'
        ? 'files.tag.reviewTag'
        : stance === 'deny'
          ? 'files.tag.reviewDeny'
          : 'files.tag.reviewUntag';
    return html`<p class="efs-tag-says">${tRich(t, line, { name, path })}</p>
      ${
        r.newTopics.length > 0
          ? html`<p class="efs-tag-creates">
              ${tRich(t, 'files.tag.creates', {
                count: r.newTopics.length,
                paths: r.newTopics.flatMap((x, n) => [
                  ...(n > 0 ? [', '] : []),
                  ...pathParts(x.words),
                ]),
              })}
            </p>`
          : nothing
      }
      ${
        stance === 'deny'
          ? html`<p class="efs-tag-reach">
              ${
                parent
                  ? tRich(t, 'files.tag.denyReach', { name, path, parent })
                  : tRich(t, 'files.tag.denyReachRoot', { name, path })
              }
            </p>`
          : nothing
      }
      ${
        stance === 'untag'
          ? html`<p class="efs-tag-untag">${tRich(t, 'files.tag.untagNote', { name, path })}</p>`
          : html`<p class="efs-tag-public">
              ${tRich(t, stance === 'deny' ? 'files.tag.publicDeny' : 'files.tag.public', { name, path })}
            </p>`
      }`;
  }

  /**
   * Creating at someone else's address: who sees the entry, said in the review before anything is
   * signed. Its owner's own entry with the same name comes first for people viewing the address.
   */
  #attachNotice(request: FolderRequest, writer: EfsWriter) {
    if (request.kind !== 'createFolder' && request.kind !== 'createFile') return nothing;
    const t = this.host.translator.t.bind(this.host.translator);
    return attachNotice(t, request.folder, writer.principal);
  }

  /** A tagged thing as the dialog names it: the name it was shown by, else its short id. */
  #targetName(index: number): string {
    const ask = this.#ask.get();
    return ask?.kind === 'tag' ? (ask.names[index] ?? '') : '';
  }

  /** Another author, as the review names them: "0x1234…cdef" (in full in the title). */
  #who(author: string): string {
    return authorLabel(this.efs, author, undefined, this.host.names.get());
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
        .reset=${readFloorReset(this.host.network.get(), this.host.reader.get())}
        .names=${this.host.names.get()}
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

  /**
   * "Store it elsewhere and link it": to the address step, fingerprinting the picked file on this
   * device meanwhile (once per ask). Nothing is uploaded or fetched.
   */
  #startLinking(name: string, locator = ''): void {
    const ask = this.#ask.get();
    if (ask?.kind !== 'upload') return;
    this.#phase.set({ phase: 'linking', name, locator });
    if (!this.#checkLocator.get()) {
      import('@efs/sdk')
        .then(({ checkLocator: sdk }) => this.#checkLocator.set(sdk))
        .catch((error: unknown) => console.error(error));
    }
    if (this.#fingerprint.get()?.of === ask) return;
    const set = (value: Fingerprint) => {
      if (this.#ask.get() === ask) this.#fingerprint.set({ of: ask, value });
    };
    if (ask.file.size > LINK_MAX_BYTES) {
      set({ status: 'tooBig' });
      return;
    }
    set({ status: 'reading' });
    void (async () => {
      try {
        const bytes = ask.bytes ?? new Uint8Array(await ask.file.arrayBuffer());
        const made = await fingerprint(bytes);
        set({ status: 'done', ...made });
      } catch (error) {
        console.error(error);
        set({ status: 'failed' });
      }
    })();
  }

  /** The address step: the fingerprint made here, and where the person stored the file. */
  #linking(ask: Extract<FolderAsk, { kind: 'upload' }>, name: string, locator: string) {
    const t = this.host.translator.t.bind(this.host.translator);
    const fp = this.#fingerprint.get();
    const print = fp?.of === ask ? fp.value : { status: 'reading' as const };
    const check = checkLocator(locator, this.#checkLocator.get());
    const ready = this.host.saving.availability.get().status === 'READY';
    const can = ready && print.status === 'done' && check === 'ok';
    const review = () => {
      if (!can || print.status !== 'done') return;
      void this.#plan({
        kind: 'createFile',
        folder: ask.folder,
        name,
        content: { kind: 'external', length: print.length, sha256: print.sha256, locator },
        mediaType: ask.mediaType,
      });
    };
    return html`<div class="wa-stack wa-gap-s efs-link">
        <p>${t('files.link.intro', { name })}</p>
        ${
          print.status === 'reading'
            ? html`<p class="wa-cluster wa-gap-xs efs-quiet" role="status">
                <wa-spinner></wa-spinner>${t('files.link.fingerprinting')}
              </p>`
            : print.status === 'done'
              ? html`<dl class="efs-facts efs-link-fingerprint">
                  <dt>${t('files.link.fingerprint')}</dt>
                  <dd><code translate="no" dir="ltr" class="efs-hash">${print.sha256}</code></dd>
                  <dt>${t('review.size')}</dt>
                  <dd>${t('files.upload.size', { size: Number(print.length) })}</dd>
                </dl>`
              : html`<p class="efs-folder-name-error" role="alert">
                  ${
                    print.status === 'tooBig'
                      ? t('files.link.fingerprintTooBig', { limit: LINK_MAX_BYTES / 1024 ** 3 })
                      : t('files.link.fingerprintFailed')
                  }
                </p>`
        }
        <wa-input
          class="efs-link-locator"
          label=${t('files.link.locator')}
          hint=${t('files.link.locatorHint')}
          autocomplete="off"
          spellcheck="false"
          .value=${locator}
          autofocus
          @input=${(event: Event) =>
            this.#phase.set({
              phase: 'linking',
              name,
              locator: (event.target as HTMLInputElement).value.trim(),
            })}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Enter') review();
          }}
        ></wa-input>
        ${
          check === 'ok' || check === 'empty' || check === 'pending'
            ? nothing
            : html`<p class="efs-folder-name-error efs-link-rule" role="alert">
                ${t(LOCATOR_RULE[check])}
              </p>`
        }
        ${
          check === 'ok' && isHttps(locator)
            ? html`<p class="efs-quiet efs-link-https">${t('files.link.httpsNote')}</p>`
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
              class="efs-link-review"
              ?disabled=${!can}
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

  /** The name typed so far (the naming phase's value), else `fallback`. */
  #nameNow(fallback: string): string {
    const s = this.#phase.get();
    return s.phase === 'naming' ? s.value : fallback;
  }

  #naming(ask: FolderAsk, value: string) {
    if (ask.kind === 'label') return this.#labelling(ask, value);
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
    // An upload can be stored elsewhere and linked instead; one too large to read here only can.
    const linkable = ask.kind === 'upload';
    const linkOnly = ask.kind === 'upload' && !ask.bytes;
    // Enter can come before checkName has loaded (it loads with the SDK when the dialog opens):
    // it waits for it, then checks the name as it is now, so a fast typist's Enter is never lost.
    const review = async () => {
      const check = (this.#checkName.get() ?? (await loadCheckName()))(this.#nameNow(value));
      if (this.#ask.get() !== ask || this.#phase.get().phase !== 'naming') return;
      if (check.status !== 'VALID' || (ask.kind === 'rename' && check.text === ask.from.name))
        return;
      if (writes) {
        // Named: the editor writes it (no wallet needed to type), once this dialog has closed.
        const key = (this.keyOf ?? folderKey)(ask.folder);
        if (!key) return;
        this.#composing = { folder: ask.folder, key, folderName: ask.folderName, name: check.text };
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
          linkOnly
            ? html`<wa-callout variant="neutral" size="small" class="efs-link-only">
                <span slot="icon">${appIcon('circle-info')}</span>
                <p>${t('files.link.tooBigHere')}</p>
              </wa-callout>`
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
        linkable
          ? html`<wa-button
              slot="footer"
              appearance=${linkOnly ? 'accent' : 'outlined'}
              variant=${linkOnly ? 'brand' : 'neutral'}
              class="efs-link-offer"
              ?disabled=${check?.status !== 'VALID'}
              @click=${() => {
                if (check?.status === 'VALID') this.#startLinking(check.text);
              }}
              >${t('files.link.offer')}</wa-button
            >`
          : nothing
      }
      ${
        linkOnly
          ? nothing
          : writes
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

  /**
   * "Name this tag": the person's name for it in their language, checked as typed with the chain's
   * text grammar (checkText). Review plans it; "Remove my name" (when they have one) plans taking
   * it back. Unchanged, Review stays off.
   */
  #labelling(ask: Extract<FolderAsk, { kind: 'label' }>, value: string) {
    const t = this.host.translator.t.bind(this.host.translator);
    const checkText = this.#checkText.get();
    const check = checkText && value !== '' ? checkText(value) : undefined;
    const ready = this.host.saving.availability.get().status === 'READY';
    const unchanged = value === (ask.current ?? '');
    const review = async () => {
      const now = this.#nameNow(value);
      const ok = (this.#checkText.get() ?? (await loadCheckText()))(now).ok;
      if (this.#ask.get() !== ask || this.#phase.get().phase !== 'naming') return;
      if (!ok || now === (ask.current ?? '') || !ready) return;
      void this.#plan({ kind: 'label', place: ask.place, lang: ask.lang, text: now });
    };
    return html`<div class="wa-stack wa-gap-s">
        <wa-input
          class="efs-label-text"
          label=${t('files.label.field', { tag: ask.tag, lang: ask.langName })}
          .value=${value}
          autofocus
          @input=${(event: Event) =>
            this.#phase.set({ phase: 'naming', value: (event.target as HTMLInputElement).value })}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Enter') void review();
          }}
        ></wa-input>
        ${
          check && !check.ok
            ? html`<p class="efs-folder-name-error" role="alert">${t('files.label.rule')}</p>`
            : nothing
        }
        <p class="efs-quiet efs-label-hint">${t('files.label.hint')}</p>
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
        ready && ask.current !== undefined
          ? html`<wa-button
              slot="footer"
              appearance="outlined"
              variant="danger"
              class="efs-label-remove"
              @click=${() =>
                void this.#plan({ kind: 'label', place: ask.place, lang: ask.lang, remove: true })}
              >${t('files.label.remove')}</wa-button
            >`
          : nothing
      }
      ${
        ready
          ? html`<wa-button
              slot="footer"
              variant="brand"
              class="efs-label-review"
              ?disabled=${!check?.ok || unchanged}
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

  /** A linked file's review: where its bytes are, and what the chain keeps (only their fingerprint). */
  #linkReview(r: CreateFileReview, ask: FolderAsk) {
    const t = this.host.translator.t.bind(this.host.translator);
    const s = this.#phase.get();
    const request = s.phase === 'review' || s.phase === 'sending' ? s.request : undefined;
    const locator =
      request?.kind === 'createFile' && !(request.content instanceof Uint8Array)
        ? request.content.locator
        : '';
    return html`<p class="efs-link-says">
        ${t('files.link.review', {
          name: r.name,
          folder: ask.kind === 'upload' ? ask.folderName : '',
        })}
      </p>
      <p><code translate="no" dir="ltr" class="efs-hash efs-link-where">${locator}</code></p>
      <wa-callout variant="neutral" size="small" class="efs-link-promise">
        <span slot="icon">${appIcon('circle-info')}</span>
        <p>${t('files.link.promise')}</p>
      </wa-callout>
      ${isHttps(locator) ? html`<p class="efs-quiet efs-link-https">${t('files.link.httpsNote')}</p>` : nothing}
      <dl class="efs-facts">
        <dt>${t('files.link.fingerprint')}</dt>
        <dd><code translate="no" dir="ltr" class="efs-hash">${r.sha256}</code></dd>
        <dt>${t('review.size')}</dt>
        <dd>${t('files.upload.size', { size: Number(r.size) })}</dd>
      </dl>
      <p class="efs-upload-type">
        ${
          r.mediaType
            ? t(
                ask.kind === 'upload' && ask.typeFrom === 'signature'
                  ? 'files.upload.typeSignature'
                  : ask.kind === 'upload' && ask.typeFrom === 'browser'
                    ? 'files.upload.typeBrowser'
                    : 'files.upload.typeText',
                { type: r.mediaType },
              )
            : t('files.upload.typeUnknown')
        }
      </p>`;
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
        if (r.layout === 'external') return this.#linkReview(r, ask);
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
      case 'efs.tagReview':
        return ask.kind === 'tag' ? this.#tagReview(ask, r) : nothing;
      case 'efs.hideReview': {
        // Whose entry the block covers, for whom it stops showing, and who still sees it.
        return html`<ul class="efs-folder-items">
          ${r.entries.map(
            (x) => html`<li class="efs-hide-item">
              <p>
                ${t('files.hide.review', {
                  name: x.entry.name,
                  author: this.#who(x.shownNow.author),
                })}
              </p>
              ${after(x.shownAfter, x.entry.name)}
            </li>`,
          )}
        </ul>
        <p class="efs-quiet efs-hide-reach">${t('files.hide.reach')}</p>`;
      }
      case 'efs.topicStatementReview': {
        if (ask.kind === 'join') {
          // A link between tags: what it says (or that yours goes), and that others decide.
          const same = r.purpose === 'same';
          const args = {
            tag: pathParts(r.subject.kind === 'topic' ? r.subject.words : []),
            other: pathParts(r.other?.words ?? []),
          };
          return html`<p class="efs-label-says">
              ${tRich(
                t,
                r.remove
                  ? same
                    ? 'files.join.sameRemoveReview'
                    : 'files.join.underRemoveReview'
                  : same
                    ? 'files.join.sameReview'
                    : 'files.join.underReview',
                args,
              )}
            </p>
            <p class="efs-quiet efs-label-public">
              ${t(same ? 'files.join.samePublic' : 'files.join.underPublic')}
            </p>`;
        }
        // A tag's name: what it says (or that it goes), and that names are public.
        if (ask.kind !== 'label') return nothing;
        const args = { tag: pathParts(ask.place), lang: ask.langName };
        return html`<p class="efs-label-says">
            ${
              r.text === undefined
                ? tRich(t, 'files.label.reviewRemove', args)
                : tRich(t, 'files.label.review', { ...args, name: labelParts(r.text) })
            }
          </p>
          <p class="efs-quiet efs-label-public">${t('files.label.public')}</p>`;
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
                    : ask?.kind === 'hide'
                      ? 'files.hide.title'
                      : ask?.kind === 'tag'
                        ? 'files.tag.title'
                        : ask?.kind === 'label'
                          ? 'files.label.title'
                          : ask?.kind === 'join'
                            ? ask.how === 'same'
                              ? 'files.join.sameTitle'
                              : 'files.join.underTitle'
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
          : ask?.kind === 'tag'
            ? t(title, { name: ask.names.join(', ') })
            : t(title);
    let body: unknown = nothing;
    if (open && ask) {
      switch (s.phase) {
        case 'naming':
          body = this.#naming(ask, s.value);
          break;
        case 'linking':
          if (ask.kind === 'upload') body = this.#linking(ask, s.name, s.locator);
          break;
        case 'picking':
          if (ask.kind === 'move') body = this.#picking(ask);
          else if (ask.kind === 'tag') body = this.#tagPicking(ask);
          else if (ask.kind === 'join') body = this.#joinPicking(ask);
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
                      author: r.author ? this.#who(r.author) : '—',
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
          const badLocator = s.code === 'BAD_LOCATOR';
          const message = noWallet
            ? t('files.save.connect')
            : intoItself
              ? t('files.move.intoSelf')
              : tooLarge
                ? t('files.upload.tooLarge')
                : badLocator
                  ? t('files.link.invalid')
                  : s.feeSchedule
                    ? t(feeScheduleCopy(s.feeSchedule).id, feeScheduleCopy(s.feeSchedule).values)
                    : t('files.save.planFailed', { code: s.code });
          // Too large for the chain, or an address the SDK refused: link it instead, or fix it.
          const relink =
            ask.kind === 'upload' && s.request.kind === 'createFile' && (tooLarge || badLocator)
              ? {
                  name: s.request.name,
                  locator: s.request.content instanceof Uint8Array ? '' : s.request.content.locator,
                }
              : undefined;
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
                : relink
                  ? html`<wa-button
                      slot="footer"
                      variant="brand"
                      class="efs-link-offer"
                      @click=${() => this.#startLinking(relink.name, relink.locator)}
                      >${t(badLocator ? 'files.link.fix' : 'files.link.offer')}</wa-button
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
          const answered = sending ? this.#answered.get() : undefined;
          const sent = s.sent;
          const { hold, lapsed } = this.#hold(s.request, s.writer, s.plan, sent?.sequenceId);
          const prompts = s.plan.review.prompts;
          const isRemove = ask.kind === 'remove';
          // Held back: which case it is, from the saves listed (and Send again once it may).
          const held =
            sent?.outcome.kind === 'held'
              ? this.#twinStanding(s.request, s.plan, sent.outcome.twin)
              : undefined;
          // Sent again (continued) only when the SDK says this same save can go as planned.
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
              ${this.#attachNotice(s.request, s.writer)}
              <p class="efs-review-prompts">
                ${approvalsLine(t, prompts)}
              </p>
              ${
                sending
                  ? html`<p class="wa-cluster wa-gap-xs" role="status">
                    <wa-spinner></wa-spinner>${
                      answered ? t(answered.id, answered.values) : t('review.sending')
                    }
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
                        : held
                          ? heldMessage(held, this.#onLocalChain())
                          : saveMessage(sent.outcome),
                      saveValues(sent.outcome, shortAccount, () => ''),
                    )}</p>
                    ${
                      (held === 'waiting' || held === 'unlisted') &&
                      sent.outcome.kind === 'held' &&
                      !sending
                        ? this.#checkAgain(s.writer, sent.outcome.twin, t)
                        : nothing
                    }
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
              class=${resplit ? 'efs-folder-not-now' : 'efs-folder-keep'}
              ?autofocus=${isRemove && !resplit}
              ?disabled=${sending}
              @click=${() => this.#close()}
              >${t(
                resplit
                  ? 'save.notNow'
                  : sent?.outcome.kind === 'damaged'
                    ? 'saves.discard'
                    : isRemove
                      ? 'files.remove.keep'
                      : 'review.cancel',
              )}</wa-button
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
                      .disabled=${live(sending || !canSendAgain || hold !== undefined)}
                      @click=${(e: Event) => {
                        if (s.phase === 'review' && this.#send(s)) pressedOnce(e);
                      }}
                      >${t(
                        resplit
                          ? 'saves.resplitContinue'
                          : sent
                            ? 'saves.sendAgain'
                            : isRemove
                              ? ask.kind === 'remove' && ask.hide
                                ? 'files.remove.blockYes'
                                : 'files.remove.yes'
                              : ask.kind === 'unhide'
                                ? 'files.unhide.yes'
                                : ask.kind === 'hide'
                                  ? 'files.hide.yes'
                                  : ask.kind === 'label'
                                    ? s.request.kind === 'label' && s.request.remove
                                      ? 'files.label.remove'
                                      : 'files.label.yes'
                                    : ask.kind === 'join'
                                      ? (s.request.kind === 'same' ||
                                          s.request.kind === 'broader') &&
                                        s.request.remove
                                        ? 'files.join.removeMine'
                                        : ask.how === 'same'
                                          ? 'files.join.sameYes'
                                          : 'files.join.underYes'
                                      : s.plan.review.kind === 'efs.tagReview'
                                        ? TAG_SEND[tagStance(s.plan.review)]
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
