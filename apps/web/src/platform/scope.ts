/**
 * Owns everything a route, session or element starts: listeners, effects,
 * requests. Disposal runs cleanups in reverse order and aborts `signal`, so
 * late completions can check it before touching released resources.
 */
export interface OwnerScope {
  readonly signal: AbortSignal;
  child(): OwnerScope;
  defer(cleanup: () => void): void;
  dispose(): void;
}

export function createScope(parent?: AbortSignal): OwnerScope {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  const cleanups: Array<() => void> = [];
  let disposed = false;
  const onParentAbort = () => scope.dispose();

  const scope: OwnerScope = {
    signal,
    child() {
      const child = createScope(signal);
      scope.defer(() => child.dispose());
      return child;
    },
    defer(cleanup) {
      if (disposed) cleanup();
      else cleanups.push(cleanup);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      parent?.removeEventListener('abort', onParentAbort);
      controller.abort();
      const errors: unknown[] = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      cleanups.length = 0;
      if (errors.length > 0) throw new AggregateError(errors, 'scope cleanup failed');
    },
  };
  if (parent?.aborted) scope.dispose();
  else parent?.addEventListener('abort', onParentAbort, { once: true });
  return scope;
}
