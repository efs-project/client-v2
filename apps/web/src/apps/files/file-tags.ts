// "Tags" in the Preview: the places a file is tagged at, as the view's Lens decides them
// (the SDK's lensTagsOf), read only when the person opens the section.
//
// - Everyone (the default view for tags, D11): the Lens's rows first ("tagged by …"), then the
//   public tier, labelled as in a tag's list. Places someone in the Lens said the file isn't in are
//   left out, and counted.
// - Each row opens its tag. Only `finished` ends the list ("Keep looking" otherwise); UNKNOWN is
//   never "no tags". Page sizes are the SDK's own.
// - Closed by default, so a Preview reads nothing for it until asked.

import type { Efs, Lens } from '@efs/sdk';
import { link as linkOf } from '@efs/sdk/links';
import type { ThingTagRow, ThingTagsPage, TopicCursor } from '@efs/sdk/tags';
import type { AppHost } from '../../shell/apps.ts';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { readerOf } from './object-kind.ts';
import { whoLine } from './topic.ts';
import { pathText } from './topic-model.ts';
import { shortId } from './who.ts';

const loadTags = async () => import('@efs/sdk/tags');

type TagsState =
  | { readonly phase: 'closed' }
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'page';
      readonly rows: readonly ThingTagRow[];
      readonly finished: boolean;
      readonly next?: TopicCursor;
      readonly denied: number;
      readonly more: 'idle' | 'loading' | 'failed';
    }
  | { readonly phase: 'unknown' };

/** The list after a page of lensTagsOf: the first, or `before` with the next appended. */
export function fromThingTags(
  page: ThingTagsPage,
  before?: Extract<TagsState, { phase: 'page' }>,
): TagsState {
  if (page.status !== 'PRESENT')
    return before ? { ...before, more: 'failed' } : { phase: 'unknown' };
  return {
    phase: 'page',
    rows: before ? [...before.rows, ...page.rows] : page.rows,
    finished: page.finished,
    ...(page.next && !page.finished ? { next: page.next } : {}),
    denied: (before?.denied ?? 0) + page.counts.deniedByLens,
    more: 'idle',
  };
}

export class EfsFileTags extends EfsElement {
  static override properties = {
    host: { attribute: false },
    efs: { attribute: false },
    subject: { attribute: false },
    lens: { attribute: false },
  };
  declare host: AppHost;
  declare efs: Efs | undefined;
  /** The file shown (its subject id). */
  declare subject: string | undefined;
  /** The Lens the Preview reads in (the link's, or "you first"): tags are decided in the same. */
  declare lens: Lens | undefined;

  #state = state<TagsState>({ phase: 'closed' });
  #paths = state<ReadonlyMap<string, readonly string[] | null>>(new Map());
  #controller: AbortController | undefined;
  #shown: string | undefined;

  protected override createRenderRoot() {
    return this;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#controller?.abort();
  }

