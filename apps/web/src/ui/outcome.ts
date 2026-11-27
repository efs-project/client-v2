// How qualified results look to a person. The SDK's status unions are open (new members may
// arrive), so every lookup has an explicit "unrecognized" fallback that is never rendered as
// success, as empty or as absent: silent absence is the bug class this file exists to prevent.

import type { MessageId } from './i18n.ts';

export type Tone = 'success' | 'neutral' | 'warning' | 'danger';

export interface OutcomeView {
  readonly tone: Tone;
  readonly message: MessageId;
  /** Shown beside the message for an Inspector; the raw code is never translated. */
  readonly code: string;
  /** The result's reason code (BEHIND, RPC_FAILED…), shown with the code when the result has one. */
  readonly reason?: string;
  /** Whether a retry button makes sense, and of which kind. */
  readonly retry?: 'transient' | 'after-reconcile' | 'after-replan';
}

type Table = Readonly<Record<string, Omit<OutcomeView, 'code'>>>;

const UNRECOGNIZED: Omit<OutcomeView, 'code'> = {
  tone: 'warning',
  message: 'outcome.unrecognized',
};

/** Read results: a point lookup or a resolve. */
const READ: Table = {
  PRESENT: { tone: 'success', message: 'outcome.read.present' },
  ABSENT_PROVEN: { tone: 'neutral', message: 'outcome.read.absentProven' },
  MASKED: { tone: 'neutral', message: 'outcome.read.masked' },
  CONFLICT: { tone: 'warning', message: 'outcome.read.conflict' },
  UNKNOWN: { tone: 'warning', message: 'outcome.read.unknown', retry: 'transient' },
  INVALID: { tone: 'danger', message: 'outcome.read.invalid' },
  BASIS_STALE: { tone: 'warning', message: 'outcome.read.basisStale', retry: 'transient' },
  UNSUPPORTED: { tone: 'neutral', message: 'outcome.read.unsupported' },
  LIMIT_EXCEEDED: { tone: 'warning', message: 'outcome.read.limitExceeded' },
};

/** Listing coverage: how much of a collection the page proves. */
const COVERAGE: Table = {
  COMPLETE: { tone: 'success', message: 'outcome.coverage.complete' },
  PARTIAL: { tone: 'neutral', message: 'outcome.coverage.partial' },
  UNKNOWN: { tone: 'warning', message: 'outcome.coverage.unknown', retry: 'transient' },
};

/** Byte reads: whether the bytes shown are the committed bytes. */
const BYTES: Table = {
  VERIFIED: { tone: 'success', message: 'outcome.bytes.verified' },
  UNVERIFIED_RANGE: { tone: 'warning', message: 'outcome.bytes.unverifiedRange' },
  MISMATCH: { tone: 'danger', message: 'outcome.bytes.mismatch' },
  UNAVAILABLE: { tone: 'warning', message: 'outcome.bytes.unavailable', retry: 'transient' },
  UNSUPPORTED_LOCATOR: { tone: 'neutral', message: 'outcome.bytes.unsupportedLocator' },
  POLICY_BLOCKED: { tone: 'neutral', message: 'outcome.bytes.policyBlocked' },
  UNKNOWN: { tone: 'warning', message: 'outcome.bytes.unknown', retry: 'transient' },
};

/** Write submission and reconciliation. Only COMMITTED is ever shown as done. */
const WRITE: Table = {
  SUBMITTED: { tone: 'neutral', message: 'outcome.write.submitted' },
  NOT_SENT: { tone: 'neutral', message: 'outcome.write.notSent' },
  AMBIGUOUS: { tone: 'warning', message: 'outcome.write.ambiguous', retry: 'after-reconcile' },
  STALE: { tone: 'warning', message: 'outcome.write.stale', retry: 'after-replan' },
  BUSY: { tone: 'neutral', message: 'outcome.write.busy' },
  COMMITTED: { tone: 'success', message: 'outcome.write.committed' },
  NOT_COMMITTED_PROVEN: { tone: 'neutral', message: 'outcome.write.notCommitted' },
  UNKNOWN: { tone: 'warning', message: 'outcome.write.unknown', retry: 'after-reconcile' },
};

