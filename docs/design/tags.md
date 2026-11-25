# Tags, topics and homes in the File Browser: design note

**Status:** draft design note, no code. Revised for James's ruling that addresses are places, the PM's answers of 2026-11-25, and the tag decision sheet. Nothing here is built. The file-operation flows (create, rename, move, remove, filter by Type) are a separate note, `file-operations.md`, because they need no contracts change and don't wait on anything below.

**Sources:**
- planning `Designs/efsv2/owner-rulings.md`, 2026-11-25: T-1 to T-5, view-all, and "Homes follow the lens like any other place";
- planning `Reviews/2026-11-25-tag-decision-sheet.md`: the one page for the tag model, with its defaults;
- planning `Reviews/2026-11-25-tag-prior-art/README.md`: the evidence behind option 3;
- SDK draft PR #36 (`docs/design/files-folders-tags-0.1.md`), for read shapes;
- planning `Designs/clientv2/file-browser-requirements.md`: L1 to L8, A7, B4.

Rounds 2 and 3 of the tag discussion are background only. Where this note still uses one of their mechanisms (the exact-word list, the zipper merge), it says so.

## What's ruled, and what this note can't assume

**Ruled (James, 2026-11-25):**
- **Tag is system, folder is app (T-1).** A topic page shows everything tagged with it, of any Type, with a Type filter. A folder stays a Files directory.
- **Topics are shared and unowned (T-2).** Words, not numbers, in links. The ruling makes the whole path the identity, so `/cars/tesla` and `/companies/tesla` are different tags.
- **Every tag carries a signed number (T-4).** At or above 0, the tag applies; below 0, it means "not this".
- **Homes (T-5).** Anyone can attach to any address. The address is the id; ENS is display only.
- **An address is a place like any other.** Viewing one inserts that address into the lens after the reader and before "public". James's example: at vitalik's address, with a lens of *"me, vitalik, public"*, `pet.jpg` shows *"my image of a dog first"*, then vitalik's, then anyone's if public is on.
- **View-all.** "Everything anyone has tagged" with a topic is a required view.

**The PM's defaults, unless James objects** (decision sheet):
- roll-up along a path is automatic, once measured;
- lowercasing is done by apps, not the chain;
- a path is at most 8 words deep;
- tag suggestions show counts across everyone;
- a folder adds its creator to the view, as an address does;
- with public on, several same-named files in one place show as a list, oldest first;
- **a bare path is a topic,** and folders and named files live under an address:
  - `/cars/tesla` is always topic words;
  - `/0x1234…/photos/cat.jpg` is a folder path;
  - the realm's shared root folder gets no link of its own;
  - first segments starting with `0x` or `~` are reserved.

**Still open, so this note works with every answer:**
- **The one real choice: what is the shared tag?** The decision sheet's options are:
  1. **the path** (ruled 2026-11-25, before the research);
  2. **the word;**
  3. **both:** the word is the shared tag, and the path is where a thing was filed. This is the PM's recommendation.

  Until James answers, the PM holds topic id derivation, registration and listing (M1 brief, D6).
- **Can wait:**
  - who is in a newcomer's lens;
  - whether a file's name is its own mechanism or the last word of a path. Until that's settled, no link addresses a named file through a topic, and files shown in a topic open by their permanent link.
- **Also open:** whether a Graph-style index joins the stack.

**The client never derives a topic id,** and never builds or parses a topic link (AGENTS.md rule 4). It shows what the SDK resolves, so a change in how ids are derived changes the SDK, not these screens. The screens still wait for their data: nothing can list a topic until its id is settled and the contracts can list it.

## Words used in the interface

- **Copy says "tag" for the place and "tagged" for the act:** "Everything tagged /cars/tesla". People know tags from hashtags and photo apps. "Topic" stays an internal word, used in this note and in code, to keep the place apart from one person's statement. *(PM, 2026-11-25.)*
- **"Remove my tag" and "Not this" are different acts, with different words.**
  - "Remove my tag" takes the person's statement back to saying nothing.
  - "Not this" records a negative number.
  - The SDK sketch keeps these as separate verbs (untag and deny), and so does the copy.
