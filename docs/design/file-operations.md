# File operations in the File Browser: flows and copy

**Status:** draft flows and copy for the integration owner's (PM's) review, revised for the 2026-11-25 decision-sheet defaults (folder paths live under an address; a folder adds its creator to the lens). No code yet. Each flow is wired only to the SDK's real exports, once they land. There's no protocol stand-in in the meantime.

**Scope:**
- **In scope:** list a folder from the realm root; create a file; create a folder; rename and move; remove your own entry and restore it; filter by Type.
- **Needs no contracts change.** Under T-1 a folder is a Files directory, so all of this needs only the SDK (planning M1 integration brief, 2026-11-25 row "Tag work order, split by the T-2 re-check").
- **Waits for a contracts release:** tags, homes, and hiding another author's entry (`tags.md`).

**Sources:**
- SDK draft PR #36 (`docs/design/files-folders-tags-0.1.md`): read and planner shapes, and hard cases 1–3 and 7;
- planning `Designs/clientv2/file-browser-requirements.md`: A1 organize, A2 ingest, A7 and B4 honest removal, A9 keyboard, L1–L5 lenses;
- `writes.md`: review, the banner, and the copy rules, which every flow here reuses unchanged.

## The rules every operation follows

1. **One review, one approval.**
   - Every operation is planned by the SDK, shown in the existing review dialog, then sent with `runSequence` and tracked by the banner.
   - Typically that's one wallet prompt (D4). A batch the SDK splits by gas says how many approvals it needs, as edits already do.
   - The review carries the gas figure in plain numbers (T-3).
2. **No wallet before Review.** Choosing a name or a destination needs no wallet. Review asks for the connected writer, on the network in view, through `requestWallet()`.
3. **Your entries only.**
   - In EFS v2 a folder's entries are per author, and the lens decides which one a name shows.
   - Rename, Move and Remove are offered only on entries the connected account wrote. On another author's entry they're shown disabled, with the reason: "This is <author>'s entry. You can rename, move or remove only your own."
   - Hiding another author's entry waits on contracts.
