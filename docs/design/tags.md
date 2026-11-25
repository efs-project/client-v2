# Tags, topics and homes in the File Browser: design note

**Status:** draft design note, no code. Rewritten for James's yes to the tag model (2026-11-25) and the working spec that applies it. Nothing here is built.

**Build order:**
- The tag views are built once the SDK's tag reads land on the contracts release, with no stand-in before then.
- The file operations come first (`file-operations.md`).

**Sources:**
- planning `Designs/efsv2/owner-rulings.md`, 2026-11-25:
  - T-1 to T-5;
  - view-all;
  - homes follow the lens;
  - "the shared tag" (planning `6c23a51`);
  - depth;
  - newest first.
- planning `Reviews/2026-11-25-tag-model-spec.md` (the spec): §9 is this note's work order, and §7 its pitfalls. Section numbers below (§3.2, §7.5, …) are the spec's.
- planning `Designs/clientv2/file-browser-requirements.md`: L1 to L8, A7, B4.

**Background only:**
- the decision sheet;
- rounds 2 and 3 of the tag discussion;
- the prior-art corpus.

**Design questions** go to the tag PM session, copying the integration owner.

## The model, as the client sees it

**Ruled by James:**
- **A topic is a path of words** (`/cars/tesla`). `/cars/tesla` and `/people/tesla` are different topics: *"The path on tags in my mind was originally for disambiguation."*
- **A word is shared across paths.** The topic `/tesla` is the word's page: every place the word is used, **grouped by place and never merged**.
- **A tag is one author's statement:** "this thing is in this topic, with this number".
  - At 0 or above it applies, and below 0 it means "not this".
  - No statement means the author said nothing.
- **A tag is listed under its topic, under every parent topic** (roll-up), **and under each of its words** (the word pages).
- **An address is a place like any other.** Anyone can attach to it, and viewing it inserts the address into the lens after the reader.
- **A folder is a Files Type** under an address or another folder. It can be tagged like anything else.
- **Tag is system, folder is app (T-1).** A topic shows things of every Type, with a filter.
- **Public lists are newest first:** *"Newest first is the only way that makes sense otherwise data views are static and nearly useless."*
  - **"Newest" means most recently first stated, not most recently changed** (tag PM session, planning `965b5eb`). Changing a number, or removing and re-adding a tag, doesn't move a thing up.
  - So the interface labels the order **"recently added"**, never "newest" or "recent activity".
- **No small depth limit.** Topic paths go to at least 64 words, and folder paths have no limit.

**Still open, for James, so this note doesn't assume them:**
- the fold refinement (NFKC_Casefold, or NFC plus lowercase);
- what a newcomer's default lens contains;
- whether a file's name is its own mechanism or the last word of a path;
- settings that inherit down a path.

**How word pages are served:** from the directory of places that use a word. There are no per-word item lists (planning `965b5eb`). Each group's items come from that place's own list.

**The client never derives a topic id,** folds a word, or builds or parses a link (AGENTS.md rule 4). The SDK does all of that, from vectors shared with the contracts.

## Links

The spec's §5, as the client routes it. Every link goes through the SDK's `parseLink`, which says what kind of target it is.

| Form | Opens |
|---|---|
| `#/r/<realm>/<word>/<word>/…` | a topic: the path view |
| `#/r/<realm>/<word>` | that word's page: the word view |
| `#/r/<realm>/0x<40 hex>/<name>/…` | an address, then folder and file names (which keep their case) |
| `#/r/<realm>/~efs/…` | a permanent object or revision link (as built) |

- **Canonical form.** A typed link is replaced by the SDK's canonical one, so `/Cars/Tesla` becomes `/cars/tesla`. Trailing slashes are ignored, and empty segments are refused, by the SDK.
- **Object links stay the default for sharing.**
  - Folder path links are shareable once addresses exist, labelled as lookups a rename can break.
  - No link addresses a named file through a topic (still open), so files in a topic open by their permanent link.
- **No depth limit in the client.** The router's 8,192-character limit is the only cap, and a longer route is refused visibly, never cut.
  - Long paths and breadcrumbs collapse visually: the first word and the last two stay visible, and the middle folds into a "…" menu listing every word.
- **`?lens=` works as on object links:** a shared topic link can carry the sharer's lens.

## Words used in the interface