- **The vocabulary guard stays:** "remove" for taking something out of a place, never "hide" (requirement A7). "Hide" suggests privacy, and an entry that's removed is still on the public record.

## A topic link, under any of the three answers

A topic link is a route like any other realm link, `#/r/<realm>/<topic link>[?lens=…]`. It's produced by the SDK's `link()` and read by its `parseLink()`, which tells the client what kind of target it is. The client picks a view by that kind.

| | 1. The path is the tag (ruled) | 2. The word is the tag | 3. Both (PM recommends) |
|---|---|---|---|
| `/cars/tesla` (the path view) | what was tagged exactly `/cars/tesla`, and below it once roll-up is built | things tagged both `cars` and `tesla` (a narrowing query) | what was filed at `/cars/tesla` and below it |
| Sub-entries to browse into | topics registered under it | none built in; "tesla is under cars" is a lens statement | paths filed under it |
| `tesla` (the word view) | the topics whose last word is `tesla`, with counts | one pool, mixed together | one pool, grouped by where each was filed |
| Permanent? | yes (nobody can rename it) | yes | yes |

**Two views cover all three columns:** the path view (next section) and the word view (the section after).
- **Only what fills a view differs.** The screens stay the same.
- **Under option 2,** the word view has no places to group by, so "By place" is unavailable and the list is flat.
- **Under option 3,** the client gains one link kind (a word) and the grouped pool.

**What the client asks of either form:**
1. **Readable words in the URL**, as James asked. No numeric id in the address bar for topics.
2. **No collisions.** The decision sheet's default settles this.
   - A bare path is a topic.
   - A first segment starting with `0x` is an address, and folders and named files live under it.
   - A first segment starting with `~` is the system's (`~efs` object and revision links).
   - The realm's shared root folder gets no link of its own, so folder links wait for addresses (homes, C8). Until then the File Browser shares folders and files only by their permanent object links (`file-operations.md`).
3. **A canonical form.** The client replaces a typed link with the SDK's canonical one, as it does for object links today. So `/Cars/Tesla` becomes `/cars/tesla`, using the SDK's fold rule.
4. **A depth limit.** At most 8 words (decision sheet), which keeps a path plus a 64-entry `?lens=` well under the router's 8,192-character limit.
5. **`?lens=` works as it does on object links.** A shared topic link can carry the sharer's lens.

## The path view (a topic page)

It opens in the File Browser, the only app that handles realm links today. The File Browser's panes are keyed on "entries of X" (`shell.md`, Apps and views), so they take a topic as their X with no new layout:
- **Overview:** the tag's name, its counts and, later, its description.
- **Entries:** the list.
- **Preview:** the selected item.

A later Topics system app could reuse the same view. *(My call: no second app before there's a second app's worth of work.)*

```text
Everything tagged /cars/tesla                              Type: [ All ▾ ]
Showing: you · 2 people · everyone [on]
4,210 tags by everyone · 12 tags under this one
───────────────────────────────────────────────────────────────────────────
▸ /cars/tesla/model_y         tag · 310 tags
▸ /cars/tesla/roadster        tag · 42 tags
From you and the people in your lens
  cat.jpg                     Image · tagged by alice.eth
  notes.txt                   Text  · tagged by you
From everyone else
  cat.jpg                     Image · tagged by 0x44…7c
  e4                          Chess move · tagged by 0x9f…01
                              [ Show more ]
```

**Rows:**
- **Sub-entries have their own section above the items,** capped at a few rows with "Show all 12".
  - They follow the same lens order as the items (the lens's first, then public's), and the section is capped. So a flood of spam sub-topics can't push the items off the page.
  - Who may list a topic under another is still open in the contracts tag work.
- **Items come in lens order, then newest first.**
  - Tags from the people the lens names come first, under "From you and the people in your lens".
  - Then, with public on, everyone else's come under "From everyone else".
  - Within each section the newest come first. Lists are in insertion order, which is time order, so that means reading from the end.
  - Spam lands below everything the person trusts.
- **For now a row is one tag, and it names who tagged it** (PM, 2026-11-25). So an item tagged by three people can appear three times: "cat.jpg · tagged by alice.eth".
  - One row per item ("tagged by 3 people") would mean merging an item's tags across pages. That's page-walking, which belongs to the SDK (AGENTS.md rule 4), so it waits on SDK ask 2.
