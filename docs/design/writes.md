# Writes: connect, edit, review, save (slice C)

**Status:** working design for slice C (the write foundation), in scope per the integration owner on 2026-11-24. Builds on the shell (`shell.md`) and verified reads (`reads.md`). Copy rules are the PM's (M1 brief, 2026-11-24); SDK semantics are the SDK's (`@efs/sdk/actions`, `@efs/sdk/files`).

## What it does

- **Connect, only on click.** The header's Connect button (or "Connect a wallet" in the editor) runs EIP-6963 discovery, falling back to an injected `window.ethereum`. With one wallet it connects at once; with several the person chooses. A wallet on another chain is flagged, and switching is one explicit prompt ("Switch wallet to <network>"). Disconnect forgets the connection in this tab.
- **Edit a text file from the Preview.** Files opened by object link whose contents are verified, text, and shown in full get an Edit button. Typing needs no wallet. "Review and save" needs the connected writer, on the network in view.
- **Review, then one approval.** The review dialog shows what the SDK planned, then Send. Typically that's one wallet approval (one per part for a large edit).
- **The banner owns a save once the wallet has answered.** It shows "Saved · confirming" until the save is final, then "Saved" (until dismissed). It also shows "Partially saved (k of N)" with Continue to finish and Stop this save, and "undone by the network" with Send again.
- **Resume on start, wallet-free.** On a verified session the tab settles interrupted and confirming saves from the ledger alone, and lists what still needs the person.

## Data flow

```text
click Connect ─> platform/wallet (lazy) ─> wallet session ─┐
reader session (verified) ─────────────────────────────────┼─> writer session ─> writer (lazy SDK actions,
network in view ───────────────────────────────────────────┘    (availability)    IndexedDB journal)

Preview ─> Edit ─> planEditFile (view's Lens) ─> review dialog ─> runSequence ─> saving.track(progress)
                                                                                      │
saves session <── journal (non-creating check) <── every verified session start ◄─────┘
     └─> banner: Saved · confirming → Saved · Partially saved → Continue (resume) · Stop (abandon)
```

