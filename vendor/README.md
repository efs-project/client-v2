# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-c8ed37a.tgz` | efs-project/sdk-v2 main `c8ed37a54a5a408b261fa3e2a9cac3481aaa6972` (merge of feat/link-grammar, PM-reviewed `2ddfede`; contracts `cc59d0c`, seed/4: folders are records only their creator publishes (`FolderRef { directory, owner }`, no `subject` or `folderOf`), `openObject`, the link grammar (home and topic links, `?lens=` defined on object, home and topic links, `parseLink` OK or INVALID), `FolderPage.rereads`. Earlier: 74a4d5e (folder operations), #38 (e28a31e)), packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `dEb1UlOI…hVrrdw==`) | `595985fbb7ac3e48b5017072f3abbc2cddd3400027517c24c2fc5f8b49767214` |
| `efs-fixture-0.0.0-c8ed37a.tgz` | `@efs/fixture` from efs-project/sdk-v2 main `c8ed37a54a5a408b261fa3e2a9cac3481aaa6972` (contracts `cc59d0c`, seed `efs-fixture-seed/4`), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `nsDu7hAn…GacnwQ==`) | `7c68700cb81b794602960814970c121aa5043768dde2aa53337e736ff38cdc1f` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
