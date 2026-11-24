// Loads the operator's public efs.config.json from beside index.html. It is static, same-origin
// configuration, not a backend: a host without it simply has no default network, and the user
// can still configure one. Never cached by URL as truth; always re-validated.

import { type ConfigRead, readConfig } from './model.ts';

export const CONFIG_FILE = 'efs.config.json';
const MAX_CONFIG_BYTES = 256 * 1024;

export async function loadOperatorConfig(
  base: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ConfigRead> {
  let response: Response;
  try {
    response = await fetchImpl(new URL(CONFIG_FILE, base), {
      signal,
      cache: 'no-cache',
      credentials: 'omit',
      redirect: 'error',
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: 'INVALID', issues: ['efs.config.json could not be fetched'] };
  }
  if (response.status === 404) return { status: 'ABSENT' };
  if (!response.ok)
    return { status: 'INVALID', issues: [`efs.config.json: HTTP ${response.status}`] };
  const text = await response.text();
  if (text.length > MAX_CONFIG_BYTES)
    return { status: 'INVALID', issues: ['efs.config.json too large'] };
  try {
    return readConfig(JSON.parse(text));
  } catch {
    return { status: 'INVALID', issues: ['efs.config.json is not valid JSON'] };
  }
}
