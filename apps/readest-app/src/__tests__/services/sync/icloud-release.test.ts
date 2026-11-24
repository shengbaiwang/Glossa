import { File as NodeFile } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { fingerprintFile } from '@/services/bookIdentity';
import { publishBlob } from '@/services/sync/providers/icloud/blob';
import { prepareVaultRelease } from '@/services/sync/providers/icloud/release';
import { useSettingsStore } from '@/store/settingsStore';
import { createFileSyncProvider } from '@/services/sync/file/providerRegistry';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { CustomFont } from '@/styles/fonts';
import { getLocalBookFilename } from '@/utils/book';
import {
  listFonts,
  pushSelectedFonts,
  readFont,
  selectFont,
} from '@/services/sync/providers/icloud/fonts';

vi.mock('@/services/sync/file/providerRegistry', () => ({ createFileSyncProvider: vi.fn() }));
vi.mock('@/glossa/sync/bookUse', () => ({
  withUnusedBook: (_id: string, action: () => Promise<void>) => action(),
}));

function fixture() {
  const vault = crypto.randomUUID(),
    root = '/GlossaSync-v2/' + vault;
  const files = new Map<string, string>(),
    bytes = new Map<string, ArrayBuffer>(),
    dirs = new Set(['/GlossaSync-v2', root]);
  const status = vi.fn(async () => 'unconfirmed');
  const p = {
    rootPath: root,
    vaultId: vault,
    ensureDir: async (paths: string[]) => paths.forEach((s) => dirs.add(s)),
    head: async (path: string) => (dirs.has(path) || files.has(path) ? {} : null),
    list: async (path: string) =>
      [...dirs, ...files.keys()]
        .filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'))
        .map((k) => ({ name: k.slice(path.length + 1), isDirectory: dirs.has(k) })),
    readText: async (k: string) => files.get(k) ?? null,
    writeText: async (k: string, v: string) => files.set(k, v),
    writeBinary: async (k: string, v: ArrayBuffer) => bytes.set(k, v),
    readBinary: async (k: string) => bytes.get(k) ?? null,
    uploadStatus: status,
  } as unknown as FileSyncProvider;
  const file = new NodeFile(['test fixture'], 'sample.otf') as unknown as File;
  return { p, status, file, vault, files };
}

it('protects the managed original until upload is confirmed and checks it again at unlink', async () => {
  const { p, status, file, vault } = fixture();
  vi.mocked(createFileSyncProvider).mockResolvedValue(p);
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.setState({
    settings: {
      ...settings,
      icloud: { ...settings.icloud, enabled: true, vaultId: vault, documentsPath: 'folder' },
    },
  });
  try {
    const expected = await fingerprintFile(file);
    const asset = await publishBlob(p, file, expected, () => {});
    const book = {
      hash: 'sample',
      format: 'PDF',
      title: 'test',
      downloadedAt: 123,
      contentFingerprint: expected,
      icloudAsset: asset,
      localRemoval: {
        id: 'release',
        downloadedAt: 123,
        cloudScope: 'icloud:' + vault + ':' + asset.manifest,
      },
    } as Book;
    const fingerprint = vi.fn(async () => expected),
      unlink = vi.fn();
    const app = {
      resolveFilePath: async () => '/managed',
      exists: async () => true,
      readFile: vi.fn(),
      writeFile: vi.fn(),
      openFile: async () => file,
      readDirectory: async () => [],
      deleteFile: unlink,
      fingerprint,
    } as unknown as AppService;
    await expect(prepareVaultRelease(app, book)).rejects.toThrow('confirm');
    status.mockResolvedValue('uploaded');
    const release = await prepareVaultRelease(app, book);
    await expect(release({ ...book, downloadedAt: 124 })).rejects.toThrow();
    fingerprint.mockResolvedValueOnce('sha256:' + '1'.repeat(64));
    await expect(release(book)).rejects.toThrow();
    status.mockResolvedValueOnce('unconfirmed');
    await expect(release(book)).rejects.toThrow('confirm');
    expect(unlink).not.toHaveBeenCalled();
    await release(book);
    expect(unlink).toHaveBeenCalledExactlyOnceWith(getLocalBookFilename(book), 'Books');
  } finally {
    useSettingsStore.setState({ settings });
  }
});

it('restores only an explicitly shared font, validates its bytes and rejects a forged filename', async () => {
  const { p, file, files } = fixture();
  const app = { openFile: async () => file } as unknown as AppService;
  const font = { name: '研究字体', id: 'local', path: 'sample.otf' } as CustomFont;
  const selected = await selectFont(app, font);
  await pushSelectedFonts(app, p, [font], [], () => {});
  expect(await listFonts(p, () => {})).toEqual([]);
  await pushSelectedFonts(app, p, [font], [selected], () => {});
  const [row] = await listFonts(p, () => {});
  expect(await fingerprintFile(await readFont(p, row!, () => {}))).toBe(selected.hash);
  const path = [...files.keys()].find((k) => k.includes('/fonts/'))!;
  files.set(path, JSON.stringify({ ...row, filename: '../sample.otf' }));
  await expect(listFonts(p, () => {})).rejects.toThrow();
});
