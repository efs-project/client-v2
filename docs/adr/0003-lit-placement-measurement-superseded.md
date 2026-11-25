# ADR 0003: The Lit-versus-native placement measurement is superseded

**Status:** accepted (integration owner, 2026-11-25).
**Supersedes:** the init plan's §4.3 measurement ("build the folder row/list both ways: native vs Lit with `@lit-labs/signals`… adopt Lit on the guest path only if…") and C4's "ADR on Lit placement".

## Decision

The measurement is not run. James's direction of 2026-11-24 (planning `Decisions.md`) makes Web Awesome + Lit + TC39 Signals the client's whole UI foundation, guest path included. That removes the question the measurement existed to answer. ADR 0002 records how the client applies the direction. The safety intent the measurement served (a guest boot that stays small and keeps working) is kept by:
- the failing 250 KiB brotli startup gate;
- the startup and Preview time budgets (`tests/e2e/budgets.spec.ts`);
- the native boot frame and the static unsupported/load-error fallback.

## Consequences

- No native-versus-Lit fixture is built for the folder list. If listings later show a measured cost that a native row would avoid, that is a new decision with its own evidence, not this one reopened.
