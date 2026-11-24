// Persists UserSettings. IndexedDB when available; memory otherwise (private modes, blocked
// storage), reported as non-persistent rather than silently pretending to save. Saves are
// compare-and-set on `revision`, so two tabs editing at once conflict instead of one silently
// overwriting the other; other tabs are told to reload through a BroadcastChannel.

import { readSettings, type SettingsRead, type UserSettings } from './model.ts';

export interface SettingsSnapshot {
  readonly read: SettingsRead;
  readonly persistent: boolean;
}

export type SaveResult =
  | { readonly status: 'SAVED'; readonly settings: UserSettings }
  /** Another tab saved first; reload and re-apply the change. */
  | { readonly status: 'CONFLICT'; readonly current: SettingsRead }
  /** Stored settings come from a newer client; this one never overwrites them. */
  | { readonly status: 'READ_ONLY' }
  | { readonly status: 'FAILED' };

export interface SettingsStore {
  readonly persistent: boolean;
  load(): Promise<SettingsSnapshot>;
  /** `next.revision` must equal the stored revision; the saved copy gets revision + 1. */
  save(next: UserSettings): Promise<SaveResult>;
  /** Called when another tab saved. Stops when `signal` aborts. */
  onExternalChange(listener: () => void, signal: AbortSignal): void;
}

const DB_NAME = 'efs-client';
const DB_VERSION = 1;
const STORE = 'settings';
const KEY = 'user';
const CHANNEL = 'efs-settings';
const OPEN_TIMEOUT_MS = 3000;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Opens the settings database. With `create: false` a database that doesn't exist yet is not
 * created: the upgrade is aborted (which deletes the new, empty database) and `undefined` is
 * returned, so a guest visit that never changes a setting writes nothing to storage.
 */
function openDatabase(factory: IDBFactory, create: boolean): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    let absent = false;
    const timer = setTimeout(() => reject(new Error('indexedDB open timed out')), OPEN_TIMEOUT_MS);
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      if (event.oldVersion === 0 && !create) {
        absent = true;
        req.transaction?.abort();
        return;
      }
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = (event) => {
      clearTimeout(timer);
      if (absent) {
        event.preventDefault();
        resolve(undefined);
      } else {
        reject(req.error);
      }
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('indexedDB open blocked'));
    };
  });
}

function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(STORE, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  return body(tx.objectStore(STORE)).then(async (result) => {
    await done;
    return result;
  });
}

function channelFor(): BroadcastChannel | undefined {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : undefined;
}

function listen(listener: () => void, signal: AbortSignal): void {
  const channel = channelFor();
  if (!channel || signal.aborted) return;
  channel.onmessage = () => listener();
  signal.addEventListener('abort', () => channel.close(), { once: true });
}

function announce(): void {
  const channel = channelFor();
  channel?.postMessage({ type: 'saved' });
  channel?.close();
}

function nextRevision(next: UserSettings): UserSettings {
  return { ...next, revision: next.revision + 1 };
}

function indexedDbStore(factory: IDBFactory, existing: IDBDatabase | undefined): SettingsStore {
  let db = existing;
  const writable = async (): Promise<IDBDatabase> => {
    db ??= await openDatabase(factory, true);
    if (!db) throw new Error('settings database unavailable');
    return db;
  };
  return {
    persistent: true,
    async load() {
      db ??= await openDatabase(factory, false);
      const raw = db
        ? await transaction(db, 'readonly', (store) => request(store.get(KEY)))
        : undefined;
      return { read: readSettings(raw), persistent: true };
    },
    async save(next) {
      try {
        const result = await transaction(
          await writable(),
          'readwrite',
          async (store): Promise<SaveResult> => {
            const current = readSettings(await request(store.get(KEY)));
            if (current.status === 'NEWER') return { status: 'READ_ONLY' };
            const storedRevision = current.status === 'OK' ? current.settings.revision : 0;
            if (storedRevision !== next.revision) return { status: 'CONFLICT', current };
            const saved = nextRevision(next);
            await request(store.put(saved, KEY));
            return { status: 'SAVED', settings: saved };
          },
        );
        if (result.status === 'SAVED') announce();
        return result;
      } catch {
        return { status: 'FAILED' };
      }
    },
    onExternalChange: listen,
  };
}

/** In-memory store: used when IndexedDB is unavailable, and in tests. */
export function memorySettingsStore(initial?: unknown): SettingsStore {
  let stored: unknown = initial;
  return {
    persistent: false,
    async load() {
      return { read: readSettings(stored), persistent: false };
    },
    async save(next) {
      const current = readSettings(stored);
      if (current.status === 'NEWER') return { status: 'READ_ONLY' };
      const storedRevision = current.status === 'OK' ? current.settings.revision : 0;
      if (storedRevision !== next.revision) return { status: 'CONFLICT', current };
      const saved = nextRevision(next);
      stored = structuredClone(saved);
      return { status: 'SAVED', settings: saved };
    },
    onExternalChange() {},
  };
}

/** Opens the persistent store without creating it; falls back to memory if storage is refused. */
export async function openSettingsStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<SettingsStore> {
  if (!factory) return memorySettingsStore();
  try {
    return indexedDbStore(factory, await openDatabase(factory, false));
  } catch {
    return memorySettingsStore();
  }
}
