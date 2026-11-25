# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-74a4d5e.tgz` | efs-project/sdk-v2 main `74a4d5ea75c95bfb93fa3f00086b3f3f8361e8e0` (merge of feat/folder-ops, PM-reviewed `d3ff919`: `listFolder`, `lookupEntry`, `resolvePath`, `folderOf`, `efs.lens.place`, `planCreateFile`, `planCreateFolder`, `planMoveEntries`, `planRemoveEntries`, `planRestoreEntries`, the `SequenceRecord.effect` union, BASE_CHANGED `headAuthor`/`headAdmission` and `Basis.admissions`; contracts still `e90c7d8`. Earlier: #38 (e28a31e), #34, #33, #32, #31, #30), packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent build (sha512 `CBr3cMCP…GDSkQFA==`) | `fc37591da6a90fb163fa4ba7cb1bbee58b4ea8bc323c87537966fee3361e47d8` |
| `efs-fixture-0.0.0-e28a31e.tgz` | `@efs/fixture` from efs-project/sdk-v2 main `e28a31eef2025be0cf135b80ef18cf145515e7c9` (contracts `e90c7d8`, seed `efs-fixture-seed/3`; still `startFixtureChain({ chainId, name })` and `stopFixtureChain({ name, home })` from #35), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `gDhMgXpY…ZhY4lA==`) | `01b33886f9c6469915734583448ec266d242e89178bed3e4bec0e8eda7bd113e` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
