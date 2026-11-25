# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-7fe5e95.tgz` | efs-project/sdk-v2 main `7fe5e9595fca82fecc7561a1a8fe3f849b772ccd`: the tag release (a7b2471) plus `planLoneHide` in `@efs/sdk/testing` (test-only, for the Unblock e2e); the tag release (contracts `2462e54`, a new deployment: every address moved, the ledger is `0x83Db…30C6`). Brings `@efs/sdk/tags`; removed rows' `last` (KNOWN, NEVER_BOUND, UNKNOWN) and `planUnhideEntries`; `lens` on openPath's answers and owners on its chain's folders; the HEAD law enforced at write time; planning that matches the contracts' reference planner (7,400 gas reserved per bind). Earlier: db9dc26 (kernel floor in every part, path links), ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `aH/kVxi/…tTWNw==`) | `bfde8ee54bfb99df05ae223b9b86455a74c20884b612326e949ce075387c21cf` |
| `efs-fixture-0.0.0-a7b2471.tgz` | `@efs/fixture` from efs-project/sdk-v2 main `a7b247114e0762bd57122f7b834cbf25d265f2b1` (contracts `2462e54`, the tag release's deployment), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `4166xlUT…7etsgQ==`) | `ff697782162bf967b39653a96772d0007bcfb0dc606771b27095a144613a8ebd` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
