# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-a61b2e8.tgz` | efs-project/sdk-v2 main `a61b2e86e3ed7b71c6c78fab149d612dad110e08`, on contracts-v2 `04526b1` (unchanged: same deployment). Over bdcbe6e: `efs.onCaughtUp` (a BEHIND episode closing, per basis policy, one-shot, no requests of its own), FaultCode RECORD_DAMAGED (a plan or a save record that isn't what it recorded; nothing sent), every reason code the SDK returns named in `ReasonCode` (ALREADY_ATTEMPTED, IN_FLIGHT, RESPONSE_LOST, ABORTED, CANCELLED, INVALID, NOT_IN_JOURNAL), the tests-only `planFolderEntry` in `@efs/sdk/testing`; and from a03ba84, the write-path audit (signed values checked before signing, plans re-derived before any wallet request, a save's parts hash checked on resume; INVARIANT when a plan or save record isn't what it recorded), RESPLIT (a part cut for the cap that needs more approvals than the review said stops first: reason RESPLIT, retry "after-review", `prompts { before, now }`), MissingList status UNKNOWN only, a batch deadline and stop rules, throttle fail-over, and one more eth_call (`ledger.executionSet()`) in planPublication's batch. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; byte-identical (`cmp`) to the SDK dev's two clean builds (sha512 `uR88y4h2…w9Ee4MheFgErEg==`) | `91918e682a7c9973d691f17f9ff4d652bd2abe2b77d5948fb2b2e9c72ff3931a` |
| `efs-fixture-0.0.0-59bb9fb.tgz` | `@efs/fixture` from sdk-v2 main `59bb9fb` (contracts-v2 `04526b1`: new addresses for everything but the ledger and genesis), for the live-chain tests and local development only; never bundled; byte-identical (`cmp`) to the SDK dev's builds (sha512 `XFo9fEF2…SImpvkkmvg==`). Packed again from `f27c190`, `bdcbe6e`, `a03ba84` and `a61b2e8`, it is byte-identical (`cmp`), so the pin keeps this file and its name | `0e367579ff3b9539ef8a87b0f4c13c93865ffccc46f1c5260d3ccaf0f8d57fcb` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table. `pnpm check` holds the table to the files (`tools/checks/vendor-hashes.test.ts`): every tarball here needs a row whose sha256 is its own, every row a tarball, and the lockfile's integrity for each must be that file's sha512.
