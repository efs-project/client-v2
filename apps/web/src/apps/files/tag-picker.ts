// Choosing where a tag goes, in the folder dialog's picking step: a path of words, typed or picked
// from the places that already use its last word, and whether it applies or is "Not this".
//
// - Suggestions are the SDK's word page for the word typed last: every place that uses it, each
//   with its "about N" (exact plus below). Exact words only: the chain answers no partial word, and
//   no index service is set up. Lens counts wait for the SDK (only the global figure is shown).
// - A path no suggestion matches is said to be new ("Nobody has used /cars/teslaa yet"), so a
//   typo is visible before it becomes permanent; the review then names every tag it creates.
// - Words are folded as the SDK folds them (its interim fold, sdk-v2 e229ea3): "Notes" saves as
//   notes, and the picker says so ("Saved as /notes"), never changing a word silently. One the
//   chain's grammar refuses is named; a non-ASCII word a ruling could change (École, straße) is
//   refused until the tag text rule is chosen (checkStableWord), with Review off.
// - Reads are debounced and one at a time; a newer word cancels an older read.

import type { Efs } from '@efs/sdk';
import { checkStableWord, foldWord } from '@efs/sdk/links';
import type { TopicView } from '@efs/sdk/tags';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { tRich } from '../../ui/rich.ts';
import { visible } from '../../ui/visible-text.ts';
import { aboutCount, badWord, pathParts, wordShown } from './topic-model.ts';

const loadTags = async () => import('@efs/sdk/tags');

export const TAG_PICK_EVENT = 'efs-tag-change';

/** How many places a suggestion list shows (and reads): the dialog's choice, not a read bound. */
const SUGGESTIONS = 8;

/** What the person has chosen so far: the words (when they are a valid path) and the stance. */
export interface TagPick {
  readonly words: readonly string[] | undefined;
  readonly stance: 'tag' | 'deny';
}

interface Suggestion {
  readonly words: readonly string[];
  readonly about: bigint;
}

type Suggestions =
  | { readonly phase: 'idle' }
  | { readonly phase: 'reading'; readonly word: string }
  | { readonly phase: 'shown'; readonly word: string; readonly rows: readonly Suggestion[] }
  /** Nobody has used the word yet: every path ending in it is new. */
  | { readonly phase: 'unused'; readonly word: string }
  | { readonly phase: 'unavailable'; readonly word: string };

/** The words of a typed path: split on "/", empty segments dropped (a trailing "/" is fine). */
export function typedWords(text: string): string[] {
  return text
    .split('/')
    .map((w) => w)
    .filter((w) => w.length > 0);
}

/** Whether `words` is one of the suggested places (then it isn't new). */
export function isSuggested(words: readonly string[], rows: readonly Suggestion[]): boolean {
  return rows.some(
    (r) => r.words.length === words.length && r.words.every((w, i) => w === words[i]),
  );
}

export class EfsTagPicker extends EfsElement {
  static override properties = {
    efs: { attribute: false },
    translator: { attribute: false },
    view: { attribute: false },
    stances: { attribute: false },
    pathLabel: { attribute: false },
  };
  declare efs: Efs | undefined;
  declare translator: Translator;
  /** Unused today: suggestions show the global figure only (Lens counts wait for the SDK). */
  declare view: TopicView | undefined;
  /**
   * Whether to offer "Applies" / "Not this" (a tag); off when picking another tag for "Same as…"
   * or "Under…", where the stance is the action itself. Default on.
   */
  declare stances: boolean;
  /** The path field's label in place of "Tag path" (a message already translated). */
  declare pathLabel: string | undefined;

  constructor() {
    super();
    this.stances = true;
  }

