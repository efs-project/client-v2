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
- **Held back by an earlier save of the same bytes (ALREADY_ATTEMPTED, sdk-v2 31ee83a).** The SDK sends one publication once: while an earlier attempt of the same actions and bodies is open (in flight, or committed and not yet final), a second save of it is NOT_STARTED with reason ALREADY_ATTEMPTED and `twin: { planId, stage, sequenceId? }`. That call sent nothing, and the twin may land or have landed, so it's never "Nothing was saved" (`save-outcome.ts` `held`; its `after-reconcile` retry would otherwise have read as "not sent").
  - The dialog stops the new, unsent save (it would linger as "not sent"), then reads the twin again: through the saves session by its save, or `writer.reconcile(planId)` first when the SDK named none (`apps/files/held.ts`).
  - Which case it is comes from the saves listed (`save-hold.ts` `twinStanding`), by what each save touches. **The same save again** (it touches what the twin's save touches, the SDK named no save, or an effect can't be read): "This is already being saved. Waiting for it to confirm." with no second Send. **Another save of the same bytes** (one image saved into two folders; the same big file again, whose content-only parts are the same publication): "An earlier save with the same contents is still confirming. You can send this once it has.", and on this computer's test chain (every RPC in use local) "…, usually about a minute on this test chain" (the dev chain mines a block a second; final is 64 blocks behind latest on anvil, about 13 minutes on Sepolia).
  - The review keeps its plan, and Send waits until the twin's save is final (or stopped). A twin the saves don't list (another tab's save, or one that dropped off) is unknown, never settled: the dialog asks its attempt (`writer.reconcile(planId)`, `twinFromReconcile`: final or proven not committed lets it go), and offers "Check again" while it waits. It then says "The earlier save with the same contents has confirmed. You can send this now." Sending again starts a new save: its content-only part goes out again (its records gain an occurrence; the bytes and ids don't change), then the name.
  - In the banner, a save held partway (on a resume) reads the same way, and offers Continue to finish (or Send again) once its twin is settled.
  - Tested end to end with the same 150 KiB upload into the root and then docs/ (`client-upload-same-bytes`: held before the wallet, Send waits, 64 blocks and the saves' next check later it sends); the standings and their copy in `save-hold.test.ts`.
- **A tag list reads again after a tag save** (PM, 2026-11-26; `apps/files/tag-edits.ts`). Once a tag save from this tab settles (no longer in flight), and whenever the tab becomes visible again (for a save made in another tab: the saves list isn't shared live), the Preview's Tags section reads again: at once if open, on its next opening if not. **Known gap:** a lagging second endpoint can still serve the re-read from before the save, until the SDK's monotonic reads land (asked for, with the committed block on SequenceProgress); then the re-read asks for a basis no older than the save's block, and a lagging-endpoint test pins it.
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
- **A block a second** (`tools/dev/ticker.ts`): anvil's automine makes a block only per transaction, so on a quiet chain nothing judged at the latest block would move: a save turning final (the endpoint's `finalized` block, 64 behind latest on anvil) or a held save's deadline. `pnpm dev` and `pnpm demo` also mine an empty block every second (`evm_mine`, automine stays on), so "Saved" comes about a minute after "Saved · confirming". The tests' chains never tick: their transcripts stay deterministic, and a test that needs finality mines its 64 blocks itself.
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
9. **Two tabs.** Tab 2 sends nothing while tab 1's save is in flight, either way the tabs meet:
   - **Opened during the save.** Tab 1's wallet request stays open. Tab 2 opens, and its own journal check lists tab 1's save in flight as the tab loads, so once connected its Review already waits (disabled, "waiting"). The test asserts that and never presses Review. Until 2026-11-26 it pressed it, and the press was dropped by the disabled button in every run (the census under "Clicks go through press()").
   - **Open before the save.** Tab 2 opens, edits and connects first: nothing is in flight, and Review is enabled. Tab 1 sends and its wallet request stays open. Tab 2's Review re-lists the journal, finds tab 1's save in flight and waits. This is the re-list at Review, driven for real (`client-two-tabs-relist`).
10. **Wallet switched networks before Send.** NOT_SENT (WALLET_MISMATCH): "Switch your wallet to … on Testnet". The wallet switches back; Send again continues the same save. One broadcast.
11. **Another author changed the file.** Review finds BASE_CHANGED; "Save my edit over the new version" plans from the new head. One send.

Unsaved edits (slice H). `edit-drafts.spec.ts`, against the chain like the cases above:

12. **The file changed while the edit was kept.** Edit, leave the file, and the author saves a new version meanwhile. Back on the file the edit returns, flagged as started on an older version; Review finds BASE_CHANGED and nothing is sent until "Save my edit over the new version". One send, and the saved edit isn't kept as unsaved.
13. **"Review changes" over a newer unsaved edit.** After case 8's lost race, the person starts a newer edit of the file and leaves it. Review changes asks; "Keep my newer edit" changes nothing, "Replace my newer edit" stops the old save and reopens its text. One send.

`drafts.spec.ts` (replayed reads, no saving, all browsers) covers leaving and coming back, Cancel asking (Keep editing, Escape, Discard), an unchanged edit keeping nothing, a kept edit whose file can't be read (said, and discardable), the leave-page prompt only while an edit is unsaved (and Chromium's real prompt on closing the tab), and the discard dialog by keyboard alone with axe in light and dark.

