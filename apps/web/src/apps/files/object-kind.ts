// What an object link (`~efs/o/<id>`) names: a folder or a file. Since sdk-v2 c8ed37a an id's kind
// is fixed by the id (a folder is a record only its creator can publish; a file is a subject).
//
// openObject decides, first and alone: the kind is a property of the id (a directory record is a
// folder, whatever else exists), never inferred from whether a HEAD happens to read PRESENT. For
// a file it also returns the file opened under the Lens (`open`), which the Preview reuses once;
// the kind and the HEAD are read in one batch, so a file link costs what opening the file does.
// A FILE whose `open` is UNKNOWN (its HEAD failed on every endpoint) shows in the file's pane with
// Try again, which opens it afresh. Until it answers, nothing reads the id as a missing file, so
// a folder's link never shows "Confirmed not present".
//
// A path link (`~efs/o/<folder>/<name>…`) is looked up with openPath, then opened by what its
// names lead to, the way clicking through them would: a folder by its own link with the trail of
// folders it came through, a file by its own link, read in the Lens its row was chosen in. The URL
// is replaced with that object link (rename-proof, as every link the app gives out). A path that
// leads nowhere says which name, and why.
//
// A file no one in the view's Lens has a version of is read in its own place (you, then its
// creator, then that Lens), as a folder is: a link to it never reads "not present" for that alone.
//
// The kind always answers for the link in the URL and the session now: while a new link (or the
// same link in a new session) resolves it is pending, or a folder already known in this tab,
// never an earlier answer. So nothing acting on it (the listing following the URL with its trail)
// can mistake the folder just left for the one arrived at, or "no reader yet" for an answer.

import type { Efs, HomeLink, Lens, PathLink, Reason } from '@efs/sdk';
import type { FolderRef, HomeRef, OpenResult, PathOpen } from '@efs/sdk/files';
import { link as linkOf } from '@efs/sdk/links';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { effect } from '../../state/effect.ts';
import { computed, type ReadonlySignal, state } from '../../state/signals.ts';
import { LENS_TOO_WIDE } from '../../ui/outcome.ts';
import { rootFolder } from './folder-model.ts';
import type { FolderNav, NavStep } from './navigation.ts';
import type { LinkState } from './target.ts';

export type ObjectKind =
  /** Not an object link (a revision link, the realm root, an app route): nothing to resolve. */
  | { readonly status: 'none' }
  | { readonly status: 'pending' }
  | { readonly status: 'folder'; readonly folder: FolderRef }
  /** An address (a home): its owner as of the read, and the Lens to list it in (openHome's). */
  | { readonly status: 'home'; readonly home: HomeRef; readonly lens: Lens }
  /** A file, opened under `lens` (its HEAD may still be absent under it). */
  | { readonly status: 'file'; readonly open: OpenResult; readonly lens: Lens | undefined }
  /** Nothing has this id (no folder record, no created subject), as of the read. */
  | { readonly status: 'absent' }
  | { readonly status: 'invalid'; readonly reason: Reason }
  | { readonly status: 'unknown'; readonly reason: Reason }
  /**
   * A path link whose names lead nowhere under its Lens, at `name`: nothing has that name there
   * (absent), an author in the Lens removed it with hide (masked), or it is a file, so the path
   * can't go below it (notFolder).
   */
  | {
      readonly status: 'noPath';
      readonly why: 'absent' | 'masked' | 'notFolder';
      readonly name: string;
    };

const loadFiles = async () => import('@efs/sdk/files');

export interface ObjectKindState {
  readonly kind: ReadonlySignal<ObjectKind>;
  /** Reads the id again (after UNKNOWN). */
  retry(): void;
}

/**
 * The Lens an object link is read in: the link's own when it carries one (the sharer's view);
 * otherwise "you first" (D10): the connected account, then the Lens it was listed in this tab (the
 * place's owner, then the default), else the default. Undefined is the SDK's default.
 */
export function readLens(
  efs: Efs,
  l: LinkState,
  nav: FolderNav | undefined,
  reader: string | undefined,
): Lens | undefined {
  if (l.status !== 'target') return undefined;
  if (l.lens) return l.lens;
  const listed = l.target.kind === 'file' ? nav?.lensFor(l.target.subject) : undefined;
  return reader ? efs.lens.mineFirst(reader as never, listed ?? efs.lens.default) : listed;
}

