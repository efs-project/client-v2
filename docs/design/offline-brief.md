# Offline, Service Worker and local storage: decision brief

**Status:** questions 2, 3 and 5–8 decided by the integration owner (PM), 2026-11-25. Questions 1 and 4 are queued for James: they are needed only before a Service Worker ships, and the PM is holding them until after the tag discussion. Each question gives the facts, the options, a recommendation, the decision, and what is hard to change later.

**Why now:** James's MVP brief (2026-11-24) names offline mode and fast loading as things that "will be hard to retrofit later". The init plan routes the Service Worker / PWA vertical ("stage R") as "unresolved, routed not decided".

**Sources:**
- **Current working architecture:** the planning drafts `Designs/web-client-os/architecture-and-modules.md` (AM), `system-profiles-and-generations.md` (SPG) and `web-platform-standards-and-forward-profile.md` (WP), from 2026-08.
- **Historical:** the July `Designs/clientv2/` set, where it conflicts with the drafts above.
- **Accepted plans:** the init plan, `Reviews/2026-09-26-client-v2-initialization-plan/README.md` (IP); the M1 brief, `Reviews/2026-11-24-m1-integration-brief.md` (M1).
- **This repo:** `docs/design/`.

**Summary:**

| # | Question | Recommendation | Decided |
|---|---|---|---|
| 1 | Where does the app keep local state and run a Service Worker? | One stable origin for the official app. Everywhere else runs without a Service Worker. | **Queued for James** (which origin) |
| 2 | Writes and settings on shared IPFS path gateways | Read-only there, now. Nothing is persisted, and Connect/Edit explain why. | PM, 2026-11-25: yes, as the next slice |
| 3 | Who selects the running client version? | A local selection record the person changes ("Update, then reload"). Never the Service Worker. | PM, 2026-11-25: yes; AM's four fixtures before any Service Worker ships |
| 4 | Where does rescue live? | A separately retained copy on a second origin, plus a downloadable zip. Never the primary origin's cache. | **Queued for James** (which origin); shape as recommended |
| 5 | Persistent byte cache | Stays memory-only by default. An opt-in "Keep files I open on this device" on stable origins only. | PM, 2026-11-25: yes, with a cap, Clear and re-verify on read |
| 6 | What must work offline first? | The app opens; opted-in files read with their age shown; listings and writes say they need the network. No offline write queue. | PM, 2026-11-25: yes |
| 7 | Install metadata (`manifest.webmanifest`) | Add it now, inert, with a fixed `id`. | PM, 2026-11-25: commit it with `id` `/`, but link it only on the stable origin (see 7) |
| 8 | Storage ownership across tabs | Keep per-store CAS plus Web Locks. Add one lock so a version switch waits for unsettled saves. | PM, 2026-11-25: yes |

---

## 1. Which origin keeps local state and runs a Service Worker? (queued for James)

**Facts:**
- Browser storage, the Service Worker and grants all belong to an *origin*, and how the app is hosted decides what that origin is (AM, "Deployment profiles"):
  - **Stable custom domain or DNSLink site:** the origin persists, so state carries across releases.
  - **IPFS CID-subdomain gateway:** each release is a new origin, so settings, the save journal and any Service Worker start empty at every release (AM).
  - **IPFS path gateway** (`gateway/ipfs/<cid>/`): one origin shared with every unrelated site on that gateway. AM: "never as the OS/Web Client origin".
- Today the build runs anywhere, under any path prefix (`AGENTS.md` rule 8), and stores settings and the journal per origin (`shell.md`).

**Options:**
- **(a) One stable origin for the official app.** The offline/PWA profile runs only there. Other hosts (CID-subdomains, loopback, plain static hosts) run fully online with no Service Worker.
- **(b)** Also run a Service Worker on CID-subdomains. This buys offline per release only, with no continuity.
- **(c)** Run a Service Worker wherever the app runs.

**Recommendation: (a).**
- The app asks for a Service Worker only when the operator's `efs.config.json` names this origin as its stable origin (for example `"delivery": { "stableOrigin": "https://…" }`).
- Everything else keeps working exactly as now.
- **For James:** which origin is the official one. A custom domain over plain HTTPS? A DNSLink name? Both?