- **Items of a Type the File Browser can't show get a row anyway:** the Type's name if one is known, else its short id, plus who tagged it. Opening such a row shows details (Type, author, links), never a guess at the contents. A chess move is a legitimate member of `/cars/tesla`.
- **Opening a row:**
  - a file opens in the Preview by its permanent link (decision sheet), through the File Browser's `linkView`, which is also what a phone shows first;
  - a folder opens its listing, also by its permanent link;
  - a sub-entry opens its own path view.

**The Type filter:**
- The SDK filters on each row's header Type id, which the chain enforced and nobody can spoof. The SDK sketch reports how many rows a filter skipped.
- The menu lists the Files Types (Folder, File) plus every Type seen on the pages read so far.
- **A filtered page never reads as empty.** A page that's PARTIAL, or had all its rows filtered out, says "No images in the first 200 tags. [Keep looking]". It never says "No images". This is the "missing answer read as none" bug shape, applied to filters.

**Counts:**
- **The header shows the total by everyone, labelled as such** ("4,210 tags by everyone"). That's one read of the list's length.
- **Other views get no count until the SDK offers one.**
  - With public off, a count would take a read per person in the lens (up to 64). So the view shows none until the SDK offers it, rather than a wrong one.
  - A count after the "not this" filter would need a scan, so it isn't shown.
- **It counts statements, not distinct items.** One photo tagged by a hundred people is a hundred tags, so the copy says "4,210 tags" and not "4,210 items".
- **The SDK defines exactly what a count includes,** for example whether negative tags are counted. The copy follows that definition.

**Honesty rules carried over from reads (`reads.md`):**
- an UNKNOWN or unreachable read shows why, with Try again, never an empty list;
- a page cut short says so and offers more;
- the pin must be VERIFIED before anything is listed.

## The word view

It's for "what does anyone mean by `tesla`?". People reach it from the search box (Enter on a single word), from a word in a path's breadcrumb, and, under option 3, from a word link.

```text
Everything tagged with the word "tesla"                    Type: [ All ▾ ]
Showing: you · 2 people · everyone [on]       Group: [ By place ▾ ]
3 places · 4,262 tags by everyone
───────────────────────────────────────────────────────────────────────────
/cars/tesla                    4,210 tags                     [ Open ]
  cat.jpg            Image · tagged by alice.eth
  model-y.pdf        File  · tagged by 0x12…ab
  …and 4,208 more
/companies/tesla                  48 tags                     [ Open ]
  q3-report.pdf      File  · tagged by bob.eth
  …and 47 more
/people/nikola_tesla               4 tags                     [ Open ]
Also: "tesla" in your lens is the same as "テスラ" (said by carol.eth) · [ Include ]
```

**Groups:**
- **Groups are places, largest first.** Each group is a path that uses the word, with its own count, its newest few items, and Open, which goes to that path view.
  - Largest-first comes from counts, which are one read each. *(My call: the order a newcomer needs, because the commons is usually the biggest place.)*
  - The order changes as counts change. That's fine, because grouping is a view and not a link.
- **Grouping by place is the default.** The prior-art verdict names its own weakness: a bare word mixes the company, the inventor and the unit. Grouping by place is its answer.
- **A word in the middle of a path** (`tesla` in `/cars/tesla/model_y`) is grouped at the place where the word sits, `/cars/tesla`. So everything filed at `/cars/tesla` and below it stays in one group, which matches the path view under options 1 (with roll-up) and 3. *(My call.)*
- **"Group: All in one list"** merges the groups into one list in lens order, then newest first. Round 3's zipper merge (background) does this in time order with no Graph. Each row then shows its place and its tagger: "cat.jpg · /cars/tesla · tagged by alice.eth".

**Under each answer:**
- **Option 1 (the path is the tag):** the chain lists every topic whose last word is `tesla`, using the exact-word list from round 2 (background). The view shows those places with their counts, so the groups and Open work.
  - The pooled items need one read per place. For a handful of places the client asks the SDK to merge them, since each extra list costs one read. Past a stated limit, the groups show only their counts, with Open.
  - Places where `tesla` isn't the last word (`/cars/tesla/model_y`) aren't found by a last-word list. Under option 1 they show only as sub-entries of `/cars/tesla`.
