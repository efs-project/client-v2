# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-e229ea3.tgz` | efs-project/sdk-v2 main `e229ea39a9364c367cf27af9250ceeeff0eeaf09`: a replay whose head moves only with what moved it (`@efs/sdk/testing` createRecorder / createReplay: one sequence for RPC calls, wallet calls and marks; reads served from the current epoch; writes and marks strict; `extraReads` counted), one kinds vocabulary (VIEW_KINDS / ViewKind across listFolder, topicItems and topicItemsMerged; an unknown kind is MISUSE), the interim word fold as the default (foldWord, FOLD_RULE `efs-sdk/fold/interim-ascii-1`: an all-ASCII word is trimmed, white space and underscores become one `_`, A–Z become a–z; planners, topic reads and parseLink), and the write guard (checkStableWord: a write adding a statement refuses a non-ASCII word a ruling could change, MISUSE `unstable-until-ruled`). No new round trips. Over 31ee83a (the reader frontier, contracts-v2 `cbf5b78`, and one publication, one wallet request). Earlier: 2fec7e2, f631922, d5e08cb, 97a257a, 983d70b, 13a733d, 7fe5e95, db9dc26, ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent builds (sha512 `vZoY3Nay…OCmbQ==`) | `57c18379f6d1b20e29d65aae0549d65ad5a3ed8f699d97d7b875e9c64d508ab2` |
| `efs-fixture-0.0.0-31ee83a.tgz` | `@efs/fixture` from sdk-v2 main `31ee83a` (unchanged at e229ea3) (contracts-v2 `cbf5b78`, the reader frontier: a new deployment), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `gFmGqdw+…iztQyQ==`) | `ee24d63a061c40d2b8cc2aa3e0e8463857f51b97e68132ffbdbec6e552c12251` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
