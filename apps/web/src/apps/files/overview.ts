// The Overview pane: the folder on screen's README.md, formatted (the EFS Markdown subset), or,
// without one, the folder's summary. The first column of James's v1 layout ("a README.md markdown
// view pane first, then the file list, then the selected file").
//
// - The README is the folder's own entry named README.md (else readme.md, any case), found in the
//   listing the Entries pane already read (no second listing), read in the same place Lens.
// - Only VERIFIED text is formatted (preview-model.ts reads it, as the Preview does); anything
//   else says why and shows the summary instead.
// - It reads nothing until the person browses (the listing publishes nothing before that).
// - Links: https: opens apart; an EFS object or revision link (parsed by the SDK) opens in the
//   app; anything else (topic and home paths included, which plain words can be) is text.

import type { Efs, Lens } from '@efs/sdk';
import type { FolderRow } from '@efs/sdk/files';
import { link, parseLink } from '@efs/sdk/links';
import { formatRealmRoute } from '../../boot/route.ts';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import { shortId } from './editor.ts';
import { type ListingState, placeLens, rootFolder } from './folder-model.ts';
import { type Block, parseMarkdown } from './markdown.ts';
import { type LinkResolver, renderMarkdown } from './markdown-view.ts';
import { type FolderNav, parentKey, sameParent } from './navigation.ts';
import { readerNotice } from './notice.ts';
import { readerOf } from './object-kind.ts';
import { type PreviewReads, runPreview } from './preview-model.ts';
import type { PlaceLink } from './topic.ts';
import { authorLabel } from './who.ts';

const loadReads = async (): Promise<PreviewReads> => {
  const { openFile, readBytes } = await import('@efs/sdk/files');
  return { openFile, readBytes };
};

type Readme =
  | { readonly phase: 'none' }
  | { readonly phase: 'reading' }
  | { readonly phase: 'shown'; readonly blocks: readonly Block[]; readonly truncated: boolean }
  /** Found, but not shown: too large, not verified text, or not readable now. */
  | { readonly phase: 'not-shown'; readonly why: 'too-large' | 'not-text' | 'unavailable' };

/** The folder's README: README.md first, else a readme.md in any case. Files only. */
export function readmeRow(rows: readonly FolderRow[]): FolderRow | undefined {
  const files = rows.filter((r) => r.kind === 'file' && r.target?.kind === 'file');
  return (
    files.find((r) => r.name === 'README.md') ??
    files.find((r) => r.name.toLowerCase() === 'readme.md')
  );
}

export class EfsFilesOverview extends EfsElement {
  static override properties = {
    host: { attribute: false },
    nav: { attribute: false },
    shown: { attribute: false },
    place: { attribute: false },
  };
  declare host: AppHost;
  declare nav: FolderNav;
  /** What the Entries pane shows now (published by the listing). */
  declare shown: ReadonlySignal<ListingState | undefined>;
  /** A tag or an address shown in Entries instead of a folder: no folder's README then. */
  declare place: ReadonlySignal<PlaceLink | undefined> | undefined;

  #readme = state<Readme>({ phase: 'none' });
  #loaded: string | undefined;
  #run: AbortController | undefined;
  /** Bumped when a save of the README lands, so it is read again. */
  #generation = state(0);
  #synced = new Set<string>();

  protected override createRenderRoot() {
    return this;
  }