- **"Tag" in copy, "topic" only internally** (PM). For example, "Everything tagged /cars/tesla".
- **"Remove my tag" and "Not this" are different acts** with different words. The first returns to saying nothing; the second records a negative number.
- **"Remove", never "hide"** (requirement A7).
- **A path segment's display name** (§3.5) is:
  1. a path-level label from the lens;
  2. else the word-level label in the reader's language;
  3. else the word itself.

  The word is always one click away, because it's what the link holds.

## Whose tags: three views, and the default for topics

**One lens, ending in public** (§1.9). From first to last:
1. **you,** the connected account;
2. **the place's owner,** inserted (an address, or a folder's creator; a topic has none);
3. **the people the lens names** (the link's `?lens=`, else the deployment's default lens);
4. **public.**

For each (topic, thing), the first of these with a stance decides (§3.1). An UNKNOWN read never counts as "said nothing".

**The three views are one control,** not two switches:

| View | Copy *(proposed)* | Shows |
|---|---|---|
| Mine | People I trust | the lens without public |
| Everyone | Everyone | the lens, then public; hidden: what lens authors marked "not this" |
| Raw | Unfiltered | everything, with "not this" marks shown greyed, with who made them |

**The public tier is labelled clearly** (pitfall §7.7: a recently-added public order rewards whoever posted last).
- Lens results come first, in their own section.
- Public results follow under "From everyone else · not checked by anyone you trust · recently added".
- Rows reached only through public open the Preview behind the media gate (below).

**Default for topics: Everyone** (PM working default D11, reversible; recommended here).
- **View-all is a ruled requirement,** and James called it *"important for censorship resistance and UX"*.
- **Newcomers have no curators yet** (§7.10). Who's in a newcomer's lens is still open, so Mine would be empty or nearly so. A page saying "nothing here" over thousands of tags is the missing-answer-as-none bug at product scale.
- **Everyone is also the cheaper read.** It's one all-authors list per topic. Mine with roll-up is the expensive view (§7.1).
- **Its risks are spam and the latest poster coming first.** They're answered by:
  - the lens tier on top;
  - the labelled public tier;
  - the media gate;
  - junk children hidden by default;
  - two counts in suggestions.
- **Revisit once a newcomer's default lens exists.** Then Mine may be the better default.
- **Not adaptive.** Mine-when-the-lens-has-something, else Everyone, is rejected: the same link would change for the same person as their lens grew, with no visible cause.

**Until the view-all lists exist** (the contracts release), Everyone and Unfiltered are shown disabled: "Everyone's tags aren't readable on this network yet." So the first build shows Mine whatever the default is.

**The choice is remembered** in the settings record. On a shared IPFS path gateway it lasts for the tab.

