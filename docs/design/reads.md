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
- **Never older than what this client has seen** (the SDK's read floor, sdk-v2 7db4417). A read is never served from a block older than one this client already read, so a lagging endpoint can't show the state from before the person's own save. When every endpoint is behind, the read waits up to 4 s, then is UNKNOWN with reason BEHIND. It has its own copy, "This network connection hasn't caught up with what you've already seen. Try again in a moment.", with Try again, and `<efs-outcome>` shows the reason code beside the status code for anyone who wants it.
  - **A BEHIND Preview reads itself again once** (PM, 2026-11-27; the SDK's `efs.onCaughtUp`, sdk-v2 a61b2e8; `preview.ts` `#awaitCatchUp`). While the Preview shows UNKNOWN BEHIND, it waits on the SDK's catch-up signal. That fires when a read, reconcile or save step in this client is next served at or above the floor. Then the Preview re-reads, once, with nobody pressing anything.
    - No polling: the SDK reads nothing for the signal, and it fires only from reads the page makes anyway, such as a save's own 12 s check. If nothing in the page reads, Try again stays the way out.
    - At most one re-read by itself: if that one is BEHIND again, the Preview shows BEHIND with Try again and doesn't wait again until the person acts (Try again, another file, a save's refresh, Show my version).
    - A new read, another file or leaving drops the wait.
    - The copy still says "Try again in a moment", and Try again still works.
    - `tests/e2e/read-floor.spec.ts` case (c) pins it on a live chain (checked by mutation: without the wait, the Preview stays BEHIND and the case fails). A Preview's Tags section also reads again when the tab becomes visible (see writes.md).
  - **On a local test chain only** (every enabled endpoint on this computer), it also offers "The test chain was reset? Start over", which forgets the floor (`efs.resetReadFloor()`, `shell/read-floor.ts`) and reads again: a reset or restarted chain is shorter than the floor and would otherwise stay BEHIND.
  - **Never on a live chain**, where a stuck endpoint would then serve old reads again.
  - **Every surface that can be UNKNOWN goes through `<efs-outcome>`,** a tag page's Synonyms and "Under" included (since 2026-11-26). A surface can keep its own words for a plain UNKNOWN ("Other names for this tag can't be read right now"), but never over BEHIND's, and each gets Try again and the reason code.
  - **Tested live** (`tests/e2e/read-floor.spec.ts`; see writes.md).
- **A file is read in its own place when the view's Lens has no version of it** (PM, 2026-11-25, for every file link without its own `?lens=`; `apps/files/object-kind.ts`). The view's Lens is "you first", then the Lens the file was listed in, or the default. If no author in it has a version of the file, the file is read again in its own place, as a folder lists in its owner's: you, then the file's creator, then that Lens (`efs.lens.place`). So a file that plainly exists never reads "Confirmed not present" only because its creator isn't someone you trust (the false-absence shape). A link carrying its own Lens is read in that Lens only. The SDK refuses a Lens of more than 64 accounts (sdk-v2 bdcbe6e), which you plus the creator plus a base of 63 or 64 can reach: `ownPlace` turns that into the outcome "This Lens names too many accounts (64 at most), so this file can't be read in its own place." (INVALID, reason LENS_TOO_WIDE, no retry), never a crash and never "not present". This is not the media gate: a file opened from a tag's public tier still shows its facts first, with Show preview (`tags.md`); a person who opens a link they were given has chosen to.
- **Versions: everyone's versions of a file** (PM-accepted sketch, 2026-11-26; the SDK's `fileVersions`, sdk-v2 f27c190, from the contracts' head-authors list; tag model spec §3.9; `apps/files/file-versions.ts`, `versions-model.ts`, `tests/e2e/versions.spec.ts`). A closed "Versions" section in the Preview, beside Tags, reads nothing until it is opened.
  - **The Lens is the one the file was opened under**, its fallback included (`readLens`: the view's Lens, or the file's own place when nobody in it had a version, as remembered for the file). Never a Show override, so the decision line says what the file's link shows.
  - **The decision line comes first:** "This view shows Alice's version." (or "your version"), "Hidden for you by Alice." ("You hid this file in this view."), "Nobody in this view has a version of this file.", or, when a head couldn't be read, "Can't tell right now which version this view shows." with Try again. Unknown is never "nobody".
  - **Three tiers, in this order:** "In this view" (the Lens authors' versions, in Lens order); "Creator" (the creator's version, only when the creator isn't in the Lens; in the Lens tier the creator's row carries the mark instead); "Others (public) · newest first, by when each person first saved one here". The order is each author's first version, never their latest edit, which the list can't say. A Lens author who only said "not this" has no row: the decision line is the only place that shows.
  - **"Versions · N" is `public.live`**, from the first page. Nothing comes from `count` (it counts lone noes and hidden and removed versions, and any new account can raise it) or `total`. No number when the public tier is UNKNOWN, which says "Other versions can't be listed right now." with Try again; the decision and the Lens and creator tiers stay, since they are exact whatever the list's coverage.
  - **Paging:** a public page can be empty while `next` is set (lone noes and removed versions are dropped after the read). Opening the section, and each Load more, reads up to 3 pages in a row (`VERSIONS_CALLS_PER_CLICK`), stopping once rows arrive or `next` is gone. If 3 pages found nothing and `next` is still set, it says "More of the list to check." with Load more. Only a missing `next` ends the list ("Nobody else has a version of this file.", when no rows came back). A list that moved since the first page says "This list changed while you were reading it." with Refresh, and never "Nobody else…": its newer entries were never scanned (`nobodyElse`, PM 2026-11-26).
  - **Show puts that author first, in place**, as "Show my version" does (the Preview's `#first`): the file's link stays, and "Showing Alice's version first." offers "Show the original view". No shareable link to one person's version yet.
  - **The media gate (the rule):** a public row's button is Open, and it shows that version behind the gate, as a file from a tag's public tier: its facts and whose it is, and nothing fetched until "Show preview". The Lens rows and the creator's row skip the gate. The creator is outside the opened Lens there, but the file view's own fallback ("you, then its creator, then that Lens") already opens the creator's version without the gate, so its Show does the same.
  - **Kept current:** the section reads again (in place if open, else on its next opening) when the opened Lens changes, when a save of this file from this pane reaches the ledger, or when the file's own view (no Show override) shows a different version or status. So "Showing here" and the decision line can't go stale. "Showing here" marks the author whose version the Preview shows now.
  - **Focus:** opening the section doesn't move it. After Load more it moves to the first new row, or stays on Load more when none arrived (at the list's end, on the public heading). After Refresh or Try again it moves to the first row, or the decision line. Show keeps focus on its row as the button gives way to "Showing here". It never falls to body.
  - **Button names: hidden text, never `aria-label`.** `wa-button` doesn't pass an `aria-label` on to its own button, so each row's button holds its visible word (marked `aria-hidden`) and its full name as `wa-visually-hidden` text: "Show Alice's version", "Open Alice's version (public)", "Show my version". Keep the visible word at the start of the name, so a voice user who says the word they see still hits it (WCAG 2.5.3, Label in Name; PM, 2026-11-26). `tests/e2e/versions.spec.ts` checks the names.
  - **Paging is pinned in a browser** (PM, 2026-11-26): a local test chain's `efs.config.json` may give a network `devVersionsPage` (a whole number from 1; tests only, never shown), the entries one read scans (fileVersions `limit`). Its upper bound is the SDK's own `MAX_VERSIONS_PAGE`, applied where the SDK is loaded (`pageLimit`; above it, the SDK's default page), never a copied number: the settings module is startup code and never imports the SDK. It is kept only for a network whose RPCs are all on this computer and applies only while every RPC in effect still is (`versionsPageOf`, as `devAccountsOf`), so a hosted config can never set it. `versions.spec.ts` "one entry per read" pages a nine-author list one entry at a time: the 3-read budget ending in "More of the list to check.", Load more keeping focus when nothing new came, then a row taking focus, a list that moves between pages (Refresh), and Refresh's focus.
  - **A decision hidden by a Lens author's lone no** is pinned in a browser (`versions.spec.ts`, sdk-v2 bdcbe6e's tests-only `planHeadNo`): with the Lens [#3, #2], #3's "not this" hides the file, the line says "Hidden for you by" #3, #2's version is the Lens tier's only row (with Show), and #3 is never a row.
  - **Not yet:** "Include hidden and taken-back versions" (`includeRemoved`): those rows have no revision to show without a history read, and asking for them turns off the SDK's early stop (PM, 2026-11-26).
- Files over 1 MiB wait for an explicit "Load it"; on-screen text is cut at 200,000 characters (saving is never cut).
- **Images, audio and video (slice G)** render in the browser's native `<img>`, `<audio>` and `<video>` elements. They come from a `blob:` URL made only from VERIFIED bytes, and the bytes' own signature decides the element (`apps/files/media.ts`): PNG, JPEG, GIF, WebP, AVIF; WAV, FLAC, Ogg, MP3, M4A; WebM, MP4, QuickTime.
  - **No declared type or file name decides.** Since contracts C4, a file's descriptor can declare a media type (`OpenedFile.mediaType`, for example `image/png`), but it's only a hint.
    - Media is shown only when the declared type's top level agrees with what the signature found (`agrees`): `image/jpeg` agrees with PNG bytes, and `video/mp4` doesn't.
    - On a disagreement nothing is shown. The Preview says "This file says it's video/mp4, but its contents are a different kind of file", with Save a copy. Neither the declaration nor the guess is trusted.
    - A declared type never makes bytes count as media, so text stays text.
    - No declared type (absent, or cleared with `""`) leaves the signature to decide alone.
    - Edits keep the file's declared type, because the editor passes none. A small typed file is stored as one chunk so it can carry the type, and the review's layout says `chunk`.
  - **SVG is only ever an image:** shown through `<img>`, where its scripts don't run and nothing external loads, never inline, never as a document. Its URL is a `data:` URL (cap 5 MiB), never `blob:`: a `blob:` URL carries the app's origin, so "Open image in new tab" would make the SVG a document on our origin. A `data:` URL can't be opened top-level and would have an opaque origin anyway.
  - **Caps:** 25 MiB for images and 100 MiB for audio and video. Larger files, types this version doesn't show, and media the browser can't decode each say so and offer Save a copy.
  - **No streaming:** a span file is read whole and verified before it is shown; there is no streaming playback yet.
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
