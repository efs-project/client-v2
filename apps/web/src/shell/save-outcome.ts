// What a save's result means to the person. Pure, so tested against every state and the SDK's
// real (code, retry) pairs.
//
// Copy rules (PM, 2026-11-24): never say "saved" before COMPLETE; "Saved · confirming" until
// final, then "Saved"; a reorg is "undone by the network" and re-sending is the person's choice;
// abandoning is not undo; a race with another author reads as "someone else changed it", never
// as the person's save failing; "nothing was sent" only when the SDK proves it.
//
// Order, as the PM's ledger says: the state, then reason.code, then reason.retry. Structured
// fields (`revert`, `wallet`) refine a code; `detail` is free text for logs and never decides.
// Continue is offered only when the same plan can go on: by code (a declined part, a wallet
// switched away) or, for codes this version doesn't name, by retry "transient"/"after-reconcile".

import type { Reason } from '@efs/sdk';
import type { SequenceProgress, WalletAnswerReason } from '@efs/sdk/actions';
import type { MessageId } from '../ui/i18n.ts';

export type SaveOutcome =
  | { readonly kind: 'saved' }
  | { readonly kind: 'confirming' }
  /** Some parts are on chain. `canContinue`: the same plan can finish ("Continue to finish"). */
  | {
      readonly kind: 'partial';
      readonly committed: number;
      readonly total: number;
      readonly canContinue: boolean;
    }
  /** The person declined part `part` (1-based) of a save already partly on chain. */
  | {
      readonly kind: 'declined';
      readonly committed: number;
      readonly total: number;
      readonly part: number;
    }
  /** Sent; the network hasn't answered yet (or the answer was lost). Settles by itself. */
  | { readonly kind: 'checking' }
  /** The wallet lost its connection mid-send: it may have relayed. Settles by itself. */
  | { readonly kind: 'wallet-lost' }
  /** A reorg took a committed part back and it was dropped. Sending again is the person's choice. */
  | { readonly kind: 'undone' }
  /** A reorg took a committed part back; it's in flight again and may still land. Settles itself. */
  | { readonly kind: 'undone-checking' }
  /**
   * Sent, but proven not committed before its deadline (EXPIRED). Nothing of it was saved;
   * `committed` > 0 means earlier parts are on chain. Send again (resume) is the person's click.
   */
  | {
      readonly kind: 'expired';
      readonly committed: number;
      readonly total: number;
    }
  /** Not started and no reason recorded (e.g. listed after a reload): it didn't go through. */
  | { readonly kind: 'not-through' }
  /** Declined in the wallet before anything was sent. */
  | { readonly kind: 'refused' }
  /**
   * The file changed after it was opened (an edit by the same account won the race). When some
   * parts were already sent (`committed` > 0) they stay on chain but won't appear as a file.
   */
  | { readonly kind: 'changed'; readonly committed: number }
  /** This plan can't be sent as prepared; `error` names the ledger's refusal when known. */
  | { readonly kind: 'stale'; readonly error?: string }
  /** The wallet moved to another account or network. Nothing was sent; switch back, Continue. */
  | {
      readonly kind: 'wallet-mismatch';
      readonly account?: string;
      readonly chainId?: number;
    }
  /**
   * Too large for one transaction (OVER_TX_GAS_CAP), after the SDK split what it can: what's left
   * is one file's content or one statement. `parts`: how many transactions it needs
   * (`reason.gas.suggestedParts`; absent on a save recorded by an older SDK). Never "failed".
   */
  | {
      readonly kind: 'too-large';
      readonly committed: number;
      readonly total: number;
      readonly parts?: number;
    }
  /**
   * The wallet can't cover the transaction's gas limit (INSUFFICIENT_FUNDS, sdk-v2 4043ce7). The
   * save stays in flight, and Send again sends the same plan again (sdk-v2 f1c5625), so it can
   * never land twice: after a top-up it goes at once. `gasLimit` is set for a single send, never
   * for a batch. A save is charged only the gas it uses: never say it costs `gasLimit`.
   */
  | { readonly kind: 'funds'; readonly gasLimit?: bigint }
  /**
   * Send again after a funds refusal, with under a minute left before the plan's deadline: the
   * same plan isn't sent again (IN_FLIGHT, ALREADY_ATTEMPTED, no twin). It waits until reconcile
   * proves it never went out (EXPIRED); then Send again plans it anew. Nothing to press meanwhile.
   */
  | { readonly kind: 'funds-late' }
  /**
   * The deployment document's fee schedule isn't this chain's (UNSUPPORTED_PROFILE with
   * `reason.feeSchedule`). Nothing was sent. `chain` is null for a schedule the SDK doesn't know.
   */
  | { readonly kind: 'fee-schedule'; readonly document: string; readonly chain: string | null }
  | { readonly kind: 'busy' }
  /** This browser won't keep the save journal (e.g. some private modes): saving is off here. */
  | { readonly kind: 'no-journal' }
  | { readonly kind: 'abandoned' }
  /** Not sent, for a reason this version doesn't name. Never shown as success. */
  | { readonly kind: 'not-sent'; readonly code: string; readonly canRetry: boolean }
  /**
   * A call threw, and the SDK says that call sent nothing, but earlier parts of the save may be on
   * chain (or it can't tell): "nothing new was sent", never "nothing was saved".
   */
  | { readonly kind: 'nothing-new' }
  /**
   * RESPLIT (sdk-v2 a03ba84): a part turned out too large for one transaction, and cutting it
   * needs more wallet approvals than the review said (`before`; `now`). Nothing more was sent,
   * and the save asks first: "This save now needs N approvals (it was M). Continue?" Continue
   * resumes; "Not now" leaves it, PARTIAL (`committed` of `total` saved) or not started, listed,
   * with Continue. `later`: the person said "Not now" (the caller's record, never the SDK's).
   */
  | {
      readonly kind: 'resplit';
      readonly committed: number;
      readonly total: number;
      readonly before?: number;
      readonly now?: number;
      readonly later?: boolean;
    }
  /**
   * The save's record doesn't match what it recorded (EfsFault INVARIANT, sdk-v2 a03ba84):
   * corrupted, or written by another version. Nothing was sent; never offered again (no retry
   * loop).
   */
  | { readonly kind: 'damaged' }
  /**
   * Held back (ALREADY_ATTEMPTED): the same publication is already on its way, an earlier attempt
   * (`twin`) still open or committed and not yet final. This call sent nothing, and the twin may
   * land or have landed, so never "nothing was saved". Whether it's the same save again or another
   * save of the same bytes is the caller's to tell (`twinStanding`, from the saves listed).
   */
  | {
      readonly kind: 'held';
      readonly committed: number;
      readonly total: number;
      readonly twin?: Twin;
    };

