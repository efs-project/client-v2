import { expect, it } from 'vitest';
import { assertBuildRuntime } from './build-runtime.ts';

it('accepts the observed pinned runtime and rejects a different runtime', () => {
  expect(() => assertBuildRuntime('24.21.0', '24.21.0')).not.toThrow();
  expect(() => assertBuildRuntime('24.21.0', '24.11.0')).toThrow('24.11.0');
  expect(() => assertBuildRuntime('24.21.0', '26.0.0')).toThrow('26.0.0');
});
