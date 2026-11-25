# Tags, topics and homes in the File Browser: design note

**Status:** draft design note, no code. It's on main for the integration owner's (PM's) review (James's working rule of 2026-11-25: iterate on main, with no PR without a reason). Nothing here is built. The file-operation flows (create, rename, move, remove, filter by Type) are a separate note, `file-operations.md`, because they need no contracts change and don't wait on anything below.

**Sources:**
- planning `Designs/efsv2/owner-rulings.md`, 2026-11-25: T-1 to T-5, and view-all;
- planning `Reviews/2026-11-25-tag-discussion-round-2.md`: the work order, Client dev;
- planning `Reviews/2026-11-25-tag-discussion-round-3.md`: §4 and §7;
- planning `Reviews/2026-11-25-tag-prior-art/README.md`: the pending refinement of T-2;
- SDK draft PR #36 (`docs/design/files-folders-tags-0.1.md`), for read shapes;
- planning `Designs/clientv2/file-browser-requirements.md`: L1 to L8, A7, B4.

## What's ruled, and what this note can't assume

**Ruled (James, 2026-11-25):**
- **Tag is system, folder is app (T-1).** A topic page shows everything tagged with it, of any Type, with a Type filter. A folder stays a Files directory.
- **Topics are shared and unowned (T-2).** Words, not numbers, in links. The ruling makes the whole path the identity, so `/cars/tesla` and `/companies/tesla` are different tags.
- **Every tag carries a signed number (T-4).** At or above 0, the tag applies; below 0, it means "not this".
- **Homes (T-5).** Anyone can attach to any address. The address is the id; ENS is display only.
- **View-all.** "Everything anyone has tagged" with a topic is a required view.

**Still open, so this note works either way:**
- **How a topic's id is derived.**
  - T-2 stands as ruled, but James is re-checking it, so the PM holds topic id derivation, registration and listing until he confirms (M1 brief, D6).
  - The prior-art verdict recommends a refinement: the word is the permanent shared id, and the path records how the tagger filed the thing.
  - In that version every tag is listed under each of its words, its path and its parent paths, so roll-up is part of it. Parents, synonyms and "moved to" are optional lens statements.
- **Also open:**
  - roll-up under the ruling as it stands;
  - who is in the default lens;
  - whether a Graph-style index joins the stack.

**The client never derives a topic id,** and never builds or parses a topic link (AGENTS.md rule 4). It shows what the SDK resolves, so a change in how ids are derived changes the SDK, not these screens. The screens still wait for their data: nothing can list a topic until its id is settled and the contracts can list it.

## Words used in the interface

- **Copy says "tag" for the place and "tagged" for the act:** "Everything tagged /cars/tesla". People know tags from hashtags and photo apps. "Topic" stays an internal word, used in this note and in code, to keep the place apart from one person's statement. *(My call.)*
- **"Remove my tag" and "Not this" are different acts, with different words.**
  - "Remove my tag" takes the person's statement back to saying nothing.
  - "Not this" records a negative number.
  - The SDK sketch keeps these as separate verbs (untag and deny), and so does the copy.
- **The vocabulary guard stays:** "remove" for taking something out of a place, never "hide" (requirement A7). "Hide" suggests privacy, and an entry that's removed is still on the public record.

## A topic link, in either URL form

A topic link is a route like any other realm link, `#/r/<realm>/<topic link>[?lens=…]`. It's produced by the SDK's `link()` and read by its `parseLink()`, which tells the client what kind of target it is. The client picks a view by that kind.

| | Under T-2 as ruled (the path is the id) | Under the prior-art refinement (the word is the id) |
|---|---|---|
| `/cars/tesla` (the path view) | the topic itself; lists what was tagged exactly `/cars/tesla` | what was filed at `/cars/tesla` and below it (every tag is also listed under its parent paths) |
| Sub-entries you can browse into | topics registered under it | paths filed under it |
| `tesla` (the word view) | a search: every topic whose last word is `tesla`, with counts | a page: everything filed under any path using `tesla`, grouped by path, with counts |
| Permanent? | yes (nobody can rename it) | yes (it always computes the same view) |

