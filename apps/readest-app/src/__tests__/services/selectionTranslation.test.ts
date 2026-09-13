import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleProvider } from '@/services/translators/providers/google';
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
afterEach(() => vi.unstubAllGlobals());
describe('selection translation transport', () => {
  it('sends only selected text, preserves line breaks and forwards cancellation', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [[['译文']]] });
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController();
    expect(
      await googleProvider.translate(['first\nsecond'], 'auto', 'ZH', null, false, abort.signal),
    ).toEqual(['译文']);
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get('q')).toBe('first\nsecond');
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get('tl')).toBe('zh-CN');
    expect(fetch.mock.calls[0]![1].signal).toBe(abort.signal);
  });
  it('rejects malformed responses instead of presenting the source as a translation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [[[{ bad: true }]]] }),
    );
    await expect(googleProvider.translate(['text'], 'auto', 'ZH')).rejects.toThrow();
  });
});
