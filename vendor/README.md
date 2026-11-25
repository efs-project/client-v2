# Vendored packages

Until the EFS SDK has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-445aca5.tgz` | efs-project/sdk-v2 main `445aca519cd36d4dd19e3127d8cca7cbfa4f9bbe` (#20: cache hardening), packed with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build | `fde589a6be691fff9cf8e7e4b6c4281145b42a9f47f84f7d8b7a5f45f3cf5e28` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
