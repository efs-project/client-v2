# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-bdcbe6e.tgz` | efs-project/sdk-v2 main `bdcbe6e06d4cebe4a5ac12aff059b409485da9ad`, on contracts-v2 `04526b1` (unchanged: same deployment). Over f27c190: the read-validation audit (a faulty or lying endpoint's answer fails over to the next RPC, or ends UNKNOWN with a transient reason, never a value, an absence or a "can never work"; openFile's HEAD whose revision reads absent is UNKNOWN, never ABSENT_PROVEN; a Lens over 64 principals is MISUSE in listFolder and the topic reads; a TopicCount's coverage is COMPLETE only; folder owners from each folder's hash-checked record, one more eth_call per unseen folder row), the tests-only `planHeadNo` and `planHeadRelease` in `@efs/sdk/testing` (7ff691d), and at most 40 calls per JSON-RPC batch, a larger read sent as consecutive batches at one block (bdcbe6e). Packed from a `git archive` with the SDK's own `tools/pack.mjs`; byte-identical (`cmp`) to the SDK dev's two clean builds (sha512 `+8RQbzrP…ZODftXKkn/L9fQ==`) | `60fe7bc4ad4fd812c75489db9ded27cab5e7752698f92ce6765f11042400d71b` |
| `efs-fixture-0.0.0-59bb9fb.tgz` | `@efs/fixture` from sdk-v2 main `59bb9fb` (contracts-v2 `04526b1`: new addresses for everything but the ledger and genesis), for the live-chain tests and local development only; never bundled; byte-identical (`cmp`) to the SDK dev's builds (sha512 `XFo9fEF2…SImpvkkmvg==`). Packed again from `f27c190` and from `bdcbe6e`, it is byte-identical (`cmp`), so the pin keeps this file and its name | `0e367579ff3b9539ef8a87b0f4c13c93865ffccc46f1c5260d3ccaf0f8d57fcb` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table. `pnpm check` holds the table to the files (`tools/checks/vendor-hashes.test.ts`): every tarball here needs a row whose sha256 is its own, every row a tarball, and the lockfile's integrity for each must be that file's sha512.