/**
 * A file's own place: you, then its creator, then that Lens (`efs.lens.place`). The SDK refuses a
 * Lens of more than 64 accounts (EfsFault LIMIT, sdk-v2 bdcbe6e), which a base of 63 or 64 can
 * reach: that is LENS_TOO_WIDE, said as an outcome, never a crash. Any other fault is thrown on.
 */
export function ownPlace(
  efs: Efs,
  o: { readonly reader?: string; readonly owner: string; readonly base: Lens },
): Lens | typeof LENS_TOO_WIDE {
  try {
    return efs.lens.place({
      ...(o.reader ? { reader: o.reader as never } : {}),
      owner: o.owner as never,
      base: o.base,
    });
  } catch (error) {
    // Duck-typed: this module is startup code and never imports an SDK value.
    const fault = error as { readonly name?: unknown; readonly code?: unknown } | null;
    if (fault?.name === 'EfsFault' && fault.code === 'LIMIT') return LENS_TOO_WIDE;
    throw error;
  }
}

/** What a path that didn't lead to an entry shows. */
function pathKind(
  answer: Exclude<PathOpen, { status: 'PRESENT' }>,
  names: readonly string[],
): ObjectKind {
  if (answer.kind === 'efs.object') return { status: 'absent' };
  switch (answer.status) {
    case 'ABSENT_PROVEN':
    case 'MASKED':
    case 'NOT_A_FOLDER':
      return {
        status: 'noPath',
        why:
          answer.status === 'MASKED'
            ? 'masked'
            : answer.status === 'NOT_A_FOLDER'
              ? 'notFolder'
              : 'absent',
        name: names[answer.segment] ?? '',
      };
    case 'INVALID':
      return { status: 'invalid', reason: answer.reason };
    default:
      return { status: 'unknown', reason: answer.reason };
  }
}

/** The connected account, when there is one on this network. */
export function readerOf(host: AppHost): string | undefined {
  const a = host.saving.availability.get();
  return a.status === 'READY' ? a.account : undefined;
}

/**
 * Follows the route's link and resolves its kind. A folder answer is kept for the tab (it can't
 * change); a file is opened again each time (its HEAD can move); absent and unknown are read again.
 */
