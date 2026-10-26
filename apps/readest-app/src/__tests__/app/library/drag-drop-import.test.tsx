import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDragDropImport } from '@/app/library/hooks/useDragDropImport';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { md5Fingerprint } from '@/utils/md5';
import { SystemSettings } from '@/types/settings';

const mocks = vi.hoisted(() => ({
  tauri: false,
  translate: (key: string) => key,
  dispatch: vi.fn(),
  unlisten: vi.fn(),
  native: (_event: {
    payload: { type: string; paths?: string[]; position?: { x: number; y: number } };
  }) => {},
  service: { isMobile: false, hasHaptics: false, isDirectory: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('groupBy=group') }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => mocks.translate }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks.service }) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => mocks.tauri }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: mocks.dispatch } }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (callback: typeof mocks.native) => {
      mocks.native = callback;
      return Promise.resolve(mocks.unlisten);
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tauri = false;
  mocks.service.isDirectory.mockResolvedValue(false);
  useSettingsStore
    .getState()
    .setSettings({ ...DEFAULT_SYSTEM_SETTINGS, libraryFolders: ['文学'] } as SystemSettings);
  useLibraryStore.getState().setLibrary([]);
  render(
    <div className='library-page'>
      <button data-library-folder-path='文学'>文学</button>
    </div>,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (document as Partial<Document>).elementFromPoint;
});

it('imports dropped files into the hovered folder and clears feedback', async () => {
  const { result } = renderHook(() => useDragDropImport());
  const target = screen.getByRole('button');
  const file = new File(['原创'], '阅读.epub');
  const dataTransfer = { types: ['Files'], items: [], files: [file] };
  fireEvent.dragOver(target, { dataTransfer });
  expect(result.current.isDragging).toBe(true);
  expect(target.hasAttribute('data-external-drop')).toBe(true);
  fireEvent.drop(target, { dataTransfer });
  await waitFor(() =>
    expect(mocks.dispatch).toHaveBeenCalledWith('import-book-files', {
      files: [{ file, groupName: '文学' }],
      folders: [],
    }),
  );
  expect(target.hasAttribute('data-external-drop')).toBe(false);
});

it('leaves internal folder moves to the navigation instead of invoking file import', () => {
  const { result } = renderHook(() => useDragDropImport());
  const dataTransfer = { types: ['application/x-glossa-library-items'], files: [] };
  fireEvent.dragOver(screen.getByRole('button'), { dataTransfer });
  fireEvent.drop(screen.getByRole('button'), { dataTransfer });
  expect(result.current.isDragging).toBe(false);
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it('uses native physical drop coordinates for the sidebar destination and removes all listeners', async () => {
  mocks.tauri = true;
  mocks.service.isDirectory.mockImplementation(async (path: string) => path === '/original/小说');
  const target = screen.getByRole('button');
  const point = vi.fn(() => target);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: point });
  const { unmount } = renderHook(() => useDragDropImport());
  await act(async () =>
    mocks.native({
      payload: {
        type: 'drop',
        position: { x: 80, y: 120 },
        paths: ['/original/小说', '/original/散步.epub'],
      },
    }),
  );
  expect(point).toHaveBeenCalledWith(80 / window.devicePixelRatio, 120 / window.devicePixelRatio);
  expect(mocks.dispatch).toHaveBeenCalledWith('import-book-files', {
    files: [{ path: '/original/散步.epub' }],
    groupId: md5Fingerprint('文学'),
  });
  expect(mocks.dispatch).toHaveBeenCalledWith('import-book-directory', {
    path: '/original/小说',
    destination: '文学',
  });
  unmount();
  await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledOnce());
  mocks.dispatch.mockClear();
  fireEvent.drop(target, {
    dataTransfer: { types: ['Files'], items: [], files: [new File(['x'], 'a.epub')] },
  });
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it('does not treat an empty native internal drag as an unsupported book import', async () => {
  mocks.tauri = true;
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => screen.getByRole('button'),
  });
  const { result } = renderHook(useDragDropImport);
  await act(async () =>
    mocks.native({ payload: { type: 'drop', position: { x: 80, y: 120 }, paths: [] } }),
  );
  expect(result.current.isDragging).toBe(false);
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
