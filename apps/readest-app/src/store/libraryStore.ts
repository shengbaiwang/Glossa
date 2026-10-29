import { removeBookSubjectMetadata } from '@/utils/bookMetadata';
import { create } from 'zustand';
import { Book, BookGroupType, ReadingStatus } from '@/types/book';
import { EnvConfigType, isTauriAppPlatform } from '@/services/environment';
import { md5Fingerprint } from '@/utils/md5';
import { useSettingsStore } from '@/store/settingsStore';
import { collectFolderPaths } from '@/app/library/utils/libraryFolders';
import { protectBookRemoval } from '@/services/bookRemovalState';
import { mergeLibraryBook } from '@/utils/libraryMerge';
import { getVisibleBooks } from '@/utils/book';

interface LibraryState {
  library: Book[]; // might contain deleted books
  libraryLoaded: boolean;
  isSyncing: boolean;
  syncProgress: number;
  checkOpenWithBooks: boolean;
  checkLastOpenBooks: boolean;
  currentBookshelf: Book[];
  selectedBooks: Set<string>; // hashes for books, ids for groups
  groups: Record<string, string>;
  hashIndex: Map<string, number>; // hash -> array index for O(1) lookup
  visibleLibrary: Book[];
  setIsSyncing: (syncing: boolean) => void;
  setSyncProgress: (progress: number) => void;
  setSelectedBooks: (ids: string[]) => void;
  getSelectedBooks: () => string[];
  toggleSelectedBook: (id: string) => void;
  getVisibleLibrary: () => Book[];
  getBookByHash: (hash: string) => Book | undefined;
  setCheckOpenWithBooks: (check: boolean) => void;
  setCheckLastOpenBooks: (check: boolean) => void;
  setLibrary: (books: Book[], complete?: boolean) => void;
  // The third parameter is required (no `?`) so a future caller cannot
  // accidentally clear `readingStatus` by omitting it. Pass the desired final
  // value explicitly: the existing `readingStatus`, `undefined` to clear, or
  // a new status like 'finished'.
  updateBookProgress: (
    hash: string,
    progress: [number, number],
    readingStatus: ReadingStatus | undefined,
  ) => void;
  updateBook: (envConfig: EnvConfigType, book: Book) => Promise<void>;
  updateBooks: (
    envConfig: EnvConfigType,
    books: Book[],
    options?: { skipSave?: boolean },
  ) => Promise<void>;
  setCurrentBookshelf: (bookshelf: Book[]) => void;
  refreshGroups: () => void;
  rebuildHashIndex: () => void;
  addGroup: (name: string) => BookGroupType;
  getGroups: () => BookGroupType[];
  getGroupId: (path: string) => string | undefined;
  getGroupName: (id: string) => string | undefined;
  getParentPath: (path: string) => string | undefined;
  getGroupsByParent: (parentPath?: string) => BookGroupType[];
}

function withoutSubjects(book: Book): Book {
  if (!book.metadata) return book;
  const metadata = removeBookSubjectMetadata(book.metadata);
  return metadata === book.metadata ? book : { ...book, metadata };
}

