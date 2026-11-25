# Vendored packages

Until the EFS SDK has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-f8fa9a6.tgz` | efs-project/sdk-v2 main `f8fa9a600fe4b853a2ac992cd9577a13fd7bf1fd` (contracts b645b61, the efs2 → efs rename; adds planEditFile), packed with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build | `d333d0e6b8afc67dbd74f22b93cb218754fba352ab5af93e6a35c1909f560d42` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
