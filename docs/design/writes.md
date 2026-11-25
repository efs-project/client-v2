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
  - After such a save, "Show my version" switches this file's view to `mineFirst(account)` for this tab. The view never switches by itself.
- **Review copy.**
  - Who sees the edit: "Your edit appears to anyone whose lens includes you."
  - How many approvals: one, or one per part (one if the wallet sends batches).
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

## Testing

`tests/e2e/edit.spec.ts` drives the real UI and SDK through the whole flow, in three modes (`tests/e2e/chain.ts`):

| Mode | Where | Chain | Wallet |
|---|---|---|---|
| replay (default) | every PR, all three browsers (`pnpm test:e2e`) | this client's recorded transcripts, strict: any miss fails | the transcript's wallet half, strict: a second `eth_sendTransaction` fails |
| live | required CI job `e2e-live-chain` (PRs, main, nightly), Chromium (`pnpm test:e2e:live`) | a fresh `@efs/fixture` chain per test (anvil 1.8.3) | signs through anvil's unlocked account #6 |
| record | `pnpm transcripts:record` (needs anvil) | live, through the SDK's `recordingFetch` | live, through `recordingProvider` |

The cases:
1. Edit, review (with the "not visible in this view" warning), one approval, "Saved · confirming", then Show my version reads the edit back.
2. The PM's proof. The wallet broadcasts, but its answer is lost, and the page is left while the transaction is pending. The next load settles the save from the ledger with no wallet request ("Saved · confirming"). After finality the banner says "Saved". One `eth_sendTransaction` in all.
3. A guest reading a file creates no journal database and touches no wallet.

**Transcripts are recorded, never edited.** Replay matches calls by order, so the order belongs to the caller: the client records its own (agreed with the SDK dev, 2026-11-24). The SDK's edit transcripts remain the SDK's contract tests.
- Re-record after any change to the client's call order. A re-record rewrites every value (fresh block hashes and timestamps), so review the diff for changes in the calls' shape, not their values.
- Two recordings of the same order have produced identical call shapes. If they ever differ, that is SDK nondeterminism: send the diff to the SDK dev.

## Bundle

| Chunk | gzip | Loads when |
|---|---|---|
| Startup (HTML, probe, JS, CSS, sprite) | 128,933 B brotli | always (+3.2 KB for the saves banner, outcome rules and writer session) |
| Wallet discovery + connect | 1.3 KB | Connect is clicked |
| Journal check | 1.4 KB | a verified session starts |
| SDK actions (writer, sequences, journal view) | 11.9 KB | something is open in the journal, or the person saves |
| SDK files (reads, planEditFile) | 16.7 KB | a file is opened |

## Later

- `onProgress` (SDK #31) for "Approve part 2 of 5 in your wallet" during long sequential saves.
- A draft kept across navigation. Today, leaving the file closes the editor, and an unsent draft is lost; nothing is ever saved silently.
- The author's display name in place of a shortened principal id.
- Live deployment documents must carry the `chain` block before writes ship. Without it, planning answers UNKNOWN ("Couldn't check the file on the network").
