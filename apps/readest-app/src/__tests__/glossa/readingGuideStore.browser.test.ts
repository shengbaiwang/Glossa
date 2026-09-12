import { describe, expect, it, vi } from 'vitest';
import { generateReadingGuide } from '@/glossa/guide/generate';
import { getPassageId } from '@/glossa/guide/passages';
import { loadReadingGuide, saveReadingGuide } from '@/glossa/guide/store';
import type { ReadingGuide, ReadingGuideBody, ReadingPassage } from '@/glossa/guide/types';

const DB_NAME = 'glossa-reading-guides';
const LEGACY_DB_NAME = 'glossa-study-notes';
const sourceText = 'Local conditions shape which explanation can support a conclusion.';

async function guideFixture(
  bookId: string,
  chapterId = 'chapter-1',
  passageMarker = 'passage-1',
  text = sourceText,
): Promise<ReadingGuide> {
  const sourceId = `s-${passageMarker}`;
  const passage: ReadingPassage = {
    id: '',
    index: 0,
    title: 'Conditions and conclusions',
    characterCount: text.length,
    unavailable: false,
    sources: [
      {
        sourceId,
        text,
        kind: 'paragraph',
        anchor: {
          sectionIndex: 0,
          cfi: 'epubcfi(/6/2!/4/2)',
          quote: { exact: text, prefix: '', suffix: '' },
        },
      },
    ],
  };
  passage.id = getPassageId(chapterId, passage.sources);
  const body: ReadingGuideBody = {
    orientation: [
      {
        text: 'Notice which conditions support the conclusion.',
        sourceIds: [sourceId],
        kind: 'source',
      },
    ],
    difficulties: [],
    readingCue: null,
    insufficientEvidence: false,
  };
  return generateReadingGuide(
    {
      bookId,
      bookTitle: 'Original reading guide fixture',
      chapterTitle: 'Conditions and conclusions',
      chapterId,
      passage,
      config: {
        id: 'fixture',
        name: 'Local fixture',
        baseUrl: 'http://localhost:1234/v1',
        model: 'fixture-model',
      },
    },
    { complete: async () => JSON.stringify(body) },
  );
}

it('persists and restores the complete twenty-thousand-character input', async () => {
  const guide = await guideFixture(crypto.randomUUID(), 'chapter-1', 'long', '甲'.repeat(20000));
  await saveReadingGuide(guide);
  const restored = await loadReadingGuide(guide.bookId, guide.chapterId, guide.passageId);
  expect(restored).toEqual(guide);
  expect(restored!.sources[0]!.anchor.quote.exact).toHaveLength(20000);
});

