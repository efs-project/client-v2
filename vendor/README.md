# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-f27c190.tgz` | efs-project/sdk-v2 main `f27c190ae7e3532483947e7c6ac5fffe543bb0e8`, on contracts-v2 `04526b1` (unchanged from 59bb9fb: same deployment). Over 59bb9fb: `fileVersions` (everyone's versions of a file from the head-authors list: the Lens decision, the Lens tier, the creator's row and a page of the public tier, read at one block; d686ec4), its reply validation, and the Lens walk `openFile` shares trusting a MASKED reply only when its selection is MASKED too (7593cdd); parseLink's bad-word `detail` is the closed `WordDetail` (with `WORD_DETAILS`; a caller's own fold refusal is `fold-refused`), and `LinkParse`'s INVALID splits by rule (25f7c1c). Packed from a `git archive` with the SDK's own `tools/pack.mjs`; byte-identical (`cmp`) to the SDK dev's two clean builds (sha512 `X9anX0Ja…Y1IP7NtGoWjBMQ==`) | `010ed373f9d048a2ce743b462ed744c846592a8de289c04f5062c339fd096ae3` |
| `efs-fixture-0.0.0-59bb9fb.tgz` | `@efs/fixture` from sdk-v2 main `59bb9fb` (contracts-v2 `04526b1`: new addresses for everything but the ledger and genesis), for the live-chain tests and local development only; never bundled; byte-identical (`cmp`) to the SDK dev's builds (sha512 `XFo9fEF2…SImpvkkmvg==`). Packed again from `f27c190`, it is byte-identical (`cmp`), so the pin keeps this file and its name | `0e367579ff3b9539ef8a87b0f4c13c93865ffccc46f1c5260d3ccaf0f8d57fcb` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
