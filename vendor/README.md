# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-96b2a58.tgz` | efs-project/sdk-v2 main `96b2a586bc6a80c57a6f4162b70c7642d7ef72e3`: parseLink's bad-word INVALID carries `word` (the refused segment as the link spelled it: percent-decoded, not folded), and the send's gas limit set by fee profile (gasLimitOf, reservoirProfile, TX_GAS_HARD_MAX, `plan.plannedGas`; prague/osaka byte-for-byte unchanged, amsterdam never clamped at 2^24: no change on today's fixture), with the split-count and division-by-zero fixes. Over e229ea3 (a replay that follows the head, VIEW_KINDS, the interim fold, checkStableWord), 31ee83a, 2fec7e2, f631922, d5e08cb, 97a257a, 983d70b, 13a733d, 7fe5e95, db9dc26, ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent builds (sha512 `dLMB3Yx7…gvWMQ==`) | `ef23ba0618eaa80f2d1df4b6bf04a252889a558171550af7250a32692361b4a0` |
| `efs-fixture-0.0.0-31ee83a.tgz` | `@efs/fixture` from sdk-v2 main `31ee83a` (unchanged at e229ea3 and 96b2a58) (contracts-v2 `cbf5b78`, the reader frontier: a new deployment), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `gFmGqdw+…iztQyQ==`) | `ee24d63a061c40d2b8cc2aa3e0e8463857f51b97e68132ffbdbec6e552c12251` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
