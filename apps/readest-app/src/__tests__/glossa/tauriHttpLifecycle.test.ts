// @vitest-environment node
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const fixture = fileURLToPath(new URL('../fixtures/tauri-http-lifecycle.mjs', import.meta.url));

interface Result {
  calls: string[];
  unhandled: string[];
  bodyExists: boolean;
  callsAfterFinish?: number;
  request?: string;
  read?: string;
  cancel?: string;
  nullBody?: boolean;
}

describe.each(['esm', 'cjs'])('native HTTP resource lifecycle (%s)', (format) => {
  async function scenario(name: string): Promise<Result> {
    const { stdout } = await run(process.execPath, [fixture, name, format], { timeout: 5000 });
    const result: Result = JSON.parse(stdout);
    expect(result.unhandled).toEqual([]);
    return result;
  }

  it('cancels after Rust EOF but before the EOF IPC arrives without an unhandled rejection', async () => {
    const result = await scenario('eof-cancel');
    expect(result.cancel).toBe('resolved');
    expect(result.bodyExists).toBe(false);
    expect(result.callsAfterFinish).toBe(0);
  });

  it('removes abort listeners on normal EOF', async () => {
    const result = await scenario('eof');
    expect(result.bodyExists).toBe(false);
    expect(result.callsAfterFinish).toBe(0);
    expect(result.calls).not.toContain('fetch_cancel_body');
  });

  it.each([
    'abort-read',
    'cancel-read',
  ])('settles %s and discards an in-flight late chunk', async (name) => {
    const result = await scenario(name);
    expect(result.read).toBe(name === 'abort-read' ? 'Request cancelled' : 'resolved');
    expect(result.bodyExists).toBe(false);
    expect(result.calls.filter((call) => call === 'fetch_cancel_body')).toHaveLength(1);
    expect(result.calls).not.toContain('fetch_cancel');
    expect(result.callsAfterFinish).toBe(0);
  });

  it.each([
    'abort-allocation',
    'abort-send',
  ])('handles %s without leaking a late response', async (name) => {
    const result = await scenario(name);
    expect(result.request).toBe('Error: Request cancelled');
    if (name === 'abort-send') expect(result.bodyExists).toBe(false);
    else expect(result.calls).not.toContain('fetch_send');
  });

  it('preserves a read error and releases the body once', async () => {
    const result = await scenario('read-error');
    expect(result.read).toBe('synthetic read failure');
    expect(result.bodyExists).toBe(false);
    expect(result.calls.filter((call) => call === 'fetch_cancel_body')).toHaveLength(1);
    expect(result.callsAfterFinish).toBe(0);
  });

  it('preserves a send error and detaches its abort listener', async () => {
    const result = await scenario('send-error');
    expect(result.request).toBe('synthetic send failure');
    expect(result.callsAfterFinish).toBe(0);
  });

  it('returns unexpected cleanup failures to the caller instead of floating a rejection', async () => {
    const result = await scenario('cleanup-error');
    expect(result.cancel).toBe('synthetic cleanup failure');
    expect(result.callsAfterFinish).toBe(0);
  });

  it('releases null-body responses and leaves no abort listener', async () => {
    const result = await scenario('null-body');
    expect(result.nullBody).toBe(true);
    expect(result.bodyExists).toBe(false);
    expect(result.callsAfterFinish).toBe(0);
  });
});
