# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-4043ce7.tgz` | efs-project/sdk-v2 main `4043ce75fb63cd33e6e37c9b867c9d4bff288a76`, on contracts-v2 `6d11858` (formula 3, the list tiers, the registry rule, the kept-index fix: a new deployment, ledger `0xe942147e…73429`). Over 7db4417: a deployment document must price like its chain (`UNSUPPORTED_PROFILE` with `reason.feeSchedule = { document, chain, freshSlotGas }`, before anything is planned or sent; 1054c2c); a part too large for one transaction is re-split, so `SequenceProgress.total` can grow during a save, and what can't be split stops with `OVER_TX_GAS_CAP` and `reason.gas = { estimate, cap, suggestedParts }` (d1115a8); a wallet's insufficient-funds refusal is named (`INSUFFICIENT_FUNDS`, AMBIGUOUS, retry after-reconcile, `reason.funds.gasLimit` for a single send; 861ca0a); interim pricing of fresh slots a later yes writes beyond its row (4043ce7); v0.1 docs (d0359fc, eef1c29). API renames the client doesn't use: `everyBindFirst` → `noPrincipal`, `KernelFloor.workModel` values `number \| Hex`, `actionGas(firstAtPlace)`, `GasConstants` tier and `interim*` fields, `PlannedAction.neverBound`/`headRevision`. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; byte-identical to the SDK dev's two clean builds (sha512 `u4S/OtMg…5fZKaw==`) | `b915a17630134a8223668d8932a18002607a913e3667f1db94fbe58a5bf2966f` |
| `efs-fixture-0.0.0-4043ce7.tgz` | `@efs/fixture` from sdk-v2 main `4043ce7` (contracts-v2 `6d11858`: a new deployment, new addresses), for the live-chain tests and local development only; never bundled; byte-identical to the SDK dev's builds (sha512 `GG31IEdN…iy7oCof62A==`) | `e82c8476ba1f881dab79d73927bb45f64c682eb8f073f2164fc5cdbfa510aaa6` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
