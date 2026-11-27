import { describe, expect, it } from 'vitest';
import { CatchUpRetry, type CatchUpSource } from './catch-up.ts';

/** The SDK's signal as a test drives it: `fire()` calls every listener once (one-shot). */
function signal() {
  let listeners: (() => void)[] = [];
  let unsubscribed = 0;
  const source: CatchUpSource = {
    onCaughtUp: (listener) => {
      const l = () => listener({ policy: 'latest', at: null } as never);
      listeners.push(l);
      return () => {
        unsubscribed++;
        listeners = listeners.filter((x) => x !== l);
      };
    },
  };
  return {
    source,
    fire() {
      const now = listeners;
      listeners = [];
      for (const l of now) l();
    },
    get listening() {
      return listeners.length;
    },
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

describe('CatchUpRetry: one re-read by itself after BEHIND', () => {
  it('waits for the catch-up, then reads again once; BEHIND again, it waits no more', () => {
    const s = signal();
    const retry = new CatchUpRetry();
    let reads = 0;
    const read = () => {
      reads++;
      retry.reading();
    };
    read();
    retry.behind(s.source, read);
    expect(s.listening).toBe(1);
    expect(reads).toBe(1);
    s.fire();
    expect(reads).toBe(2);
    // The re-read is BEHIND again: no second wait by itself.
    retry.behind(s.source, read);
    expect(s.listening).toBe(0);
    s.fire();
    expect(reads).toBe(2);
  });

  it("the person's own read (Try again) gives the allowance back", () => {
    const s = signal();
    const retry = new CatchUpRetry();
    let reads = 0;
    const read = () => {
      reads++;
      retry.reading();
    };
    read();
    retry.behind(s.source, read);
    s.fire();
    retry.behind(s.source, read); // BEHIND again: no wait
    read(); // Try again
    retry.behind(s.source, read); // BEHIND once more: it may wait again
    expect(s.listening).toBe(1);
    s.fire();
    expect(reads).toBe(4);
  });

  it('a new read, or leaving, drops the wait without reading', () => {
    const s = signal();
    const retry = new CatchUpRetry();
    let reads = 0;
    const read = () => {
      reads++;
      retry.reading();
    };
    read();
    retry.behind(s.source, read);
    read(); // something else read the view: the wait goes
    expect(s.listening).toBe(0);
    expect(s.unsubscribed).toBe(1);
    retry.behind(s.source, read);
    retry.reset(); // another file, or unmount
    expect(retry.waiting).toBe(false);
    s.fire();
    expect(reads).toBe(2);
  });
});