  #text = state('');
  #stance = state<'tag' | 'deny'>('tag');
  #suggestions = state<Suggestions>({ phase: 'idle' });
  #refused = state<{ word: string; code: number; rule: string } | undefined>(undefined);
  /** A word that can't be written until the tag text rule is chosen (checkStableWord). */
  #unstable = state<string | undefined>(undefined);
  /** The path as it will be saved, when folding changed what was typed. */
  #folded = state<readonly string[] | undefined>(undefined);
  #timer: ReturnType<typeof setTimeout> | undefined;
  #controller: AbortController | undefined;
  #checkWord: ((w: string) => { ok: true } | { ok: false; code: number; rule: string }) | undefined;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void loadTags().then((tags) => {
      this.#checkWord = tags.checkWord;
      this.#changed();
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#cancelLookUp();
  }

  /** The person's choice changed: say so, and look the last word up (debounced). */
  #changed(): void {
    const typed = typedWords(this.#text.get());
    // As the SDK will save them: folded (a word it can't fold stays as typed, for the grammar).
    // The link grammar's own fold, already loaded with the app (a lazy import of it would split
    // the startup chunks, and WebKit then can't recover a failed app chunk by reloading).
    const words = typed.map((w) => {
      const f = foldWord(w);
      return f.ok ? f.word : w;
    });
    const refused =
      this.#checkWord && words.length > 0 ? badWord(words, this.#checkWord) : undefined;
    this.#refused.set(
      refused ? { word: refused.word, code: refused.code, rule: refused.rule } : undefined,
    );
    const unstable = refused ? undefined : words.find((w) => !checkStableWord(w).ok);
    this.#unstable.set(unstable);
    const valid =
      words.length > 0 && this.#checkWord !== undefined && !refused && unstable === undefined;
    this.#folded.set(valid && words.some((w, i) => w !== typed[i]) ? words : undefined);
    this.dispatchEvent(
      new CustomEvent<TagPick>(TAG_PICK_EVENT, {
        detail: { words: valid ? words : undefined, stance: this.#stance.get() },
        bubbles: true,
        composed: true,
      }),
    );
    const last = valid ? words.at(-1) : undefined;
    const now = this.#suggestions.get();
    if (last === undefined) {
      // Nothing to look up now: a lookup still waiting for the last word would only be stale.
      this.#cancelLookUp();
      this.#suggestions.set({ phase: 'idle' });
      return;
    }
    if (now.phase !== 'idle' && now.word === last) return;
    if (this.#timer) clearTimeout(this.#timer);
    // Looking up (data-reading) from now until the read is done: tests wait for it, as they do
    // for a tag list or a word page.
    this.toggleAttribute('data-reading', true);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#lookUp(last);
    }, 300);
  }

  /** Drops a lookup still waiting or reading: its word is no longer the one typed. */
  #cancelLookUp(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#controller?.abort();
    this.toggleAttribute('data-reading', false);
  }

  async #lookUp(word: string): Promise<void> {
    const efs = this.efs;
    if (!efs) {
      this.toggleAttribute('data-reading', false);
      return;
    }
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    this.#suggestions.set({ phase: 'reading', word });
    try {
      const { topicPath, wordPage } = await loadTags();
      // Only the suggestions shown are read (and their paths resolved): never a whole page.
      const page = await wordPage(efs, word, { limit: SUGGESTIONS, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (page.status !== 'PRESENT') {
        // A word nobody has used reads as proven absent; anything else couldn't be read.
        this.#suggestions.set(
          page.status === 'ABSENT_PROVEN'
            ? { phase: 'unused', word }
            : { phase: 'unavailable', word },
        );
        return;
      }
      const rows: Suggestion[] = [];
      for (const row of page.rows.slice(0, SUGGESTIONS)) {
        const path = await topicPath(efs, row.topic, { signal: controller.signal }).catch(
          () => undefined,
        );
        if (controller.signal.aborted) return;
        if (path?.status === 'PRESENT') rows.push({ words: path.words, about: aboutCount(row) });
      }
      this.#suggestions.set({ phase: 'shown', word, rows });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      this.#suggestions.set({ phase: 'unavailable', word });
    } finally {
      // Done, unless a newer word is already waiting or being read.
      if (this.#controller === controller && this.#timer === undefined) {
        this.toggleAttribute('data-reading', false);
      }
    }
  }

  #choose(words: readonly string[]): void {
    this.#text.set(words.join('/'));
    this.#changed();
  }

  override render() {
    const t = this.translator.t.bind(this.translator);
    const s = this.#suggestions.get();
    const refused = this.#refused.get();
    const unstable = this.#unstable.get();
    const folded = this.#folded.get();
    // The words as they'll be saved (folded), which the suggestions were looked up by.
    const words = folded ?? typedWords(this.#text.get());
    const isNew =
      words.length > 0 &&
      !refused &&
      unstable === undefined &&
      ((s.phase === 'shown' && s.word === words.at(-1) && !isSuggested(words, s.rows)) ||
        (s.phase === 'unused' && s.word === words.at(-1)));
    return html`<div class="wa-stack wa-gap-s efs-tag-picker">
      <wa-input
        class="efs-tag-path"
        label=${this.pathLabel ?? t('files.tag.pathLabel')}
        hint=${t('files.tag.pathHint')}
        autocomplete="off"
        spellcheck="false"
        .value=${this.#text.get()}
        @input=${(event: Event) => {
          this.#text.set((event.target as HTMLInputElement).value);
          this.#changed();
        }}
      ></wa-input>
      ${
        refused
          ? html`<p class="efs-tag-refused" role="alert">
              ${tRich(t, 'files.topic.badWord', { word: wordShown(refused.word), code: refused.code })}
              <span class="efs-quiet" translate="no">${refused.rule}</span>
            </p>`
          : nothing
      }
      ${
        unstable !== undefined
          ? html`<p class="efs-tag-unstable" role="alert">
              ${tRich(t, 'files.tag.unstable', { word: wordShown(unstable) })}
            </p>`
          : nothing
      }
      ${
        folded
          ? html`<p class="efs-tag-folded" role="status">
              ${tRich(t, 'files.tag.savedAs', { path: pathParts(folded) })}
            </p>`
          : nothing
      }
      ${
        isNew
          ? html`<p class="efs-tag-new" role="status">${tRich(t, 'files.tag.new', { path: pathParts(words) })}</p>`
          : nothing
      }
      ${
        s.phase === 'reading'
          ? html`<p class="wa-cluster wa-gap-xs efs-quiet" role="status">
              <wa-spinner></wa-spinner>${tRich(t, 'files.tag.looking', { word: wordShown(s.word) })}
            </p>`
          : s.phase === 'shown' && s.rows.length > 0
            ? html`<div class="wa-stack wa-gap-2xs efs-tag-suggestions">
                <p class="efs-quiet">${tRich(t, 'files.tag.placesUsing', { word: wordShown(s.word) })}</p>
                <ul class="efs-entries" role="list">
                  ${s.rows.map(
                    (r) => html`<li class="efs-entry efs-tag-suggestion">
                      <button type="button" class="efs-entry-open" @click=${() => this.#choose(r.words)}>
                        ${appIcon('tag')}
                        <span class="efs-entry-name" translate="no" dir="auto">${visible(pathParts(r.words), t)}</span>
                      </button>
                      <span class="efs-entry-meta efs-quiet">
                        ${t('files.tag.aboutEveryone', { count: Number(r.about) })}
                      </span>
                    </li>`,
                  )}
                </ul>
              </div>`
            : s.phase === 'unavailable'
              ? html`<p class="efs-quiet">${t('files.tag.suggestionsUnavailable')}</p>`
              : nothing
      }
      ${this.stances ? this.#stanceGroup(t) : nothing}
    </div>`;
  }

  #stanceGroup(t: Translator['t']) {
    return html`<wa-radio-group
        class="efs-tag-stance"
        label=${t('files.tag.stanceLabel')}
        orientation="horizontal"
        size="s"
        .value=${this.#stance.get()}
        @change=${(event: Event) => {
          const value = (event.target as HTMLElement & { value: string }).value;
          this.#stance.set(value === 'deny' ? 'deny' : 'tag');
          this.#changed();
        }}
      >
        <wa-radio value="tag">${t('files.tag.applies')}</wa-radio>
        <wa-radio value="deny">${t('files.tag.notThis')}</wa-radio>
      </wa-radio-group>`;
  }
}
