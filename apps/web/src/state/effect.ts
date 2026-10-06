import type { OwnerScope } from '../platform/scope.ts';
import { Signal } from './signals.ts';

/**
 * Runs `fn` now and again (on a microtask) whenever a signal it read changes,
 * until `scope` is disposed. Effects are the only place signal reads may cause
 * side effects such as DOM writes.
 */
export function effect(scope: OwnerScope, fn: () => void): void {
  if (scope.signal.aborted) return;
  const computation = new Signal.Computed(() => {
    fn();
  });
  let scheduled = false;
  const watcher = new Signal.subtle.Watcher(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (scope.signal.aborted) return;
      computation.get();
      watcher.watch();
    });
  });
  watcher.watch(computation);
  computation.get();
  scope.defer(() => watcher.unwatch(computation));
}
