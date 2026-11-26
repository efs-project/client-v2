# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-59bb9fb.tgz` | efs-project/sdk-v2 main `59bb9fb736a4b0ee64180f446bb716875d4759f0`, on contracts-v2 `04526b1` (the list release, release digest `0xe6972acb…8612`; the ledger `0xe942147e…73429` and genesis did not move, the other contracts did). Over f1c5625: file and folder names are files-name/3 (no `# ? % / \ < > " \| : * ;`, never ending with `.`; `checkName` rules `reserved-character` and `trailing-dot`, `dot-or-dotdot` gone); a tag word's ASCII is only a–z, 0–9, `-`, `_` and `.`, never ending with `.` or starting with `-` (parseLink `detail` `forbidden-ascii`, `trailing-dot`, `leading-dash`; `dot` and `reserved-tilde` gone); new word and name Type ids, so every topic, word page and name record id moved; the list release's gas rows and batch sizes; a Send again that sends nothing returns at once, with no settle wait (9ec7860); `PlannedAction` loses `neverBound` and `headRevision`. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; byte-identical (`cmp`) to the SDK dev's two clean builds (sha512 `Ns995Rqe…L1YTxJ/UXDzsrg==`) | `5431247bf006eb4c55a04472886e4fd65a42115a040bebb93d290250f3875674` |
| `efs-fixture-0.0.0-59bb9fb.tgz` | `@efs/fixture` from sdk-v2 main `59bb9fb` (contracts-v2 `04526b1`: new addresses for everything but the ledger and genesis), for the live-chain tests and local development only; never bundled; byte-identical (`cmp`) to the SDK dev's builds (sha512 `XFo9fEF2…SImpvkkmvg==`) | `0e367579ff3b9539ef8a87b0f4c13c93865ffccc46f1c5260d3ccaf0f8d57fcb` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
