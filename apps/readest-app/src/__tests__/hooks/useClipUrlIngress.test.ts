import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@/services/environment', async (orig) => {
  const actual = await orig<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: () => true };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {}, envConfig: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (k: string) => k }));
// Clip pipeline collaborators — should never be reached for share links; stub
// so an accidental article-clip can't blow up the test environment.
vi.mock('@/services/send/clipOptions', () => ({ getClipOptions: () => ({}) }));
vi.mock('@/services/send/pageAcquisition', () => ({
  fetchWebPage: vi.fn().mockRejectedValue(new Error('HTTP unavailable')),
}));
vi.mock('@/services/send/conversion/conversionWorker', () => ({
  convertToEpubWithWorker: vi.fn(),
}));
vi.mock('@/services/ingestService', () => ({ ingestFile: vi.fn() }));

import { useClipUrlIngress } from '@/hooks/useClipUrlIngress';
import { eventDispatcher } from '@/utils/event';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import type { Book } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import { ingestFile } from '@/services/ingestService';

beforeEach(() => {
  useSettingsStore.setState({ settings: {} as SystemSettings });
  // Reject so clipAndImport short-circuits right after invoke('clip_page') —
  // we only need to observe whether the clip was attempted.
  invokeMock.mockReset().mockRejectedValue(new Error('stub'));
  vi.mocked(ingestFile).mockReset();
});

describe('useClipUrlIngress share-extension pending saves', () => {
  type PendingHook = (saves: unknown[]) => boolean;
  const getPendingHook = (): PendingHook => {
    const w = window as unknown as { __readestOnShareExtensionPending?: PendingHook };
    expect(w.__readestOnShareExtensionPending).toBeTypeOf('function');
    return w.__readestOnShareExtensionPending!;
  };

  it('converts htmlFile saves directly without re-fetching via clip_page', async () => {
    const { convertToEpubWithWorker } = await import('@/services/send/conversion/conversionWorker');
    vi.mocked(convertToEpubWithWorker).mockResolvedValueOnce({
      file: new File(['original fixture'], 'article.epub'),
      title: 'Article',
      author: '',
    });
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'plugin:native-bridge|read_share_clip_html') {
        return { html: '<html><body>captured from Safari</body></html>' };
      }
      throw new Error(`unexpected invoke: ${String(cmd)}`);
    });
    renderHook(() => useClipUrlIngress());
    getPendingHook()([{ url: 'https://example.com/paywalled', htmlFile: 'abc.html' }]);
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'plugin:native-bridge|read_share_clip_html',
        expect.objectContaining({ payload: expect.objectContaining({ fileName: 'abc.html' }) }),
      );
    });
    await vi.waitFor(() => {
      expect(convertToEpubWithWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'page',
          html: '<html><body>captured from Safari</body></html>',
          url: 'https://example.com/paywalled',
        }),
      );
    });
    expect(invokeMock).not.toHaveBeenCalledWith('clip_page', expect.anything());
  });

  it('falls back to clip_page when the shared HTML cannot be read', async () => {
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'plugin:native-bridge|read_share_clip_html') {
        throw new Error('file vanished');
      }
      throw new Error('stub');
    });
    renderHook(() => useClipUrlIngress());
    getPendingHook()([{ url: 'https://example.com/paywalled', htmlFile: 'gone.html' }]);
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'clip_page',
        expect.objectContaining({ url: 'https://example.com/paywalled' }),
      );
    });
  });

  it('passes source, destination and plugin cancellation into durable ingestion', async () => {
    const { convertToEpubWithWorker } = await import('@/services/send/conversion/conversionWorker');
    vi.mocked(convertToEpubWithWorker).mockResolvedValueOnce({
      file: new File(['original fixture'], 'article.epub'),
      title: 'Article',
      author: '',
      source: {
        originalUrl: 'https://example.com/old',
        url: 'https://example.com/final',
        extractor: 'fixture',
        version: '1',
        scope: 'article',
      },
    });
    invokeMock.mockResolvedValueOnce({ html: '<article>Shared original</article>' });
    let rejectSave!: (error: Error) => void;
    vi.mocked(ingestFile).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const view = renderHook(() => useClipUrlIngress());
    getPendingHook()([
      {
        url: 'https://example.com/old',
        htmlFile: 'source.html',
        groupId: 'chosen',
        groupName: 'Chosen',
      },
    ]);
    await vi.waitFor(() => expect(ingestFile).toHaveBeenCalledOnce());
    const options = vi.mocked(ingestFile).mock.calls[0]![0];
    expect(options).toMatchObject({
      groupId: 'chosen',
      groupName: 'Chosen',
      signal: expect.any(AbortSignal),
      webSource: { originalUrl: 'https://example.com/old', url: 'https://example.com/final' },
    });
    useSettingsStore.setState({
      settings: { officialModules: { webImport: false } } as SystemSettings,
    });
    expect(options.signal?.aborted).toBe(true);
    rejectSave(new DOMException('Aborted', 'AbortError'));
    view.unmount();
  });

  it('does not move an existing personal record after a repeated share', async () => {
    const { convertToEpubWithWorker } = await import('@/services/send/conversion/conversionWorker');
    vi.mocked(convertToEpubWithWorker).mockResolvedValueOnce({
      file: new File(['fixture'], 'a.epub'),
      title: 'A',
      author: '',
    });
    invokeMock.mockResolvedValueOnce({ html: '<article>Shared original</article>' });
    const existing = {
      hash: 'existing',
      title: 'Personal title',
      groupId: 'personal',
      groupName: 'Personal',
    } as Book;
    vi.mocked(ingestFile).mockResolvedValueOnce(existing);
    const previousUpdate = useLibraryStore.getState().updateBooks;
    const update = vi.fn().mockResolvedValue(undefined);
    useLibraryStore.setState({ updateBooks: update });
    const view = renderHook(() => useClipUrlIngress());
    try {
      getPendingHook()([
        {
          url: 'https://example.com/repeated',
          htmlFile: 'source.html',
          groupId: 'chosen',
          groupName: 'Chosen',
        },
      ]);
      await vi.waitFor(() => expect(update).toHaveBeenCalled());
      expect(existing).toMatchObject({
        title: 'Personal title',
        groupId: 'personal',
        groupName: 'Personal',
      });
    } finally {
      view.unmount();
      useLibraryStore.setState({ updateBooks: previousUpdate });
    }
  });
});