/** The earlier attempt a held-back save waits for (sdk-v2 31ee83a). */
export type Twin = NonNullable<NonNullable<SequenceProgress['reason']>['twin']>;

/** The ledger refused because the editor's own HEAD moved (compare-and-swap). */
const isCasRace = (reason: SequenceProgress['reason']): boolean =>
  reason?.revert?.error === 'E_CAS';

/** Every reason code the SDK names, without the open-ended `string` it also admits. */
type Named<T> = T extends string ? (string extends T ? never : T) : never;
export type KnownReasonCode = Named<NonNullable<Reason['code']>>;

/**
 * The codes a stopped save (PARTIAL or NOT_STARTED) has an outcome of its own for: the cases of
 * `saveOutcome`'s inner switch. Every other code the SDK names is said generically, by its retry
 * class (`otherwise`).
 */
export const OWN_STOP_CODES = [
  'REORGED',
  'REORGED_DROPPED',
  'EXPIRED',
  'JOURNAL_UNAVAILABLE',
  'WALLET_MISMATCH',
  'USER_REJECTED',
  'BUSY',
  'OVER_TX_GAS_CAP',
  'UNSUPPORTED_PROFILE',
  'ALREADY_ATTEMPTED',
  'STALE',
  'RESPLIT',
] as const satisfies readonly KnownReasonCode[];
type OwnStopCode = (typeof OWN_STOP_CODES)[number];

/**
 * Every other code the SDK names, said generically. Keyed by the SDK's own union, so a code a new
 * SDK adds is a type error until it is placed: here, or in OWN_STOP_CODES with a case of its own
 * (as RESPLIT was, sdk-v2 a03ba84).
 */