**Deterministic timing.** The reload test pauses the page clock as soon as the lost send is seen. The SDK's next ledger check waits on a timer, so it can't start; its first check finishes on answers already in flight. The test leaves once no RPC is in flight (`chain.idle()`), so the recording and its replay always contain exactly one check before the reload.

**Transcripts are recorded, never edited.** Replay matches calls by order, so the order belongs to the caller: the client records its own (agreed with the SDK dev, 2026-11-24). The SDK's edit transcripts remain the SDK's contract tests.

- **A case ends only after its last reads have answered** (`await chain.idle(500)`). Otherwise a recording can stop while a read is still in flight, and the faster replay then makes that read and misses. An assertion the previous step's screen already satisfies (the same "This folder is empty.") proves nothing: assert something only the new step's reads can produce.
- **Repeated identical calls are answered in recorded order within an epoch** (`eth_getBlockByNumber "latest"` above all): an extra read gets that epoch's answers again, never a later block's ("Replay follows the chain's head", below). To find a call-order difference, log the replay's own order on the Node side (in `chain.ts`'s `answerRpc`): a page-side fetch wrapper changes the page's timing and can hide it.
- Re-record after any change to the client's call order. A re-record rewrites every value (fresh block hashes and timestamps), so review the diff for changes in the calls' shape, not their values.
- Two recordings of the same order have produced identical call shapes, except where the client itself runs two readers at once: in the reload test's second load, the Preview and the saves check read concurrently from an unchanging chain, so their calls can interleave either way. Replay matches calls by method and parameters, so either order replays. Any other difference is SDK nondeterminism: send the diff to the SDK dev.
- Recordings are excluded from Biome, so no tool rewrites them.

### Send once

