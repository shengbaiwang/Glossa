import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeAppService } from '@/services/nodeAppService';
import { importZoteroAttachment } from '@/glossa/plugins/zotero/import';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

let root: string;
let service: NodeAppService;
const sourcePath = join(process.cwd(), 'src/__tests__/fixtures/data/sample-alice.epub');
const source = { itemKey: 'ABCD1234', attachmentKey: 'EFGH5678', title: 'Zotero title' };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'glossa-zotero-test-'));
  service = new NodeAppService(root);
  await service.init();
  useLibraryStore.getState().setLibrary([]);
  useSettingsStore.setState({ settings: await service.loadSettings() });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it('copies an attachment once and keeps saved personal metadata, notes and reading position on reconnect', async () => {
  const original = await readFile(sourcePath);
  const imported = await importZoteroAttachment(
    service,
    sourcePath,
    source,
    new AbortController().signal,
  );
  expect(imported.readingSpaces).toEqual(['academic']);
  expect(imported.filePath).not.toBe(sourcePath);
  const personal = {
    ...imported,
    title: 'Personal title',
    groupName: 'Research',
    progress: [7, 20] as [number, number],
    metadataUpdatedAt: Date.now() + 1,
    updatedAt: Date.now() + 1,
  };
  await service.saveLibraryBooks([personal]);
  const settings = await service.loadSettings();
  const config = await service.loadBookConfig(personal, settings);
  config.location = 'epubcfi(/6/4!/4/2/1:0)';
  config.booknotes = [
    {
      id: 'test-note',
      type: 'annotation',
      cfi: config.location,
      text: 'Original text',
      note: 'Personal annotation',
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  await service.saveBookConfig(personal, config, settings);
  const again = await importZoteroAttachment(
    service,
    sourcePath,
    { ...source, title: 'Changed Zotero title' },
    new AbortController().signal,
  );
  expect(again).toMatchObject({
    hash: imported.hash,
    title: 'Personal title',
    groupName: 'Research',
    progress: [7, 20],
    zoteroSource: source,
  });
  expect(await service.loadLibraryBooks()).toHaveLength(1);
  expect(await service.loadBookConfig(again, settings)).toMatchObject({
    location: config.location,
    booknotes: config.booknotes,
  });
  expect(await readFile(sourcePath)).toEqual(original);
}, 30000);
it('links an existing leisure identity into academic without overwriting its record', async () => {
  const existing = (await service.importBook(sourcePath, [], {
    initialReadingSpace: 'leisure',
    saveCover: false,
  }))!;
  await service.saveLibraryBooks([
    { ...existing, title: 'My name', metadataUpdatedAt: Date.now() + 1 },
  ]);
  useLibraryStore.getState().setLibrary(await service.loadLibraryBooks());
  const linked = await importZoteroAttachment(
    service,
    sourcePath,
    source,
    new AbortController().signal,
  );
  expect(linked.hash).toBe(existing.hash);
  expect(linked.title).toBe('My name');
  expect(linked.readingSpaces).toEqual(['leisure', 'academic']);
  expect(await service.loadLibraryBooks()).toHaveLength(1);
}, 30000);
it('does not create a record for a cancelled import or a missing attachment', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    importZoteroAttachment(service, sourcePath, source, controller.signal),
  ).rejects.toThrow();
  await expect(
    importZoteroAttachment(
      service,
      join(root, 'missing.epub'),
      source,
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(await service.loadLibraryBooks()).toEqual([]);
});