**Hard to change later:** yes. Users' settings, saves in progress and installs live on whatever origin they first use. Moving them is an export/import, never automatic.

**Decision:** queued for James; needed only before a Service Worker ships. The PM holds it until after the tag discussion.

## 2. Writes and settings on shared IPFS path gateways (PM; recommended now, independent of offline)

**Facts:**
- On a path gateway, any other site served by the same gateway shares this app's origin. It can read and change the app's IndexedDB: the settings (RPC list) and the save journal.
- A tampered RPC list can't fake a read: the pin and byte verification still hold. It can reroute every read to an endpoint that watches what the person opens.
- A tampered journal could offer a "Continue" for a save the person never made. The wallet would still ask, but the banner would vouch for it.
- Today nothing detects this hosting.

**Options:**
- **(a)** Detect path-gateway hosting (`/ipfs/<cid>/` or `/ipns/<name>/`) and run read-only: settings live for the session only, Connect and Edit explain why and link to an isolated copy, and no journal is opened.
- **(b)** Warn but allow.
- **(c)** Leave as is.

**Recommendation: (a), as a small slice now.**
- Reading stays fully available, so the "host anywhere" promise holds for reading.
- The "isolated copy" link comes from config. The CID-subdomain form of the same CID is derivable.

**Hard to change later:** the longer writes run on shared origins, the more journals and settings exist there that can't be trusted afterwards.

**Decision (PM, 2026-11-25):** (a), as the next slice. On `/ipfs/<cid>/` or `/ipns/<name>/` path hosting, the app runs read-only:
- settings last for the session only;
- no journal is opened;
- Connect and Edit explain why, with a link to the isolated copy (from config, or the CID-subdomain form).

## 3. Who selects the running client version? (PM)

**Facts:**
- The current drafts retire "Service Worker activation as a system pointer" (SPG).
- Neither network delivery nor Service Worker activation may select a generation. The Service Worker is disposable acceleration, and guest reads and foreground writes must still pass with the worker removed (AM; WP: "separate transactions").
- SPG adds: "A malicious same-origin root document or Service Worker can replace the verifier." So the Service Worker must never be the thing that decides which code is trusted.
- The July design, where the Service Worker swaps generations atomically (`Designs/clientv2/packages-and-updates.md`), is historical and conflicts with this.

**Options:**
- **(a) As in AM/SPG.** The Service Worker caches releases keyed by release identity (sha256 of `release.json`). A local selection record (IndexedDB, compare-and-set) names the running release, and only the person changes it: "Update available, then Reload". Old tabs keep their release until they reload. Current and previous releases are kept for rollback.
- **(b) The July model.** The Service Worker swaps on activation.

**Recommendation: (a).**
- The switch also waits on a Web Lock that every tab holds while it has an unsettled save (see 8). Updating never interrupts a save.
- Fixtures from AM before any Service Worker ships:
  - corrupt or partial install;
  - old client with new worker (skew);
  - rollback;
  - the app with the worker removed.

**Hard to change later:** yes. The selection record's format and the "never auto-switch" rule shape every update the person ever sees.

**Decision (PM, 2026-11-25):** (a). The four fixtures above are written before any Service Worker ships.

## 4. Where does rescue live? (origin queued for James; PM for the shape)

**Facts:**
- AM's "Independent rescue contract": rescue "is not merely the prior generation cached under the same origin". At least one exact release is retained outside the primary origin and update path.
- That release must open a public resource and export local state without the primary domain. AM's fixtures "trap a controlling service worker in a boot loop".
- The July design kept rescue inside the cached generations, on the same origin (historical, conflicts).
- The init plan defers `apps/rescue` to stage R and notes that adding it "costs nothing structural".

**Recommendation:**
- The first rescue is this same static build, with no Service Worker, retained as an exact release:
  - a downloadable zip with its `release.json`;
  - a copy hosted on a second origin, outside the primary update path.
- It reads, verifies, and exports what the primary origin's storage allows (or says why origin isolation prevents it).
- It is cheap because the build already runs without a Service Worker.
- **For James:** the second origin.

**Hard to change later:** moderate. The origin should exist before the first Service Worker ships, so the boot-loop fixture has somewhere to escape to.

