import path from 'node:path';
import type { NextConfig } from 'next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { initCloudflare } = vi.hoisted(() => ({ initCloudflare: vi.fn() }));
vi.mock('@opennextjs/cloudflare', () => ({ initOpenNextCloudflareForDev: initCloudflare }));
vi.mock('@serwist/next', () => ({ default: () => (config: unknown) => config }));
vi.mock('@next/bundle-analyzer', () => ({ default: () => (config: unknown) => config }));

beforeEach(() => {
  vi.resetModules();
  initCloudflare.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

async function loadConfig(mode: string, platform: string) {
  vi.stubEnv('NODE_ENV', mode);
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', platform);
  return (await import('../../../next.config.mjs')).default as NextConfig;
}

it('keeps native development independent of Cloudflare workers', async () => {
  await loadConfig('development', 'tauri');
  expect(initCloudflare).not.toHaveBeenCalled();
});

it('still initializes Cloudflare for web development', async () => {
  await loadConfig('development', 'web');
  expect(initCloudflare).toHaveBeenCalledOnce();
});

it('bounds both bundlers to this repository instead of an ancestor lockfile', async () => {
  const config = await loadConfig('development', 'tauri');
  const root = path.resolve(import.meta.dirname, '../../../../..');
  expect(config.turbopack?.root).toBe(root);
  expect(config.outputFileTracingRoot).toBe(root);
});

it('leaves development chunk cache headers under Next.js control', async () => {
  const config = await loadConfig('development', 'tauri');
  expect((await config.headers?.())?.some((rule) => rule.source === '/_next/static/:path*')).toBe(
    false,
  );
});

it('preserves native static export and immutable production assets', async () => {
  const config = await loadConfig('production', 'tauri');
  expect(config.output).toBe('export');
  expect(initCloudflare).not.toHaveBeenCalled();
  expect(
    (await config.headers?.())?.find((rule) => rule.source === '/_next/static/:path*')?.headers,
  ).toContainEqual({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' });
});
