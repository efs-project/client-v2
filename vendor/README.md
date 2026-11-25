# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-ff3ebe8.tgz` | efs-project/sdk-v2 main `ff3ebe8065ce94c113d2f2a9ab2a5d01114c2136` (contracts `cc59d0c`, seed/4: runSequence packs parts into one wallet batch only while their summed gas fits one transaction, and a failed batch shrinks that save's later batches; `review.prompts.atomicBatch` is a number (the real count on an atomic wallet); EIP-5792 pre-send refusals are NOT_SENT with named reasons; `SequenceProgress.mode`. Earlier: fd3db9b (openObject in one batch, FILE with open UNKNOWN), a6bf367, c8ed37a, 74a4d5e, #38), packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `p/s3H5rq…X90NHjH0sXDwIhV9A==`) | `dbf8ce6c42a203f62ca28200bd69b16bf231b65f1b8ed79aa86ceb68cd249733` |
| `efs-fixture-0.0.0-c8ed37a.tgz` | `@efs/fixture` from efs-project/sdk-v2 main `c8ed37a54a5a408b261fa3e2a9cac3481aaa6972` (contracts `cc59d0c`, seed `efs-fixture-seed/4`), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `nsDu7hAn…GacnwQ==`) | `7c68700cb81b794602960814970c121aa5043768dde2aa53337e736ff38cdc1f` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
