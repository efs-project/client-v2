# ADR 0001: C0 foundation

**Status:** accepted for C0 (2026-09-26)
**Context:** the client-v2 initialization plan (rev 2) and the C0 slice, both in the planning vault under `Reviews/2026-09-26-client-v2-initialization-plan/`.

## Decision

- A pnpm workspace with two members: `apps/web` (static SPA) and `tools` (Node-only build checks and static server). No `packages/` until something has a second consumer.
- The guest path uses native custom elements and TC39 Signals (`signal-polyfill`, isolated in `src/state/signals.ts`). Lit and Web Awesome are reserved for lazy write/settings slices and are not installed in C0.
- TypeScript 7 typechecks only; Vite 8 bundles. Biome formats and lints. Vitest runs unit and source-rule tests in Node. Playwright tests the built artifact in Chromium, Firefox and WebKit.
- Messages are MF2, parsed and validated by `messageformat` 4 at build time and formatted by it at runtime, within a narrow contract (variables, `:number`/`:integer`/`:string`, `.match`).
- Every build writes `release.json` (hashes of every shipped file) and module provenance. The startup set, leak scan, license notices and byte-reproducibility are checked on the output, not the source.

## Consequences

- Features that aren't used yet (wallet, SDK, storage, Service Worker, manifest, link formats) have named seams and no code. See `docs/architecture.md`.
- `release.json` and `provenance.json` are experimental tool formats (`/0-experimental`), not public contracts.
- Follow-ups, named in the C0 slice: install-metadata timing (C2), CSP `connect-src` versus runtime RPC config (before C2), and PM confirmation of the browser floor.
