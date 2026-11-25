# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-e28a31e.tgz` | efs-project/sdk-v2 main `e28a31eef2025be0cf135b80ef18cf145515e7c9` (#38: media types, contracts C4; `OpenedFile.mediaType` (a hint), `planEditFile({ mediaType })` replacing `media`, `review.mediaType`, a small typed file stored as a chunk, `normalizeMediaType`; one re-vendor at contracts `e90c7d8`, covering #9 and #10: new Type ids for files-content/1, files-external/1, files-root/1 and files-child/1, new reader and gateway addresses. Earlier: #34 (78464e9), #33, #32, #31, #30), packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `K2paDTrL…rK5bQ==`) | `ddbf2e21dfde4b7386259075a338fa1320da31474bc04a9ea6de651613dd00a0` |
| `efs-fixture-0.0.0-e28a31e.tgz` | `@efs/fixture` from efs-project/sdk-v2 main `e28a31eef2025be0cf135b80ef18cf145515e7c9` (contracts `e90c7d8`, seed `efs-fixture-seed/3`; still `startFixtureChain({ chainId, name })` and `stopFixtureChain({ name, home })` from #35), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `gDhMgXpY…ZhY4lA==`) | `01b33886f9c6469915734583448ec266d242e89178bed3e4bec0e8eda7bd113e` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
