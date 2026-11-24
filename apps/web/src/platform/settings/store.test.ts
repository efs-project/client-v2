import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './model.ts';
import { memorySettingsStore } from './store.ts';

// The IndexedDB store shares this save logic and is exercised in real browsers by the e2e suite.
describe('settings store (compare-and-set)', () => {
  it('saves at the expected revision and increments it', async () => {
    const store = memorySettingsStore();
    const saved = await store.save({
      ...DEFAULT_SETTINGS,
      appearance: { mode: 'dark', theme: 'cypher' },
    });
    expect(saved.status).toBe('SAVED');
    const loaded = await store.load();
    expect(loaded.read.status === 'OK' && loaded.read.settings.revision).toBe(1);
    expect(loaded.persistent).toBe(false);
  });

  it('conflicts instead of overwriting a newer save from another tab', async () => {
    const store = memorySettingsStore();
    await store.save(DEFAULT_SETTINGS); // revision 0 → 1
    const stale = await store.save(DEFAULT_SETTINGS); // still claims revision 0
    expect(stale.status).toBe('CONFLICT');
  });

  it('never writes over settings from a newer client', async () => {
    const store = memorySettingsStore({ schema: 'efs-settings/2', revision: 4 });
    expect((await store.load()).read.status).toBe('NEWER');
    expect((await store.save({ ...DEFAULT_SETTINGS, revision: 4 })).status).toBe('READ_ONLY');
  });

  it('keeps unknown fields across a save', async () => {
    const store = memorySettingsStore({ ...DEFAULT_SETTINGS, revision: 2, laterFeature: [1, 2] });
    const loaded = await store.load();
    if (loaded.read.status !== 'OK') throw new Error('expected OK');
    await store.save(loaded.read.settings);
    const again = await store.load();
    expect(again.read.status === 'OK' && again.read.settings.laterFeature).toEqual([1, 2]);
  });
});
