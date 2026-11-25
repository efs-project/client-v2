# Verified reads: pin status and Preview (slice B)

**Status:** working design for slice B, accepted in scope by the integration owner on 2026-11-24. Builds on the shell (`shell.md`); the routing contract is in `shell.md` § Routing.

## What it does

- **Reader session.** When a usable network is in view, the shell lazily loads the SDK, fetches the site's deployment document and creates one SDK instance from the user's ordered endpoints. It pins the deployment before anything is read. The header and Settings show the outcome and its evidence.
- **Preview pane.** An object or revision link (`#/r/<realm>/~efs/o/…`, `…/~efs/v/…`) opens that file in Preview. Verified text is shown; other verified contents can be saved; anything not verified is never shown as contents.
- **`<efs-outcome>`** renders any SDK status (read, bytes, pin, write) with its raw code. Unrecognized codes are never shown as success, empty or absent.

Listings, the tree and the breadcrumb wait for the folder/tag ruling.

## Data flow

```text
route (#/r/<realm>/<link>) ─┐
efs.config.json ────────────┼─> network in view ─> reader session ─> pin ─> VERIFIED? ─> Preview reads
user endpoint overrides ────┘    (os-state)          (lazy SDK)                          (lazy SDK files)
```

- `session/reader.ts` is the only module that creates an SDK instance. It is a lazy chunk; `shell/reader-state.ts` imports only its types.
- The session is rebuilt when anything the SDK is configured from changes (network, deployment URL, endpoint lists), and only then. Creating an instance does no I/O; the SDK caches nothing across instances yet.
- Reads get an instance only through `verifiedEfs()`, which returns one only for a VERIFIED pin. Until then every pane says why it can't read (connecting, unreachable with Try again, wrong deployment, setup problem), never "empty".

## Defaults that protect the person

- **The deployment document must be same-origin**, shipped beside `index.html` like `efs.config.json`. A cross-origin URL would be a request to a host the person can't see in Settings, so it is refused unread.
- **Each network names its ledger** (`core` in efs-config/1). The fetched document must match both the network's chain id and its ledger, or nothing is read.
- **Gateway lists are always passed explicitly**, so the SDK never falls back to defaults the person can't see.
- **Locations fetched without asking: `ipfs` and `ar` (through the person's gateways), `web3` (through their RPC endpoints) and inline `data`.** A publisher-chosen `https://` location would reveal the reader's IP to that host, so (PM ruling, 2026-11-24, the email-client "remote images" pattern) the Preview names the host and offers a one-time "Load from <host>", and Settings offers "Also fetch files from publishers' own web addresses" (off by default).
- **Proven absent ≠ couldn't tell.** ABSENT_PROVEN shows "Confirmed not present" with no retry; UNKNOWN shows "Couldn't be confirmed right now" with Try again.
- Files over 1 MiB wait for an explicit "Load it"; on-screen text is cut at 200,000 characters (saving is never cut).
- **"Load from <host>" is one read, for one origin.** It uses the SDK's `allowOrigins` (exact origin, no redirect to another origin), so only the host the person clicked is contacted, and the bytes are verified as usual. The permission is never remembered: another file at the same host is blocked again, and so is a reload. The SDK's in-memory byte cache may serve bytes the person already loaded for the rest of that session, without contacting anyone; nothing is persisted.

## Bundle

| Chunk | gzip | Loads when |
|---|---|---|
| Startup (HTML, probe, JS, CSS, sprite; includes the SDK's link grammar) | 123,087 B brotli | always |
| File Browser | 3.7 KB | the File Browser opens |
| Reader session (with the SDK client) | 4.4 KB | a usable network is in view |
| SDK core (shared) | 16.5 KB | with the session |
| SDK byte reads | 13.4 KB | Preview has a verified session and a link |

A site with no networks never downloads the SDK core; e2e checks this from the build's module provenance.

## Testing

- Unit: `preview-model.ts` runs against the SDK's recorded *result* fixtures (`@efs/sdk/fixtures/*.json`), with the SDK's functions injected. `reader-state.ts` runs with a fake loader.
- e2e: the real SDK runs in the page against recorded *chain traffic* (`@efs/sdk/fixtures/rpc/*.json`), answered by the SDK's own `createRpcReplay` on a fake RPC origin. Every test asserts `replay.misses` is empty, so a change in what the SDK asks fails loudly. Failure paths (missing, invalid, forged or other-chain deployments; unreachable RPCs; unknown realms; over-long links) need no recording.
