# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-59b0e20.tgz` | efs-project/sdk-v2 main `59b0e20cff64a34288ad94bd05ce8f4c47774c0d` (adds the edit-flow transcripts and `replayProvider`), packed with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build | `8ca2b7984ea19661396aaddedf109cbe8b143e118dbc854cfcb016625b7c4669` |
| `efs-fixture-0.0.0-59b0e20.tgz` | the same commit's `@efs/fixture` (node-only; `startFixtureChain` over the vendored contracts fixture, contracts `b645b61`), for the live-chain e2e job only; never bundled | `6fbf5e324c2f779356fe85a3c8ebebb218f5f0a5e0f4590082941efde51f2edb` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