  override updated(): void {
    // Another file: what was read is someone else's; the section closes again.
    const key = this.subject?.toLowerCase();
    if (key === this.#shown) return;
    this.#shown = key;
    this.#controller?.abort();
    queueMicrotask(() => {
      this.#state.set({ phase: 'closed' });
      this.#paths.set(new Map());
      const details = this.querySelector('details');
      if (details) details.open = false;
    });
  }

  /** Reads the first page (or the next) and each row's tag words, one after another. */
  async #load(more = false): Promise<void> {
    const { efs, subject } = this;
    if (!efs || !subject) return;
    const before = this.#state.get();
    if (!more) {
      this.#controller?.abort();
      this.#controller = new AbortController();
    }
    const signal = this.#controller?.signal;
    if (!signal) return;
    const cursor = more && before.phase === 'page' ? before.next : undefined;
    if (cursor && before.phase === 'page') this.#state.set({ ...before, more: 'loading' });
    else this.#state.set({ phase: 'loading' });
    this.dataset.reading = '';
    try {
      const { lensTagsOf, topicPath } = await loadTags();
      const page = await lensTagsOf(efs, subject as never, {
        view: 'everyone',
        ...(this.lens ? { lens: this.lens } : {}),
        ...(cursor ? { cursor } : {}),
        signal,
      });
      if (signal.aborted) return;
      const next = fromThingTags(page, cursor && before.phase === 'page' ? before : undefined);
      this.#state.set(next);
      if (next.phase !== 'page') return;
      for (const row of next.rows) {
        const id = row.topic.toLowerCase();
        if (this.#paths.get().has(id)) continue;
        const path = await topicPath(efs, row.topic, { signal }).catch(() => undefined);
        if (signal.aborted) return;
        this.#paths.set(
          new Map([...this.#paths.get(), [id, path?.status === 'PRESENT' ? path.words : null]]),
        );
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      this.#state.set(
        cursor && before.phase === 'page' ? { ...before, more: 'failed' } : { phase: 'unknown' },
      );
    } finally {
      if (!signal.aborted) delete this.dataset.reading;
    }
  }

  #row(row: ThingTagRow, t: Translator['t']) {
    const words = this.#paths.get().get(row.topic.toLowerCase());
    const me =
      this.efs && readerOf(this.host)
        ? this.efs.lens.principalOf(readerOf(this.host) as never)
        : undefined;
    const label = words ? pathText(words) : shortId(row.topic);
    const open = () => {
      if (!words) return;
      try {
        this.host.openLink(linkOf({ kind: 'topic', segments: words, words }));
      } catch (error) {
        console.error(error);
      }
    };
    return html`<li class="efs-entry efs-file-tag" data-decider=${row.decider.kind}>
      ${
        words
          ? html`<button type="button" class="efs-entry-open" @click=${open}>
              ${appIcon('tag')} <span class="efs-entry-name" translate="no" dir="auto">${label}</span>
            </button>`
          : html`<span class="efs-entry-open">
              ${appIcon('tag')} <span class="efs-entry-name" translate="no" dir="ltr">${label}</span>
            </span>`
      }
      <span class="efs-entry-meta efs-quiet">${whoLine(t, this.efs, row, me, undefined)}</span>
    </li>`;
  }

  #body(t: Translator['t']) {
    const s = this.#state.get();
    switch (s.phase) {
      case 'closed':
        return nothing;
      case 'loading':
        return html`<p class="wa-cluster wa-gap-xs" role="status">
          <wa-spinner></wa-spinner>${t('files.topic.reading')}
        </p>`;
      case 'unknown':
        return html`<efs-outcome
          .kind=${'read'}
          .code=${'UNKNOWN'}
          .translator=${this.host.translator}
          retryable
          @efs-retry=${() => void this.#load()}
        ></efs-outcome>`;
      case 'page': {
        const lens = s.rows.filter((r) => r.decider.kind === 'lens');
        const pub = s.rows.filter((r) => r.decider.kind !== 'lens');
        const group = (
          heading: 'files.topic.lensSection' | 'files.topic.publicSection',
          rows: readonly ThingTagRow[],
          kind: string,
        ) =>
          rows.length === 0
            ? nothing
            : html`<section class="wa-stack wa-gap-2xs" data-section=${kind}>
                <h4 class="efs-topic-heading">${t(heading)}</h4>
                <ul class="efs-entries" role="list">${rows.map((r) => this.#row(r, t))}</ul>
              </section>`;
        return html`${
          s.rows.length === 0
            ? html`<p class="efs-quiet efs-file-tags-empty" role="status">
                ${t(s.finished ? 'files.fileTags.none' : 'files.topic.noneYet')}
              </p>`
            : nothing
        }
          ${group('files.topic.lensSection', lens, 'lens')}
          ${group('files.topic.publicSection', pub, 'public')}
          ${
            s.denied > 0
              ? html`<p class="efs-quiet efs-file-tags-denied">
                  ${t('files.fileTags.denied', { count: s.denied })}
                </p>`
              : nothing
          }
          ${
            s.more === 'failed'
              ? html`<p class="efs-quiet">${t('files.topic.countUnknown')}</p>`
              : s.next
                ? html`<div>
                    <wa-button
                      size="s"
                      class="efs-file-tags-more"
                      ?loading=${s.more === 'loading'}
                      @click=${() => void this.#load(true)}
                      >${t('files.list.keepLooking')}</wa-button
                    >
                  </div>`
                : nothing
          }`;
      }
    }
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    if (!this.subject) return nothing;
    return html`<details
      class="efs-file-tags"
      @toggle=${(event: Event) => {
        const open = (event.target as HTMLDetailsElement).open;
        if (open && this.#state.get().phase === 'closed') void this.#load();
      }}
    >
      <summary>${t('files.fileTags.title')}</summary>
      <div class="wa-stack wa-gap-s efs-file-tags-body">${this.#body(t)}</div>
    </details>`;
  }
}
