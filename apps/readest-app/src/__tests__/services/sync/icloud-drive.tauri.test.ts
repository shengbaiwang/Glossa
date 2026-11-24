import { expect, it } from 'vitest';
import { mkdir, remove } from '@tauri-apps/plugin-fs';
import { NativeDatabaseService } from '@/services/database/nativeDatabaseService';
import { createICloudProvider } from '@/services/sync/providers/icloud/ICloudProvider';
import { NoteJournal } from '@/services/sync/providers/icloud/noteJournal';
import { exchangeSegments } from '@/services/sync/providers/icloud/exchangeSegments';
import { selectVault, vaultRoot } from '@/services/sync/providers/icloud/vault';

it('reopens a native outbox and reconciles two native SQLite replicas through a selected folder', async () => {
  const root = process.env['CWD'] + '/.readest-test-sandbox-tauri/icloud-' + crypto.randomUUID();
  await mkdir(root + '/drive', { recursive: true });
  const databases = new Set<NativeDatabaseService>();
  try {
    const provider = createICloudProvider(root + '/drive');
    const id = await selectVault(provider, true);
    const open = async (device: string) => {
      const db = await NativeDatabaseService.open('sqlite:' + root + '/' + device + '.db');
      databases.add(db);
      const journal = new NoteJournal(db, id, 'original', 'sha256:' + 'e'.repeat(64));
      await journal.init();
      return { db, journal };
    };
    let a = await open('A');
    const b = await open('B');
    const dir = vaultRoot(id) + '/annotations/original';
    const exchange = (j: NoteJournal, d: 'push' | 'pull') =>
      exchangeSegments(provider, dir, d, j, () => {});
    await a.journal.save([
      {
        id: 'test-note',
        type: 'annotation',
        cfi: 'epubcfi(/6/2)',
        createdAt: 1,
        updatedAt: 1,
        note: '曙光',
      },
    ]);
    await a.db.close();
    databases.delete(a.db);
    a = await open('A');
    await exchange(a.journal, 'push');
    await exchange(b.journal, 'pull');
    await a.journal.save([{ ...(await a.journal.notes())[0]!, note: '晨光' }]);
    await b.journal.save([{ ...(await b.journal.notes())[0]!, note: '天明' }]);
    await exchange(b.journal, 'push');
    await exchange(a.journal, 'pull');
    await exchange(a.journal, 'push');
    await exchange(b.journal, 'pull');
    expect(await a.journal.notes()).toEqual(await b.journal.notes());
    expect((await a.journal.notes())[0]!.icloudEdit!.bodies.map((v) => v.text).sort()).toEqual([
      '天明',
      '晨光',
    ]);
  } finally {
    for (const db of databases) await db.close();
    await remove(root, { recursive: true });
  }
});