export const GENERIC_STOP_CODES: Readonly<Record<Exclude<KnownReasonCode, OwnStopCode>, true>> = {
  RPC_UNAVAILABLE: true,
  RPC_ERROR: true,
  CHAIN_MISMATCH: true,
  BASIS_STALE: true,
  LIMIT_EXCEEDED: true,
  NOT_VERIFIED_DEPLOYMENT: true,
  GATEWAY_UNAVAILABLE: true,
  DIGEST_MISMATCH: true,
  POLICY_BLOCKED: true,
  INVALID_RESUME_TOKEN: true,
  TOO_LARGE: true,
  WALLET_UNAUTHORIZED: true,
  WALLET_UNSUPPORTED: true,
  WALLET_INVALID_PARAMS: true,
  WALLET_DISCONNECTED: true,
  WALLET_CHAIN_DISCONNECTED: true,
  INSUFFICIENT_FUNDS: true,
  NOT_YET_DECIDABLE: true,
  BEHIND: true,
  // Named since sdk-v2 a61b2e8 (returned before): none has words of its own when a save stops.
  IN_FLIGHT: true,
  RESPONSE_LOST: true,
  ABORTED: true,
  CANCELLED: true,
  INVALID: true,
  NOT_IN_JOURNAL: true,
};

/**
 * Whether the same plan may go again (Continue, Send again), by the SDK's retry class, for codes
 * said generically. Keyed by the SDK's union, so a new class is a type error until decided.
 * `after-review` (RESPLIT) goes on only once the person has seen what changed: its own ask, never
 * an unexplained Continue.
 */
const SAME_AGAIN: Readonly<Record<Reason['retry'], boolean>> = {
  transient: true,
  'after-reconcile': true,
  'after-replan': false,
  'after-review': false,
  never: false,
};

/** The same plan may go again: the SDK says so for codes this version doesn't name. */
const sameAgain = (retry: string | undefined): boolean =>
  retry === undefined || (Object.hasOwn(SAME_AGAIN, retry) && SAME_AGAIN[retry as Reason['retry']]);

export function saveOutcome(p: SequenceProgress): SaveOutcome {
  const reason = p.reason;
  const code = reason?.code;
  // The state first, then the code. A reorg is always the network's doing: while its part is in
  // flight again it may still land (REORGED: the banner keeps checking); once it is proven
  // dropped, re-sending is the person's choice (REORGED_DROPPED: Send again, which resumes).
  switch (p.state) {
    case 'COMPLETE':
      return p.final ? { kind: 'saved' } : { kind: 'confirming' };
    case 'IN_FLIGHT':
      return code === 'REORGED'
        ? { kind: 'undone-checking' }
        : code === 'WALLET_DISCONNECTED' || code === 'WALLET_CHAIN_DISCONNECTED'
          ? { kind: 'wallet-lost' }
          : code === 'INSUFFICIENT_FUNDS'
            ? reason?.funds
              ? { kind: 'funds', gasLimit: reason.funds.gasLimit }
              : { kind: 'funds' }
            : code === 'ALREADY_ATTEMPTED' && !reason?.twin
              ? { kind: 'funds-late' }
              : { kind: 'checking' };
    case 'ABANDONED':
      return { kind: 'abandoned' };
    case 'PARTIAL':
    case 'NOT_STARTED': {
      const partial = p.state === 'PARTIAL';
      switch (code) {
        case 'REORGED':
        case 'REORGED_DROPPED':
          return { kind: 'undone' };
        case 'EXPIRED':
          return { kind: 'expired', committed: p.committed, total: p.total };
        case 'JOURNAL_UNAVAILABLE':
          return { kind: 'no-journal' };
        case 'WALLET_MISMATCH': {
          const expected = reason?.wallet?.expected;
          return expected
            ? { kind: 'wallet-mismatch', account: expected.account, chainId: expected.chainId }
            : { kind: 'wallet-mismatch' };
        }
        case 'USER_REJECTED':
          return partial
            ? { kind: 'declined', committed: p.committed, total: p.total, part: p.committed + 1 }
            : { kind: 'refused' };
        case 'BUSY':
          return { kind: 'busy' };
        case 'OVER_TX_GAS_CAP': {
          const parts = reason?.gas?.suggestedParts;
          return parts === undefined
            ? { kind: 'too-large', committed: p.committed, total: p.total }
            : { kind: 'too-large', committed: p.committed, total: p.total, parts };
        }
        case 'UNSUPPORTED_PROFILE': {
          // Named only when nothing of the save is on chain; a partial save is said as stuck.
          const fee = reason?.feeSchedule;
          if (fee && !partial) {
            return { kind: 'fee-schedule', document: fee.document, chain: fee.chain };
          }
          return otherwise(p, code, reason?.retry);
        }
        case 'ALREADY_ATTEMPTED': {
          const twin = reason?.twin;
          return twin
            ? { kind: 'held', committed: p.committed, total: p.total, twin }
            : { kind: 'held', committed: p.committed, total: p.total };
        }
        case 'RESPLIT': {
          const prompts = reason?.prompts;
          return {
            kind: 'resplit',
            committed: p.committed,
            total: p.total,
            ...(prompts ? { before: prompts.before, now: prompts.now } : {}),
          };
        }
        case 'STALE': {
          if (isCasRace(reason)) return { kind: 'changed', committed: p.committed };
          const error = reason?.revert?.error;
          return partial
            ? { kind: 'partial', committed: p.committed, total: p.total, canContinue: false }
            : error
              ? { kind: 'stale', error }
              : { kind: 'stale' };
        }
        case undefined:
          // No reason recorded: a partial save can go on; one not started didn't go through
          // (never sent, or sent and dropped): never "not sent", which it may not be.
          return partial
            ? { kind: 'partial', committed: p.committed, total: p.total, canContinue: true }
            : { kind: 'not-through' };
        default:
          return otherwise(p, code, reason?.retry);
      }
    }
    default:
      return { kind: 'not-sent', code: String(p.state), canRetry: false };
  }
}