**Two views cover both columns:** the path view (next section) and the word view (the section after).
- **The word view looks the same in both columns.** Only what fills it differs. As ruled, it lists matching topics and their counts. Under the refinement, it also pools their items.
- **If the refinement is adopted,** the client gains one link kind (a word) and the pooled list. Nothing else changes.

**What the client asks of either form:**
1. **Readable words in the URL**, as James asked. No numeric id in the address bar for topics.
2. **No collisions, and one open conflict.**
   - A topic link must never be read as a folder path, a home, or an object or revision link.
   - **Folders and topics both want the bare path.**
     - The SDK's folder work starts at the realm root (`#/r/<realm>/photos/2026`; the M1 brief's "paths from the realm root").
     - Round 3 §6.5 reserves only `0x…` (homes) and `~efs` as first words, which leaves the bare path to topics.
     - One of the two needs a prefix. The SDK sketch's `~tag/` predates the rulings.
     - The SDK and the PM own that choice. The client works either way, because `parseLink` says which kind a link is.
3. **A canonical form.** The client replaces a typed link with the SDK's canonical one, as it does for object links today. So `/Cars/Tesla` becomes `/cars/tesla`, using the SDK's fold rule.
4. **A depth limit.** It keeps a path plus a 64-entry `?lens=` under the router's 8,192-character limit. Round 3 suggests 8 words.
5. **`?lens=` works as it does on object links.** A shared topic link can carry the sharer's lens.

## The path view (a topic page)

It opens in the File Browser, the only app that handles realm links today. The File Browser's panes are keyed on "entries of X" (`shell.md`, Apps and views), so they take a topic as their X with no new layout:
- **Overview:** the tag's name, its counts and, later, its description.
- **Entries:** the list.
- **Preview:** the selected item.

A later Topics system app could reuse the same view. *(My call: no second app before there's a second app's worth of work.)*

```text
Everything tagged /cars/tesla               [ Everyone ▾ ]   Type: [ All ▾ ]
4,210 tags by everyone · 12 tags under this one
───────────────────────────────────────────────────────────────────────────
▸ /cars/tesla/model_y         tag · 310 tags
▸ /cars/tesla/roadster        tag · 42 tags
  cat.jpg                     Image   · alice.eth · tagged by 3 people
  notes.txt                   Text    · 0x12…ab
  e4                          Chess move · 0x9f…01
                              [ Show more ]
```

**Rows:**
- **Sub-entries have their own section above the items,** capped at a few rows with "Show all 12".
  - They follow the same view switch as the items, so a flood of spam sub-topics can't push the items off the page.
  - Who may list a topic under another is still open in the contracts work order (item 2).
- **Items are newest first.** Lists are in insertion order, which is time order, so "newest first" means reading from the end.
- **One row per item, once the SDK can page by item.**
  - An item tagged by several people shows once, with "tagged by N people", placed by its newest tag.
  - Merging an item's tags across pages is page-walking, which belongs to the SDK (AGENTS.md rule 4), so this is SDK ask 2.
  - Until the SDK offers it, a row is one tag ("cat.jpg · tagged by alice.eth"), and an item can appear more than once.
- **Items of a Type the File Browser can't show get a row anyway:** the Type's name if one is known, else its short id, plus who tagged it. Opening such a row shows details (Type, author, links), never a guess at the contents. A chess move is a legitimate member of `/cars/tesla`.
- **Opening a row:**
  - a file opens in the Preview, the File Browser's `linkView`, which is also what a phone shows first;
  - a folder opens its listing;
  - a sub-entry opens its own path view.

**The Type filter:**
- The SDK filters on each row's header Type id, which the chain enforced and nobody can spoof. The SDK sketch reports how many rows a filter skipped.
- The menu lists the Files Types (Folder, File) plus every Type seen on the pages read so far.
- **A filtered page never reads as empty.** A page that's PARTIAL, or had all its rows filtered out, says "No images in the first 200 tags. [Keep looking]". It never says "No images". This is the "missing answer read as none" bug shape, applied to filters.

**Counts:**
- **The header shows the total by everyone, labelled as such** ("4,210 tags by everyone"). That's one read of the list's length.
- **Other views get no count until the SDK offers one.**
  - A count for Mine would take a read per person in the lens (up to 64), so Mine shows none until the SDK offers it, rather than a wrong one.
  - A count after the "not this" filter would need a scan, so it isn't shown.
