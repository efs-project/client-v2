// Module-purity and import-direction rules for apps/web/src (plan §1.4). Biome covers
// package bans in the editor; this test covers what Biome can't express.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WEB } from '../build/paths.ts';

const SRC = `${WEB}src/`;
const ENTRIES = ['boot/main.ts', 'features/files/write/entry.ts'];

function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(`${dir}${e.name}/`)
      : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
        ? [`${dir}${e.name}`]
        : [],
  );
}
const rel = (path: string) => relative(SRC, path);
const isRegistration = (path: string) => path.endsWith('/define.ts');

function specifiers(code: string): string[] {
  const found: string[] = [];
  const re =
    /\b(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of code.matchAll(re)) found.push((m[1] ?? m[2] ?? m[3]) as string);
  return found;
}

describe('import rules', () => {
  for (const file of sources()) {
    const code = readFileSync(file, 'utf8');
    it(`${rel(file)}: relative imports stay inside src, literal dynamic imports only`, () => {
      expect(code).not.toMatch(/\bimport\(\s*[^'"\s)]/);
      for (const spec of specifiers(code).filter((s) => s.startsWith('.'))) {
        const target = resolve(dirname(file), spec);
        expect(target.startsWith(SRC), `${spec} escapes apps/web/src`).toBe(true);
        if (isRegistration(target)) {
          expect(ENTRIES, `${rel(file)} imports a registration module`).toContain(rel(file));
        }
      }
    });
  }
});

// Globals whose use during module evaluation is forbidden.
const TRAPPED = [
  'fetch',
  'indexedDB',
  'localStorage',
  'sessionStorage',
  'ethereum',
  'document',
  'XMLHttpRequest',
  'WebSocket',
];
const saved = new Map<string, PropertyDescriptor | undefined>();
const violations: string[] = [];
const defined: string[] = [];

function trap(name: string) {
  return new Proxy(() => {}, {
    get: (_t, prop) => {
      violations.push(`${name}.${String(prop)}`);
      throw new Error(`module evaluation touched ${name}`);
    },
    apply: () => {
      violations.push(`${name}()`);
      throw new Error(`module evaluation called ${name}`);
    },
  });
}

function install(allowDefine: boolean) {
  const replacements: Record<string, unknown> = {
    HTMLElement: class {},
    navigator: {
      get serviceWorker() {
        violations.push('navigator.serviceWorker');
        throw new Error('serviceWorker');
      },
      get locks() {
        violations.push('navigator.locks');
        throw new Error('locks');
      },
      languages: ['en'],
    },
    customElements: {
      define(name: string) {
        if (!allowDefine || !name.startsWith('efs-'))
          violations.push(`customElements.define(${name})`);
        defined.push(name);
      },
    },
  };
  for (const name of TRAPPED) replacements[name] = trap(name);
  for (const [name, value] of Object.entries(replacements)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

afterEach(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  saved.clear();
});

describe('module evaluation does no I/O', () => {
  for (const file of sources().filter((f) => !ENTRIES.includes(rel(f)))) {
    it(rel(file), async () => {
      violations.length = 0;
      defined.length = 0;
      install(isRegistration(file));
      await import(file);
      expect(violations).toEqual([]);
      if (isRegistration(file)) expect(defined.every((n) => n.startsWith('efs-'))).toBe(true);
    });
  }
});