/**
 * A save's outcome as this tab shows it: a RESPLIT ask the person answered "Not now" is said as
 * waiting, with Continue, and asks no more (`later`, the saves session's record of the answer).
 */
export function shownOutcome(p: SequenceProgress, later?: ReadonlySet<string>): SaveOutcome {
  const outcome = saveOutcome(p);
  return outcome.kind === 'resplit' && later?.has(p.sequenceId.toLowerCase())
    ? { ...outcome, later: true }
    : outcome;
}

/** A code this version doesn't name: partial saves continue, others retry, as `retry` says. */
function otherwise(p: SequenceProgress, code: string, retry: string | undefined): SaveOutcome {
  return p.state === 'PARTIAL'
    ? { kind: 'partial', committed: p.committed, total: p.total, canContinue: sameAgain(retry) }
    : { kind: 'not-sent', code, canRetry: sameAgain(retry) };
}

/**
 * What a "wallet-answer" progress event says while the save still checks the ledger (sdk-v2
 * f1c5625): the wallet or its node answered and the send may have gone out. Shown at once, in
 * place of "Approve in your wallet, then wait for the network…", before the settle wait (up to
 * 60 s) ends. Exactly the SDK's WALLET_ANSWER_CODES.
 */
export function answerCopy(reason: WalletAnswerReason): {
  readonly id: MessageId;
  readonly values: Record<string, string | number>;
} {
  switch (reason.code) {
    case 'INSUFFICIENT_FUNDS':
      return reason.funds
        ? { id: 'save.fundsChecking', values: { gasLimit: Number(reason.funds.gasLimit) } }
        : { id: 'save.fundsCheckingNoLimit', values: {} };
    case 'WALLET_DISCONNECTED':
    case 'WALLET_CHAIN_DISCONNECTED':
      return { id: 'save.walletLost', values: {} };
    default:
      // RESPONSE_LOST, and any code a later SDK adds to the list: it may have gone out.
      return { id: 'save.checking', values: {} };
  }
}

/** The copy that names both fee schedules (a send refused, or a plan that never was). */
export function feeScheduleCopy(fee: {
  readonly document: string;
  readonly chain: string | null;
}): {
  readonly id: MessageId;
  readonly values: Record<string, string>;
} {
  return fee.chain === null
    ? { id: 'save.feeScheduleUnknown', values: { document: fee.document } }
    : { id: 'save.feeSchedule', values: { document: fee.document, chain: fee.chain } };
}

