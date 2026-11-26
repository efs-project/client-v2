import { describe, expect, it } from 'vitest';
import { createScope } from '../platform/scope.ts';
import {
  type ConfigRead,
  DEFAULT_SETTINGS,
  type UserSettings,
} from '../platform/settings/model.ts';
import { memorySettingsStore, type SettingsStore } from '../platform/settings/store.ts';
import { createOsState, type OsStateInput } from './os-state.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Just enough of <html> for applyAppearance. */
function fakeRoot() {
  const classes = new Set<string>();
  return {
    classList: {
      add: (...names: string[]) => {
        for (const n of names) classes.add(n);
      },
      remove: (name: string) => classes.delete(name),
      [Symbol.iterator]: () => classes[Symbol.iterator](),
    },
    style: { colorScheme: '' },
    classes,
  };
}

const CONFIG: ConfigRead = {
  status: 'OK',
  issues: [],
  config: {
    schema: 'efs-config/1',
    networks: [
      {
        id: 'testnet',
        label: 'Testnet',
        chainId: 11155111,
        core: '0x83ce0b9e2ddd9c5cebbfe6b2b9bc275fda9a20fb',
        deployment: 'deployments/testnet.json',
        release: 'deployments/testnet-release.json',
        rpcs: [{ url: 'https://rpc.example.net/', enabled: true }],
        ipfsGateways: [],
        arweaveGateways: [],
      },
    ],
  },
};

function setup(store: SettingsStore, settings: UserSettings = DEFAULT_SETTINGS, readOnly = false) {
  const root = fakeRoot();
  const scope = createScope();
  const input: OsStateInput = {
    store,
    settings,
    settingsInfo: { persistent: false, readOnly, issues: [] },
    config: CONFIG,
    route: { kind: 'default' },
    prefersDark: true,
    root: root as unknown as HTMLElement,
  };
  return { os: createOsState(input, scope), root, scope };
}

describe('createOsState', () => {
  it('applies appearance classes now and whenever settings or the system preference change', async () => {
    const { os, root, scope } = setup(memorySettingsStore());
    expect(root.classes).toContain('wa-dark');
    expect(root.classes).toContain('efs-theme-cypher');
    os.prefersDark.set(false);
    await tick();
    expect(root.classes).toContain('wa-light');
    expect(root.classes).not.toContain('wa-dark');
    await os.updateSettings((s) => ({ ...s, appearance: { mode: 'dark', theme: 'paper' } }));
    await tick();
    expect(root.classes).toContain('wa-dark');
    expect(root.classes).toContain('efs-theme-paper');
    expect(root.classes).not.toContain('efs-theme-cypher');
    scope.dispose();
  });

  it('saves with compare-and-set and advances the revision', async () => {
    const { os, scope } = setup(memorySettingsStore());
    const result = await os.updateSettings((s) => ({
      ...s,
      appearance: { ...s.appearance, mode: 'light' },
    }));
    expect(result.status).toBe('SAVED');
    expect(os.settings.get().revision).toBe(1);
    expect(os.settings.get().appearance.mode).toBe('light');
    scope.dispose();
  });

  it('on a conflict, refuses the change and shows what is stored instead', async () => {
    const store = memorySettingsStore();
    const a = setup(store);
    const b = setup(store);
    await a.os.updateSettings((s) => ({ ...s, appearance: { mode: 'light', theme: 'paper' } }));
    const result = await b.os.updateSettings((s) => ({
      ...s,
      appearance: { mode: 'dark', theme: 'cypher' },
    }));
    expect(result.status).toBe('CONFLICT');
    expect(b.os.settings.get().appearance).toEqual({ mode: 'light', theme: 'paper' });
    expect(b.os.settings.get().revision).toBe(1);
    a.scope.dispose();
    b.scope.dispose();
  });

  it('never writes settings that a newer client version saved', async () => {
    const store = memorySettingsStore();
    const { os, scope } = setup(store, DEFAULT_SETTINGS, true);
    const result = await os.updateSettings((s) => ({
      ...s,
      appearance: { ...s.appearance, mode: 'light' },
    }));
    expect(result.status).toBe('READ_ONLY');
    expect((await store.load()).read).toMatchObject({ status: 'OK', settings: { revision: 0 } });
    scope.dispose();
  });

  it('derives the network the SDK will be handed from config and user overrides', async () => {
    const { os, scope } = setup(memorySettingsStore());
    expect(os.network.get()).toMatchObject({
      status: 'CONFIGURED',
      endpointLabel: 'https://rpc.example.net',
    });
    await os.updateSettings((s) => ({
      ...s,
      network: {
        ...s.network,
        overrides: {
          testnet: {
            rpcs: [
              {
                url: 'http://127.0.0.1:8545/',
                label: 'My node',
                enabled: true,
              },
            ],
          },
        },
      },
    }));
    expect(os.network.get()).toMatchObject({ status: 'CONFIGURED', endpointLabel: 'My node' });
    await os.updateSettings((s) => ({
      ...s,
      network: {
        ...s.network,
        overrides: {
          testnet: {
            rpcs: [
              {
                url: 'http://127.0.0.1:8545/',
                label: 'My node',
                enabled: false,
              },
            ],
          },
        },
      },
    }));
    expect(os.network.get().status).toBe('NO_ENDPOINTS');
    scope.dispose();
  });
});
