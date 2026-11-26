// User Timing marks. For the time budgets (tests/e2e/budgets.spec.ts, docs/design/shell.md) each
// is set once per page load, the first time its moment comes, so a later re-read never moves it.
// `efs:send` is set at every send a control starts: the write tests count them.

/** Marks `name` unless it was already marked in this page load. */
export function markOnce(name: string): void {
  if (performance.getEntriesByName(name, 'mark').length === 0) performance.mark(name);
}

/** Marks `name` each time (counted by the tests, never timed). */
export function markEach(name: string): void {
  performance.mark(name);
}