- **Option 2 (the word is the tag):** one list, read once, shown flat. There are no places to group by.
- **Option 3 (both):** the word's own list holds every tag filed under any path using it. The SDK reads one list and returns it already grouped. Nothing is merged on the client.

**Synonyms, translations and "moved to":**
- These are optional lens statements, and the system works with none of them.
- When the person's lens says another word or place is the same as this one, the view says so in one line, with who said it, and offers **Include**. Include adds that word's places as more groups, marked with the word they came from.
- Include is never automatic. A synonym is somebody's opinion (D-A still holds for opinions), and each included word costs another read. The SDK bounds how many words can be followed.
- **"Moved to" works the same way.** "/cars/tesla says it moved to /vehicles/tesla (said by alice.eth) · [ Go there ]". The old place keeps its items, because a topic's contents never move.

**Counts and honesty:** the header counts places and tags, never distinct items (the same rule as the path view). If any place's read is UNKNOWN or PARTIAL, its group says so ("4,210 tags · couldn't read the newest"), and the header doesn't add it into a total as if it were known.

## Whose entries: one lens, with "public" last

**The views are one ordered lens, not three modes** (PM, 2026-11-25, following James's example *"me, vitalik, public"*). From first to last:
1. **You:** the connected account, when there is one.
2. **The place's owner,** inserted by the client:
   - for an address, that address (the ruling);
   - for a folder, its creator (decision-sheet default);
   - a topic has no owner, so nothing is inserted.
3. **The people the lens names:** the link's `?lens=` when it carries one, otherwise the deployment's default lens (`defaultLensPrincipals`). Who's in a newcomer's lens can wait.
4. **Public,** meaning anyone, when it's on.

The first of these with a stance on an entry decides it (the lens law). A "not this" from anyone named in 1–3 hides that item, even when public has it.

**Where the owner goes** *(my reading)*:
- The ruling says the owner goes after the reader and before public. Between those, I put the owner right after "you", ahead of the people the lens names.
- James's reason was *"we should see that address' data unless we overrode it"*, and only "you" can override it.
- If the PM reads it the other way, only the order changes.

**What the person sees and can change:**
- **The lens line:** "Showing: you · 0x12…ab · 2 people · everyone [on]". It's always visible on path, word and address views, because there it changes the answer by design (requirement L1 keeps lens chrome hidden only until it does).
- **The "everyone" switch is public on or off.**
  - Public on is copied "Everyone"; public off is copied "People I trust".
  - **The default is on,** because this is a test chain (PM, 2026-11-25).
  - It's remembered in the settings record. On a shared IPFS path gateway it lasts for the tab, as every setting does there.
- **Taking the owner out:** "Don't put 0x12…ab first" removes the inserted owner for this view, which is James's *"unless we overrode it"*.
- **"Show what's marked 'not this'"** reveals hidden items, greyed, with who marked them. It's the old "Raw" view as one switch (requirement L5: hiding is inspectable). Raw stays available from the chain, which is what makes the design censorship-resistant. James called view-all *"important for censorship resistance and UX"*.
- **Public can't be on until the all-authors lists exist** (the view-all contracts work). Until then the switch is shown off and disabled: "Everyone's tags aren't readable on this network yet."

**"You" first, and the save path:**
- James's example puts the reader first, so connecting a wallet now changes what a place shows: your own entries come first.
- That replaces `writes.md`'s "the view never switches by itself" rule for place views.
- It also makes its "this view shows <author>'s version first" warning rarer, because your own save is then first in your own view.
- It touches the save path's copy, so it's listed for the PM below, and `writes.md` is changed only with that answer.

**Media gate** (PM, 2026-11-25: yes):
- The list loads no file bytes; there are no thumbnails in the first build.
- An item reached only through public (its author isn't you, the owner, or anyone the lens names) opens in the Preview on its Type, size and author, with "Show preview". A phone, which shows the Preview first, shows that too.
- "Show previews on this page" lifts the gate for the page.
- It's the same pattern as "Load from <host>" for publisher web addresses (PM ruling, 2026-11-24).

## Addresses are places

James ruled that an address works like any other folder or tag. So there's no special home page: an address opens the ordinary place view, the folder listing of `file-operations.md`, with the address inserted into the lens.

```text
0x12…ab  vitalik.eth                                        Type: [ All ▾ ]
Showing: you · 0x12…ab · 2 people · everyone [on]
───────────────────────────────────────────────────────────────────────────
  pet.jpg        Image · yours                  also: 0x12…ab's, 3 others
  talk.pdf       File  · 0x12…ab
  ▾ dog.png      2 versions from everyone, oldest first
      dog.png    Image · 0x9f…01 · 2 Oct
      dog.png    Image · 0x44…7c · 20 Nov
```

- **Each name shows its first answer in lens order,** which is James's pet.jpg example: yours, else the address's, else others'.
  - "also: …" marks a name that others in the lens or public also have (requirement L2: a marker, never a merge). It opens the list of versions.
- **With public on, several versions from everyone** of the same name, none from the lens, show as a list, oldest first (decision-sheet default).
- **The address is what's shown and what's checked.** An ENS name, when one is shown, is display only, looked up at view time, and held behind the PM's ENS privacy question.
- **Your own address:** "you" and the owner are the same entry in the lens line, shown once. New file and New folder work there once homes and the folder operations land.
- **An address with nothing of its own** shows whatever the lens finds, plus the line "0x12…ab hasn't put anything here." UNKNOWN stays UNKNOWN.
- **Attaching to someone else's address** says what it means before the review:
  - "Your entry appears at 0x12…ab for you, for anyone whose lens names you, and for everyone with public on."
  - "Where 0x12…ab has its own entry with this name, people viewing the address see theirs first, unless it's you."
  - This follows the ordering above.
- **Links:** the SDK makes an address link (first segment `0x…`), and homes wait on contracts (C8).

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
- **Many people, many numbers.** A row is one person's tag, so it shows that person's sign. When the SDK can page by item, the row will sum the signs by counts instead ("3 people · 1 says not this"). Details always lists each person's number.

**Suggestions with counts:**
- **What's suggested, in this order:**
  1. the exact match from the chain, with its count;
  2. topics seen in this tab that start with what was typed, each with a count;
  3. under option 3, the word view and the paths that use the word.
- **Counts are across everyone, not limited to the lens** (decision-sheet default). The prior-art evidence (Centola and Baronchelli) says a shared vocabulary forms only when people can see everyone's choices.
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

A file is created with a name in a place: under its author's address, or in a folder there. Tags go on top (the Gmail "All Mail plus labels" model; round 2, background).
- **Creating a file always gives it a named spot.**
  - **Once addresses are places (C8),** the default spot is the person's own address or a folder under it. Its folder path is `/0x…/photos/cat.jpg`, and the name keeps its capitals.
  - **Until then,** it's a folder they choose, under the realm's shared root, which works today but gets no link of its own. Such folders and files are shared only by their permanent object links. *(My call; the sources don't cover the time before addresses.)*
  - **Those earlier files get no spot under the person's address automatically.** When addresses land, "File it under my address" adds one: one more named link, and the old one stays. It's offered on the person's files that have none.
  - Tags go on top, in the same review where possible.
- **A file can be named in more places later.** The name a view shows first is the one its author gave it.
- **"New file here" on a path view** creates the file under the person's address (or in a chosen folder) and tags it with this topic, in one review.
- **What name a path or word view shows for an item:**
  1. the name its author gave it, in their named spot;
  2. else the name in the tagger's named spot;
  3. else its Type and short id.

  The client never invents a name. Tagging someone else's file doesn't name it.
- **Renaming a file changes its name everywhere it's shown,** because its tags point at the file and not at the name. That's the point of keeping the name off the tag.

## What the client needs from the SDK

Each ask names the shape, not the implementation. The SDK sketch (#36) already covers most of them.

1. **Link kinds:**
   - `parseLink` returns a topic kind (and a word kind, under option 3), an address kind, and folder paths under an address.
   - Each carries the display words, the canonical link, and the lens.
2. **A path view read:**
   - pages of rows, each with item, tagger, number, Type and tagged-at;
   - the lens with public on or off, plus whether hidden items are included, `types`, `cursor` and `limit`;
   - rows marked as coming from the named lens or from public, so the two sections can be drawn;
   - coverage COMPLETE or PARTIAL, plus skipped counts (denied, filtered).
3. **Sub-entries of a topic,** paged the same way.
4. **Counts,** with what each count includes.
5. **The word view's data:**
   - **Option 1:** exact-word lookup (every topic with this last word, each with its count) plus a bounded merge of their lists in time order.
   - **Option 2:** the word's own list.
   - **Option 3:** the word's own list, grouped by place, with a count per place.
   - **Either way:** the lens's same-as and moved-to statements about the word or place, each with its author, and a bound on how many words a merge follows.
6. **A fold result:** the canonical words, whether folding changed them, and a mixed-script flag.
7. **An item's display name:** its author's named spot and the tagger's, without the client walking anything.
8. **Planners** for tag, remove my tag, and "not this", with the number, and attach to an address. Each returns the usual `PLANNED { parts, review }`, with the gas figure in the review (T-3).
9. **Place reads with the owner inserted:**
   - a lens helper that inserts an address, or a folder's creator, after the reader;
   - a name read that, with public on and nobody in the lens answering, returns every version in one place, oldest first.

   The client never assembles a lens order or walks authors itself.

## What waits for what

| Piece | Waits on |
|---|---|
| Path view, sub-entries, counts, exact-word search | James's answer to the one real choice, then the contracts release; then SDK asks 1–6. A first version with public off needs no view-all list (lens lists work as built), but still waits for topic ids |
| Word view | option 1: the exact-word list. Option 3: the per-word lists, plus the contracts measurement of their cost and abuse. Option 2: the word's list |
| Synonyms, "moved to" and display names per language | the topic statements in the contracts tag work; SDK ask 5. Until then a view shows the path's own words |
| Tagging, "Not this", the number | the contracts release (the signed number, T-4); SDK ask 8 |
| Address views, attaching to an address | homes (C8) in that release; SDK asks 8–9 |
| Public on (the default) | the all-authors lists (view-all) in that release. Until then the switch is off and disabled |
| Item names in path and word views | SDK ask 7; folder operations (named spots) |
| Type-ahead beyond the tab | a decision on a local cache or an index service |
| Hiding another author's entry | the contracts release (a lone negative, or C3) |

None of this starts before its row is clear. The folder operations proceed now (`file-operations.md`).

## Approaches considered

1. **Whose entries.** Decided by the PM: one lens ending in public, with public on by default on this test chain.
   - The earlier draft proposed three separate modes (Mine, Everyone, Raw). They're now the public switch plus a "show what's marked 'not this'" switch.
   - **Adaptive** (public off when the lens is non-empty, else on): rejected. The same link would show different things to the same person as their lens grows, with no visible cause.
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
  - media reached only through public isn't loaded until asked;
  - an address view shows yours, then the address's, then public's, for one name (James's pet.jpg example, as a test).
- **At 320 px,** keyboard and axe in light and dark, as the other slices do.

## Decided by the PM (2026-11-25)

1. **The bare path is a topic.** Folders and named files live under an address (decision-sheet default). Until that's settled for good, no folder path links are shared; object links are fine.
2. **Whose entries:** one lens ending in public, with public on by default (this is a test chain).
3. **The media gate:** yes, for items reached only through public.
4. **Rows are tags for now,** so an item can appear more than once, provided each row names who tagged it.
5. **Copy:** "tag" in the interface, "topic" only internally.
6. **Type-ahead:** from this tab only.

## For the PM

1. **Where the owner goes in the lens.** I read "after the reader and before public" as right after the reader, ahead of the people the lens names, because only "you" overrides the address's data. Agree?
2. **"You" first when a wallet is connected.** James's example puts the reader first, which replaces `writes.md`'s "the view never switches by itself" for place views and changes when the edit review's "this view shows <author>'s version first" appears. It touches the save path's copy, so I'll change `writes.md` only with your yes. I recommend yes.
