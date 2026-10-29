import { useCallback, useRef } from 'react';
import type { Book, ReadingStatus } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';

type Field = 'title' | 'author' | 'tags' | 'readingStatus';
type Change = { before: Book; after: Book; field: Field };
const same = (a: Book, b: Book, field: Field) =>
  JSON.stringify(a[field]) === JSON.stringify(b[field]) &&
  (field === 'readingStatus'
    ? a.readingStatusUpdatedAt === b.readingStatusUpdatedAt
    : a.metadataUpdatedAt === b.metadataUpdatedAt);
const restore = (current: Book, saved: Book, field: Field, stamp: number): Book => {
  if (field === 'readingStatus')
    return {
      ...current,
      readingStatus: saved.readingStatus,
      readingStatusUpdatedAt: stamp,
      updatedAt: stamp,
    };
  return {
    ...current,
    [field]: saved[field],
    metadata: saved.metadata,
    metadataUpdatedAt: stamp,
    updatedAt: stamp,
  };
};

/** Field-scoped edits and one-step undo preserve newer reading progress and unrelated fields. */
export function useLibraryBookEdits() {
  const { envConfig } = useEnv();
  const _ = useTranslation();
  const history = useRef<Change[]>([]);
  const busy = useRef(false);
  const persist = useCallback(
    async (changes: Change[]) => {
      const store = useLibraryStore.getState();
      try {
        await store.updateBooks(
          envConfig,
          changes.map((c) => c.after),
        );
      } catch {
        // updateBooks updates memory before disk. Revert only this failed field,
        // and only while it still has our version; never restore a book snapshot.
        const reverted = changes.flatMap((c) => {
          const current = useLibraryStore.getState().library.find((b) => b.hash === c.after.hash);
          return current && same(current, c.after, c.field)
            ? [
                {
                  ...restore(current, c.before, c.field, c.before.updatedAt),
                  updatedAt:
                    current.updatedAt === c.after.updatedAt
                      ? c.before.updatedAt
                      : current.updatedAt,
                  ...(c.field === 'readingStatus'
                    ? { readingStatusUpdatedAt: c.before.readingStatusUpdatedAt }
                    : { metadataUpdatedAt: c.before.metadataUpdatedAt }),
                },
              ]
            : [];
        });
        if (reverted.length) {
          // This is a guarded rollback of an unsaved field, not a newer incoming edit.
          // The normal merge correctly rejects its older revision, so publish locally.
          const byHash = new Map(reverted.map((book) => [book.hash, book]));
          store.setLibrary(
            useLibraryStore.getState().library.map((book) => byHash.get(book.hash) ?? book),
          );
        }
        throw new Error('library_edit_save_failed');
      }
    },
    [envConfig],
  );
  const undo = useCallback(async () => {
    if (busy.current || !history.current.length) return;
    busy.current = true;
    try {
      const changes = history.current;
      const current = changes.map((c) =>
        useLibraryStore.getState().library.find((b) => b.hash === c.after.hash),
      );
      if (
        current.some(
          (book, i) => !book || book.deletedAt || !same(book, changes[i]!.after, changes[i]!.field),
        )
      ) {
        history.current = [];
        void eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Unable to undo after newer changes'),
        });
        return;
      }
      await persist(
        changes.map((c, i) => ({
          before: current[i]!,
          after: restore(
            current[i]!,
            c.before,
            c.field,
            Math.max(
              Date.now(),
              (c.field === 'readingStatus'
                ? current[i]!.readingStatusUpdatedAt
                : current[i]!.metadataUpdatedAt) ?? 0,
            ) + 1,
          ),
          field: c.field,
        })),
      );
      history.current = [];
    } catch {
      void eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to save changes'),
      });
    } finally {
      busy.current = false;
    }
  }, [persist, _]);
  const apply = useCallback(
    async (books: Book[], field: Field, value: string | string[] | undefined) => {
      if (busy.current) return false;
      if (field === 'title' && (typeof value !== 'string' || !value.trim())) return false;
      busy.current = true;
      try {
        const now = Date.now();
        const changes: Change[] = books.flatMap((book) => {
          const before = useLibraryStore.getState().library.find((b) => b.hash === book.hash);
          if (!before || before.deletedAt) return [];
          const stamp =
            Math.max(
              now,
              (field === 'readingStatus'
                ? before.readingStatusUpdatedAt
                : before.metadataUpdatedAt) ?? 0,
            ) + 1;
          const normalized = Array.isArray(value)
            ? [...new Set(value.map((t) => t.trim()).filter(Boolean))]
            : value?.trim();
          if (JSON.stringify(before[field]) === JSON.stringify(normalized)) return [];
          const after: Book =
            field === 'readingStatus'
              ? {
                  ...before,
                  readingStatus: normalized as ReadingStatus | undefined,
                  readingStatusUpdatedAt: stamp,
                  updatedAt: stamp,
                }
              : {
                  ...before,
                  [field]: normalized,
                  metadata: {
                    title: before.title,
                    author: before.author,
                    language: before.primaryLanguage ?? '',
                    ...(before.metadata ?? book.metadata),
                    ...(field !== 'tags' ? { [field]: normalized } : {}),
                  },
                  metadataUpdatedAt: stamp,
                  updatedAt: stamp,
                };
          return [{ before, after, field }];
        });
        if (!changes.length) return true;
        await persist(changes);
        history.current = changes;
        void eventDispatcher.dispatch('toast', {
          type: 'success',
          message: _('Changes saved'),
          timeout: 4500,
          action: { label: _('Undo'), onClick: undo },
        });
        return true;
      } catch {
        void eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to save changes'),
        });
        return false;
      } finally {
        busy.current = false;
      }
    },
    [persist, undo, _],
  );
  const clearUndo = useCallback(() => {
    history.current = [];
  }, []);
  return { apply, undo, canUndo: () => history.current.length > 0, clearUndo };
}