/**
 * What a fault thrown out of runSequence/resume says about sending (sdk-v2 #32; absent on older
 * SDKs and on other faults, which then count as "may have sent").
 */
export interface ThrownSave {
  /** The save's record, once it exists (always for resume). */
  readonly sequenceId?: `0x${string}`;
  /** This call may have broadcast something. */
  readonly mayHaveSent?: boolean;
  /** Some part of this save may be on chain, from this call or an earlier one. */
  readonly sequenceMayHaveSent?: boolean;
}

/** An SDK fault thrown (not returned) with this code, e.g. JOURNAL_UNAVAILABLE on a first save. */
export function isFault(error: unknown, code: string): boolean {
  // Matched by name, not instanceof: the shell keeps the SDK's runtime out of its startup code.
  return (
    error instanceof Error &&
    error.name === 'EfsFault' &&
    (error as Error & { code?: unknown }).code === code
  );
}

export const SAVE_MESSAGE: Readonly<Record<SaveOutcome['kind'], MessageId>> = {
  saved: 'save.saved',
  confirming: 'save.confirming',
  partial: 'save.partial',
  declined: 'save.declinedPart',
  checking: 'save.checking',
  'wallet-lost': 'save.walletLost',
  undone: 'save.undone',
  'undone-checking': 'save.undoneChecking',
  expired: 'save.expired',
  'not-through': 'save.notThrough',
  refused: 'save.refused',
  changed: 'save.changed',
  stale: 'save.stale',
  'wallet-mismatch': 'save.walletMismatch',
  'too-large': 'save.tooLarge',
  funds: 'save.funds',
  'funds-late': 'save.fundsLate',
  'fee-schedule': 'save.feeSchedule',
  busy: 'save.busy',
  'no-journal': 'save.noJournal',
  abandoned: 'save.abandoned',
  'not-sent': 'save.notSent',
  'nothing-new': 'save.nothingNew',
  held: 'save.held',
  resplit: 'save.resplit',
  damaged: 'save.damaged',
};

/** The message for an outcome, with the detail some outcomes add. */
export function saveMessage(o: SaveOutcome): MessageId {
  if (o.kind === 'changed' && o.committed > 0) return 'save.changedPartly';
  if (o.kind === 'partial' && !o.canContinue) return 'save.partialStuck';
  if (o.kind === 'stale' && o.error) return 'save.refusedByLedger';
  if (o.kind === 'wallet-mismatch' && o.account) return 'save.walletMismatchTo';
  if (o.kind === 'expired' && o.committed > 0) return 'save.expiredPart';
  if (o.kind === 'too-large') {
    if (o.committed > 0)
      return o.parts === undefined ? 'save.partialStuck' : 'save.tooLargeSplitPart';
    return o.parts === undefined ? 'save.tooLarge' : 'save.tooLargeSplit';
  }
  if (o.kind === 'funds' && o.gasLimit === undefined) return 'save.fundsNoLimit';
  if (o.kind === 'fee-schedule') return feeScheduleCopy(o).id;
  if (o.kind === 'resplit') {
    // Put off: a partial save is said as partial; one not started says it's waiting.
    if (o.later) return o.committed > 0 ? 'save.partial' : 'save.resplitLater';
    return o.now === undefined || o.before === undefined ? 'save.resplitMore' : 'save.resplit';
  }
  return SAVE_MESSAGE[o.kind];
}

