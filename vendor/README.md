# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-a6bf367.tgz` | efs-project/sdk-v2 main `a6bf36766b5a2066f2e73cce93ed50e2c23f6eb3` (merge of fix/head-law-object-transcripts, PM-reviewed `89145bf`; contracts `cc59d0c`, seed/4: the HEAD law (a HEAD bound to another file's revision opens INVALID, never as that file's bytes; planEditFile on it is UNKNOWN), RPC fixtures re-recorded openObject-first (plus `open-folder`; the edit transcripts now include planEditFile's base read). Since c8ed37a also: `listRemoved` (1878e4f) and restore's `alsoPlaced` (f976b25). Earlier: c8ed37a (folder records, `openObject`, the link grammar), 74a4d5e (folder operations), #38 (e28a31e)), packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `dHAl7fob…R0+gFQ==`) | `c9b5d4999af48d65a9ebefdf937273c3f2f3d2c1ec8c8804f640a1df27d8eaab` |
| `efs-fixture-0.0.0-c8ed37a.tgz` | `@efs/fixture` from efs-project/sdk-v2 main `c8ed37a54a5a408b261fa3e2a9cac3481aaa6972` (contracts `cc59d0c`, seed `efs-fixture-seed/4`), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `nsDu7hAn…GacnwQ==`) | `7c68700cb81b794602960814970c121aa5043768dde2aa53337e736ff38cdc1f` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
