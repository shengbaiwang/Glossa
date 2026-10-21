import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { Book } from '@/types/book';
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
  removeFolder,
  placeFolder,
  type FolderChange,
} from '../utils/libraryFolders';

// Serialize folder writes across the shelf and destination picker.
let pendingMutation: Promise<unknown> = Promise.resolve();
type Undo = {
  before: string[];
  after: string[];
  books: { hash: string; before: string; after: string }[];
  imports: { key: string; before: string; after: string }[];
};
const useFolderHistory = create<{
  undo?: Undo;
  revision: number;
  replacements?: Map<string, string>;
  pending: number;
}>(() => ({ revision: 0, pending: 0 }));
export const resolveFolderPath = (path: string) =>
  useFolderHistory.getState().replacements?.get(path) ?? path;
const samePaths = (a: string[], b: string[]) =>
  a.length === b.length && a.every((p, i) => p === b[i]);
function canRestore(
  undo: Undo | undefined,
  paths: string[],
  books: Book[],
  imports?: Record<string, string>,
): undo is Undo {
  if (!undo || !samePaths(paths, undo.after)) return false;
  const affected = new Map(undo.books.map((b) => [b.hash, b]));
  const changedPaths = new Set(
    [...undo.before, ...undo.after].filter(
      (p) => !undo.before.includes(p) || !undo.after.includes(p),
    ),
  );
  return (
    undo.imports.every((entry) => imports?.[entry.key] === entry.after) &&
    undo.books.every((b) =>
      books.some(
        (current) =>
          current.hash === b.hash && !current.deletedAt && (current.groupName ?? '') === b.after,
      ),
    ) &&
    !books.some((b) => !b.deletedAt && !affected.has(b.hash) && changedPaths.has(b.groupName ?? ''))
  );
}
const folderErrors = new Set([
  'Invalid folder name',
  'Folder not found',
  'Up to 4 levels',
  'A folder with this name already exists',
  'Cannot move a folder into itself',
  'This change can no longer be undone',
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
  const [error, setError] = useState('');
  const history = useFolderHistory();

  const mutate = async (
    change: (
      books: typeof library,
      paths: string[],
    ) => FolderChange & { target?: string; importGroups?: Record<string, string> },
    undoing = false,
  ) => {
    useFolderHistory.setState((state) => ({ pending: state.pending + 1 }));
    setError('');
    const mutation = pendingMutation
      .catch(() => {})
      .then(async () => {
        if (!appService) throw new Error('Unavailable');
        const before = useSettingsStore.getState().settings;
        const books = useLibraryStore.getState().library;
        const beforePaths = collectFolderPaths(books, before.libraryFolders);
        const result = change(books, beforePaths);
        const importGroups =
          result.importGroups ??
          (before.autoImportFolderGroups &&
            Object.fromEntries(
              Object.entries(before.autoImportFolderGroups).map(([key, path]) => [
                key,
                result.replacements?.get(path) ?? path,
              ]),
            ));
        const nextSettings = {
          ...before,
          libraryFolders: result.paths,
          autoImportFolderGroups: importGroups,
        };
        const changedBooks = result.books.filter((book, index) => book !== books[index]);
        await appService.saveSettings(nextSettings);
        try {
          if (changedBooks.length) {
            const latest = new Map(useLibraryStore.getState().library.map((b) => [b.hash, b]));
            await appService.saveLibraryBooks(
              changedBooks.map((book) => ({
                ...book,
                // A progress/title change while the catalog was saving must survive.
                ...latest.get(book.hash),
                groupName: book.groupName,
                groupId: book.groupId,
                updatedAt: book.updatedAt,
              })),
            );
          }
        } catch (err) {
          // The book save failed: restore the catalog and leave the visible state unchanged.
          await appService.saveSettings({
            ...useSettingsStore.getState().settings,
            libraryFolders: before.libraryFolders,
            autoImportFolderGroups: before.autoImportFolderGroups,
          });
          throw err;
        }
        const currentSettings = {
          ...useSettingsStore.getState().settings,
          libraryFolders: result.paths,
          autoImportFolderGroups: importGroups,
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
        if (!samePaths(beforePaths, result.paths) || changedBooks.length) {
          useFolderHistory.setState({
            revision: useFolderHistory.getState().revision + 1,
            replacements: result.replacements,
            undo: undoing
              ? undefined
              : {
                  before: beforePaths,
                  after: result.paths,
                  books: changedBooks.map((book) => ({
                    hash: book.hash,
                    before: books.find((b) => b.hash === book.hash)?.groupName ?? '',
                    after: book.groupName ?? '',
                  })),
                  imports: Object.entries(before.autoImportFolderGroups ?? {}).flatMap(
                    ([key, path]) =>
                      importGroups?.[key] !== path
                        ? [{ key, before: path, after: importGroups![key]! }]
                        : [],
                  ),
                },
          });
        }
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
      useFolderHistory.setState((state) => ({ pending: state.pending - 1 }));
    }
  };

  return {
    paths,
    busy: history.pending > 0,
    error,
    clearError: () => setError(''),
    revision: history.revision,
    replacements: history.replacements,
    resolvePath: resolveFolderPath,
    remappedGroup: (id: string) =>
      [...(history.replacements ?? [])].find(([path]) => md5Fingerprint(path) === id)?.[1],
    canUndo: canRestore(history.undo, paths, library, settings.autoImportFolderGroups),
    undo: async () =>
      (await mutate((books, all) => {
        const record = useFolderHistory.getState().undo;
        const imports = useSettingsStore.getState().settings.autoImportFolderGroups;
        if (!canRestore(record, all, books, imports))
          throw new Error('This change can no longer be undone');
        const changes = new Map(record.books.map((b) => [b.hash, b.before]));
        const reverse = new Map<string, string>();
        for (const [before, after] of useFolderHistory.getState().replacements ?? []) {
          // Removal can map a container to a pre-existing parent; only moved branches redirect.
          if (after && !record.before.includes(after)) reverse.set(after, before);
        }
        return {
          paths: record.before,
          importGroups: imports && {
            ...imports,
            ...Object.fromEntries(record.imports.map((entry) => [entry.key, entry.before])),
          },
          replacements: reverse,
          books: books.map((book) => {
            const path = changes.get(book.hash);
            return path === undefined
              ? book
              : {
                  ...book,
                  groupName: path,
                  groupId: path ? md5Fingerprint(path) : '',
                  updatedAt: Date.now(),
                };
          }),
        };
      }, true)) !== undefined,
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
          const target = createFolderPath(all, parent, label.trim() || _('Untitled'));
          return { books, paths: [...all, target], target };
        })
      )?.target,
    rename: async (path: string, label: string) =>
      (await mutate((books, all) => renameFolder(books, all, path, label))) !== undefined,
    move: async (selection: string[], destination: string) =>
      (await mutate((books, all) => moveToFolder(books, all, selection, destination))) !==
      undefined,
    place: async (path: string, anchor: string, edge: 'before' | 'after') =>
      (await mutate((books, all) => placeFolder(books, all, path, anchor, edge))) !== undefined,
    remove: async (path: string) =>
      (await mutate((books, all) => removeFolder(books, all, path))) !== undefined,
  };
}
