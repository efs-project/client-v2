// User Timing marks for the time budgets (tests/e2e/budgets.spec.ts, docs/design/shell.md): each
// is set once per page load, the first time its moment comes, so a later re-read never moves it.

/** Marks `name` unless it was already marked in this page load. */
export function markOnce(name: string): void {
  if (performance.getEntriesByName(name, 'mark').length === 0) performance.mark(name);
}
