import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import { findTocItemBS, findParentPath } from '@/services/nav/lookup';
import type { BookDoc, TOCItem } from '@/libs/document';

const { pdf } = vi.hoisted(() => ({
  pdf: {
    numPages: 4,
    getPage: vi.fn(async () => ({
      getViewport: () => ({
        width: 600,
        height: 800,
        viewBox: [0, 0, 600, 800],
        convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
      }),
      cleanup: vi.fn(),
    })),
    getMetadata: vi.fn(async () => ({ info: {} })),
    getOutline: vi.fn(),
    getPageLabels: vi.fn(async () => ['i', 'ii', '1', '2']),
    getDestination: vi.fn(),
    getPageIndex: vi.fn(async (ref: { num: number }) => ref.num - 10),
    destroy: vi.fn(),
  },
}));

vi.mock('@pdfjs/pdf.min.mjs', () => {
  (globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport: class {},
    getDocument: () => ({ promise: Promise.resolve(pdf) }),
  };
  return {};
});

type PDFNavigationBook = BookDoc & {
  toc: TOCItem[];
  pageList: TOCItem[];
  resolveHref(href: string): Promise<{ index: number } | undefined>;
  destroy(): void;
};
const open = async () =>
  (await import('foliate-js/pdf.js')).makePDF({ size: 1 } as File) as unknown as PDFNavigationBook;

beforeEach(() => {
  vi.clearAllMocks();
  pdf.getOutline.mockResolvedValue([
    {
      title: 'Chapter one',
      dest: [0, { name: 'Fit' }],
      items: [{ title: 'Detail', dest: 'detail', items: [] }],
    },
    { title: 'Chapter two', dest: [{ num: 13, gen: 0 }, { name: 'Fit' }], items: [] },
  ]);
  pdf.getDestination.mockImplementation(async (name: string) =>
    name === 'detail' ? [2, { name: 'XYZ' }, 0, 500, null] : null,
  );
});

describe('PDF navigation shared with the reader', () => {
  it('resolves zero-based page destinations, named destinations and object references', async () => {
    const book = await open();
    expect(book.toc[0]!.index).toBe(0);
    expect(book.toc[0]!.subitems![0]!.index).toBe(2);
    expect(book.toc[1]!.index).toBe(3);
    expect((await book.resolveHref(book.toc[0]!.href))!.index).toBe(0);
    expect((await book.resolveHref(book.toc[0]!.subitems![0]!.href))!.index).toBe(2);
    expect(pdf.getPageIndex).not.toHaveBeenCalledWith(0);
    book.destroy();
  });

  it('provides canonical positions and distinct IDs for chapter paths, bookmarks and notes', async () => {
    const book = await open();
    const toc = book.toc as TOCItem[];
    const detail = toc[0]!.subitems![0]!;
    expect(detail.cfi).toBe(CFI.fake.fromIndex(2));
    expect(new Set([toc[0]!.id, detail.id, toc[1]!.id]).size).toBe(3);
    expect(findTocItemBS(toc, CFI.fake.fromIndex(2))).toBe(detail);
    expect(findParentPath(toc, detail.href).map((item) => item.label)).toEqual([
      'Chapter one',
      'Detail',
    ]);
    expect(book.splitTOCHref(detail.href)).toEqual([2, null]);
    book.destroy();
  });

  it('keeps page labels and supplies page navigation when there is no embedded outline', async () => {
    pdf.getOutline.mockResolvedValue(null);
    const book = await open();
    expect(book.pageList.map((item: TOCItem) => item.label)).toEqual(['i', 'ii', '1', '2']);
    expect(book.toc).toHaveLength(4);
    expect(book.toc[2]!.cfi).toBe(CFI.fake.fromIndex(2));
    expect((await book.resolveHref(book.toc[2]!.href))!.index).toBe(2);
    book.destroy();
  });

  it('ignores missing and out-of-bounds destinations without a rejected promise', async () => {
    const book = await open();
    await expect(book.resolveHref('"missing"')).resolves.toBeUndefined();
    await expect(book.resolveHref('[99,{"name":"Fit"}]')).resolves.toBeUndefined();
    await expect(book.resolveHref('malformed')).resolves.toBeUndefined();
    expect(book.splitTOCHref('"missing"')).toEqual([null, null]);
    book.destroy();
  });
});
