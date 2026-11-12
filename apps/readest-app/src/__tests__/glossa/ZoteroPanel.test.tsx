import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import ZoteroPanel from '@/glossa/plugins/zotero/ZoteroPanel';
const f = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), ingest: vi.fn(), open: vi.fn() }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobileApp: false } }) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: f.fetch }));
vi.mock('@/glossa/plugins/zotero/import', () => ({ importZoteroAttachment: f.ingest }));
vi.mock('@/app/library/hooks/useOpenBook', () => ({ useOpenBook: () => ({ openBook: f.open }) }));
beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settings: {} as SystemSettings });
});
afterEach(cleanup);
it('does nothing on opening, connects explicitly and opens only an explicitly chosen attachment', async () => {
  f.fetch.mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/collections?')) return new Response('[]');
    if (path.includes('/items/top?'))
      return Response.json([
        { key: 'ABCD1234', data: { itemType: 'book', title: 'Research book' } },
      ]);
    if (path.includes('/children?'))
      return Response.json([
        {
          key: 'EFGH5678',
          data: {
            itemType: 'attachment',
            filename: 'Book.epub',
            contentType: 'application/epub+zip',
          },
        },
      ]);
    return new Response('file:///tmp/Book.epub');
  });
  f.ingest.mockResolvedValue({ hash: 'same-identity' });
  render(<ZoteroPanel />);
  expect(f.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Connect to Zotero' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Research book' }));
  const read = await screen.findByRole('button', { name: 'Read · Book.epub' });
  expect(f.ingest).not.toHaveBeenCalled();
  fireEvent.click(read);
  await waitFor(() => expect(f.open).toHaveBeenCalledWith({ hash: 'same-identity' }));
  expect(f.ingest).toHaveBeenCalledWith(
    expect.anything(),
    '/tmp/Book.epub',
    expect.objectContaining({ itemKey: 'ABCD1234', attachmentKey: 'EFGH5678' }),
    expect.any(AbortSignal),
  );
  expect(f.fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
});
it('disabling aborts a pending response and re-enabling never resumes the request', async () => {
  let release: (response: Response) => void = () => {};
  f.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  render(<ZoteroPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect to Zotero' }));
  await waitFor(() => expect(f.fetch).toHaveBeenCalledOnce());
  act(() =>
    useSettingsStore.setState({
      settings: { officialModules: { zotero: false } } as SystemSettings,
    }),
  );
  expect(f.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => release(Response.json([])));
  act(() => useSettingsStore.setState({ settings: {} as SystemSettings }));
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.ingest).not.toHaveBeenCalled();
});
it('shows the actionable local access error and offers retry without an automatic loop', async () => {
  f.fetch.mockResolvedValue(new Response('', { status: 403 }));
  render(<ZoteroPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect to Zotero' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Enable local application access',
  );
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(f.fetch).toHaveBeenCalledOnce();
});
