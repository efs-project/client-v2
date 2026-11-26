# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-f631922.tgz` | efs-project/sdk-v2 main `f631922571cac75daee4e7da9aa14968a9a6cd00`, additive over d5e08cb: `Joined.said` (a SAME statement's own direction) and `topicBroader` (broader and narrower, one hop). Below, d5e08cb's notes. Built on (contracts-v2 `0fb4804fdfde33e5ab312eaacf00410785e995c3`, release digest `0x580ede64…d04e`: the index (now `0xCa5A752AC91AE1796574E964C30Cbe06c67ad4Dc`), its reads contract, BitmapStore and FilesFinalValidator moved; the ledger, realm id, realm origin and chain id didn't, so journal records stay valid): `planOtherEntry` in `@efs/sdk/testing` (a subject with no file version at a name, an "other" row, for blocking tests), the labelKey ASCII fold, measured gas rows for labels and same/broader, refusal code 16. Earlier: 97a257a (lensTagsOf), 983d70b, 13a733d, 7fe5e95, db9dc26, ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `DOiz2B/c…gNgo95Ew==`) | `32e77e9645bdc3fb875aef2890ca1a71ea309ec7a82d9dd3573d6d783926ebfd` |
| `efs-fixture-0.0.0-d5e08cb.tgz` | `@efs/fixture` from sdk-v2 main `d5e08cb` (unchanged at f631922) (contracts-v2 `0fb4804`, the new index), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `lCiukrSF…GX+REA==`) | `f04666c31fb31b0b002eb70e9fe5c941046eeff2846f6fb900400d84a264368b` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
