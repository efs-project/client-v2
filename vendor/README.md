# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-31ee83a.tgz` | efs-project/sdk-v2 main `31ee83a6f3b7f810b3648f9eb4d88e84c1f523f4`: the reader frontier (contracts-v2 `cbf5b78`, a new deployment: every address, the realm id and the domain separator moved; `TopicPageInfo.frontier`, and the merged read's floors use it, so a padded synonym list no longer holds pages back; topicItems and topicItemsMerged check every page's frontier against the reader's promises, a break is RPC_ERROR; no new round trips) and one publication, one wallet request (a second save of the same publication while the first attempt is open, committed-but-not-final included, is NOT_STARTED with reason ALREADY_ATTEMPTED and `twin: { planId, stage, sequenceId? }`; two different saves of the same bytes hold the same way until the first is final). Earlier: 2fec7e2 (topicItemsMerged, no default gateways, checkLocator, row kinds), f631922, d5e08cb, 97a257a, 983d70b, 13a733d, 7fe5e95, db9dc26, ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent builds (sha512 `ql2MLRxo…HqFaw==`) | `b1f1e9b368061e6543d39394bc89a5020afc1dcbf1c29a5dfa859e9f92204d9b` |
| `efs-fixture-0.0.0-31ee83a.tgz` | `@efs/fixture` from sdk-v2 main `31ee83a` (contracts-v2 `cbf5b78`, the reader frontier: a new deployment), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `gFmGqdw+…iztQyQ==`) | `ee24d63a061c40d2b8cc2aa3e0e8463857f51b97e68132ffbdbec6e552c12251` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