- **It counts statements, not distinct items.** One photo tagged by a hundred people is a hundred tags, so the copy says "4,210 tags" and not "4,210 items".
- **The SDK defines exactly what a count includes,** for example whether negative tags are counted. The copy follows that definition.

**Honesty rules carried over from reads (`reads.md`):**
- an UNKNOWN or unreachable read shows why, with Try again, never an empty list;
- a page cut short says so and offers more;
- the pin must be VERIFIED before anything is listed.

## The word view

It's for "what does anyone mean by `tesla`?". People reach it from the search box (Enter on a single word), from a word in a path's breadcrumb, and, under the refinement, from a word link.

```text
Everything tagged with the word "tesla"      [ Everyone ▾ ]   Type: [ All ▾ ]
3 places · 4,262 tags by everyone             Group: [ By place ▾ ]
───────────────────────────────────────────────────────────────────────────
/cars/tesla                    4,210 tags                     [ Open ]
  cat.jpg            Image · alice.eth · tagged by 3 people
  model-y.pdf        File  · 0x12…ab
  …and 4,208 more
/companies/tesla                  48 tags                     [ Open ]
  q3-report.pdf      File  · bob.eth
  …and 47 more
/people/nikola_tesla               4 tags                     [ Open ]
Also: "tesla" in your lens is the same as "テスラ" (said by carol.eth) · [ Include ]
```

**Groups:**
- **Groups are places, largest first.** Each group is a path that uses the word, with its own count, its newest few items, and Open, which goes to that path view.
  - Largest-first comes from counts, which are one read each. *(My call: the order a newcomer needs, because the commons is usually the biggest place.)*
  - The order changes as counts change. That's fine, because grouping is a view and not a link.
- **Grouping by place is the default.** The prior-art verdict names its own weakness: a bare word mixes the company, the inventor and the unit. Grouping by place is its answer.
- **A word in the middle of a path** (`tesla` in `/cars/tesla/model_y`) is grouped at the place where the word sits, `/cars/tesla`. So everything filed at `/cars/tesla` and below it stays in one group, which matches the path view under the refinement. *(My call.)*
- **"Group: All in one list"** merges the groups into one list, newest first, with each item shown once. Round 3 §5's zipper merge does this in time order with no Graph. Each row then shows its place: "cat.jpg · /cars/tesla".

