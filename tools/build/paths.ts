import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const WEB = `${ROOT}apps/web/`;
export const DIST = `${WEB}dist/`;
export const EVIDENCE = `${WEB}dist-evidence/`;

/** Package name for a module path inside node_modules, or undefined for first-party code. */
export function packageOf(moduleId: string): string | undefined {
  const marker = '/node_modules/';
  const at = moduleId.lastIndexOf(marker);
  if (at < 0) return undefined;
  const [first, second] = moduleId.slice(at + marker.length).split('/');
  if (!first) return undefined;
  return first.startsWith('@') ? `${first}/${second}` : first;
}

/** Directory of the installed package that owns a node_modules module path. */
export function packageDirOf(moduleId: string): string | undefined {
  const name = packageOf(moduleId);
  if (!name) return undefined;
  const marker = `/node_modules/${name}/`;
  return moduleId.slice(0, moduleId.lastIndexOf(marker) + marker.length);
}