/** The values the outcome's message names (chain names resolved by the caller). */
export function saveValues(
  o: SaveOutcome,
  shortAccount: (a: string) => string,
  chainName: (id: number) => string,
): Record<string, string | number> {
  switch (o.kind) {
    case 'partial':
      return { committed: o.committed, total: o.total };
    case 'declined':
      return { committed: o.committed, total: o.total, part: o.part };
    case 'expired':
      return { committed: o.committed, total: o.total, part: o.committed + 1 };
    case 'stale':
      return o.error ? { error: o.error } : {};
    case 'too-large':
      return {
        committed: o.committed,
        total: o.total,
        part: o.committed + 1,
        ...(o.parts === undefined ? {} : { parts: o.parts }),
      };
    case 'funds':
      // A gas limit, in gas (never a price): it fits a double exactly.
      return o.gasLimit === undefined ? {} : { gasLimit: Number(o.gasLimit) };
    case 'fee-schedule':
      return feeScheduleCopy(o).values;
    case 'resplit':
      return {
        committed: o.committed,
        total: o.total,
        ...(o.now === undefined ? {} : { now: o.now }),
        ...(o.before === undefined ? {} : { before: o.before }),
      };
    case 'wallet-mismatch':
      return o.account
        ? {
            account: shortAccount(o.account),
            chain: o.chainId === undefined ? '' : chainName(o.chainId),
          }
        : {};
    default:
      return {};
  }
}

export type SaveAction = 'continue' | 'send-again' | 'reopen' | 'retry' | 'abandon';

/** What the person can do next: finish, re-send, edit again, or stop offering to continue. */
export function saveAction(o: SaveOutcome): SaveAction | undefined {
  switch (o.kind) {
    case 'partial':
      return o.canContinue ? 'continue' : 'abandon';
    case 'declined':
    case 'wallet-mismatch':
    case 'resplit':
      return 'continue';
    case 'undone':
    case 'expired':
    case 'not-through':
    case 'funds':
      return 'send-again';
    case 'changed':
    case 'stale':
      return 'reopen';
    case 'refused':
    case 'busy':
    case 'nothing-new':
      return 'retry';
    case 'not-sent':
      return o.canRetry ? 'retry' : undefined;
    default:
      return undefined;
  }
}

/** What the editor does when runSequence/resume throws instead of returning progress. */
export type ThrownOutcome =
  /** It may have been sent: "We couldn't confirm this save yet", re-read, hold new sends. */
  | {
      readonly kind: 'unconfirmed';
      readonly noJournal: boolean;
      /** The save's record, when the SDK says it exists: the hold lasts until a check finds it. */
      readonly sequenceId?: `0x${string}`;
    }
  /** This call sent nothing: the same save is offered again (continued when its record exists). */
  | { readonly kind: 'again'; readonly outcome: SaveOutcome; readonly sequenceId?: `0x${string}` };

/**
 * Reads a thrown fault (sdk-v2 #32). Only `mayHaveSent === false` proves this call sent nothing;
 * "nothing was saved" additionally needs `sequenceMayHaveSent === false` (a resumed save can have
 * earlier parts on chain). Anything else, including errors that aren't SDK faults, may have sent.
 */
export function thrownOutcome(error: unknown): ThrownOutcome {
  const noJournal = isFault(error, 'JOURNAL_UNAVAILABLE');
  const fault =
    error instanceof Error && error.name === 'EfsFault' ? (error as Error & ThrownSave) : undefined;

  if (fault?.mayHaveSent !== false) {
    return fault?.sequenceId
      ? { kind: 'unconfirmed', noJournal, sequenceId: fault.sequenceId }
      : { kind: 'unconfirmed', noJournal };
  }
  // A plan or a save record that isn't what it recorded (RECORD_DAMAGED, sdk-v2 a61b2e8: an
  // altered plan, a resume whose parts don't hash to the recorded ones, a funds resend's stored
  // plan): nothing was sent, and the same record can't go as it stands, so it's said as damaged,
  // with Discard and never Send again. Every other fault, INVARIANT included, is as before.
  if (isFault(error, 'RECORD_DAMAGED')) {
    return fault.sequenceId
      ? { kind: 'again', outcome: { kind: 'damaged' }, sequenceId: fault.sequenceId }
      : { kind: 'again', outcome: { kind: 'damaged' } };
  }
  const code = (fault as { code?: unknown }).code;
  const outcome: SaveOutcome = noJournal
    ? { kind: 'no-journal' }
    : fault.sequenceMayHaveSent === false
      ? { kind: 'not-sent', code: typeof code === 'string' ? code : 'FAULT', canRetry: true }
      : { kind: 'nothing-new' };
  return fault.sequenceId
    ? { kind: 'again', outcome, sequenceId: fault.sequenceId }
    : { kind: 'again', outcome };
}