function openDatabase(name: string, createStore?: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      if (createStore) request.result.createObjectStore(createStore);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRaw(name: string, store: string, value: unknown, key?: string) {
  const db = await openDatabase(name, store);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, 'readwrite');
      if (key) transaction.objectStore(store).put(value, key);
      else transaction.objectStore(store).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function readRaw(name: string, store: string, key: IDBValidKey): Promise<unknown> {
  const db = await openDatabase(name);
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as unknown);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

describe('reading guides in real IndexedDB', () => {
  it('uses the new database without opening, transacting with or deleting legacy study notes', async () => {
    const sentinelKey = crypto.randomUUID();
    const sentinel = { personalNote: 'PRIVATE_LEGACY_SENTINEL', versions: [{ id: 'keep-me' }] };
    await putRaw(LEGACY_DB_NAME, 'sentinel', sentinel, sentinelKey);
    const opened = vi.spyOn(IDBFactory.prototype, 'open');
    const deleted = vi.spyOn(IDBFactory.prototype, 'deleteDatabase');
    const transacted = vi.spyOn(IDBDatabase.prototype, 'transaction');
    try {
      const guide = await guideFixture(crypto.randomUUID());
      expect(await loadReadingGuide(guide.bookId, guide.chapterId, guide.passageId)).toBeNull();
      await saveReadingGuide(guide);
      expect(await loadReadingGuide(guide.bookId, guide.chapterId, guide.passageId)).toEqual(guide);
      expect(opened.mock.calls.every(([name]) => name === DB_NAME)).toBe(true);
      expect(
        transacted.mock.contexts.every((db) => db instanceof IDBDatabase && db.name === DB_NAME),
      ).toBe(true);
      expect(deleted).not.toHaveBeenCalled();
    } finally {
      opened.mockRestore();
      deleted.mockRestore();
      transacted.mockRestore();
    }
    expect(await readRaw(LEGACY_DB_NAME, 'sentinel', sentinelKey)).toEqual(sentinel);
  });

  it('persists one guide per book, chapter and passage and isolates neighboring reading scopes', async () => {
    const bookId = crypto.randomUUID();
    const first = await guideFixture(bookId);
    const nextPassage = await guideFixture(bookId, 'chapter-1', 'passage-2');
    const nextChapter = await guideFixture(bookId, 'chapter-2');
    const otherBook = await guideFixture(crypto.randomUUID());
    for (const guide of [first, nextPassage, nextChapter, otherBook]) await saveReadingGuide(guide);
    const updated = await guideFixture(bookId);
    await saveReadingGuide(updated);
    expect(await loadReadingGuide(bookId, 'chapter-1', first.passageId)).toEqual(updated);
    expect(await readRaw(DB_NAME, 'guides', [bookId, 'chapter-1', first.passageId])).toEqual(
      updated,
    );
    expect(await loadReadingGuide(bookId, 'chapter-1', nextPassage.passageId)).toEqual(nextPassage);
    expect(await loadReadingGuide(bookId, 'chapter-2', nextChapter.passageId)).toEqual(nextChapter);
    expect(await loadReadingGuide(otherBook.bookId, 'chapter-1', otherBook.passageId)).toEqual(
      otherBook,
    );
    expect(await loadReadingGuide(bookId, 'unopened-chapter', first.passageId)).toBeNull();
  });

  it('rejects invalid source references without replacing the previous valid guide', async () => {
    const first = await guideFixture(crypto.randomUUID());
    await saveReadingGuide(first);
    const invalid: ReadingGuide = {
      ...first,
      orientation: [
        { text: 'An unsupported claim.', sourceIds: ['invented-source'], kind: 'source' },
      ],
    };
    await expect(saveReadingGuide(invalid)).rejects.toThrow();
    expect(await loadReadingGuide(first.bookId, first.chapterId, first.passageId)).toEqual(first);
    await putRaw(DB_NAME, 'guides', invalid);
    expect(await loadReadingGuide(first.bookId, first.chapterId, first.passageId)).toBeNull();
  });

  it('keeps the old guide when cancellation happens before a write starts', async () => {
    const first = await guideFixture(crypto.randomUUID());
    await saveReadingGuide(first);
    const replacement = await guideFixture(first.bookId);
    const controller = new AbortController();
    controller.abort();
    await expect(saveReadingGuide(replacement, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(await loadReadingGuide(first.bookId, first.chapterId, first.passageId)).toEqual(first);
  });

  it('rolls back an active write transaction on cancellation and can retry', async () => {
    const first = await guideFixture(crypto.randomUUID());
    await saveReadingGuide(first);
    const replacement = await guideFixture(first.bookId);
    const controller = new AbortController();
    const put = IDBObjectStore.prototype.put;
    const intercepted = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = put.call(this, value, key);
      queueMicrotask(() => controller.abort());
      return request;
    });
    try {
      await expect(saveReadingGuide(replacement, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
    } finally {
      intercepted.mockRestore();
    }
    expect(await loadReadingGuide(first.bookId, first.chapterId, first.passageId)).toEqual(first);
    await saveReadingGuide(replacement);
    expect(await loadReadingGuide(first.bookId, first.chapterId, first.passageId)).toEqual(
      replacement,
    );
  });

  it('does not overwrite a saved guide when IndexedDB rejects a replacement', async () => {
    const first = await guideFixture(crypto.randomUUID());
    await saveReadingGuide(first);
    const replacement = await guideFixture(first.bookId);
    const intercepted = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Fixture quota exceeded', 'QuotaExceededError');
    });
    try {
      await expect(saveReadingGuide(replacement)).rejects.toThrow();
    } finally {
      intercepted.mockRestore();
    }
    expect(await loadReadingGuide(first.bookId, first.chapterId, first.passageId)).toEqual(first);
  });
});
