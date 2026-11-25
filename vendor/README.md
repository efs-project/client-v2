# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-db9dc26.tgz` | efs-project/sdk-v2 main `db9dc261a8a5d8b964a11ca065715619d211763c` (contracts `cc59d0c`, seed/4: every publication is planned with the kernel's per-bind index floor (120,000 gas on this release), so a part never needs more than the 2^24 cap (multi-select batches of about 40+ were refused on every try before); path links `~efs/o/<folder>/<name>…` (LinkParse kind `path`, `openPath` in `@efs/sdk/files`); a web3:// gateway's 501 reads as UNAVAILABLE. Earlier: ff3ebe8 (parts packed into one wallet batch by summed gas, `review.prompts.atomicBatch` a number, EIP-5792 refusals named), fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38), packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `I+0rEG0t…ICEDmhxA==`) | `fafddc8183d208bb4a86f4badd64f6dd8a50ccfd82025df664fb8f8706f239a7` |
| `efs-fixture-0.0.0-c8ed37a.tgz` | `@efs/fixture` from efs-project/sdk-v2 main `c8ed37a54a5a408b261fa3e2a9cac3481aaa6972` (contracts `cc59d0c`, seed `efs-fixture-seed/4`), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `nsDu7hAn…GacnwQ==`) | `7c68700cb81b794602960814970c121aa5043768dde2aa53337e736ff38cdc1f` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
