import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION, pluginManifestSchema } from '@/glossa/plugins/manifest';
import { PLUGINS } from '@/glossa/plugins/registry';
import { pluginLoaders } from '@/glossa/plugins/loaders';

const example: unknown = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../docs/development/plugin-example/manifest.json'),
    'utf-8',
  ),
);

describe('plugin manifest draft', () => {
  it('validates bundled metadata with the same contract as the developer example', () => {
    for (const { labelKey, ...manifest } of PLUGINS) {
      expect(pluginManifestSchema.parse(manifest)).toEqual(manifest);
      expect(labelKey).toBe(manifest.name);
      expect(manifest.apiVersion).toBe(PLUGIN_API_VERSION);
    }
  });

  it('accepts namespaced metadata without registering or loading a third-party plugin', () => {
    const manifest = pluginManifestSchema.parse(example);
    expect(manifest.id).toBe('org.example.outline');
    expect(Object.keys(pluginLoaders)).toEqual(PLUGINS.map((plugin) => plugin.id));
    expect(manifest.id in pluginLoaders).toBe(false);
    expect(PLUGINS).toHaveLength(3);
  });
  it('accepts explicit panel and import activation without allowing automatic startup', () => {
    const manifest = pluginManifestSchema.parse(example);
    expect(
      pluginManifestSchema.parse({ ...manifest, activation: ['reader-panel', 'persistent-import'] })
        .activation,
    ).toEqual(['reader-panel', 'persistent-import']);
    expect(pluginManifestSchema.safeParse({ ...manifest, activation: [] }).success).toBe(false);
    expect(
      pluginManifestSchema.safeParse({ ...manifest, activation: ['reader-panel', 'startup'] })
        .success,
    ).toBe(false);
  });

  it.each([
    '1.0.0-beta.1',
    '1.0.0+build.4',
    '1.0.0-beta.1+build.4',
  ])('preserves valid semantic versions including build metadata: %s', (version) => {
    const manifest = pluginManifestSchema.parse(example);
    expect(pluginManifestSchema.parse({ ...manifest, version }).version).toBe(version);
  });

  it.each([
    { id: '../plugin' },
    { id: 'https://example.com/plugin' },
    { name: ' ' },
    { author: '' },
    { version: '1' },
    { version: 'v1.0.0' },
    { version: ' 1.0.0 ' },
    { apiVersion: PLUGIN_API_VERSION + 1 },
    { capabilities: ['filesystem'] },
    { activation: 'startup' },
    { format: 'HTML' },
    { main: 'https://example.com/plugin.js' },
  ])('rejects unsupported or executable metadata: %j', (patch) => {
    const manifest = pluginManifestSchema.parse(example);
    expect(pluginManifestSchema.safeParse({ ...manifest, ...patch }).success).toBe(false);
  });
});
