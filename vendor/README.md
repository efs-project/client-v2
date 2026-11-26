# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-97a257a.tgz` | efs-project/sdk-v2 main `97a257a044bc9f563b3b0b78f13be6a6015162c1` (contracts `2462e54`, the tag release's deployment, unchanged): `lensTagsOf` (the places a thing is tagged at, as a Lens decides them, with the public tier and the page laws of topicItems). Additive. Earlier: 983d70b (names, synonyms, label planners, tag save effects), 13a733d, 7fe5e95, db9dc26, ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `cTedbqPi…LCLidQ2Ig==`) | `d600ead62b5dbfddf0b2a6c4a4064d2ddfcc20fdd51e371df7d97773d1ad299d` |
| `efs-fixture-0.0.0-a7b2471.tgz` | `@efs/fixture` from efs-project/sdk-v2 main `a7b247114e0762bd57122f7b834cbf25d265f2b1` (contracts `2462e54`, the tag release's deployment), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `4166xlUT…7etsgQ==`) | `ff697782162bf967b39653a96772d0007bcfb0dc606771b27095a144613a8ebd` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
