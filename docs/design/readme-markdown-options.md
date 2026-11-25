# Markdown READMEs in the Overview pane: options

**Status:** decided by the integration owner (PM), 2026-11-25: **(c), then (a), with no new library.** No code until listings land.

**Context:**
- The File Browser's Overview pane says "When this location has a README, it will appear here."
- **The feature waits on listings.** A README belongs to a location (a folder, or under the tag ruling a tag), and listings wait for that ruling, so nothing here is needed before it.
- **Three constraints:**
  - **James's direction (2026-11-24):** the UI uses Web Awesome, Lit and Signals, "and nothing else".
  - **Our CSP:** it enforces Trusted Types with one policy, Lit's pass-through `lit-html`. That's why `unsafeHTML` is banned in source and Web Awesome's own `wa-markdown` is unusable (`docs/design/shell.md`, Security policy).
  - **What's shown is a file's verified bytes:** a README is content, not trusted code.

## The options

### (a) A small in-house subset renderer, straight to Lit templates

- **What it covers:**
  - ATX headings, paragraphs and line breaks;
  - emphasis, strong and inline code;
  - fenced code blocks;
  - ordered and unordered lists (nested);
  - blockquotes, thematic breaks;
  - links, only `https:` and EFS links, with `rel="noopener noreferrer"`.
- **What it leaves out:** raw HTML (shown as text), images (later, through the Preview's verified-media path) and GFM tables.
- **Safety:** it builds Lit templates directly, with no HTML string at any point. Lit escapes every text value, and there's no new Trusted Types policy and no CSP change.
- **Size:** about 400–600 lines of TypeScript plus about 150 table-driven tests. Roughly 3–5 KB brotli, lazy-loaded with the Overview pane, never in startup. These are estimates; it would be measured with the build's own gate.
- **Maintenance:** it's ours. Where it differs from CommonMark (the subset, plus edge cases like setext headings and lazy continuation), it's documented as "the EFS Markdown subset".
- **Risk:** low security risk, because nothing reaches the DOM as HTML. The cost is fidelity: unsupported syntax shows as plain text.

### (b) A library

Two families, sized approximately from their published bundle sizes (to be measured in a spike before adoption):

- **HTML-string renderers:** `marked` (about 13 KB gzip) or `markdown-it` (about 35 KB gzip).
  - They output HTML strings, which can only reach the page through `innerHTML`. That needs a sanitizer (DOMPurify, about 8 KB gzip) *and* a second Trusted Types policy (DOMPurify's), added to the CSP's `trusted-types`.
  - That reverses the "no HTML strings" stance this client has kept since slice A.
- **AST parsers:** `micromark` with `mdast-util-from-markdown` (about 30 KB gzip; about 10 KB more with GFM tables).
  - They produce a syntax tree we'd render to Lit templates ourselves, dropping `html` nodes, so there's no sanitizer and no CSP change.
  - They're fully CommonMark-compliant and actively maintained (the unified collective).
  - They add about a dozen small runtime packages (`micromark-*`, character-entity tables).
- **Either way** this adds runtime dependencies beyond Web Awesome, Lit and Signals. That's the line James drew, so it's his call, not the PM's.

### (c) Show the README as plain text, for now

- A `README.md` shows as text: monospace, wrapped, with a quiet note "Markdown is shown as plain text."
- That's the Preview's existing text rendering. It costs nothing, and nothing in it is ever interpreted.

## Recommendation

1. **(c) when listings land** (the first time a README can be found), because it's free and safe.
2. **(a) as a small follow-up**, if people want formatted READMEs. It keeps to James's library rule, keeps Trusted Types and the CSP unchanged, and is cheap to own at this scope.
3. Revisit **(b), the AST-parser variant**, only if README fidelity needs to go beyond the subset (tables, footnotes, full CommonMark), and then take it to James as a dependency decision. Don't use an HTML-string renderer: it needs a second Trusted Types policy and a sanitizer for content that's untrusted by definition.

**Who decides:**
- (a) or (c): the PM.
- (b): James, because it's a dependency-policy call.

## Decision (PM, 2026-11-25)

- **(c) when listings land:** the README shows as plain text.
- **Then (a):** an in-house subset rendered straight to Lit templates. No HTML strings, no new Trusted Types policy, no CSP change.
- **(b) stays off the table** unless (a) proves too costly. If it does, it goes to James as a dependency decision.
