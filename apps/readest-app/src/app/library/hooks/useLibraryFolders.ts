import { useMemo, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import { md5Fingerprint } from '@/utils/md5';
import {
  collectFolderPaths,
  createFolderPath,
  renameFolder,
  moveToFolder,
  type FolderChange,
} from '../utils/libraryFolders';

// Serialize folder writes across the shelf and destination picker.
let pendingMutation: Promise<unknown> = Promise.resolve();
const folderErrors = new Set([
  'Invalid folder name',
  'Folder not found',
  'Folders support two levels',
  'A folder with this name already exists',
  'Cannot move a folder into itself',
  'Only empty folders can be deleted',
]);

export function useLibraryFolders() {
  const { appService } = useEnv();
  const _ = useTranslation();
  const { library } = useLibraryStore();
  const { settings } = useSettingsStore();
  const paths = useMemo(
    () => collectFolderPaths(library, settings.libraryFolders),
    [library, settings.libraryFolders],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mutate = async (
    change: (books: typeof library, paths: string[]) => FolderChange & { target?: string },
  ) => {
    setBusy(true);
    setError('');
    const mutation = pendingMutation
      .catch(() => {})
      .then(async () => {
        if (!appService) throw new Error('Unavailable');
        const before = useSettingsStore.getState().settings;
        const books = useLibraryStore.getState().library;
        const beforePaths = collectFolderPaths(books, before.libraryFolders);
        const result = change(books, beforePaths);
        const nextSettings = { ...before, libraryFolders: result.paths };
        const changedBooks = result.books.filter((book, index) => book !== books[index]);
        await appService.saveSettings(nextSettings);
        try {
          if (changedBooks.length) await appService.saveLibraryBooks(changedBooks);
        } catch (err) {
          // The book save failed: restore the catalog and leave the visible state unchanged.
          await appService.saveSettings({
            ...useSettingsStore.getState().settings,
            libraryFolders: before.libraryFolders,
          });
          throw err;
        }
        const currentSettings = {
          ...useSettingsStore.getState().settings,
          libraryFolders: result.paths,
        };
        useSettingsStore.getState().setSettings(currentSettings);
        const changed = new Map(changedBooks.map((book) => [book.hash, book]));
        useLibraryStore.getState().setLibrary(
          useLibraryStore.getState().library.map((book) => {
            const updated = changed.get(book.hash);
            return updated
              ? {
                  ...book,
                  groupName: updated.groupName,
                  groupId: updated.groupId,
                  updatedAt: updated.updatedAt,
                }
              : book;
          }),
        );
        const previousFolderIds = new Set(beforePaths.map(md5Fingerprint));
        const nextFolderIds = new Set(result.paths.map(md5Fingerprint));
        const selection = useLibraryStore.getState().getSelectedBooks();
        const retained = selection.filter(
          (id) => !previousFolderIds.has(id) || nextFolderIds.has(id),
        );
        if (retained.length !== selection.length)
          useLibraryStore.getState().setSelectedBooks(retained);
        void broadcastGlobalSettings(currentSettings, { includeLibraryFolders: true });
        return result;
      });
    pendingMutation = mutation;
    try {
      return await mutation;
    } catch (err) {
      setError(
        _(
          err instanceof Error && folderErrors.has(err.message)
            ? err.message
            : 'Unable to save folders. Please try again.',
        ),
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  return {
    paths,
    busy,
    error,
    clearError: () => setError(''),
    ensure: async (imported: string[]) =>
      (await mutate((books, all) => {
        const next = [...all];
        for (const path of imported) {
          let parent = '';
          for (const label of path.split('/')) {
            const target = parent ? `${parent}/${label}` : label;
            if (!next.includes(target)) next.push(createFolderPath(next, parent, label));
            parent = target;
          }
        }
        return { books, paths: next };
      })) !== undefined,
    create: async (parent: string, label: string) =>
      (
        await mutate((books, all) => {
          const target = createFolderPath(all, parent, label);
          return { books, paths: [...all, target], target };
        })
      )?.target,
    rename: async (path: string, label: string) =>
      (await mutate((books, all) => renameFolder(books, all, path, label))) !== undefined,
    move: async (selection: string[], destination: string) =>
      (await mutate((books, all) => moveToFolder(books, all, selection, destination))) !==
      undefined,
    remove: async (path: string) =>
      (await mutate((books, all) => {
        if (
          books.some((book) => !book.deletedAt && book.groupName === path) ||
          all.some((p) => p.startsWith(`${path}/`))
        ) {
          throw new Error('Only empty folders can be deleted');
        }
        return { books, paths: all.filter((p) => p !== path) };
      })) !== undefined,
  };
}
