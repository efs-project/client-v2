import { describe, expect, it } from 'vitest';
import { createScope } from '../platform/scope.ts';
import { effect } from './effect.ts';
import { state } from './signals.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('effect', () => {
  it('reruns on change and stops after its scope is disposed', async () => {
    const scope = createScope();
    const count = state(0);
    const seen: number[] = [];
    effect(scope, () => seen.push(count.get()));
    count.set(1);
    await tick();
    count.set(2);
    await tick();
    scope.dispose();
    count.set(3);
    await tick();
    expect(seen).toEqual([0, 1, 2]);
  });
});
