# File operations in the File Browser: flows and copy

**Status:** draft flows and copy for the integration owner's (PM's) review. Revised for the 2026-11-25 decision-sheet defaults (folder paths live under an address; a folder opened from a link shows its creator's files; public lists newest first; no small depth limit) and for the SDK dev's confirmed removal semantics (Remove releases). No code yet. Each flow is wired only to the SDK's real exports, once they land. There's no protocol stand-in in the meantime.

**Scope:**
- **In scope:** list a folder; create a file; create a folder; rename and move; remove your own entry and restore it; filter by kind.
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
  - **Object links stay the default for sharing** (PM, 2026-11-25).
    - Until addresses are places, no folder path link is shared at all.
    - Once they are, a folder path link can be shared, labelled as a lookup that a rename can break: "This link finds whatever is called this here, and can break if it's renamed."
    - No link ever addresses a named file through a topic. Whether a file's name is its own mechanism or a path's last word is still open.
  - **No depth limit** on folder paths under an address (James, 2026-11-25). The only cap is the router's 8,192 characters, and a longer route is refused visibly, never cut.
  - The canonical form replaces a typed link, as object links do today.
- **The breadcrumb.**
  - **For a folder path under an address,** it comes from the resolved chain, with each segment's author, so "whose `/photos`" is answerable (#36 hard case 4).
  - **For a folder opened by its object link,** it shows how the person got there in this tab, because folders form a graph and have no single parent (#36 hard case 5). Opened fresh from a link, it shows only the folder's own name.
  - **Deep paths collapse visually, never by depth.** The first segment and the last two stay visible, and the middle folds into a "…" menu listing every segment (Web Awesome's breadcrumb, with a dropdown). Nothing is dropped.
- **Whose entries.**
  - A folder view reads through the lens with the folder's creator inserted right after "you", and public last, on by default.
    - So a folder opened from a link shows its creator's files even when the creator isn't in the reader's view (decision-sheet default). Without that, a shared folder link would open empty.
    - The person can take the creator out for this view, as with an address.
  - The lens line, the "everyone" switch and the media gate are the ones in `tags.md`.
  - **With public on, several versions from everyone** of one name, none from the lens, show as one row that opens a list, newest first. James: oldest first would make public views static.
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

## Filter by kind

It's named a kind filter until topic views bring a filter by Type id (SDK dev, 2026-11-25).
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

They are one SDK operation: one atomic change of placement. It releases the entry at the old place and binds it at the new one in a single publication (SDK dev, 2026-11-25).

- **Rename.**
  - It starts from the entry's ⋯ menu or F2, and edits the name in place (A9).
  - Enter goes to the review, and Escape cancels.
  - The review says: "Rename "notes.txt" to "plans.txt". Links to this file keep working. Links that use its old path won't find it there."
  - **It also says what the old name shows afterwards,** from the review's `shownAfter`: "After this, "notes.txt" here shows Alice's file" or "…shows nothing".
- **Move.**
  - It starts from "Move to…" in the ⋯ menu, which opens a folder picker (the tree, folders only).
  - The person can move an entry into any folder, including one another author made. The review says who will see it there: "Your entry appears in /team/plans for you, for anyone whose lens names you, and for everyone with public on."
  - **A folder can't be moved into itself or below itself.**
    - The picker greys those out, and the SDK refuses them too.
    - Moving a folder passes the destination's chain (`via`), the folders the person went through to get there.
    - Folders form a graph seen through a lens, so the review says how far the check goes: "Checked under this lens: the destination isn't inside this folder."
  - **The review says what the old place shows at that name afterwards** (`shownAfter`), as for a rename.
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
Remove "pet.jpg" from 0x12…ab?

 · Your pet.jpg stops appearing here.
 · After this, this view shows 0x12…ab's pet.jpg here.
 · The file and its history stay on the network, and anyone with its
   link can still open it.
 · This removal is itself public. You can restore it.
                                         [ Keep it ]  [ Remove ]
```

- **This dialog is the review.** It's planned first, so it also shows the gas figure, and Remove sends it: one approval, with no second dialog.
- **Remove releases the person's own entry by default** (SDK dev, 2026-11-25).
  - The next author's file with the same name, in the view's lens order, shows through, as in v1.
  - A mask would also have hidden the owner's `pet.jpg` from the person's view, and from everyone who trusts them.
- **The second line comes from the review's `shownAfter`** (`{ author }` or null): "After this, this view shows <author>'s <name> here" or "After this, nothing is called <name> here in this view".
- **Removing and blocking the name** is the masking form (`hide: true`).
  - It's offered only to the place's owner (the address, or the folder's creator), to stop someone squatting a name they removed.
  - It's labelled "Remove and block this name", with the line "Other people's files called <name> won't show here either, for anyone whose view puts you first".
  - The word "hide" is still never used (A7).
- **Keep it is focused first,** as in the discard dialog, so Enter or Escape keeps the entry.
- **Removing a folder:**
  - It removes the folder's entry from its parent. Its contents stay inside it, still reachable by its link.
  - The dialog adds: "Items inside it stay inside it."
- **Restore.**
  - Restore plans a bind at the same place and name, after either a removal or a block.
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
| `files.shownAfter.author` | After this, this view shows {$author}'s {$name} here. |
| `files.shownAfter.none` | After this, nothing is called {$name} here in this view. |
| `files.move.checkedUnderLens` | Checked under this lens: the destination isn't inside this folder. |
| `files.link.lookup` | This link finds whatever is called this here, and can break if it's renamed. |
| `files.move.picker` | Move to… |
| `files.move.review` | Your entry appears in {$folder} for you, for anyone whose lens names you, and for everyone with public on. |
| `files.move.intoSelf` | A folder can't be moved into itself. |
| `files.remove.title` | Remove {$name} from {$folder}? |
| `files.remove.here` | Your {$name} stops appearing here. |
| `files.remove.block` | Remove and block this name |
| `files.remove.blockDetail` | Other people's files called {$name} won't show here either, for anyone whose view puts you first. |
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
| `files.filter.label` | Kind |
| `files.filter.all` / `.folders` / `.files` / `.other` | All / Folders / Files / Other |
| `files.filter.hidden` | {$count} other entries hidden by the filter |
| `files.filter.partialEmpty` | No {$type} in the first {$count} entries. |
| `saves.removed` | Removed |
| `files.pending` | Saving |

## What the client needs from the SDK

These are already in #36's sketch, except where a line says otherwise.
- `parseLink` for folder paths under an address, and `files.resolve(path, { lens })` with the status set above.
- **A folder by its object link** (the parent as a parameter; the realm root is only a fixture stand-in, SDK dev).
- `nodes.children(folder, { lens, cursor, limit, kinds })` → a `Page` with `coverage`, `skipped`, `next`, and each row's author and Type.
- **The planners,** each returning `PLANNED { parts, review }` for `runSequence`:
  - `planCreateFile`;
  - `planCreateFolder` (the directory planner);
  - `planRenameFile` (including moves, and for folders too);
  - `planDeleteFile`;
  - a restore.
- **Confirmed by the SDK dev (2026-11-25):**
  - Remove releases by default, and `hide: true` masks;
  - Move is a release plus a bind, atomic;
  - Restore works after either;
  - `shownAfter` (`{ author }` or null) is in every removal and move review;
  - a folder move takes its destination chain (`via`);
  - batch forms exist.
- **Asked, via the PM:** a refusal reason code for "name taken by your own entry", so the copy can branch on the code and not on text.
- `files.placements(object)` later, for "find it by its permanent link".

## Testing

Each operation is recorded once against the SDK's fixture chain (`pnpm transcripts:record`), and replayed in every browser. Transcripts are never edited by hand.

- **Create a file, then a folder:** each appears with "Saving", then settled, with one send each.
- **Rename:** the object link still opens the file; the old path answers ABSENT_PROVEN with the copy above.
- **Move into another folder:** the entry leaves one listing and joins the other. A folder can't be moved into itself.
- **Remove:** "Keep it" is focused and Escape keeps the entry.
  - Removing takes it out, and the dialog's `shownAfter` line matches what the view then shows: another author's same-named file showing through, or nothing.
  - Restore from the banner brings it back, and "Show removed" lists it.
  - "Remove and block this name" is offered only to the place's owner.
- **Another author's entry:** actions disabled, with the reason.
- **Filter by kind:** a PARTIAL filtered page shows "Keep looking", never "No folders".
- **Name rules:** each `checkName` rule maps to its message. A mutation check confirms a rule's message is the one shown.
- **Accessibility and layout:** keyboard-only rename (F2, Enter, Escape) and remove; axe in light and dark; 320 px with no sideways scroll.
