// A view that shows UNKNOWN BEHIND reads itself again once (PM, 2026-11-27): it waits on the SDK's
// catch-up signal (efs.onCaughtUp, sdk-v2 a61b2e8), which fires when a read, reconcile or save step
// in this client is next served at or above the read floor, then reads again. No polling: the SDK
// reads nothing for the signal, so if nothing in the page reads, Try again stays the way out.
// At most one re-read by itself: if that one is BEHIND again, the next is the person's (Try again,
// or anything else that reads the view), which gives the allowance back.

import type { Efs } from '@efs/sdk';

/** Just the SDK's catch-up signal: tests answer it themselves. */
export type CatchUpSource = Pick<Efs, 'onCaughtUp'>;

export class CatchUpRetry {
  #unsubscribe: (() => void) | undefined;
  /** This view already read itself again since the person (or anything else) last read it. */
  #retried = false;
  /** The read now starting is this retry's own. */
  #bySelf = false;

  /** At the start of every read of the view: drops a wait; a read not made by the retry gives the allowance back. */
  reading(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    if (!this.#bySelf) this.#retried = false;
    this.#bySelf = false;
  }

  /** After a read that ended BEHIND: wait for the catch-up, then call `again` once. */
  behind(efs: CatchUpSource, again: () => void): void {
    if (this.#retried) return;
    this.#unsubscribe?.();
    this.#unsubscribe = efs.onCaughtUp(() => {
      this.#unsubscribe = undefined;
      this.#retried = true;
      this.#bySelf = true;
      again();
    });
  }

  /** Whether a wait is open (for tests). */
  get waiting(): boolean {
    return this.#unsubscribe !== undefined;
  }

  /** The view is gone, or shows something else: drop any wait, and give the allowance back. */
  reset(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#retried = false;
    this.#bySelf = false;
  }
}
