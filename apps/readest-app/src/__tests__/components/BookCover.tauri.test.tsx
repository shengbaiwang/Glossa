import { beforeAll, expect, it, vi } from 'vitest';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { join, tempDir } from '@tauri-apps/api/path';
import { writeFile, remove } from '@tauri-apps/plugin-fs';
import { render, waitFor, cleanup } from '@testing-library/react';
import BookCover from '@/components/BookCover';
import type { Book } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import { ImageConfigContext } from 'next/dist/shared/lib/image-config-context.shared-runtime';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import { readLibraryDiagnostics } from '@/utils/libraryDiagnostics';
beforeAll(async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
});
async function png(width: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 3;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#819e88';
  context.fillRect(0, 0, width, 3);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((value) => resolve(value!), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
it('recovers a real native asset after temporary absence and reloads a replacement at the same path', async () => {
  sessionStorage.setItem('glossa-library-diagnostics', '1');
  const path = await join(await tempDir(), `glossa-cover-test-${crypto.randomUUID()}.png`);
  await invoke('allow_paths_in_scopes', { paths: [path], isDirectory: false });
  const book = {
    hash: 'native-cover-only',
    title: 'Synthetic Cover',
    author: 'Glossa',
    format: 'PDF',
    createdAt: 1,
    updatedAt: 1,
    coverImageUrl: convertFileSrc(path),
  } as Book;
  const failed = vi.fn();
  // Match next.config.mjs: native export serves assets without Next's HTTP optimizer.
  const Gallery = ({ item }: { item: Book }) => (
    <ImageConfigContext.Provider value={{ ...imageConfigDefault, unoptimized: true }}>
      <div style={{ width: 160, height: 240 }}>
        <BookCover book={item} onImageError={failed} />
      </div>
    </ImageConfigContext.Provider>
  );
  const view = render(<Gallery item={book} />);
  try {
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(failed).toHaveBeenCalledTimes(2);
    await writeFile(path, await png(2));
    await invoke('allow_paths_in_scopes', { paths: [path], isDirectory: false });
    const raw = new Image();
    const rawLoaded = new Promise<void>((resolve, reject) => {
      raw.onload = () => resolve();
      raw.onerror = () => reject(new Error('Native asset baseline failed'));
    });
    raw.src = convertFileSrc(path);
    await rawLoaded;
    const versioned = new Image();
    const versionedLoaded = new Promise<void>((resolve, reject) => {
      versioned.onload = () => resolve();
      versioned.onerror = () => reject(new Error('Native versioned asset baseline failed'));
    });
    versioned.src = `${convertFileSrc(path)}?glossa-cover=%3A2`;
    await versionedLoaded;
    window.dispatchEvent(new Event('focus'));
    try {
      await waitFor(
        () =>
          expect(
            view.container.querySelector<HTMLImageElement>('img[aria-hidden="false"]')
              ?.naturalWidth,
          ).toBe(2),
        { timeout: 5000 },
      );
    } catch (error) {
      console.info(
        'Native cover recovery evidence',
        JSON.stringify({
          failed: failed.mock.calls.length,
          events: readLibraryDiagnostics(),
          images: [...view.container.querySelectorAll<HTMLImageElement>('img')].map((image) => ({
            protocol: new URL(image.src).protocol,
            complete: image.complete,
            width: image.naturalWidth,
          })),
        }),
      );
      throw error;
    }
    await writeFile(path, await png(4));
    view.rerender(<Gallery item={{ ...book, coverHash: 'replacement', coverUpdatedAt: 2 }} />);
    await waitFor(
      () =>
        expect(
          view.container.querySelector<HTMLImageElement>('img[aria-hidden="false"]')?.naturalWidth,
        ).toBe(4),
      { timeout: 5000 },
    );
  } finally {
    cleanup();
    sessionStorage.removeItem('glossa-library-diagnostics');
    await remove(path).catch(() => {});
  }
});
