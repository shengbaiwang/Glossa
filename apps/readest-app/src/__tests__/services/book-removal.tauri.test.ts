import { expect, test } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { mkdir, writeFile, readFile, remove, exists } from '@tauri-apps/plugin-fs';
import {
  openPDFCache,
  savePDFOutline,
  startPDFOCR,
  getPDFOCRStatus,
  purgePDFBook,
  inspectLegacyPDFCaches,
  clearLegacyPDFCaches,
} from '@/services/pdfEnhancement';
import { removeAppBooks, bookRemovalIO } from '@/services/appBookRemoval';
import { restoreRemovedBooks } from '@/services/bookRemovalService';
import { getLibraryFilename } from '@/utils/book';
import { saveConversations, loadConversations } from '@/glossa/conversation/store';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';

test('native workflow preserves originals and another book, cancels OCR before purge, and blocks late writes after restore', async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
  const root = await appLocalDataDir(),
    id = crypto.randomUUID();
  const sandbox = await join(root, 'Readest', `removal-${id}`),
    cacheRoot = await join(root, 'pdf-local-v1');
  await invoke('allow_paths_in_scopes', { paths: [sandbox, cacheRoot], isDirectory: true });
  await mkdir(sandbox, { recursive: true });
  const source = `${sandbox}/original.pdf`,
    managed = `${sandbox}/managed.pdf`;
  const raw = await fetch('/src/__tests__/fixtures/data/glossa-ocr-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  const file = new File([raw, `\n% deletion fixture ${id}\n`], 'original.pdf');
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeFile(source, bytes);
  await writeFile(managed, bytes);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const book: Book = {
    hash: `native-${id}`,
    title: 'Original fixture',
    author: 'Fixture',
    format: 'PDF',
    filePath: source,
    createdAt: 1,
    updatedAt: 1,
  };
  const files = new Map([[getLibraryFilename(), JSON.stringify([book])]]);
  const app = {
    resolveFilePath: async () => sandbox,
    readFile: async (path: string) => files.get(path) ?? '',
    writeFile: async (path: string, _base: string, text: string) => {
      files.set(path, text);
    },
    deleteBook: async () => {
      if (await exists(managed)) await remove(managed);
    },
  } as unknown as AppService;
  const dirs: string[] = [];
  try {
    const legacy = (await openPDFCache(source, true))!;
    dirs.push(legacy.id);
    const initial = (await openPDFCache(source, true, { bookId: book.hash, revision: 0 }))!;
    dirs.push(initial.id);
    await savePDFOutline(
      source,
      initial,
      [{ title: 'Personal outline', pageIndex: 0, level: 0 }],
      2,
    );
    const other = (await openPDFCache(source, true, { bookId: `other-${id}`, revision: 0 }))!;
    dirs.push(other.id);
    await savePDFOutline(source, other, [{ title: 'Other outline', pageIndex: 0, level: 0 }], 2);
    await saveConversations({
      version: 1,
      bookId: book.hash,
      activeId: 'one',
      sessions: [{ id: 'one', turns: [] }],
    });
    const trashed = await removeAppBooks(app, [book], 'trash');
    expect(trashed.completed).toEqual([book.hash]);
    expect(await exists(managed)).toBe(true);
    expect(await loadConversations(book.hash)).not.toBeNull();
    const restored = await restoreRemovedBooks(bookRemovalIO(app), [book.hash]);
    const revision = restored[0]!.removal!.revision;
    const current = (await openPDFCache(source, true, { bookId: book.hash, revision }))!;
    dirs.push(current.id);
    expect(current.outline?.[0]?.title).toBe('Personal outline');
    const running = await startPDFOCR(source, current.id, [0, 1]);
    expect(running.state).toBe('running');
    const purged = await removeAppBooks(app, restored, 'purge');
    expect(purged.completed).toEqual([book.hash]);
    expect(await exists(managed)).toBe(false);
    expect(await exists(await join(cacheRoot, initial.id))).toBe(false);
    expect(await exists(await join(cacheRoot, current.id))).toBe(false);
    expect((await getPDFOCRStatus(current.id))?.state).toBe('cancelled');
    await expect(openPDFCache(source, true, { bookId: book.hash, revision })).rejects.toBeTruthy();
    await expect(savePDFOutline(source, current, [], 2)).rejects.toBeTruthy();
    expect(
      (await openPDFCache(source, false, { bookId: `other-${id}`, revision: 0 }))?.outline?.[0]
        ?.title,
    ).toBe('Other outline');
    expect(await crypto.subtle.digest('SHA-256', await readFile(source))).toEqual(digest);
    const review = (await inspectLegacyPDFCaches()).filter((c) => c.id === legacy.id);
    expect(review).toHaveLength(1);
    await clearLegacyPDFCaches(review);
    expect(await exists(await join(cacheRoot, legacy.id))).toBe(false);
    await expect(openPDFCache(source, true)).rejects.toBeTruthy();
    expect(await exists(await join(cacheRoot, other.id))).toBe(true);
    const newer = purged.books[0]!.removal!.revision + 100;
    const reopened = (await openPDFCache(source, true, { bookId: book.hash, revision: newer }))!;
    dirs.push(reopened.id);
    expect(reopened.outline).toBeNull();
    await expect(purgePDFBook(book.hash, purged.books[0]!.removal!.revision)).rejects.toBeTruthy();
    expect(await exists(await join(cacheRoot, reopened.id))).toBe(true);
  } finally {
    for (const cacheId of dirs) {
      const path = await join(cacheRoot, cacheId);
      if (await exists(path)) await remove(path, { recursive: true });
    }
    await remove(sandbox, { recursive: true });
  }
}, 60000);