**Denials** (§3.2):
- **Only lens authors can hide things.** A stranger's "not this" never hides anything from anyone else. In Everyone it shows only as a count ("1 says not this").
- **A denial is about one place.** "Not this" at `/cars/tesla` hides the thing there and at the place it was filed. It doesn't travel down to children, and says nothing about `/cars`.
- **In Everyone and Unfiltered, a row exists because a statement exists** (tag PM session's pitfall review, planning `e09ae60`).
  - A row never needs a positive tag before it shows. Otherwise a few pre-emptive "not this" statements would hide a thing from public views.
  - The row shows the stances found: "3 say it applies, 1 says not".
  - **When not every author was read** (a PARTIAL page, or a bounded merge), it says so ("from the first 200 tags"), never implying a full count.
  - Only a lens author's "not this" hides the row in Everyone, as above.

**Where the owner goes** (our reading of the ruling, agreed with the PM; James can correct it in one line):
- James: *"automatically add vitalik to our lens list automatically in the middle because we should see that address' data unless we overrode it."*
- Only the reader overrides it, so the owner goes right after "you".
- The reader can take the owner out for a view: "Don't put 0x12…ab first".

**"You" first when a wallet is connected** (PM: yes; it's James's example). It holds with three conditions, recorded in `writes.md`:
1. an unsaved edit keeps its base;
2. a reorder is never silent;
3. the order changes only on an identity change or a lens change the person makes.

**Media gate** (PM: yes):
- Lists load no file bytes; there are no thumbnails in the first build.
- An item reached only through public opens on its Type, size and author, with "Show preview". "Show previews on this page" lifts the gate for the page.

## Every row says whose it is

**Every row that isn't the place owner's says whose it is** (§4). Without that, a reader's own `pet.jpg` at someone else's address looks like the owner's.
- **At an address or in a folder:**
  - the owner's rows carry no label;
  - every other row does, the reader's own included ("yours", "alice.eth's", "0x9f…01's");
  - with public on, the label also says the row is from public.
- **In a topic view** there's no owner, so every row says who tagged it.
- **The L1 rule** ("no lens chrome until it changes an answer") yields to this. At a place, authorship always changes the answer.

## Text direction: every label on its own

**Every label from the chain is rendered isolated for text direction** (tag spec, planning `ba33d7f`): a topic's display name, any chain text shown inline, and names and authors shown next to each other. Each sits in its own element with `dir="auto"` (or `<bdi>`), so it never reorders the text around it.
- **Labels refuse direction-control characters** (the SDK's name rules), but a right-to-left label beside other text can still pull its neighbours into its direction without isolation.
- **Inside messages,** MF2 already wraps each argument in bidi isolates. The rule covers labels rendered outside a message: list rows, breadcrumbs, chips and the word view's headings.
- **Built so far** for names in the Files app: entry names in the listing, the removed list and the Move picker, and breadcrumb names, each `translate="no" dir="auto"`.

## The path view (a topic)

It opens in the File Browser's panes, which are keyed on "entries of X":
- the Overview: the tag's display name, its counts, and later its definition;
- the Entries: the list;
- the Preview: the selected thing.

```text
Everything tagged /cars/tesla              View: [ Everyone ▾ ]  Type: [ All ▾ ]
About 4,210 tags · 12 your lens            Scope: (•) Here and below  ( ) Only here
───────────────────────────────────────────────────────────────────────────────
Tags under this one
▸ /cars/tesla/model_y      ★ listed first by alice.eth    310 tags
▸ /cars/tesla/roadster                                     42 tags
  Show all 12
From you and the people you trust
  cat.jpg                  Image · tagged by alice.eth
  notes.txt                Text  · tagged by you · filed at /cars/tesla/model_y
From everyone else · not checked by anyone you trust · recently added
  cat.jpg                  Image · tagged by 0x44…7c
  e4                       Chess move · tagged by 0x9f…01
                           [ Show more ]
```

**Scope: here and below, or only here** (§2.3, roll-up).
- "Here and below" is the default, because it's what browsing a topic means.
- In it, each row filed deeper says where ("filed at /cars/tesla/model_y").
- "Only here" lists exactly this topic.

**Rows:**
- **For now a row is one tag, and it names who tagged it** (PM). An item tagged by three people, or filed under two children, can appear more than once.
  - One row per item is the SDK's job (§3.3: duplicates removed by thing, across pages). It comes when the SDK's reads do it, never by the client walking pages.
- **Things of any Type get a row.** A Type the File Browser can't show gets its name if one is known, else its short id. Opening it shows details, never a guess at the contents.
- **Opening a row:** a file opens in the Preview by its permanent link; a folder opens its listing; a sub-entry opens its own path view.
- **The display name of a thing** comes from the SDK in §3.7's order:
  1. the name its tagger gave it in their own home or folders;
  2. else the name its creator gave it;
  3. else the first name from the lens;
  4. else its media type and a short id.

  The client never invents one.

**Tags under this one: junk hidden by default** (§3.6, §7.11, as refined by the tag PM session, planning `aef00e6`).
- **Three tiers, up to 8 rows in all by default** (the row count is the client's):
  1. **Listed by the lens:** children someone in the lens listed with a number of 0 or more, ranked by the number and marked with who listed them.
  2. **Used by the lens:** children someone in the lens has filed something under, ranked by the lens's count. Friends using `/cars/tesla` is an endorsement even if nobody listed it.
  3. **The rest,** by global count.
- **Eligibility for the default rows is the SDK's default,** so every client agrees: a child needs tags from at least 2 different authors. One spammer tagging twice doesn't pass.
- **A child the lens marked "not this" is hidden.** It appears greyed only in Unfiltered.
- **Everything else is behind "Show all N".**
- **A big directory can't be ranked in one read.**
  - The SDK's children read scans a bounded number of entries and reports PARTIAL.
  - The heading then says "Top of the first 500 tags under this one", with "Keep looking". It never implies everything was ranked.
- **Curating is tagging.** A child row's menu offers "List first under /cars/tesla" (a tag of the child into its parent, with a number) and "Don't list under /cars/tesla" (a negative number). Both are ordinary tags, reviewed and signed like any other.

**The Type filter:**
- The SDK filters on each row's header Type id.
- A PARTIAL or fully filtered page says "No images in the first 200 tags. [Keep looking]", never "No images".

**Counts are "about"** (§2.3).
- A list's length counts every statement ever made, including removed and negative ones, so the copy says "About 4,210 tags", never "4,210 items".
- Beside it is the lens's count ("12 your lens"), where the SDK gives it cheaply. Global counts can be inflated at about one tag's gas each (§7.6).

**Honesty rules:**
- an UNKNOWN read shows why, with Try again, never an empty list;
- a page cut short says so and offers more;
- nothing is listed before the pin is VERIFIED.

## The word view (`/tesla`)

It's for "what does anyone mean by `tesla`?". **It's grouped by place, never one mixed list** (§3.4).

```text
Everything tagged with the word "tesla"    View: [ Everyone ▾ ]  Type: [ All ▾ ]
4 places
───────────────────────────────────────────────────────────────────────────────
/tesla (just the word)     about 9 tags                             [ Open ]
/cars/tesla                about 4,210 tags · 12 your lens          [ Open ]
  cat.jpg            Image · tagged by alice.eth
  model-y.pdf        File  · tagged by 0x12…ab
/companies/tesla           about 48 tags                            [ Open ]
  q3-report.pdf      File  · tagged by bob.eth
/people/nikola_tesla       about 4 tags                             [ Open ]
Also: "テスラ" is the same as "tesla" (said by carol.eth) · [ Include ]
```

**Groups:**
- **A group is a place whose own last word is the word** (§3.4, confirmed by the tag PM session). It shows that place's roll-up, with its counts, its few most recently added items, and Open.
  - So `/cars/tesla/model_y` sits in the `/cars/tesla` group, not in a group of its own.
  - **A place below another group isn't a second group.** `/tesla/cars/tesla` is already inside plain `/tesla`.
  - The groups are exactly the contracts' "topics that use a word" directory.
- **Order:**
  1. **the plain one-word topic first,** "/tesla (just the word)", because it's the page's own place;
  2. **then places the lens has used,** by the lens's count;
  3. **then the rest by global count,** largest first.

  So a spammer's count can't jump the lens's places (§7.6), and both counts are shown. Within a group, the lens tier comes first, then public, most recently added first.
- **There's no "all in one list" option.** A bare word mixes the company, the inventor and the unit, and the place is what tells them apart.

**Synonyms, translations and "moved to"** (§3.5):
- They're optional lens statements, at two levels:
  - word level (`car` = `cars`, `汽车` = `cars`);
  - path level (`/cars/tesla` = `/companies/tesla_motors`).
- **Each one is shown as one line with who said it,** plus Include, which adds its places as more groups, marked with where they came from.
- **Include is never automatic.** The SDK bounds it at 4 hops and 16 lists per view, and says when the bound stopped it.
- **"Moved to"** reads "/cars/tesla says it moved to /vehicles/tesla (said by alice.eth) · [ Go there ]". The old place keeps its items.

**Counts and honesty** are the path view's rules. A group whose read is UNKNOWN or PARTIAL says so, and isn't added into a total as if known.

## Addresses are places

An address opens the ordinary place view (the folder listing in `file-operations.md`), with the address inserted after "you".

**A topic and an address must look different.**
- `vitalik.eth` can be an ordinary topic word, and only a first segment of `0x` plus 40 hex digits is ever an address. The contracts refuse address-shaped and `~`-leading words at every level of a path, so `/people/0x…` can't exist (tag PM session).
- **Address views** show an address mark, the word "Address" and the full checksummed address, with the ENS name, when shown, only as a secondary label.
- **Topic views** show the tag mark and the word "Tag".
- **A topic whose word looks like an ENS name** (ends in `.eth`) adds one line: "This is the tag vitalik.eth, not an address." The client does no lookup; ENS is held behind the PM's privacy question.
- The two marks are new icons for `APP_ICONS` when this is built.

```text
0x12…ab  vitalik.eth                       View: [ Everyone ▾ ]  Type: [ All ▾ ]
───────────────────────────────────────────────────────────────────────────────
  pet.jpg        Image · yours                  also: 0x12…ab's, 3 others
  talk.pdf       File
  ▾ dog.png      2 versions from everyone, recently added
      dog.png    Image · 0x44…7c's, from everyone · 20 Nov
      dog.png    Image · 0x9f…01's, from everyone · 2 Oct
```

- **Each name shows its first answer in lens order:** yours, else the address's, else others'. That's James's `pet.jpg` example.
  - "also: …" marks the other versions (requirement L2: a marker, never a merge).
- **Only the address's own rows are unlabelled.** "talk.pdf" above is 0x12…ab's.
- **Several versions from public** of one name are shown as a list, most recently first stated at the top, labelled "recently added".
- **The address is what's shown and what's checked.** ENS is display only, held behind the PM's ENS privacy question.
- **An address with nothing of its own** says "0x12…ab hasn't put anything here", besides whatever the lens finds.
- **Attaching to someone else's address** says first: "Your entry appears at 0x12…ab for you, for anyone whose lens names you, and for everyone with public on. Where 0x12…ab has its own entry with this name, people viewing the address see theirs first, unless it's you."
- **An address can be tagged** (§2.2), for example "this address is a phishing site", even one that has never transacted. The address view has "Tag this address".

## Tagging

**Where it starts:**
- **Tag** on a file's Preview, on an entry's menu, and on an address view;
- for several entries at once, multi-select in the folder operations.

**The dialog:**

```text
Tag "cat.jpg"
 [ tesla|                                                 ]
   Places that use "tesla":
   /cars/tesla             about 4,210 everyone · 12 your lens
   /companies/tesla        about 48 everyone
   /people/nikola_tesla    about 4 everyone
   /tesla                  about 9 everyone
   Use a new place: /tesla/…   (type a path)
 Chosen:  (/cars/tesla ×)  (/nsfw  Not this ×)
 ▸ More options: a number for each tag · tag only this version
                                                  [ Cancel ]  [ Review ]
```

**Suggestions are the main defence against fragmentation** (§7.5).
- **Typing a word lists the existing places that use it,** each with two counts:
  - across everyone, because a shared vocabulary forms only when people see everyone's choices (Centola and Baronchelli);
  - from the reader's lens, because global counts can be gamed (§7.6).
- **Places the lens has used come first,** then the rest by the global count.
- **Typing a path** narrows the suggestions to places under it.
- **Only exact words come from the chain.** Type-ahead on partial words covers topics seen in this tab only, until a local cache or an index service is decided (see the search box).
- **A new place is shown as new** ("nobody has used /cars/teslaa yet"), so a typo is visible before it becomes permanent (§7.8: a typo is forever, and "moved to" is the only repair).
- **Mixed-script look-alikes** get a warning, from the SDK's fold result.

**The number** (§2.2):
- **The default is 0, "applies".** A chip's "Not this" sets −1.
- **An optional size goes under "More options":** a whole number within the width the SDK reports (8 bits at least). The File Browser reads only the sign; apps define the size.
- **Display follows the sign.** Details list each person's number.
- **The File Browser never sorts by the number,** except a child topic's listing rank (above).

**What a tag points at** (§2.2, §7.9):
- **By default, the file,** so the tag outlives edits.
- **"Tag only this version"** points at the revision. It's meant for claims about content, such as safety tags, that an edit could change.

**The review:**
- **New topics.** A first use of a path registers each missing topic and word page in the same publication, with no extra prompt. The review says how many it creates ("Creates 2 new tags: /cars/teslaa, /teslaa").
- **Parts.** A first use of a deep new path may need more than one part (§7.2). The review says how many approvals, as edits do.
- **The price** is in plain figures (T-3).
- **It says the tags are public:** "Tags are public and permanent: anyone can see that you tagged cat.jpg /cars/tesla." (§7.13). Private tags would stay on this device, and aren't in this version.
- **"Not this"** says its reach: "Hides cat.jpg at /cars/tesla for you and for anyone whose lens puts you first. It says nothing about /cars."

## The search box

- **It sits in the File Browser's location bar,** and accepts a path, a word or a link.
- **The chain answers exact words only.**
  - A single word opens its word view.
  - A path opens its path view.
  - Folding is shown when it changes the text: "Showing `tesla` (you typed `Tesla`)".
- **Type-ahead on partial words covers topics seen in this tab only** (PM). A local cache would be new storage, and an index service a new remote party, so each needs a decision and would be off by default.
- **The copy says so:** "Exact matches only. Searching partial words needs an index service, which isn't set up."

## Naming: a named spot first, tags on top

- **A new file always gets a named spot.** That's under the person's own address (or a folder there) once addresses are places; until then, a folder they choose under the realm's shared root, shared only by its permanent link. *(My call for the time before addresses.)*
- **Tags go on top,** in the same review where possible. "New file here" on a path view creates the file under the person's address and tags it with this topic, in one review.
- **Renaming a file changes its name everywhere,** because tags point at the file, not at the name.

## What the client needs from the SDK

Matching the spec's SDK work order (§9):
1. **Fold and the link grammar,** with vectors: topic, word page, address with names, and `~efs` kinds. The fold result carries the canonical words, whether folding changed them, and a mixed-script flag.
2. **`planTag`, `planUntag` and `planDeny`.**
   - Registration is planned automatically and split when deep.
   - The review shows the price, the number of parts, and the new topics it creates.
   - It targets a file or a revision.
3. **Reads for the three views:**
   - the lens rule;
   - here and below, or only here;
   - duplicates removed by thing, when it can;
   - each row's tagger, number, Type, where it was filed, and whether it came from the lens or from public;
   - counts (global, and the lens's where cheap);
   - word pages grouped by place;
   - the synonym merge, within its bounds;
   - the display-name order of §3.7.
4. **Children of a topic,** with the three tiers (listed by the lens, used by the lens, the rest). Eligibility for the default rows is the SDK's default of tags from at least 2 different authors. The scan is bounded and reports PARTIAL, so "top of the first N" is honest.
5. **A place view with the owner inserted** (the pure lens helper), and the owner's rows marked so "whose" labels need no extra read.

## Testing, when this is built

Recorded transcripts from the SDK's fixture chain, never edited by hand. Each rule gets a test that fails when the rule is broken:
- a word page is grouped by place; a test asserts there's no single mixed list;
- every row at a place that isn't the owner's says whose it is, "yours" included;
- PARTIAL, filtered and UNKNOWN never read as empty;
- "Not this" is never shown as "Remove my tag", and its review states its reach;
- a stranger's "not this" hides nothing in Everyone;
- junk children stay behind "Show all". A child tagged twice by one author isn't eligible, and a lens "not this" hides a child;
- a PARTIAL children read says "top of the first N", never implying everything was ranked;
- a word-page group is never a place below another group;
- a topic named `vitalik.eth` and the address view look different;
- media reached only through public isn't loaded until asked;
- James's `pet.jpg` example: yours, then the address's, then public's;
- suggestions show both counts, lens places first;
- a new path's review names the topics it creates.

Plus 320 px, keyboard, and axe in light and dark.

## Decided (2026-11-25)

**By James:**
1. The tag model: paths tell tags apart, and a word's page shows every place, grouped by place.
2. No small depth limit.
3. Public lists are newest first, meaning most recently first stated, and labelled "recently added".

**By the PM:**
1. **The default view for topics is Everyone** (PM working default D11, reversible). It's listed for James as a default he can flip in one line. It follows his *"a lot of people are going to want to… just 'view all'"*. The first build shows Mine until view-all ships.
2. The bare path is a topic. Folders and named files live under an address, and object links are the default for sharing.
3. One lens ending in public, with the owner right after the reader.
4. "You" first when connected, with three conditions.
5. The media gate.
6. Rows are tags for now, each naming who tagged it.
7. "Tag" in copy.
8. Type-ahead from this tab only.

**By the tag PM session** (planning `aef00e6`, spec §3.4 and §3.6):
1. Children come in three tiers; the default rows need tags from at least 2 different authors, an SDK default; big directories report PARTIAL ("top of the first N").
2. A word-page group is a place whose own word is the word, showing its roll-up. A place below another group isn't a second group.
3. Word-page order is plain `/tesla` first, then lens-used places, then by global count.
4. A topic and an address look different.

The default view (Everyone) is the integration owner's call for now, with public-tier media not loaded until asked. James confirms it before launch, because it decides what a newcomer sees first.