**Under each identity model:**
- **As ruled (the path is the id):** the chain lists every topic whose last word is `tesla` (round 2's exact-word list). The view shows those places with their counts, so the groups and Open work.
  - The pooled items need one read per place. For a handful of places the client asks the SDK to merge them (round 3 §5: each extra list costs one read). Past a stated limit, the groups show only their counts, with Open.
  - Places where `tesla` isn't the last word (`/cars/tesla/model_y`) aren't found by a last-word list. As ruled, they show only as sub-entries of `/cars/tesla`.
- **Under the refinement (the word is the id):** the word's own list holds every tag filed under any path using it. The SDK reads one list and returns it already grouped. Nothing is merged on the client.

**Synonyms, translations and "moved to":**
- These are optional lens statements, and the system works with none of them.
- When the person's lens says another word or place is the same as this one, the view says so in one line, with who said it, and offers **Include**. Include adds that word's places as more groups, marked with the word they came from.
- Include is never automatic. A synonym is somebody's opinion (D-A still holds for opinions), and each included word costs another read. The SDK bounds how many words can be followed.
- **"Moved to" works the same way.** "/cars/tesla says it moved to /vehicles/tesla (said by alice.eth) · [ Go there ]". The old place keeps its items, because a topic's contents never move.

**Counts and honesty:** the header counts places and tags, never distinct items (the same rule as the path view). If any place's read is UNKNOWN or PARTIAL, its group says so ("4,210 tags · couldn't read the newest"), and the header doesn't add it into a total as if it were known.

## Whose tags: the three views, and the default

From round 3 §4:

| View | Shows | Copy *(proposed)* |
|---|---|---|
| **Mine** | tags by the people in my lens | "People I trust" |
| **Everyone** | every tag by anyone, minus items the people in my lens marked "not this" | "Everyone" |
| **Raw** | everything, including "not this" marks, shown as such | "Unfiltered" |

**Recommended default: Everyone.**
- **James named view-all as the core use case.** He called it *"important for censorship resistance and UX"*, and said *"a lot of people are going to want to … just 'view all'"*.
  - Unfiltered stays one click away. It's always available from the chain, which is what makes the design censorship-resistant (round 3 §4).
- **Mine shows only what the lens tagged.** For most people that's the deployment's default lens, whose membership is still undecided, so it can be empty or a few people. A page saying "nothing here" over 4,210 tags is the missing-answer-as-none shape at the scale of the whole product.
- **Everyone still applies the lens's "not this" marks.** That makes it the block-list model (Bluesky labelers, Nostr mute lists), not an unfiltered firehose.

**Whose lens:**
- **"My lens" is the lens the view is read under, as for files today.** That's the link's `?lens=` when it carries one, otherwise the deployment's default lens (`defaultLensPrincipals` in the deployment document).
- **Connecting a wallet doesn't add the account to it.** The view never switches by itself (`writes.md`).
- **A link that carries a lens says so.** "People this link trusts" replaces "People I trust".
- **A person's own lens, kept in Settings, comes later** with the Lens/Trust manager (requirement L6).

**The risk, and what this note proposes against it:**
- **Spam costs gas, but abusive images cost nothing to look at.**
  - The list loads no file bytes. There are no thumbnails in the first build.
  - So the gate is in the Preview. An item opened from Everyone or Unfiltered whose author is outside the lens opens on its Type, size and author with "Show preview".
  - A phone, which shows the Preview first, shows that too.
  - With a small lens, that's nearly every image, and that's the intent. "Show previews on this page" lifts the gate for the page.
  - It's the same pattern as "Load from <host>" for publisher web addresses (a PM ruling of 2026-11-24).
- **People I trust is one click away.**
- **The choice is remembered** in the settings record ("Show tags from"). On a shared IPFS path gateway it lasts for the tab, as every setting does there.

If the PM or James prefers **Mine** as the default, the empty state carries the count across: "Nothing tagged here by people you trust. 4,210 tags by everyone. [Show everyone]".

**The view switch is always visible on a path or word view.** Requirement L1 keeps lens chrome hidden until it changes an answer. Here it changes the answer by design.

## The home page

- **A home is the place for an address.**
  - The SDK makes its link (`0x…` first, per the sketch); homes wait on contracts (C8).
  - The address is what's shown and what's checked. An ENS name, when one is shown, is display only, looked up at view time, and held behind the PM's ENS privacy question.
- **Two tabs:**
  - **"Files by 0x12…ab"** (the owner's entries) is the default.
  - **"Attached by others (N)"** is the second. Inside it, the same three-way switch and the same remembered default apply, along with the same media rule.
- **Your own home is "Your files".** It has New file and New folder, which work once the folder operations land.
- **An address that has never used the chain gets honest copy:** "This address hasn't put anything here. 3 things attached by others." UNKNOWN stays UNKNOWN.
- **Attaching to someone else's address** says what it means before the review: "This doesn't add it to their files. It appears under 'Attached by others' for anyone who sees your tags." The wording follows round 2 pushback 7: "'Attached to vitalik.eth' is the attacher's statement".

## Tagging, the number, and suggestions

**Where tagging starts:**
- A **Tag** action on a file's Preview and on an entry's menu.
- Several entries at once comes with multi-select in the folder operations.

**The dialog:**
- A path field. Typing `cars/tesla` or `/cars/tesla` both work, and the SDK folds and checks it.
- Chosen tags are shown as chips, and the whole set goes through one review and one prompt (D4: one prompt per save; the SDK splits by gas).

```text
Tag "cat.jpg"
 [ /cars/tes|                                    ]
   /cars/tesla           4,210 tags   ← exact match first
   /cars/tesla/model_y     310 tags
   /cars/tesla_roadster      2 tags
   Create /cars/tes — new, nobody has used it yet
 Chosen:  (/cars/tesla ×)  (/nsfw  Not this ×)
 ▸ More options: number for each tag (default 0)
                                    [ Cancel ]  [ Review ]
```

**The number:**
- **The default is 0, which means "applies".** A chip's "Not this" sets −1. That covers everything the File Browser itself needs.
- **Any whole number can be entered under "More options",** within the width the SDK defines. James wants apps to decide what the size means (an adult app grading 3 against 99). The File Browser reads only the sign.
- **The display follows the sign:** a number at 0 or above shows as tagged, and a number below 0 shows as "Not this". Details show the exact number and who gave it.
- **The File Browser never sorts by the number.** An app may.
- **Many people, many numbers.** Which number a row shows in Everyone is left open in round 3 (§6.4). My call: the row shows the sign by counts ("3 people · 1 says not this"), and Details lists each person's number.

**Suggestions with counts:**
- **What's suggested, in this order:**
  1. the exact match from the chain, with its count;
  2. topics seen in this tab that start with what was typed, each with a count;
  3. under the prior-art refinement, the word's page and the paths that use it.
- **Counts are global, not limited to the lens.** The prior-art evidence (Centola and Baronchelli) says a shared vocabulary forms only when people can see everyone's choices.
- **A new tag is shown as new** ("nobody has used it yet") so a typo is visible before it's made permanent. A topic can't be renamed, and a misspelling is forever.
- **Mixed-script look-alikes** (Cyrillic `а` in `tesla`) get a warning. This needs a flag from the SDK's fold result (see the asks below); the client doesn't do Unicode script detection itself.
- **Later (English-only):** a hint when a simple variant (`car` vs `cars`) has many more tags. It's a UI heuristic that asks the SDK for each candidate's count, not a protocol rule.
- **A seeded starter tree** would feed the suggestions. Who seeds it is the default-lens question.

## The search box

- **It sits in the File Browser's location bar.** It accepts a path, a word or a link.
- **The chain answers exact words only.** Typing `tesla` and pressing Enter opens the word view for `tesla`, with every place that uses it and their counts. Typing a path (`cars/tesla`) opens that path view.
- **Folding is shown when it changes the text:** "Searching for `tesla` (you typed `Tesla`)".
- **Type-ahead on partial words can't come from the chain.** For now it covers only topics seen in this tab, in memory. Two later sources each need a decision first:
  - **A local cache of topics across visits** is new storage beyond the settings record and the save journal, which AGENTS.md defers.
  - **A Graph-style index** is a new remote service, so it would go in Settings like the RPC list, off by default. Every query would tell that service what the person is interested in.
- **The copy states the limit:** "Exact matches only. Searching partial words needs an index service, which isn't set up."
- **File-name search is a different feature,** and out of scope here.

## Naming: a named spot first, tags on top

A file is created with a name in a place: its author's home, or a folder there. Tags go on top. This is round 2 pushback 8, the Gmail "All Mail plus labels" model; the work order says "its author's home".
- **Creating a file always gives it a named spot.**
  - **Once homes land,** the default spot is the person's home or a folder in it.
  - **Until then,** it's a folder they choose, starting at the realm root, which works today. *(My call; neither source covers the time before homes.)*
  - **Those earlier files get no spot in a home automatically.** When homes land, "File it in my home" adds one: one more named link, and the old one stays. It's offered on the person's files that have no home spot.
  - Tags go on top, in the same review where possible.
- **A file can be named in more places later.** The name a view shows first is the one its author gave it.
- **"New file here" on a path view** creates the file in the person's home (or chosen folder) and tags it with this topic, in one review.
- **What name a path or word view shows for an item:**
  1. the name its author gave it, in their named spot;
  2. else the name in the tagger's named spot;
  3. else its Type and short id.

  The client never invents a name. Tagging someone else's file doesn't name it.
- **Renaming a file changes its name everywhere it's shown,** because its tags point at the file and not at the name. That's the point of keeping the name off the tag.

## What the client needs from the SDK

Each ask names the shape, not the implementation. The SDK sketch (#36) already covers most of them.

1. **Link kinds:**
   - `parseLink` returns a topic kind (and a word-page kind, if the refinement is adopted) and a home kind.
   - Each carries the display words, the canonical link, and the lens.
2. **A path view read:**
   - pages of rows, each with item, author, number, Type and tagged-at;
   - a view option (Mine, Everyone, Raw), `types`, `cursor`, `limit`;
   - coverage COMPLETE or PARTIAL, plus skipped counts (denied, filtered).
3. **Sub-entries of a topic,** paged the same way.
4. **Counts,** with what each count includes.
5. **The word view's data:**
   - **As ruled:** exact-word lookup (every topic with this last word, each with its count) plus a bounded merge of their lists in time order.
   - **Under the refinement:** the word's own list, grouped by place, with a count per place.
   - **Either way:** the lens's same-as and moved-to statements about the word or place, each with its author, and a bound on how many words a merge follows.
6. **A fold result:** the canonical words, whether folding changed them, and a mixed-script flag.
7. **An item's display name:** its author's named spot and the tagger's, without the client walking anything.
8. **Planners** for tag, remove my tag, and "not this", with the number, and attach to an address. Each returns the usual `PLANNED { parts, review }`, with the gas figure in the review (T-3).
9. **Home reads:** the owner's entries and others' attachments as two lists.

## What waits for what

| Piece | Waits on |
|---|---|
| Path view, sub-entries, counts, exact-word search | the T-2 re-check, then the contracts release with the view-all list; then SDK asks 1–6. A Mine-only first version needs no view-all list (lens lists work as built), but still waits for topic ids |
| Word view, grouped by place | as ruled: the exact-word list; under the refinement: the per-word lists (James adopting it, and the contracts measurement of their cost and abuse) |
| Synonyms, "moved to" and display names per language | the topic statements (round 2 work order, contracts item 4); SDK ask 5. Until then a view shows the path's own words |
| Tagging, "Not this", the number | the contracts release (the signed number, T-4); SDK ask 8 |
| Home page, attaching to an address | homes (C8) in that release; SDK asks 8–9 |
| Item names in path and word views | SDK ask 7; folder operations (named spots) |
| Type-ahead beyond the tab | a decision on a local cache or an index service |
| Hiding another author's entry | the contracts release (a lone negative, or C3) |

None of this starts before its row is clear. The folder operations proceed now in their own PR.

## Approaches considered

1. **The default view.**
   - **Everyone** (recommended, reasons above).
   - **Mine:** safer, but it shows only the deployment's default lens, which may be empty or small until its membership is decided.
   - **Adaptive** (Mine when the lens is non-empty, else Everyone): rejected. The same link would show different things to the same person as their lens grows, with no visible cause.
2. **Where the topic view lives.**
   - **The File Browser's panes** (recommended). It's the only app, and its panes already speak "entries of X".
   - **A separate Topics app now:** rejected. It would be a second app with one view and no second consumer.
3. **Type-ahead.**
   - **This tab's memory** (recommended for now): no new storage, no new service.
   - **A persistent local cache:** new storage, so it needs a decision.
   - **An index service:** a new remote party, so it needs a decision and a Settings entry.

## Testing, when this is built

- **Recorded transcripts** from the SDK's fixture chain, as for edits. Never edited by hand.
- **Each honesty rule gets a test that fails when the rule is broken:**
  - PARTIAL or filtered never reads as empty;
  - UNKNOWN never reads as empty;
  - "Not this" is never shown as "Remove my tag";
  - media outside the lens isn't loaded in Everyone.
- **At 320 px,** keyboard and axe in light and dark, as the other slices do.

## For the PM

1. **Who gets the bare path, folders or topics?** Today the SDK's folder work starts at the realm root, and round 3 reserves only `0x…` and `~efs`.
   - **(a) Topics bare, folders under homes** (`/cars/tesla`; `/0x12…ab/photos`).
     - This matches James's *"when you go to /cars/ you see everything tagged with the /cars/ tag"* and T-1 (the system primitive owns the system's namespace).
     - Folders at the realm root would need a prefix until homes land.
   - **(b) Folders bare, topics under a prefix** (`/~tag/cars/tesla`). This keeps the SDK's current folder work as it is.
   - **I lean to (a),** and either way it should be settled before any folder path link is shared publicly. Nothing has shipped yet, so changing it now is cheap.
   - This is the SDK's and contracts' call more than the client's, and the client works either way.
2. **The default view:** Everyone (recommended) or Mine.
3. **Media gating** in the Preview for items opened from Everyone or Unfiltered whose author is outside the lens: yes (recommended).
4. **One row per item** needs the SDK to page by item (SDK ask 2). Until then, rows are tags. Accept that interim (recommended)?
5. **Copy:** "tag" in the interface, "topic" only internally. Yes (recommended).
6. **Type-ahead** stays tab-only until a cache or index service is decided. Yes (recommended).