describe('useClipUrlIngress deep-link routing', () => {
  it('does NOT run the article clipper on share deep links', async () => {
    renderHook(() => useClipUrlIngress());
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['https://web.readest.com/s/Qmup0X1A8ovl2FmKJKA8mB'],
    });
    await Promise.resolve();
    // Share links belong to useOpenShareLink; the clipper must leave them alone.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('still clips ordinary article URLs', async () => {
    renderHook(() => useClipUrlIngress());
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['https://example.com/some-article'],
    });
    await Promise.resolve();
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'clip_page',
        expect.objectContaining({ url: 'https://example.com/some-article' }),
      ),
    );
  });
});

it('does not consume queued shared HTML or capture deep links while the plugin is disabled', async () => {
  useSettingsStore.setState({
    settings: { officialModules: { webImport: false } } as SystemSettings,
  });
  const view = renderHook(() => useClipUrlIngress());
  const pending = (
    window as unknown as { __readestOnShareExtensionPending: (saves: unknown[]) => boolean }
  ).__readestOnShareExtensionPending;
  expect(pending([{ url: 'https://example.com/article', htmlFile: 'original.html' }])).toBe(false);
  await eventDispatcher.dispatch('app-incoming-url', { urls: ['https://example.com/article'] });
  await Promise.resolve();
  expect(invokeMock).not.toHaveBeenCalled();
  view.unmount();
});