**Decision:** the origin is queued for James (with question 1). The shape is as recommended.

## 5. Persistent byte cache (PM)

**Facts:**
- Accepted in M1: the default is memory only. Persistence is opt-in through the SDK's `indexedDbByteStore`, which creates nothing on reads, re-verifies on read, and treats a tampered cache as a miss.
- `reads.md`: nothing is persisted today.
- A persistent cache reveals "what you've read" to anyone with the device (July threat model). On a shared origin, it reveals it to other sites too.

**Recommendation:**
- Keep memory-only as the default.
- Add a Settings switch, "Keep files I open on this device (for offline reading)", off by default and available only on the stable origin (1), with:
  - a size cap and "Clear";
  - verified bytes only, re-verified on every read;
  - eviction that is a miss, never "absent".

**Hard to change later:** low, as long as the default stays off.

**Decision (PM, 2026-11-25):** as recommended: memory-only by default, and the opt-in only on the stable origin, with a cap, Clear and re-verify on read.

## 6. What must work offline first? (PM)

**Facts:**
- The drafts: a browser cache "is not protocol truth", and installability is not offline readiness (WP).
- The July design (historical) wants "Available offline" only for fully hash-verified bytes, never a missing transport shown as "not found", and a store-and-forward write outbox.

**Recommendation for the first offline slice (stable origin only):**
- The app opens offline from its cached release.
- Files kept on the device (5) open, labeled "Saved on this device, couldn't check the network". They are never shown as current.
- Pins, listings and Preview of other files say they need the network.
- No offline write queue. Saving needs the wallet and the network, and drafts stay in memory.
- A store-and-forward outbox is a later, separate decision.

**Hard to change later:** low, as long as the copy never claims freshness it didn't check.

**Decision (PM, 2026-11-25):** as recommended.

## 7. Install metadata: `manifest.webmanifest` (PM)

**Facts:**
- AM: "The build carries standards-based install metadata from the first product slice."
- The init plan lists `manifest.webmanifest` (`id`, `scope` and `start_url` all `./`) as build output.
- This repo's `AGENTS.md` defers it. That is the conflict.

**Recommendation:**
- Add it now, inert without a Service Worker, with a fixed `id`.
- An installed app's identity is its manifest `id`. Changing it later makes existing installs a different app.

**Hard to change later:** the `id` is.

**Decision (PM, 2026-11-25):** fix the `id` now, but don't link the manifest everywhere.
- Chrome installs sites without a Service Worker. A manifest linked on every host would let people install from CID-subdomains, path gateways or loopback, each install tied to the wrong origin for good.
- So `apps/web/public/manifest.webmanifest` is committed with **`"id": "/"`**, while `scope` and `start_url` stay `./` (so path-prefix hosting, `AGENTS.md` rule 8, still works).
- Why `/` and not `./`: the `id` is resolved against `start_url`. With `./`, the app's identity would be the directory it's served from, so moving it on the stable origin (from `/` to `/app/`, or back) would turn every existing install into a different app. `/` is the origin root wherever the app lives, and is same-origin with any `start_url`.
- `<link rel="manifest">` is emitted only when `efs.config.json` names this origin as `delivery.stableOrigin`.
- `AGENTS.md`'s deferral line is updated to say exactly this. That lands with the path-gateway slice, which reads the same `delivery` config.

## 8. Storage ownership across tabs (PM)

**Facts:**
- Today each store has its own owner:
  - settings: compare-and-set on `revision`, plus a BroadcastChannel notice (`shell.md`);
  - the save journal: the SDK's per-account Web Lock (IP).
- SPG: "the Web Lock is coordination, while the transactional CAS is correctness."
- The July design had a single elected storage worker owning every write (historical).

**Recommendation:**
- Keep per-store compare-and-set plus Web Locks.
- Add one shared lock that a tab holds while it has an unsettled save. The version switch (3) and any storage migration wait for it.

**Hard to change later:** low.

**Decision (PM, 2026-11-25):** as recommended.

---

**Not asked here:** third-party app runners and separate origins for them, COOP/COEP, and a served CSP header. These are delivery-profile questions too, but nothing in the next slices needs them.
