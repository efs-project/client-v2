# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-f1c5625.tgz` | efs-project/sdk-v2 main `f1c5625fb26827edadc1f984b76b90352c884bc4`, on contracts-v2 `6d11858` (unchanged from 4043ce7: same deployment, ledger `0xe942147e…73429`). Over 4043ce7: after a funds refusal, Send again (`resume`, or `send` with the same plan) sends the same plan again, so it can never land twice, while its deadline is at least 60 s ahead; with under 60 s left it answers IN_FLIGHT with ALREADY_ATTEMPTED and waits for EXPIRED (08c780f); a `wallet-answer` progress event (`{ kind, parts, reason }`) as soon as a send is AMBIGUOUS after the wallet or node answered, for exactly `WALLET_ANSWER_CODES` (INSUFFICIENT_FUNDS, WALLET_DISCONNECTED, WALLET_CHAIN_DISCONNECTED, RESPONSE_LOST), before the settle wait; links read `0X` + 40 hex as a home (f1c5625); INTERIM kernel pricing of a folder entry's retarget (1685a41). Packed from a `git archive` with the SDK's own `tools/pack.mjs`; byte-identical to the SDK dev's two clean builds (sha512 `UR13ShJ0…16zQoA7Q==`) | `7f7f08940b8528bb098d54526523c935a5b4d9e8560ad6792735deb68a30b8fb` |
| `efs-fixture-0.0.0-4043ce7.tgz` | `@efs/fixture` from sdk-v2 main `4043ce7` (contracts-v2 `6d11858`: a new deployment, new addresses), for the live-chain tests and local development only; never bundled; byte-identical to the SDK dev's builds (sha512 `GG31IEdN…iy7oCof62A==`). Packed again from `f1c5625`, it is byte-identical (`cmp`), so the pin keeps this file and its name | `e82c8476ba1f881dab79d73927bb45f64c682eb8f073f2164fc5cdbfa510aaa6` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
