import { describe, expect, it, vi } from 'vitest';
import {
  deleteStudyNote,
  loadChapterNotes,
  savePersonalNote,
  saveStudyNote,
} from '@/glossa/notes/store';
import type { StudyNoteVersion } from '@/glossa/notes/types';

function version(bookId: string, extra: Partial<StudyNoteVersion> = {}): StudyNoteVersion {
  return {
    id: crypto.randomUUID(),
    bookId,
    bookTitle: 'Original fixture',
    chapterId: 'chapter-1',
    chapterTitle: 'Institutions',
    createdAt: new Date().toISOString(),
    cacheKey: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    provider: {
      id: 'fixture',
      name: 'Fixture',
      baseUrl: 'https://example.test/v1',
      model: 'fixture-model',
    },
    promptVersion: 'chapter-study-1',
    schemaVersion: 1,
    title: 'Institutions',
    overview: [],
    questions: [],
    insufficientEvidence: false,
    sections: [
      {
        heading: 'A relationship',
        paragraphs: [
          { text: 'Local conditions shape institutions.', sourceIds: ['s1'], kind: 'source' },
        ],
      },
    ],
    sources: [
      {
        sourceId: 's1',
        text: 'Local conditions shape institutions.',
        kind: 'paragraph',
        anchor: {
          sectionIndex: 0,
          cfi: 'epubcfi(/6/2!/4/2)',
          quote: { exact: 'Local conditions shape institutions.', prefix: '', suffix: '' },
        },
      },
    ],
    ...extra,
  };
}

describe('local study note history in real IndexedDB', () => {
  it('keeps generated versions and personal writing separately, isolated by book and chapter', async () => {
    const bookId = crypto.randomUUID();
    const first = version(bookId, { createdAt: '2026-09-01T00:00:00.000Z' });
    const second = version(bookId, { createdAt: '2026-09-02T00:00:00.000Z' });
    await saveStudyNote(first);
    await savePersonalNote(bookId, 'chapter-1', 'My own explanation');
    await saveStudyNote(second);
    expect(await loadChapterNotes(bookId, 'chapter-1')).toEqual({
      versions: [second, first],
      personalNote: 'My own explanation',
    });
    expect(await loadChapterNotes(bookId, 'chapter-2')).toEqual({ versions: [], personalNote: '' });
    expect(await loadChapterNotes('other-book', 'chapter-1')).toEqual({
      versions: [],
      personalNote: '',
    });
  });

  it('does not replace a previous version when saving fails or is cancelled', async () => {
    const bookId = crypto.randomUUID();
    const first = version(bookId);
    await saveStudyNote(first);
    await expect(saveStudyNote({ ...first, title: 'Accidental ID collision' })).rejects.toThrow();
    const controller = new AbortController();
    const pending = saveStudyNote(version(bookId), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect((await loadChapterNotes(bookId, 'chapter-1')).versions).toEqual([first]);
  });

  it('preserves last-write order for rapid personal-note edits', async () => {
    const bookId = crypto.randomUUID();
    await Promise.all(
      ['A', 'AB', 'ABC', 'ABCD'].map((text) => savePersonalNote(bookId, 'chapter-1', text)),
    );
    expect((await loadChapterNotes(bookId, 'chapter-1')).personalNote).toBe('ABCD');
    await savePersonalNote(bookId, 'chapter-1', '');
    expect((await loadChapterNotes(bookId, 'chapter-1')).personalNote).toBe('');
  });

  it('aborts an active IndexedDB write transaction before it can add a version', async () => {
    const bookId = crypto.randomUUID();
    const first = version(bookId);
    await saveStudyNote(first);
    const controller = new AbortController();
    const add = IDBObjectStore.prototype.add;
    const intercepted = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = add.call(this, value, key);
      queueMicrotask(() => controller.abort());
      return request;
    });
    try {
      await expect(saveStudyNote(version(bookId), controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
    } finally {
      intercepted.mockRestore();
    }
    expect((await loadChapterNotes(bookId, 'chapter-1')).versions).toEqual([first]);
  });

  it('rejects unsupported sources and preserves personal notes when a generated version is deleted', async () => {
    const bookId = crypto.randomUUID();
    const note = version(bookId);
    const invalid = version(bookId, { sources: [] });
    await expect(saveStudyNote(invalid)).rejects.toThrow();
    await saveStudyNote(note);
    await savePersonalNote(bookId, 'chapter-1', 'Keep this');
    await deleteStudyNote(note.id);
    expect(await loadChapterNotes(bookId, 'chapter-1')).toEqual({
      versions: [],
      personalNote: 'Keep this',
    });
  });
});
