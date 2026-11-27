# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-3bcd21c.tgz` | efs-project/sdk-v2 main `3bcd21cd7f9e818f8248d6b5c0af95a77935e80c`, on contracts-v2 `19891fe` (the guard release, re-vendored with the read-set guard not yet sent: the SDK still sends an empty guard; no exported type changed). The fixture Realm is now revision 2 with the guard switched on, so every genesis address moved (ledger proxy `0xBfe0D63fe8bEe7e225ed521756f9AA15f68e03C5`, the realm id, the domain separator and every reader), and every transcript was re-recorded. Over a61b2e8: `files.folderNames` (a folder's name for a breadcrumb, the folder twin of fileNames), and the regenerated gas model (each row a few dozen gas higher or lower; the client names no gas figure). Before it, a61b2e8 brought `efs.onCaughtUp`, FaultCode RECORD_DAMAGED, every reason code named in `ReasonCode`, `planFolderEntry` in `@efs/sdk/testing`, the write-path audit, RESPLIT, MissingList UNKNOWN only, the batch deadline and stop rules, and throttle fail-over. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; byte-identical (`cmp`) to the SDK dev's build (sha256 below) | `a5727bc6f8a7599d945bae9b9185f89331a72fae1096ae480ff05de3f1d3a3ab` |
| `efs-fixture-0.0.0-3bcd21c.tgz` | `@efs/fixture` from sdk-v2 main `3bcd21c` (contracts-v2 `19891fe`: the Realm at revision 2 with the read-set guard on, so new addresses for everything, the ledger proxy included), for the live-chain tests and local development only; never bundled; byte-identical (`cmp`) to the SDK dev's build | `280c6811bff93c6877cada51a34828cdc81a9863793763fe657f0126b79263f2` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table. `pnpm check` holds the table to the files (`tools/checks/vendor-hashes.test.ts`): every tarball here needs a row whose sha256 is its own, every row a tarball, and the lockfile's integrity for each must be that file's sha512.