it('saves through the native reader entry and merges a peer bookmark and two offline bodies', async () => {
  const { NativeAppService, nativeFileSystem } = await import('@/services/nativeAppService');
  const { syncBookJournal } = await import('@/services/sync/providers/icloud/noteSync');
  const { DEFAULT_SYSTEM_SETTINGS } = await import('@/services/constants');
  const root = process.env['CWD'] + '/.readest-test-sandbox-tauri/reader-' + crypto.randomUUID();
  await mkdir(root + '/drive', { recursive: true });
  try {
    const drive = createICloudProvider(root + '/drive');
    const id = await selectVault(drive, true);
    const provider = { ...drive, vaultId: id, rootPath: vaultRoot(id) };
    const settings = {
      ...DEFAULT_SYSTEM_SETTINGS,
      icloud: { ...DEFAULT_SYSTEM_SETTINGS.icloud, enabled: true, vaultId: id, syncStats: false },
      globalViewSettings: {},
    } as import('@/types/settings').SystemSettings;
    const reader = (device: string) => {
      const app = new NativeAppService();
      app.fs = {
        ...nativeFileSystem,
        resolvePath: (path, base) => ({
          base,
          baseDir: 0,
          basePrefix: async () => '',
          fp: base === 'None' ? path : root + '/' + device + '/' + base + (path ? '/' + path : ''),
        }),
      };
      return app;
    };
    const book = {
      hash: 'sample',
      format: 'EPUB',
      title: 'Test',
      author: 'A',
      createdAt: 1,
      updatedAt: 1,
      contentFingerprint: 'sha256:' + '7'.repeat(64),
    } as import('@/types/book').Book;
    const a = reader('a'),
      b = reader('b');
    const sync = async (app: typeof a, direction: 'push' | 'pull') => {
      const local = await app.loadBookConfig(book, settings);
      return syncBookJournal(app, provider, id, () => settings.icloud)(book, direction, local);
    };
    await a.saveBookConfig(
      book,
      {
        updatedAt: 1,
        booknotes: [
          {
            id: 'p',
            type: 'annotation',
            cfi: 'epubcfi(/6/2)',
            note: '原稿',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      settings,
    );
    await sync(reader('a'), 'push');
    await sync(b, 'pull');
    const left = await a.loadBookConfig(book, settings),
      right = await b.loadBookConfig(book, settings);
    await a.saveBookConfig(
      book,
      { ...left, booknotes: [{ ...left.booknotes![0]!, note: '甲' }] },
      settings,
    );
    await b.saveBookConfig(
      book,
      {
        ...right,
        booknotes: [
          { ...right.booknotes![0]!, note: '乙' },
          { id: 'b', type: 'bookmark', note: '', cfi: 'epubcfi(/6/4)', createdAt: 2, updatedAt: 2 },
        ],
      },
      settings,
    );
    await sync(b, 'push');
    await sync(a, 'pull');
    await sync(a, 'push');
    await sync(b, 'pull');
    const result = (await reader('b').loadBookConfig(book, settings)).booknotes!;
    expect(result).toEqual((await a.loadBookConfig(book, settings)).booknotes);
    expect(result.filter((n) => n.type === 'bookmark')).toHaveLength(1);
    expect(
      result
        .find((n) => n.id === 'p')!
        .icloudEdit!.bodies.map((v) => v.text)
        .sort(),
    ).toEqual(['乙', '甲']);
    await sync(a, 'push');
    const { withGlobalTypography } = await import('@/services/sync/providers/icloud/typography');
    const statuses = await withGlobalTypography(a, id, (_, db) =>
      db.select<{ uploaded: number; peer: string | null }>(
        'SELECT uploaded,peer FROM segment_delivery',
      ),
    );
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((row) => !row.uploaded)).toBe(true);
    expect(statuses.some((row) => row.peer)).toBe(true);
    expect(await provider.uploadStatus!(provider.rootPath)).toBe('unconfirmed');
  } finally {
    await remove(root, { recursive: true });
  }
});

for (const format of ['PDF', 'EPUB'] as const) {
  it('reads a ' +
    format +
    ' from verified Drive chunks, downloads it and reopens it with the target disabled', async () => {
    const { NativeAppService, nativeFileSystem } = await import('@/services/nativeAppService');
    const { DocumentLoader } = await import('@/libs/document');
    const { publishBlob, openVaultBlob } = await import('@/services/sync/providers/icloud/blob');
    const { fingerprintFile } = await import('@/services/bookIdentity');
    const { createAppLocalStore } = await import('@/services/sync/file/appLocalStore');
    const { useSettingsStore } = await import('@/store/settingsStore');
    const root = process.env['CWD'] + '/.readest-test-sandbox-tauri/assets-' + crypto.randomUUID();
    await mkdir(root + '/drive', { recursive: true });
    const initial = useSettingsStore.getState().settings;
    try {
      const raw = createICloudProvider(root + '/drive'),
        id = await selectVault(raw, true);
      const provider = { ...raw, vaultId: id, rootPath: vaultRoot(id) };
      const app = new NativeAppService();
      app.fs = {
        ...nativeFileSystem,
        resolvePath: (path, base) => ({
          base,
          baseDir: 0,
          basePrefix: async () => '',
          fp: base === 'None' ? path : root + '/reader/' + base + (path ? '/' + path : ''),
        }),
      };
      const settings = {
        ...initial,
        icloud: { ...initial.icloud, enabled: true, vaultId: id, documentsPath: root + '/drive' },
      };
      useSettingsStore.setState({ settings });
      const fixture = 'glossa-reading-sample.' + format.toLowerCase();
      const response = await fetch('/src/__tests__/fixtures/data/' + fixture);
      expect(response.ok).toBe(true);
      const original = new File([await response.arrayBuffer()], fixture),
        fingerprint = await fingerprintFile(original);
      const asset = await publishBlob(provider, original, fingerprint, () => {});
      expect(await publishBlob(provider, original, fingerprint, () => {})).toEqual(asset);
      const streamed = await openVaultBlob(
        provider,
        asset,
        fixture,
        format === 'EPUB' ? 'application/epub+zip' : 'application/pdf',
        () => {},
      );
      try {
        const { book, format: detected } = await new DocumentLoader(streamed, {
          loadPDFCache: false,
        }).open();
        try {
          expect(detected).toBe(format);
          expect(book.sections.length).toBeGreaterThan(0);
        } finally {
          await book.destroy?.();
        }
      } finally {
        await streamed.close();
      }
      const book = {
        hash: 'fixture',
        format,
        title: 'fixture',
        author: 'Test',
        createdAt: 1,
        updatedAt: 1,
        icloudAsset: asset,
        contentFingerprint: fingerprint,
      } as import('@/types/book').Book;
      const store = createAppLocalStore({
        appService: app,
        settings,
        envConfig: {
          getAppService: async () => app,
        } as import('@/services/environment').EnvConfigType,
      });
      expect(await store.downloadVaultFile!(provider, book)).toBe(true);
      useSettingsStore.setState({
        settings: { ...settings, icloud: { ...settings.icloud, enabled: false } },
      });
      const { file } = await app.loadBookContent(book);
      try {
        expect(await fingerprintFile(file)).toBe(fingerprint);
        const opened = await new DocumentLoader(file, { loadPDFCache: false }).open();
        try {
          expect(opened.format).toBe(format);
          expect(opened.book.sections.length).toBeGreaterThan(0);
        } finally {
          await opened.book.destroy?.();
        }
      } finally {
        await (file as File & { close?: () => Promise<void> }).close?.();
      }
    } finally {
      useSettingsStore.setState({ settings: initial });
      await remove(root, { recursive: true });
    }
  }, 30000);
}
