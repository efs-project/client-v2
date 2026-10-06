import { describe, expect, it } from 'vitest';
import { createScope } from './scope.ts';

describe('OwnerScope', () => {
  it('runs cleanups in reverse order once and aborts its signal', () => {
    const scope = createScope();
    const order: number[] = [];
    scope.defer(() => order.push(1));
    scope.defer(() => order.push(2));
    scope.dispose();
    scope.dispose();
    expect(order).toEqual([2, 1]);
    expect(scope.signal.aborted).toBe(true);
  });

  it('disposes children with the parent and runs late cleanups immediately', () => {
    const parent = createScope();
    const child = parent.child();
    let childCleaned = false;
    child.defer(() => {
      childCleaned = true;
    });
    parent.dispose();
    expect(childCleaned).toBe(true);
    expect(child.signal.aborted).toBe(true);
    let late = false;
    child.defer(() => {
      late = true;
    });
    expect(late).toBe(true);
  });
});
