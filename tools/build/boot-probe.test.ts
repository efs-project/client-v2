import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkBootProbe } from './boot-probe.ts';
import { WEB } from './paths.ts';

it('the classic unsupported-browser probe parses as ES5', () => {
  expect(checkBootProbe(readFileSync(`${WEB}public/boot-probe.js`, 'utf8'))).toEqual([]);
});

it('rejects both arrow functions and trailing call commas', () => {
  expect(checkBootProbe('(() => {})();')).not.toEqual([]);
  expect(checkBootProbe('window.addEventListener("error", function () {}, true,);')).not.toEqual(
    [],
  );
  expect(
    checkBootProbe('(function () { window.addEventListener("error", function () {}, true); })();'),
  ).toEqual([]);
});