4. **Pending isn't done.**
   - Until the banner says "Saved", the listing shows the change with a "Saving" badge (A1's optimistic UI over the journal).
   - A stop shown in the banner (partial, "undone by the network") also shows on the row.
   - A pending entry is never shown as a settled one.
5. **Names are checked by the SDK, as the person types.**
   - `checkName` (files-name/2) is already exported, and its rule picks the inline message. The client has no name rules of its own.
   - A name that isn't in NFC form is allowed, as the profile allows it. The dialog says so: "This name isn't in the usual Unicode form, so a name that looks the same could be a different name. It will be saved exactly as typed."
6. **A listing never reads as empty when it isn't known.**
   - Pages are COMPLETE or PARTIAL (#36 hard case 1). An empty PARTIAL page says "Nothing in the first 200 entries. [Keep looking]".
   - UNKNOWN shows its reason with Try again (`reads.md`).
7. **Read-only where writes can't happen.**
   - On a shared IPFS path gateway, and while the reader session isn't VERIFIED, the operations aren't offered.
   - A read-only gateway shows the existing explanation and the isolated-copy link.

## Listing a folder

```text
/ photos / 2026                                      [ New ▾ ]  Type: [ All ▾ ]
───────────────────────────────────────────────────────────────────────────
▸ trips            Folder
  cat.jpg          Image · 48 KB                              ⋯
  notes.txt        Text · 2 KB · Saving                       ⋯
  draft.md         Text · 0x9f…01                     (not yours, actions off)
                                                      [ Show more ]
```

- **Links** (decision-sheet default, 2026-11-25).
  - **Folder paths live under an address:** `#/r/<realm>/0x…/photos/2026`. A bare path is a topic, never a folder.
  - **The realm's shared root folder gets no link of its own.** So until addresses are places (contracts C8), a folder opens by its permanent object link (`~efs/o/<id>`), like a file.
  - **The File Browser shares only permanent links until then:** no folder path link is shared (PM, 2026-11-25).
  - The canonical form replaces a typed link, as object links do today.
- **The breadcrumb.**
  - **For a folder path under an address,** it comes from the resolved chain, with each segment's author, so "whose `/photos`" is answerable (#36 hard case 4).
  - **For a folder opened by its object link,** it shows how the person got there in this tab, because folders form a graph and have no single parent (#36 hard case 5). Opened fresh from a link, it shows only the folder's own name.
- **Whose entries.**
  - A folder view reads through the lens with the folder's creator inserted after "you" (decision-sheet default: a folder adds its creator, as an address does), and public last, on by default.
  - The lens line, the "everyone" switch and the media gate are the ones in `tags.md`.
  - **With public on, several versions from everyone** of one name, none from the lens, show as one row that opens a list, oldest first (decision-sheet default).
- **What a path that doesn't resolve shows:**
  - **ABSENT_PROVEN at a segment:** "Nothing is called "2026" in /photos now. It may have been renamed or moved." When the SDK offers `files.placements`, it adds "Find it by its permanent link".
  - **MASKED:** "Removed by an author in your lens."
  - **CONFLICT:** the existing "Authors in your lens disagree".
- **Rows.**
  - Folders come first, then files, each in the SDK's order, plus Type and size.
  - The author is shown only when it isn't the person (lens requirement L1: no lens chrome until it changes an answer).
- **Opening.**
  - A folder opens its listing.
  - A file opens in the Preview, by its object link. That keeps the permanent link in the address bar, and keeps the Preview's existing verified-read path.
- **The tree** (the navigation pane) shows folders only, loaded one level at a time when expanded, never recursively (#36 hard case 5: folders form a graph, not a tree).
- **Phone.** Choosing an entry moves to the next pane (`shell.md`'s planned drill-in, which arrives with real data).

## Filter by Type

- **The SDK filters on each row's header Type id.** The chain enforced that Type, so it can't be spoofed, and no contracts work is needed.
- **The menu offers All, Folders, Files and Other.** "Files" is every Files content Type. "Other" covers Types the File Browser doesn't show, such as a chess app's.
- **Rows the filter removed are counted, never hidden silently:** "Showing folders · 14 other entries hidden by the filter". An empty filtered page says "No folders in the first 200 entries. [Keep looking]", never "No folders".
- **The filter is view state, kept for this tab.** It isn't put in the link, so a shared folder link isn't filtered for the person who opens it.

## Create a file

**New ▾** offers New text file, New folder and Upload files.

- **New text file**
  1. **Name** (`checkName` as typed), in a small dialog.
  2. **Write:** the Preview opens the existing editor on an empty document.
  3. **Save:** "Review and save" plans `planCreateFile({ parent, name, content })`.
  - The unsaved-edit rules of slice H apply from the first keystroke. A new file's draft is kept under its folder and name until saved.
- **Upload files**
  - Upload uses a file picker, or drag and drop onto the Entries pane.
  - The media type comes from the bytes' signature, never from the extension alone. The Preview already checks signatures.
  - Size limits are the SDK's. A file too large for one save shows its part count in the review, before Send.
- **A name that's already taken** in this folder:
  - **By the person's own entry:** the plan is refused at Review with "You already have something called "notes.txt" here. Choose another name, or open it to save a new version." That's the skip / new version / rename choice of A2.
  - **By another author's entry:** allowed, because entries are per author. The review warns as edits do: "Your file will be saved, but this view shows <author>'s "notes.txt" first."
- **After Send:**
  - the row appears with "Saving";
  - the banner says "Saved · confirming", then "Saved";
  - the new file opens in the Preview once its object link exists.

## Create a folder

- **New folder** opens a name dialog, then a review of `planCreateFolder({ parent, name })`, then Send. The SDK sketch's `planCreateNode` becomes a directory planner under T-1.
- **The same name rules and the same name-taken handling** as files apply.
- **An empty new folder says** "This folder is empty". That copy is used only when the SDK reports COMPLETE.

## Rename and move

They are one SDK operation: one atomic change of placement (#36's `planRenameFile`, which also moves).

- **Rename.**
  - It starts from the entry's ⋯ menu or F2, and edits the name in place (A9).
  - Enter goes to the review, and Escape cancels.
  - The review says: "Rename "notes.txt" to "plans.txt". Links to this file keep working. Links that use its old path won't find it there."
- **Move.**
  - It starts from "Move to…" in the ⋯ menu, which opens a folder picker (the tree, folders only).
  - The person can move an entry into any folder, including one another author made. The review says who will see it there: "Your entry appears in /team/plans for you, for anyone whose lens names you, and for everyone with public on."
  - A folder can't be moved into itself or below itself. The picker greys those out, and the SDK refuses them too.
- **Links:**
  - Object and revision links are unaffected, because a link names the file and not its place.
  - A folder path link (under an address, once those exist) to the old place answers ABSENT_PROVEN, with the copy above.
- **Several at once.**
  - Selecting several entries and choosing Move, or Remove, makes one review and one prompt (A1: "reorganizing 50 items is one ceremony").
  - The SDK splits the batch by gas, and a partial batch uses the banner's existing Continue / Stop.
  - *Multi-select may ship after single-item operations if the SDK's batch planner lands later.*

## Remove and restore

The words are "Remove" and "Restore", never "Delete" or "Hide" (A7, B4). Removing takes an entry out of a place. It doesn't destroy anything.

```text
Remove "notes.txt" from /photos/2026?

 · It stops appearing here for anyone who sees your entries.
 · The file and its history stay on the network, and anyone with its
   link can still open it.
 · This removal is itself public. You can restore it.
                                         [ Keep it ]  [ Remove ]
```

- **This dialog is the review.** It's planned first, with `planDeleteFile({ file, at })` (an unbind of the person's own entry, a mask), so it also shows the gas figure, and Remove sends it: one approval, with no second dialog.
- **Keep it is focused first,** as in the discard dialog, so Enter or Escape keeps the entry.
- **Removing a folder:**
  - It removes the folder's entry from its parent. Its contents stay inside it, still reachable by its link.
  - The dialog adds: "Items inside it stay inside it."
- **Restore.**
  - Restore plans a bind at the same place and name.
  - **Right after a removal,** the banner offers it: "Removed · Restore".
  - **Later,** "Show removed" in the listing's menu shows the person's own removed entries, greyed, each with Restore (L5: shadowing is inspectable).
  - If someone else's entry now holds the name, Restore says so before the review.
- **Another author's entry** has no Remove. Hiding it waits on contracts.

## Copy

These are proposed `en.json` messages, with MF2 arguments. The wording follows `writes.md`'s rules: plain, specific, no blame, and never "saved" before COMPLETE.

| Id (proposed) | Text |
|---|---|
| `files.new.menu` | New |
| `files.new.textFile` | New text file |
| `files.new.folder` | New folder |
| `files.new.upload` | Upload files |
| `files.name.label` | Name |
| `files.name.taken.mine` | You already have something called {$name} here. Choose another name, or open it to save a new version. |
| `files.name.taken.lens` | Your file will be saved, but this view shows {$author}'s {$name} first. |
| `files.name.rule.empty` | Enter a name. |
| `files.name.rule.tooLong` | That name is too long ({$bytes} of 255 bytes). |
| `files.name.rule.dots` | A name can't be "." or "..". |
| `files.name.rule.reserved` | Names can't start with "~efs". |
| `files.name.rule.character` | This name has a character that isn't allowed (position {$at}). |
| `files.name.rule.space` | A name can't start or end with a space. |
| `files.name.notNfc` | This name isn't in the usual Unicode form, so a name that looks the same could be a different name. It will be saved exactly as typed. |
| `files.rename.review` | Rename {$from} to {$to}. Links to this file keep working. Links that use its old path won't find it there. |
| `files.move.picker` | Move to… |
| `files.move.review` | Your entry appears in {$folder} for you, for anyone whose lens names you, and for everyone with public on. |
| `files.move.intoSelf` | A folder can't be moved into itself. |
| `files.remove.title` | Remove {$name} from {$folder}? |
| `files.remove.here` | It stops appearing here for anyone who sees your entries. |
| `files.remove.stays` | The file and its history stay on the network, and anyone with its link can still open it. |
| `files.remove.public` | This removal is itself public. You can restore it. |
| `files.remove.folder` | Items inside it stay inside it. |
| `files.remove.keep` | Keep it |
| `files.remove.yes` | Remove |
| `files.restore` | Restore |
| `files.restore.taken` | Someone else's entry is now called {$name} here. Restoring puts yours back beside it; your lens decides which one shows. |
| `files.showRemoved` | Show removed |
| `files.notYours` | This is {$author}'s entry. You can rename, move or remove only your own. |
| `files.list.partialEmpty` | Nothing in the first {$count} entries. |
| `files.list.keepLooking` | Keep looking |
| `files.list.empty` | This folder is empty. |
| `files.list.absent` | Nothing is called {$name} in {$folder} now. It may have been renamed or moved. |
| `files.list.masked` | Removed by an author in your lens. |
| `files.filter.label` | Type |
| `files.filter.all` / `.folders` / `.files` / `.other` | All / Folders / Files / Other |
| `files.filter.hidden` | {$count} other entries hidden by the filter |
| `files.filter.partialEmpty` | No {$type} in the first {$count} entries. |
| `saves.removed` | Removed |
| `files.pending` | Saving |

## What the client needs from the SDK

These are already in #36's sketch, except where a line says otherwise.
- `parseLink` for realm-root paths, and `files.resolve(path, { lens })` with the status set above.
- `nodes.children(folder, { lens, cursor, limit, types })` → a `Page` with `coverage`, `skipped`, `next`, and each row's author and Type.
- **The planners,** each returning `PLANNED { parts, review }` for `runSequence`:
  - `planCreateFile`;
  - `planCreateFolder` (the directory planner);
  - `planRenameFile` (including moves, and for folders too);
  - `planDeleteFile`;
  - a restore.
- **Not in #36:**
  - a batch form of rename/move and remove for multi-select;
  - a refusal reason code for "name taken by your own entry", so the copy can branch on the code and not on text.
- `files.placements(object)` later, for "find it by its permanent link".

## Testing

Each operation is recorded once against the SDK's fixture chain (`pnpm transcripts:record`), and replayed in every browser. Transcripts are never edited by hand.

- **Create a file, then a folder:** each appears with "Saving", then settled, with one send each.
- **Rename:** the object link still opens the file; the old path answers ABSENT_PROVEN with the copy above.
- **Move into another folder:** the entry leaves one listing and joins the other. A folder can't be moved into itself.
- **Remove:** "Keep it" is focused and Escape keeps the entry. Removing hides it; Restore from the banner brings it back; "Show removed" lists it.
- **Another author's entry:** actions disabled, with the reason.
- **Filter by Type:** a PARTIAL filtered page shows "Keep looking", never "No folders".
- **Name rules:** each `checkName` rule maps to its message. A mutation check confirms a rule's message is the one shown.
- **Accessibility and layout:** keyboard-only rename (F2, Enter, Escape) and remove; axe in light and dark; 320 px with no sideways scroll.
