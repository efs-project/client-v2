# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-2ab41b5.tgz` | efs-project/sdk-v2 main `2ab41b587207d7006a5417847d95898b0477a046` (#30: `WALLET_MISMATCH` as NOT_SENT with `reason.wallet`, STALE reasons carry `reason.revert`, settleMs bounds the receipt wait; contracts `07818d1` as in 88bfc0c), packed with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build | `6245171f45a0a09a3ebf2a8f83c5c1b5b281e9f11efa669cf3889b3df72eb22a` |
| `efs-fixture-0.0.0-88bfc0c.tgz` | `@efs/fixture` from sdk-v2 main `88bfc0c` (byte-identical at `2ab41b5`) (node-only; `startFixtureChain` over the vendored contracts fixture, contracts `07818d1`), for the live-chain e2e job only; never bundled | `2296fa1c8414670114c70c47309fd1d2afe50023f067f06cef3888c7c6d887b8` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
