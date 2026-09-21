// Exercise the installed plugin in its own process so unhandled IPC rejections
// are observable without interfering with Vitest's rejection handler. No HTTP.
import { createRequire } from 'node:module';

const [scenario, format] = process.argv.slice(2);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(String(error)));
const calls = [];
const abort = new AbortController();
const allocation = deferred();
const sending = deferred();
const reading = deferred();
const readStarted = deferred();
let bodyExists = true;
let reads = 0;
const failure = 'synthetic read failure';
const chunk = (text) => [...new TextEncoder().encode(text), 0];

globalThis.window = {
  __TAURI_INTERNALS__: {
    async invoke(command) {
      const name = command.replace('plugin:http|', '');
      calls.push(name);
      switch (name) {
        case 'fetch':
          if (scenario === 'abort-allocation') await allocation.promise;
          return 100;
        case 'fetch_send':
          if (scenario === 'send-error') throw 'synthetic send failure';
          if (scenario === 'abort-send') await sending.promise;
          return {
            status: scenario === 'null-body' ? 204 : 200,
            statusText: 'OK', url: 'https://example.invalid/offline',
            headers: [], rid: 200,
          };
        case 'fetch_cancel':
          // Model a request that has already settled on the Rust side.
          throw 'The resource id 100 is invalid.';
        case 'fetch_read_body':
          if (scenario === 'read-error') throw failure;
          if (scenario === 'abort-read' || scenario === 'cancel-read') {
            readStarted.resolve();
            await reading.promise;
            return chunk('late data');
          }
          if (reads++ === 0) return chunk('data: [DONE]\n\n');
          // Rust drops the resource before delivering the EOF IPC response.
          bodyExists = false;
          if (scenario === 'eof-cancel') {
            readStarted.resolve();
            await reading.promise;
          }
          return [1];
        case 'fetch_cancel_body':
          if (scenario === 'cleanup-error') throw 'synthetic cleanup failure';
          if (!bodyExists) throw 'The resource id 200 is invalid.';
          bodyExists = false;
          return;
        default:
          throw new Error(`Unexpected IPC: ${command}`);
      }
    },
  },
};
const { fetch } = format === 'cjs'
  ? createRequire(import.meta.url)('@tauri-apps/plugin-http')
  : await import('@tauri-apps/plugin-http');
const result = {};
const capture = async (promise) => {
  try { await promise; return 'resolved'; }
  catch (error) { return String(error); }
};
const pending = fetch('https://example.invalid/offline', { signal: abort.signal });
if (scenario === 'abort-allocation' || scenario === 'abort-send') {
  const caught = capture(pending);
  await tick();
  abort.abort();
  allocation.resolve();
  sending.resolve();
  result.request = await caught;
} else if (scenario === 'send-error') {
  result.request = await capture(pending);
  const count = calls.length;
  abort.abort();
  result.callsAfterFinish = calls.length - count;
} else {
  const response = await pending;
  // The provider awaits request() before getting the reader; allow prefetch.
  await tick();
  if (scenario === 'null-body') {
    result.nullBody = response.body === null;
  } else {
    const reader = response.body.getReader();
    if (scenario === 'abort-read' || scenario === 'cancel-read') {
      const caught = capture(reader.read());
      await readStarted.promise;
      if (scenario === 'abort-read') abort.abort();
      else await reader.cancel();
      result.read = await caught;
      result.cancel = await capture(reader.cancel());
      reading.resolve();
    } else if (scenario === 'read-error') {
      result.read = await capture(reader.read());
      await capture(reader.cancel());
    } else if (scenario === 'eof-cancel') {
      await reader.read();
      await readStarted.promise;
      result.cancel = await capture(reader.cancel());
      reading.resolve();
    } else if (scenario === 'cleanup-error') {
      result.cancel = await capture(reader.cancel());
    } else {
      while (!(await reader.read()).done) { /* consume through EOF */ }
      await reader.cancel();
    }
    await tick();
    reader.releaseLock();
  }
  const count = calls.length;
  abort.abort();
  result.callsAfterFinish = calls.length - count;
}
await tick();
await tick();
console.log(JSON.stringify({ ...result, calls, bodyExists, unhandled }));