- Apps never get the wallet. `AppHost.saving` offers four things: `availability` (NO_SESSION, NO_WALLET, WRONG_CHAIN or READY), `requestWallet()` (opens the shell's wallet dialog, from a click), `writer()`, and `track(progress)`.
- One writer per (SDK instance, wallet provider, account). The account is passed to the SDK explicitly, so the writer signs as exactly the account shown.
- The saves session is created at boot, but loads nothing until a session is verified. Then it asks the small journal module "is anything open?" without creating storage. The SDK's write code loads only if the answer is yes.

## Defaults that protect the person

- **No wallet before a click, no storage before a save.** Guest boot touches no wallet, and creates no journal database until the first real submission. The e2e suite asserts both.
- **Plan in the view's Lens.** The edit is planned in the link's Lens, else the default. The base check and `review.visibleInLens` are therefore about what the person is looking at.
  - When the view won't show the edit (`visibleInLens` false: the Lens leaves the author out, or puts another author first), the review says so before Send: "Your edit will be saved, but this view shows <author>'s version first."
  - After such a save, "Show my version" switches this file's view to `mineFirst(account)` for this tab. The view never switches by itself, apart from the identity changes below.
  - **"You" first when connected (D10; built)** (PM, 2026-11-25, from James's *"me, vitalik, public"* example; `tags.md`, Whose entries).
    - The view's lens becomes: the connected account, then the place's owner, then the link's or default lens, then public. A link that carries its own lens keeps it: the view is the sharer's (`object-kind.ts` `readLens`, used by both the object read and the Preview, so the opened file is still reused in the same lens). An identity change reads the file again under the new order.
    - **An unsaved edit keeps its base** when connecting or disconnecting reorders the view (slice H's rule). Review plans from the kept base, never from the newly shown version, so BASE_CHANGED asks before anything is saved over.
    - **A reorder is never silent.** When connecting changes what a file shows, the Preview says so: "Showing your version · also: <author>'s". An unsaved edit reopened under the new order says "This view now shows your own version first, so saving will ask before replacing it", never "changed".
    - **Order changes only on an identity change** (connect, disconnect, account switch) **or a lens change the person makes.** Otherwise "the view never switches by itself" still holds.
    - **The review's "this view shows <author>'s version first" is computed from the lens at review time.** With "you" first, it appears only when the person put someone else first, or opened a link that carries its own lens.
    - **Test, when built:** start an edit on the owner's version as a guest, then connect a wallet that has its own version of the file. The editor stays on the owner's text, and Review plans from the owner's revision as its base. It never saves over the person's own version, or the owner's, unasked.
    - **A reorder isn't a change.** The SDK's base check is "the file's HEAD under the lens must still be `base`". With "you" first, that plan answers BASE_CHANGED with `head` set to the person's own version (SDK, via the PM, 2026-11-25).
      - The editor tells this apart from a real change: it's a reorder when `headAuthor` is the connected account and `headAdmission` is no later than the admissions of the basis the edit began from. That count is kept with the edit's base in the unsaved draft, so coming back later still tells the two apart.
      - A reorder gets its own copy, never "This file has changed since you started it": "You connected, and this view now shows your own version first. Save over it, or keep editing the version you started from?" (draft, PM-accepted).
      - Saving over keeps the person's older version in history. "Keep editing the version I started from" changes nothing and sends nothing; the next Review asks again.
      - **The person's own version saved elsewhere after the edit began** (another tab) is a change, not a reorder: "Your own version of this file changed since you opened it (another tab or device saved it)", with the change's choices (save over it, or discard and show it). Under a sharer's lens, where the view's head is still the other author's, the plan goes through and the editor says so first ("Review and save anyway").
      - The SDK gives BASE_CHANGED `headAuthor` and `headAdmission` (sdk-v2, compare with `Basis.admissions`).
- **Review copy.**
  - Who sees the edit: "Your edit appears to anyone whose lens includes you."
  - How many approvals, from `review.prompts` only: one, or one per part; when a wallet that sends batches would be asked fewer times (`prompts.atomicBatch`, packed by gas), that count too (`apps/files/approvals.ts`).
  - Size, SHA-256, layout, author, the new revision, and the overwrite protection from `review.guard`. `own-head` means the ledger refuses the save if the person's own version moved. `lens` means they are editing someone else's version, and the save becomes their own.
- **Never "saved" before COMPLETE.** "Saved · confirming" lasts until every part is at a finalized block, then "Saved". Outcomes branch on the state, then on `reason.code`, `reason.retry` and the structured fields (`reason.revert`, `reason.wallet`), never on `detail` text.
- **Continue only when the same plan can finish.** That means `retry` is transient or after-reconcile (or there's no reason yet, after a reload). After-replan means continuing would fail the same way every time:
  - A race lost by the finishing part (`reason.revert.error === "E_CAS"`) reads as "This file changed while your edit was saving", not as a partial save.
  - Any other after-replan stop is offered only "Stop this save".
- **Abandon is not undo.** "Stop this save" first asks: "Parts already sent stay on the network but won't appear as a file."
- **A reorg is the network's doing.** "This save was undone by the network" is re-sent only when the person presses Send again.
- **Continue needs the account that started the save.** With no wallet (or the wrong network), it opens the wallet dialog. With another account, it says which account to switch to; the SDK would refuse the mix-up anyway.
- **Not sent stays visible.** A refusal in the review keeps the dialog and the text, with "Send again" (which resumes the same save). Cancel drops a save that was never sent. A thrown JOURNAL_UNAVAILABLE (for example a private window) reads as "saving is turned off here".
- **The wallet's answer is not success.** The banner reconciles against the ledger: every 4 s while a part is in flight, every 12 s while confirming. One save that can't be read right now keeps its last known state and hides nothing else.

## Unsaved edits (slice H)

An edit survives moving around the app. Open another file, another app or Settings, come back, and the editor is open on the same text: "Your unsaved edit is back." It lives in this tab's memory only (`shell/drafts.ts`: one per file, keyed by the file's canonical route). Nothing is written to storage, so the shared-gateway rule and the "storage only for settings and the journal" rule are unchanged.

- **The edit keeps its base.** It's kept with the revision it started from (or the newer one the person chose to save over), not just its text. If the file changed while the person was away, the editor says "This file has changed since you started it", and Review plans from the old base, so it finds BASE_CHANGED and asks. Without the base, coming back would plan from the new version and save over another author's change unasked.
- **Discarded only after asking.** Cancel with changes opens "Discard your edit?". Keep editing is focused first, so Enter or Escape keeps the edit and returns to the text; Discard takes a deliberate Tab. Cancel with no changes closes at once. Typing back to the original text keeps nothing.
- **Closing the editor ends the edit.** Saving (the banner keeps the text for "Review changes"), Discard, and "Discard my edit and show the new version" all drop the kept edit. Leaving the file never does.
- **"Review changes" never replaces a newer edit unasked.** If the person has since started a different unsaved edit of that file, the banner asks first: "Replace my newer edit" stops the old save and brings its edit back; "Keep my newer edit" changes nothing.
- **A reload or closing the tab asks first** while any edit is unsaved (the browser's own "Leave site?" prompt, from `beforeunload`). The listener is attached only while an edit exists, so the page stays eligible for the back/forward cache otherwise. iOS Safari has no `beforeunload`: there, a reload or closing the tab loses the edit without asking (`docs/web-platform/feature-policy.md`).
- **An edit the editor can't show is still reachable.** If the file can't be opened as editable text when the person comes back (gone, no longer text, too large, or unreadable right now), the Preview says "You have an unsaved edit of this file…" with "Discard my unsaved edit", so the leave prompt never sticks with no way to clear it. A later read that gets the text reopens the editor on the edit.
- **Not yet:** a marker on files with unsaved edits in the file list. That waits for folder listing, which is held.

## Dev accounts on the local test chain

`pnpm dev` and `pnpm demo` offer **EFS dev accounts** in the ordinary wallet picker, beside any installed wallet: twenty personas in v1's order (Satoshi Nakamoto, Hal Finney, … James Carnley; `tools/dev/personas.ts`), each a test account on this computer's anvil. It's the modern shape of a "burner" without its stale-key problems: no keys in the browser and no wallet library, just a dependency-free EIP-1193 provider (`platform/wallet/dev-accounts.ts`) that forwards a send to the dev chain with `from` set to the persona, and lets the chain sign. Anvil unlocks the first ten; the dev tool impersonates and funds the other ten at start, and checks each unlocked address against its persona.

- **Only a local test chain:** the generated `efs.config.json` lists the network's `devAccounts` (names and addresses). The client keeps them only for a network whose RPCs are all on this computer, and offers them only while every RPC in effect still is (`devAccountsOf`). A hosted config can never offer them. The provider and its chooser load when the person clicks Connect, never at startup.
- **Labelled everywhere:** the chooser and the wallet panel say "Dev account: local test chain only"; the header shows the persona's name.
- **Choosing and switching:** connecting asks which persona (the provider's own prompt, `shell/dev-accounts-ui.ts`); "Switch persona" in the wallet panel asks again (`wallet_requestPermissions`, then `accountsChanged`), an identity change under every existing rule: holds by signer, "you first" reading again, whose labels. Batches are refused (4200), so saves go part by part.
- **Per tab:** each tab's persona is its own, kept across a reload in `sessionStorage` (the one storage key outside the settings record and the save journal, written only when the person picks one, and on a local test chain only), so two tabs can be two people side by side.
- **Names beside addresses:** on that network, authors read "Satoshi Nakamoto · 0xf39F…2266" wherever the app names one (`authorLabel` with the host's `names`).
- **Tests:** `tests/e2e/dev-accounts.spec.ts` connects with the dev accounts on a local-RPC config, saves as Satoshi, switches to Adam Back and saves as him, checking whose labels and own-entry actions follow the switch. The harness answers the local RPC origin from its own chain (anvil, then the transcript).

## Testing

`tests/e2e/edit.spec.ts` and `tests/e2e/edit-failures.spec.ts` drive the real UI and SDK through the whole flow, in three modes (`tests/e2e/chain.ts`):

| Mode | Where | Chain | Wallet |
|---|---|---|---|
| replay (default) | every PR, all three browsers (`pnpm test:e2e`) | this client's recorded transcripts, strict: any miss fails | the transcript's wallet half, strict: a second `eth_sendTransaction` fails |
| live | required CI job `e2e-live-chain` (PRs, main, nightly), Chromium (`pnpm test:e2e:live`) | a fresh `@efs/fixture` chain per test (anvil 1.8.3) | signs through anvil's unlocked account #6 |
| record | `pnpm transcripts:record` (needs anvil) | live, through the SDK's `recordingFetch` | live, through `recordingProvider` |

The cases:
1. Edit, review (with the "not visible in this view" warning), one approval, "Saved · confirming", then Show my version reads the edit back.
2. The PM's proof. The wallet broadcasts, but its answer is lost, and the page is left while the transaction is pending. The next load settles the save from the ledger with no wallet request ("Saved · confirming"). After finality the banner says "Saved". One `eth_sendTransaction` in all.
3. A guest reading a file creates no journal database and touches no wallet.

The failure cases, all in one tab (slice D). Each asserts what the wallet was asked to send, and, live, what it broadcast:

4. **Lost answer, same tab.** The wallet broadcasts but its answer is lost; the SDK settles the part from the ledger: "Saved · confirming". One send.
5. **Storage lost right after a send.** IndexedDB writes fail once the wallet has answered. The page says "We couldn't confirm this save yet", and the editor holds new saves. When storage is back, the banner settles it. One send.
6. **Own version changed before Send (E_CAS).** The same account saves the file elsewhere between Review and Send. The ledger refuses before the wallet is asked; the editor says the person's own version changed and offers "Review and save anyway". One send in all.
7. **A declined part.** A two-part (150 KiB) edit; the wallet declines part 2. The banner says "You declined part 2", and Continue finishes it. Each part is broadcast once.
8. **The finishing part loses a race (PARTIAL + E_CAS).** The same account saves the file elsewhere before Send. Part 1 (content) lands; the bind is refused. The banner says the file changed while saving, and "Review changes" stops the old save and reopens the editor with the person's text.
9. **Two tabs.** Tab 1's wallet request stays open; tab 2's Review re-lists the journal, finds tab 1's save in flight and waits. Tab 2 sends nothing.
10. **Wallet switched networks before Send.** NOT_SENT (WALLET_MISMATCH): "Switch your wallet to … on Testnet". The wallet switches back; Send again continues the same save. One broadcast.
11. **Another author changed the file.** Review finds BASE_CHANGED; "Save my edit over the new version" plans from the new head. One send.

Unsaved edits (slice H). `edit-drafts.spec.ts`, against the chain like the cases above:

12. **The file changed while the edit was kept.** Edit, leave the file, and the author saves a new version meanwhile. Back on the file the edit returns, flagged as started on an older version; Review finds BASE_CHANGED and nothing is sent until "Save my edit over the new version". One send, and the saved edit isn't kept as unsaved.
13. **"Review changes" over a newer unsaved edit.** After case 8's lost race, the person starts a newer edit of the file and leaves it. Review changes asks; "Keep my newer edit" changes nothing, "Replace my newer edit" stops the old save and reopens its text. One send.

`drafts.spec.ts` (replayed reads, no saving, all browsers) covers leaving and coming back, Cancel asking (Keep editing, Escape, Discard), an unchanged edit keeping nothing, a kept edit whose file can't be read (said, and discardable), the leave-page prompt only while an edit is unsaved (and Chromium's real prompt on closing the tab), and the discard dialog by keyboard alone with axe in light and dark.

**Deterministic timing.** The reload test pauses the page clock as soon as the lost send is seen. The SDK's next ledger check waits on a timer, so it can't start; its first check finishes on answers already in flight. The test leaves once no RPC is in flight (`chain.idle()`), so the recording and its replay always contain exactly one check before the reload.

**Transcripts are recorded, never edited.** Replay matches calls by order, so the order belongs to the caller: the client records its own (agreed with the SDK dev, 2026-11-24). The SDK's edit transcripts remain the SDK's contract tests.

- **A case ends only after its last reads have answered** (`await chain.idle(500)`). Otherwise a recording can stop while a read is still in flight, and the faster replay then makes that read and misses. An assertion the previous step's screen already satisfies (the same "This folder is empty.") proves nothing: assert something only the new step's reads can produce.
- **Repeated identical calls are answered in recorded order** (`eth_getBlockByNumber "latest"` above all). A read that starts and is aborted in one browser but not another uses up an answer and shifts later reads onto the next block. To find one, log each browser's JSON-RPC sequence (`page.on('request')`) and diff them.
- Re-record after any change to the client's call order. A re-record rewrites every value (fresh block hashes and timestamps), so review the diff for changes in the calls' shape, not their values.
- Two recordings of the same order have produced identical call shapes, except where the client itself runs two readers at once: in the reload test's second load, the Preview and the saves check read concurrently from an unchanging chain, so their calls can interleave either way. Replay matches calls by method and parameters, so either order replays. Any other difference is SDK nondeterminism: send the diff to the SDK dev.
- Recordings are excluded from Biome, so no tool rewrites them.

## Bundle

| Chunk | gzip | Loads when |
|---|---|---|
| Startup (HTML, probe, JS, CSS, sprite) | 128,933 B brotli | always (+3.2 KB for the saves banner, outcome rules and writer session) |
| Wallet discovery + connect | 1.3 KB | Connect is clicked |
| Journal check | 1.4 KB | a verified session starts |
| SDK actions (writer, sequences, journal view) | 11.9 KB | something is open in the journal, or the person saves |
| SDK files (reads, planEditFile) | 16.7 KB | a file is opened |

## Later

- The author's display name in place of a shortened principal id. Held (PM, 2026-11-25): names come from ENS (network calls beyond the person's RPC list, a privacy question) or from EFS labels (C5, tied to the tag discussion).
- Live deployment documents must carry the `chain` block before writes ship. Without it, planning answers UNKNOWN ("Couldn't check the file on the network").
