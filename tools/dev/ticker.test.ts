import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBlockTicker } from './ticker.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('startBlockTicker', () => {
  it('mines one empty block a second, skips a tick while one is unanswered, and stops', async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    let answer: (() => void) | undefined;
    const post = vi.fn((_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Promise<void>((resolve) => {
        answer = resolve;
      });
    });
    const stop = startBlockTicker('http://127.0.0.1:8545', { post });
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toMatchObject({ method: 'evm_mine', params: [] });
    // Still unanswered: the next tick is skipped, never queued.
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(1);
    answer?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
    stop();
    answer?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('keeps ticking after a failed request (the chain stopping)', async () => {
    vi.useFakeTimers();
    const post = vi.fn(() => Promise.reject(new Error('connection refused')));
    const stop = startBlockTicker('http://127.0.0.1:8545', { post });
    await vi.advanceTimersByTimeAsync(3000);
    expect(post).toHaveBeenCalledTimes(3);
    stop();
  });
});
