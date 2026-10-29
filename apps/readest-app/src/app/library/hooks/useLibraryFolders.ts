import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import { md5Fingerprint } from '@/utils/md5';
import { isLibraryTransferCurrent, type LibraryTransfer } from '../utils/libraryTransfer';
import {
  collectFolderPaths,
  assignBookToFolder,
  createFolderPath,
  renameFolder,
  moveToFolder,
  removeFolder,
  removeFolders,
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
  replacements?: Map<string, string>;
};
const HISTORY_LIMIT = 30;
const useFolderHistory = create<{
  past: Undo[];
  future: Undo[];
  revision: number;
  replacements?: Map<string, string>;
  pending: number;
}>(() => ({ past: [], future: [], revision: 0, pending: 0 }));
export const resolveFolderPath = (path: string) =>
  useFolderHistory.getState().replacements?.get(path) ?? path;
const samePaths = (a: string[], b: string[]) =>
  a.length === b.length && a.every((p, i) => p === b[i]);
function canRestore(
  undo: Undo | undefined,
  paths: string[],
  books: Book[],
  imports?: Record<string, string>,
  direction: 'undo' | 'redo' = 'undo',
): undo is Undo {
  const from = direction === 'undo' ? 'after' : 'before';
  if (!undo || !samePaths(paths, undo[from])) return false;
  const affected = new Map(undo.books.map((b) => [b.hash, b]));
  const changedPaths = new Set(
    [...undo.before, ...undo.after].filter(
      (p) => !undo.before.includes(p) || !undo.after.includes(p),
    ),
  );
  return (
    undo.imports.every((entry) => imports?.[entry.key] === entry[from]) &&
    !Object.entries(imports ?? {}).some(
      ([key, path]) => changedPaths.has(path) && !undo.imports.some((entry) => entry.key === key),
    ) &&
    undo.books.every((b) =>
      books.some(
        (current) =>
          current.hash === b.hash && !current.deletedAt && (current.groupName ?? '') === b[from],
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
  'This change can no longer be redone',
  'These items have changed. Select them again.',
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
    direction?: 'undo' | 'redo',
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
        if (samePaths(beforePaths, result.paths) && !changedBooks.length) return result;
        const sourceBooks = new Map(books.map((book) => [book.hash, book]));
        const record: Undo = {
          before: beforePaths,
          after: result.paths,
          books: changedBooks.map((book) => ({
            hash: book.hash,
            before: sourceBooks.get(book.hash)?.groupName ?? '',
            after: book.groupName ?? '',
          })),
          imports: Object.entries(before.autoImportFolderGroups ?? {}).flatMap(([key, path]) =>
            importGroups?.[key] !== path ? [{ key, before: path, after: importGroups![key]! }] : [],
          ),
          replacements: result.replacements,
        };
        await appService.saveSettings(nextSettings);
        try {
          const current = useSettingsStore.getState().settings;
          if (
            !canRestore(
              record,
              collectFolderPaths(useLibraryStore.getState().library, current.libraryFolders),
              useLibraryStore.getState().library,
              current.autoImportFolderGroups,
              'redo',
            )
          )
            throw new Error('These items have changed. Select them again.');
          if (changedBooks.length) {
            const latest = new Map(useLibraryStore.getState().library.map((b) => [b.hash, b]));
            await appService.saveLibraryBooks(
              changedBooks.map((book) => ({
                ...book,
                // A progress/title change while the catalog was saving must survive.
                ...latest.get(book.hash),
                groupName: book.groupName,
                groupId: book.groupId,
                groupUpdatedAt: book.groupUpdatedAt,
                updatedAt: Math.max(book.updatedAt, latest.get(book.hash)?.updatedAt ?? 0),
              })),
            );
          }
        } catch (err) {
          // The book save failed: restore the catalog and leave the visible state unchanged.
          await appService.saveSettings(useSettingsStore.getState().settings);
          throw err;
        }
        const currentSettings = {
          ...useSettingsStore.getState().settings,
          libraryFolders: result.paths,
          autoImportFolderGroups: useSettingsStore.getState().settings.autoImportFolderGroups && {
            ...useSettingsStore.getState().settings.autoImportFolderGroups,
            ...Object.fromEntries(record.imports.map((entry) => [entry.key, entry.after])),
          },
        };
        useSettingsStore.getState().setSettings(currentSettings);
        const changed = new Map(changedBooks.map((book) => [book.hash, book]));
        useLibraryStore.getState().setLibrary(
          useLibraryStore.getState().library.map((book) => {
            const updated = changed.get(book.hash);
            // A later move or deletion may arrive while book persistence is pending.
            return updated &&
              !book.deletedAt &&
              (book.groupUpdatedAt ?? 0) <= (updated.groupUpdatedAt ?? 0)
              ? {
                  ...book,
                  groupName: updated.groupName,
                  groupId: updated.groupId,
                  groupUpdatedAt: updated.groupUpdatedAt,
                  updatedAt: Math.max(book.updatedAt, updated.updatedAt),
                }
              : book;
          }),
        );
        const previousFolderIds = new Set(beforePaths.map(md5Fingerprint));
        const nextFolderIds = new Set(result.paths.map(md5Fingerprint));
        const selection = useLibraryStore.getState().getSelectedBooks();
        const remappedIds = new Map(
          [...(result.replacements ?? [])].map(([from, to]) => [
            md5Fingerprint(from),
            to && (to === from || !beforePaths.includes(to)) ? md5Fingerprint(to) : '',
          ]),
        );
        const retained = [
          ...new Set(
            selection
              .map((id) => remappedIds.get(id) ?? id)
              .filter((id) => id && (!previousFolderIds.has(id) || nextFolderIds.has(id))),
          ),
        ];
        if (!samePaths(retained, selection)) useLibraryStore.getState().setSelectedBooks(retained);
        void broadcastGlobalSettings(currentSettings, { includeLibraryFolders: true });
        if (!samePaths(beforePaths, result.paths) || changedBooks.length) {
          const state = useFolderHistory.getState();
          const prior = canRestore(
            state.past.at(-1),
            beforePaths,
            books,
            before.autoImportFolderGroups,
          )
            ? state.past
            : [];
          useFolderHistory.setState({
            revision: state.revision + 1,
            replacements: result.replacements,
            past:
              direction === 'undo'
                ? state.past.slice(0, -1)
                : [
                    ...(direction === 'redo' ? state.past : prior),
                    direction === 'redo' ? state.future.at(-1)! : record,
                  ].slice(-HISTORY_LIMIT),
            future:
              direction === 'undo'
                ? [...state.future, state.past.at(-1)!].slice(-HISTORY_LIMIT)
                : direction === 'redo'
                  ? state.future.slice(0, -1)
                  : [],
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

  const restore = async (direction: 'undo' | 'redo') =>
    (await mutate((books, all) => {
      const state = useFolderHistory.getState();
      const record = (direction === 'undo' ? state.past : state.future).at(-1);
      const imports = useSettingsStore.getState().settings.autoImportFolderGroups;
      if (!canRestore(record, all, books, imports, direction))
        throw new Error(
          direction === 'undo'
            ? 'This change can no longer be undone'
            : 'This change can no longer be redone',
        );
      const to = direction === 'undo' ? 'before' : 'after';
      const changes = new Map(record.books.map((book) => [book.hash, book[to]]));
      const reverse = new Map<string, string>();
      for (const [before, after] of record.replacements ?? []) {
        if (after && !record.before.includes(after)) reverse.set(after, before);
      }
      return {
        paths: record[to],
        importGroups: imports && {
          ...imports,
          ...Object.fromEntries(record.imports.map((entry) => [entry.key, entry[to]])),
        },
        replacements: direction === 'undo' ? reverse : record.replacements,
        books: books.map((book) => {
          const path = changes.get(book.hash);
          return path === undefined ? book : assignBookToFolder(book, path);
        }),
      };
    }, direction)) !== undefined;

  const validateTransfer = (snapshot: LibraryTransfer, books: Book[], paths: string[]) => {
    if (!isLibraryTransferCurrent(snapshot, books, paths))
      throw new Error('These items have changed. Select them again.');
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
    canUndo: canRestore(history.past.at(-1), paths, library, settings.autoImportFolderGroups),
    canRedo: canRestore(
      history.future.at(-1),
      paths,
      library,
      settings.autoImportFolderGroups,
      'redo',
    ),
    undo: () => restore('undo'),
    redo: () => restore('redo'),
    moveItems: async (snapshot: LibraryTransfer, destination: string) =>
      (await mutate((books, all) => {
        validateTransfer(snapshot, books, all);
        return moveToFolder(books, all, snapshot.selection, destination);
      })) !== undefined,
    createWithItems: async (parent: string, label: string, snapshot: LibraryTransfer) =>
      (
        await mutate((books, all) => {
          validateTransfer(snapshot, books, all);
          const target = createFolderPath(all, parent, label.trim() || _('Untitled'));
          return { ...moveToFolder(books, [...all, target], snapshot.selection, target), target };
        })
      )?.target,
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
    placeItems: async (snapshot: LibraryTransfer, anchor: string, edge: 'before' | 'after') =>
      (await mutate((books, all) => {
        validateTransfer(snapshot, books, all);
        if (snapshot.roots.length !== 1)
          throw new Error('These items have changed. Select them again.');
        return placeFolder(books, all, snapshot.roots[0]!, anchor, edge);
      })) !== undefined,
    removeMany: async (selection: string[]) =>
      (await mutate((books, all) => removeFolders(books, all, selection))) !== undefined,
    remove: async (path: string) =>
      (await mutate((books, all) => removeFolder(books, all, path))) !== undefined,
  };
}
