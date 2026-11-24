import { expect, it, vi } from 'vitest';
import { page as webview } from 'vitest/browser';
import 'foliate-js/view.js';
import type { FoliateView } from '@/types/view';
import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { mkdir, remove } from '@tauri-apps/plugin-fs';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { NativeAppService } from '@/services/nativeAppService';
import { loadLibraryRows } from '@/services/libraryRepository';
import { saveLibraryBooks } from '@/services/libraryService';
import { removeAppBooks } from '@/services/appBookRemoval';
import { getLocalBookFilename } from '@/utils/book';
import { openCloudBook } from '@/glossa/sync/cloudBook';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { Book } from '@/types/book';

const auth = vi.hoisted(() => ({
  origin: 'https://native-sync.invalid',
  subject: 'native-fixture',
}));
vi.mock('@/glossa/sync/config', () => ({
  syncOrigin: () => auth.origin,
  hasGlossaSyncConfig: () => true,
}));
vi.mock('@/utils/access', async (original) => ({
  ...(await original<typeof import('@/utils/access')>()),
  getUserID: async () => auth.subject,
}));
vi.mock('@/glossa/account/config', async (original) => ({
  ...(await original<typeof import('@/glossa/account/config')>()),
  isGlossaAuthConfigured: () => true,
}));
vi.mock('@/utils/supabase', async (original) => ({
  ...(await original<typeof import('@/utils/supabase')>()),
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: auth.subject }, access_token: 'test-identity' } },
      }),
    },
  },
}));

for (const format of ['PDF', 'EPUB'] as const) {
  it('releases, opens and restores a ' +
    format +
    ' using the native filesystem and SQLite', async () => {
    expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
    const variant = format === 'PDF' ? 'glossa-ocr-sample.pdf' : 'glossa-reading-sample.epub';
    const fixture = await fetch('/src/__tests__/fixtures/data/' + variant);
    expect(fixture.ok).toBe(true);
    const bytes = new Uint8Array(await fixture.arrayBuffer());
    const hash = bytesToHex(blake3(bytes));
    const pointer = {
      origin: auth.origin,
      subject: auth.subject,
      book_id: crypto.randomUUID(),
      manifest_id: crypto.randomUUID(),
      file_blake3: hash,
    };
    const book: Book = {
      hash: crypto.randomUUID().replaceAll('-', ''),
      format,
      title: 'Native fixture',
      author: 'Glossa',
      createdAt: 1,
      updatedAt: 1,
      downloadedAt: 1,
      glossaCloud: pointer,
    };
    const root = await join(await appLocalDataDir(), 'Readest', 'cloud-test-' + book.hash);
    await mkdir(root, { recursive: true });
    const app = new NativeAppService();
    app.fs = { ...app.fs };
    const originalFetch = globalThis.fetch.bind(globalThis);
    let available = false;
    const segment = { ordinal: 0, blake3: hash, start_byte: 0, end_byte: bytes.length - 1 };
    const object = 'https://native-objects.invalid/' + hash;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.href === object)
        return available ? new Response(bytes) : new Response(null, { status: 503 });
      if (url.origin !== auth.origin) return originalFetch(input, options);
      if (url.pathname === '/v1/auth/exchange')
        return Response.json({
          access_token: 'native-access',
          refresh_token: 'native-refresh',
          expires_in: 900,
          device_id: JSON.parse(String(options?.body)).device_id,
          session_id: crypto.randomUUID(),
        });
      expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer native-access');
      const path = '/v1/books/' + pointer.book_id;
      if (url.pathname === path + '/manifest')
        return Response.json({
          book_rev: 2,
          status: 'unread',
          finished_at: null,
          manifest_id: pointer.manifest_id,
          file_blake3: hash,
          file_bytes: bytes.length,
          manifest_digest: 'a'.repeat(64),
          chunk_count: 1,
          assets: [],
          chunks: [segment],
          next_ordinal: null,
        });
      expect(url.pathname).toBe(path + '/stream-urls');
      return Response.json({
        manifest_id: pointer.manifest_id,
        chunks: [{ ...segment, get_url: object }],
        assets: [],
      });
    });
    try {
      await app.setCustomRootDir(root);
      for (const base of ['Books', 'Data'] as const) {
        expect(await app.resolveFilePath('', base)).toMatch(root + '/');
        await app.createDir('', base, true);
      }
      await saveLibraryBooks(app.fs, [book]);
      const path = getLocalBookFilename(book);
      const notes = book.hash + '/config.json';
      await app.writeFile(path, 'Books', bytes.buffer);
      await app.writeFile(notes, 'Books', '{"notes":["native overlay"]}');
      const current = async () => (await loadLibraryRows(app.fs, { hashes: [book.hash] }))[0]!;
      expect((await removeAppBooks(app, [await current()], 'local')).failed).toEqual([book.hash]);
      expect(await app.exists(path, 'Books')).toBe(true);
      available = true;
      expect((await removeAppBooks(app, [await current()], 'local')).completed).toEqual([
        book.hash,
      ]);
      expect(await app.exists(path, 'Books')).toBe(false);
      expect(await current()).toMatchObject({ downloadedAt: null, glossaCloud: pointer });
      const cold = await openCloudBook(await current());
      let doc: BookDoc | undefined;
      try {
        const result = await new DocumentLoader(cold, { loadPDFCache: false }).open();
        doc = result.book;
        expect(result.format).toBe(format);
        expect(doc.sections.length).toBeGreaterThan(0);
        if (format === 'PDF') {
          await webview.viewport(800, 700);
          const view = document.createElement('foliate-view') as FoliateView;
          view.style.cssText = 'display:block;width:700px;height:650px';
          document.body.append(view);
          try {
            await view.open(doc);
            view.renderer.setAttribute('spread', 'none');
            await view.goTo(1);
            const bitmap = () =>
              view.renderer
                .getContents()
                .find((item) => item.index === 1)
                ?.doc.querySelector<HTMLCanvasElement>('#canvas canvas');
            await expect.poll(() => bitmap()?.width, { timeout: 10000 }).toBeGreaterThan(0);
            const sample = document.createElement('canvas');
            sample.width = 160;
            sample.height = 200;
            const ctx = sample.getContext('2d')!;
            ctx.drawImage(bitmap()!, 0, 0, sample.width, sample.height);
            const rgba = ctx.getImageData(0, 0, sample.width, sample.height).data;
            expect(
              rgba.some(
                (channel, index) => index % 4 === 0 && channel < 192 && rgba[index + 3] === 255,
              ),
            ).toBe(true);
            const preview = await doc.getPDFImage!(1, 256, undefined, AbortSignal.timeout(10000));
            expect(preview?.type).toBe('image/png');
            expect(preview?.size).toBeGreaterThan(0);
          } finally {
            view.close();
            view.remove();
          }
        } else {
          const section = await doc.sections.at(-1)!.createDocument!();
          expect(section.body.textContent).toContain('return signal');
        }
      } finally {
        await doc?.destroy?.();
        await cold.close();
      }
      expect(await app.exists(path, 'Books')).toBe(false);
      await app.downloadBook(await current());
      expect(
        bytesToHex(
          blake3(new Uint8Array((await app.readFile(path, 'Books', 'binary')) as ArrayBuffer)),
        ),
      ).toBe(hash);
      expect((await current()).downloadedAt).toBeGreaterThan(1);
      expect(await app.readFile(notes, 'Books', 'text')).toBe('{"notes":["native overlay"]}');
    } finally {
      fetcher.mockRestore();
      await remove(root, { recursive: true });
    }
  }, 45000);
}
