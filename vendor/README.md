# Vendored packages

Until the EFS SDK (and its test fixture) has a public release (it waits for the owner's explicit yes, because a release
publishes), client-v2 depends on a packed tarball of `@efs/sdk` committed here (PM working
default D2, 2026-11-24). The lockfile records its integrity, so `pnpm install --frozen-lockfile`
refuses any other bytes.

| File | Source | sha256 |
|---|---|---|
| `efs-sdk-0.0.0-2fec7e2.tgz` | efs-project/sdk-v2 main `2fec7e28f50c5177c8b3f90c82b1084b893ebbfe`: `topicItemsMerged` (a tag with the Lens's synonyms merged, each row naming its `via`; `missing` lists; a "not this" at the asked page wins) and a Lens dedupe at every read (no calldata change for Lenses built by the SDK). Over 141729a: no default gateways (DEFAULT_GATEWAYS has none; ipfs:// and ar:// read POLICY_BLOCKED, rule "no-gateway", until the app names its own; https stays off unless allowed), `checkLocator` (pure; both file planners now refuse an unreadable locator with MISUSE before anything is read or sent), and topicItems row `kind` (+ `typeId`) with a `kinds` filter (counts.filtered; part of the cursor). Each topicItems page makes one more batched round trip (records + subjectInfo). Earlier: f631922 (Joined.said, topicBroader), d5e08cb (contracts 0fb4804), 97a257a, 983d70b, 13a733d, 7fe5e95, db9dc26, ff3ebe8, fd3db9b, a6bf367, c8ed37a, 74a4d5e, #38. Packed from a `git archive` with the SDK's own `tools/pack.mjs`; matches the SDK dev's independent builds (sha512 `HmGCAAWL…D9h6uw==`) | `bb27c6fa1a746349ae9573be404db3534046690c4ec881880d6d97c6648a6109` |
| `efs-fixture-0.0.0-d5e08cb.tgz` | `@efs/fixture` from sdk-v2 main `d5e08cb` (unchanged at f631922, 141729a and 2fec7e2) (contracts-v2 `0fb4804`, the new index), for the live-chain tests and local development only; never bundled; matches the SDK dev's independent build (sha512 `lCiukrSF…GX+REA==`) | `f04666c31fb31b0b002eb70e9fe5c941046eeff2846f6fb900400d84a264368b` |

**Bumping:** the SDK dev names a main commit. Pack it from a `git archive` of that commit
(`pnpm install --frozen-lockfile && pnpm --filter @efs/sdk build && node tools/pack.mjs --only sdk`);
packs are byte-reproducible, so compare the sha256 with the SDK dev's own. Then add the new
`efs-sdk-<version>-<sha7>.tgz`, point both `file:` dependencies at it (`apps/web/package.json`
and the root `package.json`, which the e2e tests use for `@efs/sdk/testing`), remove the old
file, run `pnpm install`, and update this table.