  start(scope: OwnerScope): void {
    effect(scope, () => {
      const efs = verifiedEfs(this.host.reader.get());
      const s = this.shown.get();
      const reader = readerOf(this.host);
      const generation = this.#generation.get();
      const row = s?.phase === 'page' ? readmeRow(s.rows) : undefined;
      const subject = row?.target?.kind === 'file' ? row.target.subject : undefined;
      const key =
        efs && s?.phase === 'page' && subject
          ? `${parentKey(s.folder)}|${subject}|${reader ?? ''}|${generation}`
          : undefined;
      if (key === this.#loaded) return;
      this.#loaded = key;
      queueMicrotask(() =>
        this.#read(
          efs,
          subject,
          s?.phase === 'page' ? placeLens(efs as Efs, s.folder, reader) : undefined,
        ),
      );
    });
    // An edit of the README, saved: read it again.
    effect(scope, () => {
      for (const p of this.host.saving.saves.get()) {
        if (p.state !== 'COMPLETE' || this.#synced.has(p.sequenceId)) continue;
        this.#synced.add(p.sequenceId);
        const e = p.effect as { kind?: string; file?: string } | undefined;
        const s = this.shown.get();
        const row = s?.phase === 'page' ? readmeRow(s.rows) : undefined;
        const subject = row?.target?.kind === 'file' ? row.target.subject : undefined;
        if (
          e?.kind === 'files.edit' &&
          subject &&
          e.file?.toLowerCase() === subject.toLowerCase()
        ) {
          queueMicrotask(() => this.#generation.set(this.#generation.get() + 1));
        }
      }
    });
    scope.signal.addEventListener('abort', () => this.#run?.abort());
  }

  #read(efs: Efs | undefined, subject: string | undefined, lens: Lens | undefined): void {
    this.#run?.abort();
    if (!efs || !subject) {
      this.#readme.set({ phase: 'none' });
      return;
    }
    const run = new AbortController();
    this.#run = run;
    this.#readme.set({ phase: 'reading' });
    loadReads()
      .then((reads) =>
        runPreview(
          reads,
          efs,
          { kind: 'file', subject: subject as never },
          run.signal,
          (p) => {
            if (run.signal.aborted) return;
            if (p.phase === 'too-large') this.#readme.set({ phase: 'not-shown', why: 'too-large' });
            else if (p.phase === 'not-present') {
              this.#readme.set({ phase: 'not-shown', why: 'unavailable' });
            } else if (p.phase === 'read') {
              const c = p.content;
              this.#readme.set(
                c?.kind === 'text'
                  ? { phase: 'shown', blocks: parseMarkdown(c.text), truncated: c.truncated }
                  : { phase: 'not-shown', why: c ? 'not-text' : 'unavailable' },
              );
            }
          },
          lens ? { lens } : {},
        ),
      )
      .catch((error: unknown) => {
        if (run.signal.aborted) return;
        console.error(error);
        this.#readme.set({ phase: 'not-shown', why: 'unavailable' });
      });
  }

  /** https: opens apart; an EFS link the SDK parses opens in the app; anything else is text. */
  #resolve: LinkResolver = (href) => {
    if (/^https:\/\//i.test(href)) return { kind: 'external', href };
    const location = this.host.location.get();
    if (location.kind !== 'realm') return undefined;
    // Only explicit object and revision links: other forms the grammar accepts (topic and home
    // paths, which plain words can be) stay text here.
    const parsed = parseLink(href);
    if (parsed.status !== 'OK') return undefined;
    if (parsed.target.kind !== 'object' && parsed.target.kind !== 'revision') return undefined;
    return {
      kind: 'efs',
      href: formatRealmRoute(location.realm, parsed.canonical),
      open: () => this.host.openLink(parsed.canonical),
    };
  };

  /** The folder's name as shown: its row's, the root's, or its short id when opened by link. */
  #folderName(s: Extract<ListingState, { phase: 'page' }>): string {
    const t = this.host.translator.t.bind(this.host.translator);
    if (this.#isRoot(s)) return t('files.location.root');
    if (s.folder.kind === 'home') return shortId(s.folder.address);
    return this.nav.path.get().at(-1)?.name || shortId(s.folder.directory);
  }

  /** Whether the folder on screen is the realm's shared root (however it was opened). */
  #isRoot(s: Extract<ListingState, { phase: 'page' }>): boolean {
    const efs = verifiedEfs(this.host.reader.get());
    return efs !== undefined && sameParent(rootFolder(efs), s.folder);
  }

