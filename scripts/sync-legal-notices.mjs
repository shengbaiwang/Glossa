// Keep the offline About disclosures identical to the repository notices.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const files = {
  license: 'LICENSE',
  notice: 'NOTICE',
  thirdParty: 'THIRD_PARTY_NOTICES.md',
};
const notices = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(new URL(path, root), 'utf8')]),
);
const output = new URL('apps/readest-app/public/legal/notices.json', root);
const contents = `${JSON.stringify(notices, null, 2)}\n`;

if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== contents) {
    throw new Error('Offline legal notices are stale. Run node scripts/sync-legal-notices.mjs.');
  }
  console.info('Offline legal notices match LICENSE, NOTICE and THIRD_PARTY_NOTICES.md.');
} else {
  mkdirSync(fileURLToPath(new URL('.', output)), { recursive: true });
  writeFileSync(output, contents);
}
