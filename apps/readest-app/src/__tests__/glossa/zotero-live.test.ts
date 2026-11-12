import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { NodeAppService } from '@/services/nodeAppService';
import { importZoteroAttachment } from '@/glossa/plugins/zotero/import';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
const fixturePath = process.env['GLOSSA_ZOTERO_LIVE_FIXTURE'];
const fingerprint = async (path: string) => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
};
// Explicit opt-in only. It copies one authorized attachment into a disposable library.
it.skipIf(!fixturePath)(
  'imports an authorized live Zotero attachment twice without changing its original file',
  async () => {
    const fixture = z
      .object({
        path: z.string(),
        source: z.object({ itemKey: z.string(), attachmentKey: z.string(), title: z.string() }),
      })
      .parse(JSON.parse(await readFile(fixturePath!, 'utf8')));
    if (/\.pdf$/i.test(fixture.path)) {
      await import('foliate-js/pdf.js');
      (
        globalThis as unknown as { pdfjsLib: { GlobalWorkerOptions: { workerSrc: string } } }
      ).pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        `file://${join(process.cwd(), 'public/vendor/pdfjs/pdf.worker.min.mjs')}`,
      ).href;
    }
    const before = await fingerprint(fixture.path);
    const root = await mkdtemp(join(tmpdir(), 'glossa-zotero-live-'));
    try {
      const service = new NodeAppService(root);
      await service.init();
      // jsdom has no canvas. This lane verifies real file/data persistence;
      // cover rendering remains a separate browser/native acceptance boundary.
      const importBook = service.importBook.bind(service);
      service.importBook = (file, books, options) =>
        importBook(file, books, { ...options, saveCover: false });
      useLibraryStore.getState().setLibrary([]);
      const settings = await service.loadSettings();
      useSettingsStore.setState({ settings });
      const first = await importZoteroAttachment(
        service,
        fixture.path,
        fixture.source,
        new AbortController().signal,
      );
      expect(first.readingSpaces).toEqual(['academic']);
      const config = await service.loadBookConfig(first, settings);
      config.location = 'verification-location';
      config.booknotes = [
        {
          id: 'verification-note',
          type: 'annotation',
          cfi: 'verification-location',
          note: 'Isolated verification note',
          createdAt: 1,
          updatedAt: 1,
        },
      ];
      await service.saveBookConfig(first, config, settings);
      const second = await importZoteroAttachment(
        service,
        fixture.path,
        fixture.source,
        new AbortController().signal,
      );
      expect(second.hash).toBe(first.hash);
      expect(await service.loadLibraryBooks()).toHaveLength(1);
      expect(await service.loadBookConfig(second, settings)).toMatchObject({
        location: config.location,
        booknotes: config.booknotes,
      });
      expect(await fingerprint(fixture.path)).toBe(before);
      const reportPath = process.env['GLOSSA_ZOTERO_LIVE_REPORT'];
      if (reportPath)
        await writeFile(
          reportPath,
          JSON.stringify(
            {
              format: first.format,
              recordsAfterTwoImports: 1,
              originalUnchanged: true,
              isolatedNotesPreserved: true,
              coverRendering: false,
            },
            null,
            2,
          ),
        );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  120000,
);
