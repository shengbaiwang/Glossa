import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareGlossaCloudConfig, readGlossaPublicConfig } from '../glossa-cloud-config.mjs';

test('builds Glossa callbacks from the same own public client ID', () => {
  const root = mkdtempSync(join(tmpdir(), 'glossa-cloud-config-'));
  try {
    mkdirSync(join(root, 'apps/readest-app'), { recursive: true });
    writeFileSync(join(root, 'apps/readest-app/.env.glossa.local'), 'NEXT_PUBLIC_GLOSSA_GOOGLE_CLIENT_ID=123-own.apps.googleusercontent.com\nPRIVATE_SECRET=must-not-load\n');
    const { configPath, environment } = prepareGlossaCloudConfig(root, { dev: true, environment: {} });
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')).plugins['deep-link'].desktop.schemes, ['glossa-dev', 'glossa-dev-onedrive', 'readest', 'com.googleusercontent.apps.123-own']);
    assert.equal(environment.PRIVATE_SECRET, undefined);
    assert.equal(readGlossaPublicConfig(root, { NEXT_PUBLIC_GLOSSA_GOOGLE_CLIENT_ID: 'override' }).NEXT_PUBLIC_GLOSSA_GOOGLE_CLIENT_ID, 'override');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('rejects a secret or service-role key before client bundling', () => {
  const root = mkdtempSync(join(tmpdir(), 'glossa-cloud-config-'));
  try {
    assert.throws(() => readGlossaPublicConfig(root, { NEXT_PUBLIC_GLOSSA_AUTH_KEY: 'sb_secret_private' }));
    const jwt = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
    assert.throws(() => readGlossaPublicConfig(root, { NEXT_PUBLIC_GLOSSA_AUTH_KEY: jwt }));
    assert.throws(() => prepareGlossaCloudConfig(root, { environment: { NEXT_PUBLIC_GLOSSA_GOOGLE_CLIENT_ID: 'bad ID' } }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
