import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MacFileOpen from '@/components/MacFileOpen';
import type { IngestFileOptions, IngestFileResult } from '@/services/ingestService';
import type { Book } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  updateBooks: vi.fn(),
  ingestFiles: vi.fn(),
  showReaderWindow: vi.fn(),
  showLibraryWindow: vi.fn(),
  ensureMainLibraryWindow: vi.fn(),
  app: {
    isMacOSApp: true,
    loadSettings: vi.fn(async () => ({ autoImportBooksOnOpen: false, openBookInNewWindow: true })),
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}));
vi.mock('@tauri-apps/plugin-log', () => ({ warn: vi.fn(async () => {}) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: mocks.app, envConfig: {} }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/services/ingestService', () => ({ ingestFiles: mocks.ingestFiles }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ library: [], updateBooks: mocks.updateBooks }) },
}));
vi.mock('@/utils/nav', () => ({
  navigateToReader: vi.fn(),
  showReaderWindow: mocks.showReaderWindow,
  showLibraryWindow: mocks.showLibraryWindow,
  ensureMainLibraryWindow: mocks.ensureMainLibraryWindow,
}));

const receipt = (hash: string, status: IngestFileResult['status'] = 'added'): IngestFileResult => ({
  book: { hash } as Book,
  status,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listen.mockResolvedValue(vi.fn());
  mocks.invoke.mockResolvedValue([]);
});

afterEach(cleanup);

it('handles cold and live opens and opens only the first successfully committed file of a batch', async () => {
  const first = receipt('one', 'existing');
  const second = receipt('two');
  const third = receipt('three');
  mocks.invoke.mockResolvedValueOnce([{ files: ['/one.pdf', '/two.epub'], temporary: false }]);
  mocks.ingestFiles
    .mockImplementationOnce(async (items: IngestFileOptions[]) => {
      expect(items.every((item) => item.forceCopy && !item.transient)).toBe(true);
      items[1]!.onComplete!(second);
      await Promise.resolve();
      expect(mocks.showReaderWindow).not.toHaveBeenCalled();
      items[0]!.onComplete!(first);
      return [first, second];
    })
    .mockImplementationOnce(async (items: IngestFileOptions[]) => {
      items[0]!.onComplete!(third);
      return [third];
    });
  render(<MacFileOpen enabled />);
  await waitFor(() =>
    expect(mocks.showReaderWindow).toHaveBeenCalledExactlyOnceWith(mocks.app, ['one']),
  );
  expect(mocks.updateBooks).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
  mocks.invoke.mockResolvedValueOnce([{ files: ['/three.pdf'], temporary: false }]);
  act(() => mocks.listen.mock.calls[0]![1]());
  await waitFor(() =>
    expect(mocks.showReaderWindow).toHaveBeenLastCalledWith(mocks.app, ['three']),
  );
  expect(mocks.showReaderWindow).toHaveBeenCalledTimes(2);
});

it('reports a failed save and retries without opening an uncommitted record', async () => {
  const failed = { book: null, status: 'added', error: new Error('Disk write failed') } as const;
  const added = receipt('saved');
  mocks.invoke.mockResolvedValueOnce([{ files: ['/retry.pdf'], temporary: false }]);
  mocks.ingestFiles
    .mockImplementationOnce(async (items: IngestFileOptions[]) => {
      items[0]!.onComplete!(failed);
      return [failed];
    })
    .mockImplementationOnce(async (items: IngestFileOptions[]) => {
      expect(items[0]!.file).toBe('/retry.pdf');
      items[0]!.onComplete!(added);
      return [added];
    });
  const toast = vi.fn();
  eventDispatcher.on('mac-file-open-toast', toast);
  try {
    render(<MacFileOpen enabled />);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(mocks.showReaderWindow).not.toHaveBeenCalled();
    const { action } = toast.mock.calls[0]![0].detail;
    await act(async () => action.onClick());
    await waitFor(() => expect(mocks.showReaderWindow).toHaveBeenCalledWith(mocks.app, ['saved']));
  } finally {
    eventDispatcher.off('mac-file-open-toast', toast);
  }
});
