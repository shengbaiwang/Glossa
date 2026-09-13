// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc') as {
  transformSync: (source: string, options: object) => { code: string };
};

it('compiles ReaderContent as a Next.js client boundary', () => {
  const filename = resolve('src/app/reader/components/ReaderContent.tsx');
  const result = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022' },
    module: { type: 'es6' },
    serverComponents: {
      isReactServerLayer: true,
      cacheComponentsEnabled: false,
      useCacheEnabled: false,
      taintEnabled: false,
      pageExtensions: ['tsx'],
    },
  });
  expect(result.code).toContain('__next_internal_client_entry_do_not_use__');
});
