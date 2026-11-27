# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-9a44046.tgz` | efs-project/sdk-v2 main `9a44046fe04f5876543c0ce84a43256657204333`, on contracts-v2 `19891fe` (unchanged: same deployment and fixture). The read-set guard (S2–S5): on a Realm with the guard (the fixture has it) every folder, tag, statement and edit save carries one by default, and the chain refuses the whole publication if a head it rests on moved or was misreported; a stale or repeated save is refused `E_READSET_STALE` before the CAS (the same STALE outcome, retry after-replan). Each plan reads one more call (headSnapshots), an edit two; guarded batches lose one entry at the cap; shown gas rises per guarded publication. New: the edit review's `chainChecked`, `createWriter({ guard: "auto" | "always" | "never" })` (default auto), `Plan.guard`, `SequencePart.guard`, `DeploymentInfo.nativeGuard` and the read-set limits. Every transcript was re-recorded. Before it, 3bcd21c brought `files.folderNames` and the contracts 19891fe re-vendor (every genesis address moved). Packed from a `git archive` with the SDK's own `tools/pack.mjs`; byte-identical (`cmp`) to the SDK dev's build (sha256 below) | `7409fa4ecfa3df751b4d38f183a4b5a70c84994d21be4bdd3bc9247b31d73b44` |
| `efs-fixture-0.0.0-3bcd21c.tgz` | `@efs/fixture` from sdk-v2 main `3bcd21c` (contracts-v2 `19891fe`: the Realm at revision 2 with the read-set guard on, so new addresses for everything, the ledger proxy included), for the live-chain tests and local development only; packed again from `9a44046`, it is byte-identical (`cmp`), so the pin keeps this file and its name; never bundled; byte-identical (`cmp`) to the SDK dev's build | `280c6811bff93c6877cada51a34828cdc81a9863793763fe657f0126b79263f2` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table. `pnpm check` holds the table to the files (`tools/checks/vendor-hashes.test.ts`): every tarball here needs a row whose sha256 is its own, every row a tarball, and the lockfile's integrity for each must be that file's sha512.
