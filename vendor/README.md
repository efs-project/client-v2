# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-754f6d2.tgz` | efs-project/sdk-v2 main `754f6d227486eadb57c9e1b5aa7f355be00732d7`: parseLink runs the chain's word grammar (checkWord) on each folded word, so a word the chain can't hold (a bidi override, a zero-width joiner, a no-break space, a soft hyphen, variation selectors, C1 controls, noncharacters, U+FFFD, a backslash) is INVALID bad-word, never a topic link; the result carries the chain's refusal `code` and a `detail` name (refused-character, forbidden-ascii, malformed-utf8, length, dot, reserved-tilde, address-shaped, or the fold's unfolded, slash, control). @efs/sdk/links now imports names/word and generated/constants (startup +1.8 KB brotli here). Over 96b2a58 (bad-word `word`, the gas limit by fee profile), e229ea3, 31ee83a, 2fec7e2, f631922, d5e08cb, 97a257a, 983d70b, 13a733d, 7fe5e95, db9dc26, ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent builds (sha512 `gBaARDRI…NU28eQ==`) | `b604fdeca4075a3a68b13d41cc1eb02a3ec9944f870dc0f4131117094a80bd18` |
| `efs-fixture-0.0.0-31ee83a.tgz` | `@efs/fixture` from sdk-v2 main `31ee83a` (unchanged at e229ea3, 96b2a58 and 754f6d2) (contracts-v2 `cbf5b78`, the reader frontier: a new deployment), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `gFmGqdw+…iztQyQ==`) | `ee24d63a061c40d2b8cc2aa3e0e8463857f51b97e68132ffbdbec6e552c12251` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