- **One press, one save.** A button's handler sees the page as it was rendered, so a second activation before the page re-renders used to start a second save of the same plan, and on a live chain, while the first was still pending, a second wallet prompt. Every control that starts or continues a save is now single-shot, twice over:
  - **The claim.** The folder dialog's and the editor's Send start only while the exact review pressed is still the current one, and set "sending" before anything is awaited. The saves banner's Continue to finish, Send again and Try again (each a `resume`), and its Stop and Review changes, run one writer call at a time: the first claims the banner (busy) before it awaits anything, and a press while it's busy does nothing.
  - **The button.** The pressed button is disabled at once (`ui/press-once.ts`), and wa-button drops clicks while disabled; its `.disabled` is bound with `live()`, so the next render sets it from the state again.
  - Found while decoding the "Tag from the Preview" replay miss (`0xd62efcd9`, `acceptanceProfileOf`, the planner's read at send) with the SDK dev, who also made the SDK hold back a second send of a publication still in flight (ALREADY_ATTEMPTED). That miss turned out to have another cause (below, "Replay follows the chain's head").
  - **Tested** by pressing twice three ways (`DOUBLE_PRESSES` in `tests/e2e/edit-support.ts`: both presses in one task, a double click, Enter then a click) on the folder dialog and the editor, and twice in one task on the banner's Continue: one wallet request each, and one `efs:send` mark per send started (the page's own count; the SDK's own guard would hide a second one from the wallet count). Without the claim and the disabling, the three in-one-task cases fail; either one alone passes them. A double click and Enter then a click are already stopped by the re-render between them, so they pin what a person does rather than the bug.

### Clicks go through press()

- **A disabled wa-button looks enabled to Playwright.** The native button sits inside the host's shadow root, so Playwright's actionability check sees only the host and counts it as enabled, even while the button is disabled or loading. It clicks, and wa-button drops the click: the inner button is disabled, and wa-button's handler stops a loading button's click before ours runs. A test that pressed a button it believed enabled could pass for the wrong reason.
- **`press(target)` (`tests/e2e/press.ts`).** For a wa-button (the host, or anything inside it), `press()` waits until it is neither disabled nor loading, then clicks. Any other target gets Playwright's own checks. Every click in `tests/e2e` goes through it. `tools/checks/e2e-press.test.ts` (in `pnpm check`) refuses a raw `click`, `dblclick`, `tap`, `mouse.click` or dispatched click. The one exception is a line marked `press-raw:` with its reason: the double-press tests (`DOUBLE_PRESSES`) press a disabled button on purpose.
- **The census, when it went in (2026-11-26).** `EFS_PRESS_CENSUS=<file>` keeps the old behaviour and logs every wa-button press's state. It covered every replayed test in the three browsers, the live job, and the double-press loops: 1,498 presses at 260 call sites. One site was disabled at the press: case 9's Review, in every run (3 browsers replayed, plus live). No press was ever on a loading button.
- **What assistive technology sees.** Checked in Chromium, Firefox and WebKit: a disabled wa-button is exposed as a disabled button, through its inner native button (the host has no role). So no `aria-disabled` is needed on the host. Adding one changes nothing for Playwright either, since its host check still counts the host as enabled, and axe is silent either way. A loading button is not exposed as disabled (it is `aria-busy`, with a "Loading" progress bar).

### Replay follows the chain's head (sdk-v2 e229ea3)

- The harness records with `createRecorder` and replays with `createReplay` (`tests/e2e/chain.ts`). RPC calls, wallet calls and marks share one sequence, and every recorded answer belongs to the epoch it was recorded in: the number of gates before it. A gate is a page wallet write, an `eth_sendRawTransaction`, or a mark for a head move the page didn't make (`editAs #n`, `actAs #n`, `mine n`, `automine on|off`).
- So a page that reads "latest" more often than the recording did gets the same head again, never the one a later write produced, and a pending receipt stays null until its `mine` is marked. `chain.editAs`, `actAs` and `control` exist in every mode: in replay they only mark. Writes stay strict (an unrecorded or repeated write, or a mark out of order, is a miss), and `finish()` turns any gate never served into a miss. Reads replay forgave are counted per case and printed (`extraReads`).
- **Lifted:** the WebKit quarantine on `tags.spec.ts` "Tag from the Preview…" (2026-11-26). Its cause was the old replay's ordering: in about 1 run in 40 under load, WebKit read the latest block once more around Review than the recording did, the extra read took Send's answer, and the tag was planned at the block it lands in. Not a second save (that real bug, a second activation before the re-render, is fixed separately above).

### Watch

- **2026-11-26, WebKit, `edit-failures.spec.ts` "a second tab waits for the first tab's save, and never sends meanwhile" (case 9).** It failed once in a full run (491 passed) at the 30 s test timeout. Tab 1's `eth_sendTransaction` (gate seq 34, "From tab one.") was never served. Since then it has passed 60 of 60 alone in WebKit at 8 workers, and the next full run was clean. The trace was overwritten.
  - **Decoded from the log alone.** A bare "Test timeout" with `finish()`'s error after it is the shape of a Playwright action outliving the test timeout (there is no `actionTimeout`, so a click waits that long). `finish()`'s throw in the `finally` then replaced that action's call log. It was not the plain `await held.reached`: a promise that never settles never lets the `finally` run, so nothing would have followed the timeout.
  - **Two cases remain, which the log can't tell apart.** Either tab 1's Send never became clickable, so nothing was sent; or one of tab 2's actions stalled after the send reached the hold, so the send was held and never released.
  - **The next occurrence decodes itself** (`tests/e2e/chain.ts`):
    - `finish()` reports misses and harness errors softly, beside the test's own error, so a stuck action's call log (which locator, "not enabled" or "not stable") survives.
    - It names each unserved gate: its seq, its label and who makes it (the page's wallet or RPC, or the test's actor or chain control).
    - It gives the steps reached against the recorded count, and where `holdNextSend()` got to: "armed" (never sent) or "reached" (never released).

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