  #summary(s: Extract<ListingState, { phase: 'page' }>) {
    const t = this.host.translator.t.bind(this.host.translator);
    const root = this.#isRoot(s);
    const reader = readerOf(this.host);
    const efs = verifiedEfs(this.host.reader.get());
    const owner = s.folder.owner;
    const mine =
      reader !== undefined &&
      owner !== undefined &&
      efs?.lens.principalOf(reader as never).toLowerCase() === owner.toLowerCase();
    const folders = s.rows.filter((r) => r.kind === 'folder').length;
    const files = s.rows.filter((r) => r.kind === 'file').length;
    const counts = t(
      s.coverage.state === 'COMPLETE' ? 'files.overview.counts' : 'files.overview.countsSoFar',
      {
        folders: t('files.overview.folders', { count: folders }),
        files: t('files.overview.files', { count: files }),
      },
    );
    return html`<div class="wa-stack wa-gap-xs efs-folder-summary">
      <h3 translate="no" dir="auto">${this.#folderName(s)}</h3>
      <p class="efs-quiet">
        ${
          root
            ? t('files.overview.root')
            : mine
              ? t('files.overview.byYou')
              : owner
                ? t('files.overview.by', {
                    author: authorLabel(verifiedEfs(this.host.reader.get()), owner),
                  })
                : nothing
        }
      </p>
      <p>${counts}</p>
    </div>`;
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const notice = readerNotice(this, this.host, t);
    if (notice) return html`<div class="wa-stack wa-gap-m efs-files-empty">${notice}</div>`;
    const place = this.place?.get();
    if (place) {
      return html`<p class="efs-quiet efs-overview-place">
        ${t(place.status === 'topic' ? 'files.overview.tag' : 'files.overview.address')}
      </p>`;
    }
    const s = this.shown.get();
    if (!s) return html`<p class="efs-quiet">${t('files.overview.empty')}</p>`;
    if (s.phase !== 'page') return nothing;
    const readme = this.#readme.get();
    const row = readmeRow(s.rows);
    const location = this.host.location.get();
    const readmeLink =
      row?.target?.kind === 'file' && location.kind === 'realm'
        ? link({ kind: 'object', subject: row.target.subject })
        : undefined;
    const caption = row
      ? html`<p class="efs-quiet efs-readme-caption">
          ${
            readmeLink && location.kind === 'realm'
              ? html`<a
                  href=${formatRealmRoute(location.realm, readmeLink)}
                  translate="no"
                  dir="auto"
                  @click=${(event: MouseEvent) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                      return;
                    event.preventDefault();
                    const efs = verifiedEfs(this.host.reader.get());
                    if (efs && row.target?.kind === 'file') {
                      this.nav.rememberLens(
                        row.target.subject,
                        placeLens(efs, s.folder, readerOf(this.host)),
                      );
                    }
                    this.host.openLink(readmeLink);
                  }}
                  >${row.name}</a
                >`
              : html`<span translate="no" dir="auto">${row.name}</span>`
          }
        </p>`
      : nothing;
    if (readme.phase === 'shown') {
      return html`<section class="wa-stack wa-gap-s efs-readme" aria-label=${t('files.overview.readme')}>
        ${caption}
        <div class="efs-readme-body" translate="no" dir="auto">${renderMarkdown(readme.blocks, this.#resolve)}</div>
        ${readme.truncated ? html`<p class="efs-quiet">${t('files.preview.truncated')}</p>` : nothing}
      </section>`;
    }
    return html`<div class="wa-stack wa-gap-m">
      ${this.#summary(s)}
      ${
        readme.phase === 'reading'
          ? html`<p class="efs-quiet" role="status"><wa-spinner></wa-spinner> ${t('files.overview.readmeReading')}</p>`
          : readme.phase === 'not-shown'
            ? html`${caption}<p class="efs-quiet efs-readme-not-shown">
                ${t(
                  readme.why === 'too-large'
                    ? 'files.overview.readmeTooLarge'
                    : readme.why === 'not-text'
                      ? 'files.overview.readmeNotText'
                      : 'files.overview.readmeUnavailable',
                )}
              </p>`
            : nothing
      }
    </div>`;
  }
}