export function objectKindState(
  host: AppHost,
  link: ReadonlySignal<LinkState>,
  nav: FolderNav,
  scope: OwnerScope,
): ObjectKindState {
  /** Folders this tab has resolved, by id (a folder stays a folder), in session `foldersFor`. */
  const folders = new Map<string, FolderRef>();
  let foldersFor: Efs | undefined;
  /** The last answer, and the link, session and connected account (its Lens) it is for. */
  const answer = state<{
    readonly key: string;
    readonly efs: Efs | undefined;
    readonly kind: ObjectKind;
  }>({ key: 'none', efs: undefined, kind: { status: 'none' } });
  const readerFor = (l: LinkState) =>
    (l.status === 'target' && !l.lens) ||
    (l.status === 'path' && !l.link.lens) ||
    (l.status === 'home' && !l.lens)
      ? readerOf(host)
      : undefined;
  const keyOf = (l: LinkState, reader: string | undefined) =>
    l.status === 'target' || l.status === 'path' || l.status === 'home'
      ? `${l.canonical}|${reader ?? ''}`
      : l.status;
  const kind = computed<ObjectKind>(() => {
    const l = link.get();
    const efs = verifiedEfs(host.reader.get());
    const a = answer.get();
    if (l.status === 'path' || l.status === 'home') {
      return a.key === keyOf(l, readerFor(l)) && a.efs === efs ? a.kind : { status: 'pending' };
    }
    if (l.status !== 'target' || l.target.kind !== 'file') return { status: 'none' };
    if (a.key === keyOf(l, readerFor(l)) && a.efs === efs) return a.kind;
    const folder =
      efs && efs === foldersFor ? folders.get(l.target.subject.toLowerCase()) : undefined;
    return folder ? { status: 'folder', folder } : { status: 'pending' };
  });
  let resolved: string | undefined;
  let resolvedEfs: Efs | undefined;
  let run: OwnerScope | undefined;
  let attempt = 0;
  const resolve = (efs: Efs | undefined, l: LinkState, reader: string | undefined) => {
    run?.dispose();
    run = undefined;
    const key = keyOf(l, reader);
    const set = (k: ObjectKind) => answer.set({ key, efs, kind: k });
    if (efs && l.status === 'path') {
      followPath(efs, l.link, reader, set);
      return;
    }
    if (efs && l.status === 'home') {
      const homeLink: HomeLink = {
        kind: 'home',
        address: l.address,
        names: l.names,
        ...(l.lens ? { lens: l.lens } : {}),
      };
      if (l.names.length > 0) followPath(efs, homeLink, reader, set);
      else openAddress(efs, l, reader, set);
      return;
    }
    if (!efs || l.status !== 'target' || l.target.kind !== 'file') {
      set({ status: 'none' });
      return;
    }
    const subject = l.target.subject;
    const id = subject.toLowerCase();
    const folder = folders.get(id);
    if (folder) {
      set({ status: 'folder', folder });
      return;
    }
    const mine = scope.child();
    run = mine;
    const lens = readLens(efs, l, nav, reader);
    const o = { signal: mine.signal, ...(lens ? { lens } : {}) };
    set({ status: 'pending' });
    void (async () => {
      try {
        const { openFile, openObject } = await loadFiles();
        const object = await openObject(efs, subject, o);
        if (mine.signal.aborted) return;
        if (object.status === 'FOLDER') folders.set(id, object.folder);
        // No author in the view's Lens has a version of this file: read it in its own place, as
        // a folder lists in its owner's (you, then its creator, then that Lens). A file opened
        // from a tag or a link is then never "not present" only because its creator isn't in the
        // reader's Lens. A link carrying its own Lens is read in that Lens alone.
        if (object.status === 'FILE' && object.open.status === 'ABSENT_PROVEN' && !l.lens) {
          const own = ownPlace(efs, {
            ...(reader ? { reader } : {}),
            owner: object.creator,
            base: lens ?? efs.lens.default,
          });
          if (own === LENS_TOO_WIDE) {
            set({ status: 'invalid', reason: { code: LENS_TOO_WIDE, retry: 'never' } as Reason });
            return;
          }
          const before = (lens ?? efs.lens.default).principals.map((p) => p.toLowerCase());
          const widened = own.principals.some((p) => !before.includes(p.toLowerCase()));
          if (widened) {
            const open = await openFile(
              efs,
              { kind: 'file', subject: subject as never },
              { signal: mine.signal, lens: own },
            );
            if (mine.signal.aborted) return;
            nav.rememberLens(subject, own);
            set({ status: 'file', open, lens: own });
            return;
          }
        }
        set(
          object.status === 'FOLDER'
            ? { status: 'folder', folder: object.folder }
            : object.status === 'FILE'
              ? { status: 'file', open: object.open, lens }
              : object.status === 'ABSENT_PROVEN'
                ? { status: 'absent' }
                : object.status === 'INVALID'
                  ? { status: 'invalid', reason: object.reason }
                  : { status: 'unknown', reason: object.reason },
        );
      } catch (error) {
        if (mine.signal.aborted) return;
        console.error(error);
        set({
          status: 'unknown',
          reason: { code: 'CLIENT_ERROR', retry: 'transient' } as Reason,
        });
      }
    })();
  };
  /**
   * An address (a home): its owner, as of the read, and the Lens to list it in (the link's own,
   * else you, then the address, then the default). Its entries list like a folder's.
   */
  const openAddress = (
    efs: Efs,
    l: Extract<LinkState, { status: 'home' }>,
    reader: string | undefined,
    set: (k: ObjectKind) => void,
  ) => {
    const mine = scope.child();
    run = mine;
    set({ status: 'pending' });
    const { signal } = mine;
    void (async () => {
      try {
        const { openHome } = await loadFiles();
        const home = await openHome(efs, l.address, {
          signal,
          ...(reader ? { reader: reader as never } : {}),
          base: efs.lens.default,
        });
        if (signal.aborted) return;
        set(
          home.status === 'PRESENT'
            ? { status: 'home', home: home.home, lens: l.lens ?? home.lens }
            : { status: 'unknown', reason: home.reason },
        );
      } catch (error) {
        if (signal.aborted) return;
        console.error(error);
        set({ status: 'unknown', reason: { code: 'CLIENT_ERROR', retry: 'transient' } as Reason });
      }
    })();
  };
  /** Looks a path link up, then opens what it leads to by its own link (or says why not). */
  const followPath = (
    efs: Efs,
    l: PathLink | HomeLink,
    reader: string | undefined,
    set: (k: ObjectKind) => void,
  ) => {
    const mine = scope.child();
    run = mine;
    set({ status: 'pending' });
    const { signal } = mine;
    const root = rootFolder(efs);
    void (async () => {
      try {
        const { openPath } = await loadFiles();
        if (signal.aborted) return;
        // The Lens is openPath's: the link's own; else you first, then the start folder's
        // creator, then the default. It comes back with the answer, and the file opens in it.
        const answer = await openPath(efs, l, {
          signal,
          ...(reader ? { reader: reader as never } : {}),
          base: efs.lens.default,
        });
        if (signal.aborted) return;
        if (answer.status === 'PRESENT') {
          arrive(l, answer, root);
          return;
        }
        set(pathKind(answer, l.names));
      } catch (error) {
        if (signal.aborted) return;
        console.error(error);
        set({ status: 'unknown', reason: { code: 'CLIENT_ERROR', retry: 'transient' } as Reason });
      }
    })();
  };
  /**
   * Opens what a path led to by its own link, in place of the path in the URL. A folder: the trail
   * becomes the folders the names came through, each with its creator (a start other than the
   * realm's root comes first, by its id). A file: the trail stays as it is (as for any file link),
   * and the file is read in the Lens its row was chosen in (the link's own Lens travels in the new
   * link instead).
   */
  const arrive = (
    l: PathLink | HomeLink,
    answer: Extract<PathOpen, { status: 'PRESENT' }>,
    root: FolderRef,
  ) => {
    const target = answer.target;
    const own = l.lens ? { lens: l.lens } : {};
    if (target.kind === 'file') {
      if (!l.lens) nav.rememberLens(target.subject, answer.lens);
      host.openLink(linkOf({ kind: 'object', subject: target.subject, ...own }), { replace: true });
      return;
    }
    // Where the names start: an address (the trail starts there), or a folder by its id (the
    // realm's root, or a folder off it, first by its short id).
    const first = answer.chain[0]?.folder;
    const home: HomeRef | undefined =
      l.kind === 'home'
        ? first?.kind === 'home'
          ? first
          : { kind: 'home', address: l.address }
        : undefined;
    const start: FolderRef | undefined =
      l.kind === 'path'
        ? first?.kind === 'folder'
          ? first
          : { kind: 'folder', directory: l.folder }
        : undefined;
    const fromRoot = !start || start.directory.toLowerCase() === root.directory.toLowerCase();
    const trail: NavStep[] = fromRoot || !start ? [] : [{ folder: start, name: '' }];
    for (const step of answer.chain) {
      if (step.target.kind === 'folder') trail.push({ folder: step.target, name: step.name });
    }
    folders.set(target.directory.toLowerCase(), target);
    nav.goTo(trail, home);
    host.openLink(linkOf({ kind: 'object', subject: target.directory as never, ...own }), {
      replace: true,
    });
  };
  effect(scope, () => {
    const efs = verifiedEfs(host.reader.get());
    const l = link.get();
    // An identity change reorders the view ("you first"): a file is read again under it.
    const reader = readerFor(l);
    const key = `${keyOf(l, reader)}|${attempt}`;
    if (key === resolved && efs === resolvedEfs) return;
    // Another session (network, deployment): what was a folder there is unknown here.
    if (efs !== foldersFor) {
      folders.clear();
      foldersFor = efs;
    }
    resolved = key;
    resolvedEfs = efs;
    queueMicrotask(() => resolve(efs, l, reader));
  });
  return {
    kind,
    retry() {
      attempt++;
      const l = link.get();
      resolve(verifiedEfs(host.reader.get()), l, readerFor(l));
    },
  };
}
