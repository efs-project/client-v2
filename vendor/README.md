# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-78464e9.tgz` | efs-project/sdk-v2 main `78464e9a02e136cab4531bfd3d952e1593b35ac9` (#34: `progress.current.deadline`, `checkedAt`, fail-closed `pastDeadline`; optional `Basis.timestamp`; an unknown resume reports `sequenceMayHaveSent`. #33 (57f76f0, sha256 `708847a3…7880`, confirmed by the SDK dev): `effect`, EXPIRED, NOT_SENT only for refusals before signing. Earlier: #32, #31, #30; contracts `07818d1`), packed with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build | `1198607d02ad00fe6f8bf9be05c292b94e6e96bf1fde1afcd7700e65aeb0e270` |
| `efs-fixture-0.0.0-88bfc0c.tgz` | `@efs/fixture` from sdk-v2 main `88bfc0c` (byte-identical at `78464e9`) (node-only; `startFixtureChain` over the vendored contracts fixture, contracts `07818d1`), for the live-chain e2e job only; never bundled | `2296fa1c8414670114c70c47309fd1d2afe50023f067f06cef3888c7c6d887b8` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
