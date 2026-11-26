# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-7db4417.tgz` | efs-project/sdk-v2 main `7db4417abb82a52b74b6f0e0e5ba69baf4993634`: the read floor (a read is never served from a block older than one this client already read; when every endpoint is behind, it waits up to `reads.behindWaitMs`, 4 s, then is UNKNOWN BEHIND; `SequenceProgress.visibleAt`, `SequencePart.committedAt`; the journal raises the floor on a reload or in another tab, keyed by chain id, ledger and genesis hash; `efs.readFloor()`, `efs.resetReadFloor()`, `CallOpts.atLeast`) and contracts-v2 `3ca53ba` (the final step: digest `0x9f360a55…f321`, ledger `0xFEd9404A…97243Ef`, new stores, index and readers; type ids, layout id and seed unchanged). Recorded save flows gain one genesis read (`eth_getBlockByNumber ["0x0", false]`) at a client's first commit. @efs/sdk/links (startup) unchanged from 754f6d2. Over 754f6d2 (the chain's word grammar in parseLink), 96b2a58, e229ea3, 31ee83a, 2fec7e2, f631922, d5e08cb, 97a257a, 983d70b, 13a733d, 7fe5e95, db9dc26, ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent builds (sha512 `udFtoeYI…tjsvg==`) | `e268edc704846aed4dfb67f6c233a189813da8665c08fdb1a8bc7d292f297e69` |
| `efs-fixture-0.0.0-7db4417.tgz` | `@efs/fixture` from sdk-v2 main `7db4417` (contracts-v2 `3ca53ba`, the final step: a new deployment, new addresses), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `6NUUpyxb…sCbfcg==`) | `e2807e6f28b63a57adad436faf4e5294cd631121d7c665e5bd44f458e36a213e` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
