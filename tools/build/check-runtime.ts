import { readFileSync } from 'node:fs';
import { assertBuildRuntime } from './build-runtime.ts';
import { ROOT } from './paths.ts';

assertBuildRuntime(readFileSync(`${ROOT}.node-version`, 'utf8').trim(), process.versions.node);