function buildHashIndex(books: Book[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < books.length; i++) {
    index.set(books[i]!.hash, i);
  }
  return index;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  library: [],
  libraryLoaded: false,
  isSyncing: false,
  syncProgress: 0,
  currentBookshelf: [],
  selectedBooks: new Set(),
  groups: {},
  hashIndex: new Map(),
  visibleLibrary: [],
  checkOpenWithBooks: isTauriAppPlatform(),
  checkLastOpenBooks: isTauriAppPlatform(),

  setIsSyncing: (syncing: boolean) => set({ isSyncing: syncing }),
  setSyncProgress: (progress: number) => set({ syncProgress: progress }),
  getVisibleLibrary: () => get().visibleLibrary,
  getBookByHash: (hash: string) => {
    const { library, hashIndex } = get();
    const idx = hashIndex.get(hash);
    return idx !== undefined ? library[idx] : undefined;
  },

  setCurrentBookshelf: (bookshelf: Book[]) => {
    set({ currentBookshelf: bookshelf });
  },

  setCheckOpenWithBooks: (check) => set({ checkOpenWithBooks: check }),
  setCheckLastOpenBooks: (check) => set({ checkLastOpenBooks: check }),
  // Mutations may replace only the subset loaded for a reader. Complete reads
  // establish readiness and membership, while preserving newer personal edits
  // made in memory while disk rows and cover URLs were loading.
  setLibrary: (books, complete = false) => {
    if (complete) {
      const current = new Map(get().library.map((book) => [book.hash, book]));
      books = books.map((book) => {
        const previous = current.get(book.hash);
        return previous ? mergeLibraryBook(previous, book) : book;
      });
    }
    books = books.map(withoutSubjects);
    set({
      library: books,
      libraryLoaded: complete || get().libraryLoaded,
      hashIndex: buildHashIndex(books),
      visibleLibrary: getVisibleBooks(books),
    });
    get().refreshGroups();
  },

  // Immutable lightweight progress update — skips refreshGroups (which is the
  // expensive O(n) MD5 path) but still creates new array references for
  // `library` and `visibleLibrary` so Zustand subscribers re-render correctly
  // and the visibleLibrary cache stays in sync.
  updateBookProgress: (hash, progress, readingStatus) => {
    const { library, hashIndex } = get();
    const idx = hashIndex.get(hash);
    if (idx === undefined) return;
    const book = library[idx]!;
    const statusChanged = readingStatus !== book.readingStatus;
    const updatedBook: Book = {
      ...book,
      progress,
      readingStatus,
      readingStatusUpdatedAt: statusChanged ? Date.now() : book.readingStatusUpdatedAt,
      updatedAt: Date.now(),
    };
    const newLibrary = library.slice();
    newLibrary[idx] = updatedBook;
    set({
      library: newLibrary,
      visibleLibrary: getVisibleBooks(newLibrary),
    });
  },

  rebuildHashIndex: () => {
    set({ hashIndex: buildHashIndex(get().library) });
  },

  updateBook: async (envConfig: EnvConfigType, book: Book) => {
    book = withoutSubjects(book);
    const appService = await envConfig.getAppService();
    const { library, hashIndex } = get();
    const idx = hashIndex.get(book.hash);
    if (idx !== undefined) book = protectBookRemoval(book, library[idx]!);
    // Build the new library immutably — never mutate the previous-state array.
    const newLibrary =
      idx !== undefined
        ? [...library.slice(0, idx), book, ...library.slice(idx + 1)]
        : library.slice();
    set({
      library: newLibrary,
      hashIndex: buildHashIndex(newLibrary),
      visibleLibrary: getVisibleBooks(newLibrary),
    });
    const persisted = await appService.saveLibraryBooks(newLibrary);
    if (persisted) {
      const lifecycles = new Map(
        persisted.filter((b) => b.removal || b.localRemoval).map((b) => [b.hash, b]),
      );
      if (lifecycles.size)
        get().setLibrary(
          get().library.map((b) => {
            const current = lifecycles.get(b.hash);
            return current ? protectBookRemoval(b, current) : b;
          }),
        );
    }
  },
  updateBooks: async (
    envConfig: EnvConfigType,
    books: Book[],
    options?: { skipSave?: boolean },
  ) => {
    if (!books?.length) return;
    books = books.map(withoutSubjects);

    // Hardening: if a caller (e.g. /send, the inbox drainer) hits us before
    // `setLibrary` has populated the store, merging against the empty
    // in-memory array would persist `books` as the *entire* library and
    // clobber whatever is on disk. Load the real library first.
    let { library } = get();
    const { libraryLoaded, refreshGroups } = get();
    if (!libraryLoaded) {
      const appService = await envConfig.getAppService();
      library = await appService.loadLibraryBooks();
      get().setLibrary(library, true);
      library = get().library;
    }

    const existingByHash = new Map(library.map((b) => [b.hash, b]));
    books = books.map((b) =>
      existingByHash.has(b.hash) ? mergeLibraryBook(existingByHash.get(b.hash)!, b) : b,
    );
    const newLibrary = Array.from(new Map([...library, ...books].map((b) => [b.hash, b])).values());
    set({
      library: newLibrary,
      hashIndex: buildHashIndex(newLibrary),
      visibleLibrary: getVisibleBooks(newLibrary),
    });
    refreshGroups();

    if (!options?.skipSave) {
      const appService = await envConfig.getAppService();
      const persisted = await appService.saveLibraryBooks(newLibrary);
      if (persisted) {
        const lifecycles = new Map(
          persisted.filter((b) => b.removal || b.localRemoval).map((b) => [b.hash, b]),
        );
        if (lifecycles.size)
          get().setLibrary(
            get().library.map((b) => {
              const current = lifecycles.get(b.hash);
              return current ? protectBookRemoval(b, current) : b;
            }),
          );
      }
    }
  },

  setSelectedBooks: (ids: string[]) => {
    set({ selectedBooks: new Set(ids) });
  },

  getSelectedBooks: () => {
    return Array.from(get().selectedBooks);
  },

  toggleSelectedBook: (id: string) => {
    set((state) => {
      const newSelection = new Set(state.selectedBooks);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      return { selectedBooks: newSelection };
    });
  },

  refreshGroups: () => {
    const { library } = get();
    const groups: Record<string, string> = {};

    for (const path of collectFolderPaths(
      library,
      useSettingsStore.getState().settings.libraryFolders,
    )) {
      groups[md5Fingerprint(path)] = path;
    }

    set({ groups });
  },

  addGroup: (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Group name cannot be empty');
    }

    const id = md5Fingerprint(trimmedName);
    const { groups } = get();

    set({ groups: { ...groups, [id]: trimmedName } });

    return { id, name: trimmedName };
  },

  getGroups: () => {
    const { groups } = get();
    return Object.entries(groups)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  getGroupId: (path: string) => {
    const { groups } = get();

    const directId = Object.entries(groups).find(([_, name]) => name === path)?.[0];
    if (directId) {
      return directId;
    }

    return md5Fingerprint(path);
  },

  getGroupName: (id: string) => {
    return (
      get().groups[id] ??
      collectFolderPaths([], useSettingsStore.getState().settings.libraryFolders).find(
        (path) => md5Fingerprint(path) === id,
      )
    );
  },

  getParentPath: (path: string) => {
    const lastSlashIndex = path.lastIndexOf('/');
    if (lastSlashIndex === -1) return '';
    return path.slice(0, lastSlashIndex);
  },

  getGroupsByParent: (parentPath?: string) => {
    const { groups } = get();
    const result: BookGroupType[] = [];
    Object.entries(groups).forEach(([id, name]) => {
      const groupParentPath = get().getParentPath(name);
      if (groupParentPath === (parentPath || '')) {
        result.push({ id, name });
      }
    });
    return result;
  },
}));