/** Deployment pin: is this the contract set the configuration says it is? */
const PIN: Table = {
  VERIFIED: { tone: 'success', message: 'outcome.pin.verified' },
  MISMATCH: { tone: 'danger', message: 'outcome.pin.mismatch' },
  UNKNOWN: { tone: 'warning', message: 'outcome.pin.unknown', retry: 'transient' },
};

const TABLES = { read: READ, coverage: COVERAGE, bytes: BYTES, write: WRITE, pin: PIN } as const;
export type OutcomeKind = keyof typeof TABLES;

/**
 * UNKNOWN with reason BEHIND (sdk-v2 7db4417, the read floor): every endpoint is behind a block
 * this client already read, so the SDK refused to answer from older state rather than show what
 * was there before the person's own save. It is transient: the endpoint catches up.
 */
const BEHIND: Omit<OutcomeView, 'code'> = {
  tone: 'warning',
  message: 'outcome.behind',
  retry: 'transient',
};

/**
 * INVALID with reason LENS_TOO_WIDE (the client's own reason, `object-kind.ts` ownPlace): a file's
 * own place ("you, then its creator, then that Lens") would name more than 64 accounts, which the
 * SDK refuses (sdk-v2 bdcbe6e). Never a crash, never "not present"; retrying can't change it.
 */
export const LENS_TOO_WIDE = 'LENS_TOO_WIDE';
const LENS_TOO_WIDE_VIEW: Omit<OutcomeView, 'code'> = {
  tone: 'warning',
  message: 'outcome.lensTooWide',
};

export function describeOutcome(kind: OutcomeKind, code: string, reason?: string): OutcomeView {
  const known = Object.hasOwn(TABLES[kind], code) ? TABLES[kind][code] : undefined;
  const view =
    code === 'UNKNOWN' && reason === 'BEHIND'
      ? BEHIND
      : code === 'INVALID' && reason === LENS_TOO_WIDE
        ? LENS_TOO_WIDE_VIEW
        : (known ?? UNRECOGNIZED);
  return { ...view, code, ...(reason ? { reason } : {}) };
}

/**
 * The words shown: a surface's own copy for a plain UNKNOWN ("Other names for this tag can't be
 * read right now"), else the table's. Never over BEHIND, which says what is actually wrong.
 */
export function shownMessage(view: OutcomeView, unknownMessage?: MessageId): MessageId {
  return unknownMessage && view.code === 'UNKNOWN' && view.message !== BEHIND.message
    ? unknownMessage
    : view.message;
}

export type OutcomeAction = 'retry' | 'startOver';

/**
 * The buttons an outcome offers. Try again for a transient status the host can retry. "Start over"
 * only for BEHIND on a local test chain (`canReset`): a reset or restarted chain is shorter than
 * the floor and stays BEHIND, so the floor is forgotten there. Never on a live chain, where a
 * stuck endpoint would then serve old reads again (the SDK's rule).
 */
export function outcomeActions(
  view: OutcomeView,
  options: { readonly retryable: boolean; readonly canReset: boolean },
): OutcomeAction[] {
  const actions: OutcomeAction[] = [];
  if (options.retryable && view.retry === 'transient') actions.push('retry');
  if (options.retryable && options.canReset && view.message === 'outcome.behind') {
    actions.push('startOver');
  }
  return actions;
}

/** Every message id the tables can produce, so the catalog check can prove none is missing. */
export function outcomeMessageIds(): MessageId[] {
  const ids = new Set<MessageId>([
    UNRECOGNIZED.message,
    BEHIND.message,
    LENS_TOO_WIDE_VIEW.message,
  ]);
  for (const table of Object.values(TABLES))
    for (const view of Object.values(table)) ids.add(view.message);
  return [...ids];
}
