import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Isolate module state and replace the native/Web I/O constructors. Executing
// the actual source avoids concurrent dynamic-import mock races loading a real
// service (and IndexedDB or the Tauri bridge) into this unit test.
const source = ts.transpileModule(
  readFileSync(resolve(__dirname, '../../services/environment.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function loadEnvironment(platform: string, initialize: () => Promise<void>) {
  const construct = vi.fn();
  const init = vi.fn(initialize);
  class Service {
    constructor() {
      construct();
    }
    init = init;
  }
  const exports = {} as {
    default: { getAppService: () => Promise<Service> };
    getInitializedAppService: () => Service | null;
  };
  runInNewContext(source, {
    exports,
    process: { env: { NEXT_PUBLIC_APP_PLATFORM: platform } },
    require(name: string) {
      if (name.includes('nativeAppService')) {
        expect(platform).toBe('tauri');
        return { NativeAppService: Service };
      }
      if (name.includes('webAppService')) {
        expect(platform).toBe('web');
        return { WebAppService: Service };
      }
      if (name === './runtimeConfig') return { getRuntimeConfig: () => null };
      if (name === './constants' || name === './appIdentity') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { env: exports.default, get: exports.getInitializedAppService, init, construct };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe.each(['tauri', 'web'])('%s app service initialization', (platform) => {
  it('shares initialization across early and late callers and publishes only a ready service', async () => {
    const gate = deferred();
    const { env, get, init, construct } = loadEnvironment(platform, () => gate.promise);
    const early = Array.from({ length: 8 }, () => env.getAppService());
    await tick();
    const publishedDuringInit = get();
    let lateResolved = false;
    const late = env.getAppService().then((service) => {
      lateResolved = true;
      return service;
    });
    await tick();
    const lateResolvedBeforeReady = lateResolved;
    gate.resolve();
    const services = await Promise.all([...early, late]);

    expect(construct).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(publishedDuringInit).toBeNull();
    expect(lateResolvedBeforeReady).toBe(false);
    expect(services.every((service) => service === services[0])).toBe(true);
    expect(get()).toBe(services[0]);
    expect(await env.getAppService()).toBe(services[0]);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('rejects all waiting callers on failure, then retries with a fresh instance', async () => {
    const gate = deferred();
    let attempts = 0;
    const { env, get, init, construct } = loadEnvironment(platform, () => {
      attempts++;
      return attempts === 1 ? gate.promise : Promise.resolve();
    });
    const failed = Promise.allSettled(Array.from({ length: 4 }, () => env.getAppService()));
    await tick();
    gate.reject(new Error('startup failed'));
    const results = await failed;
    const publishedAfterFailure = get();
    const retry = await env.getAppService();

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(publishedAfterFailure).toBeNull();
    expect(construct).toHaveBeenCalledTimes(2);
    expect(init).toHaveBeenCalledTimes(2);
    expect(get()).toBe(retry);
    expect(await env.getAppService()).toBe(retry);
    expect(init).toHaveBeenCalledTimes(2);
  });
});
