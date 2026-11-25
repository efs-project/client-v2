# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-983d70b.tgz` | efs-project/sdk-v2 main `983d70bc67fbb39e5b0709d3c6a615a63e4d7703` (contracts `2462e54`, the tag release's deployment, unchanged): names for tags and files (`topicName`, `labelOf`, `fileNames`), `topicSynonyms`, the label/same/broader planners, and save effects for tag saves (`tags.tag`, `tags.deny`, `tags.untag`, `tags.register`, `tags.label`, `tags.same`, `tags.broader`). Additive: no existing type changes. Earlier: 13a733d (homes as parents, ABSENT_PROVEN directories, displayOf), 7fe5e95, db9dc26, ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `68a0U0aC…l+Mg==`) | `1d27285d861ed8b2d73c43a609d4a72aba5a38971ff9a73aef5d5fc926a66fd3` |
| `efs-fixture-0.0.0-a7b2471.tgz` | `@efs/fixture` from efs-project/sdk-v2 main `a7b247114e0762bd57122f7b834cbf25d265f2b1` (contracts `2462e54`, the tag release's deployment), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `4166xlUT…7etsgQ==`) | `ff697782162bf967b39653a96772d0007bcfb0dc606771b27095a144613a8ebd` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
