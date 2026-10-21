import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';

const state = vi.hoisted(() => ({
  opening: false,
  request: (_begin: number, _end: number) => {},
  destroy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@pdfjs/pdf.min.mjs', () => {
  class PDFDataRangeTransport {
    requestDataRange!: (begin: number, end: number) => void;
    onDataRange() {}
  }
  const page = {
    getViewport: () => ({ width: 600, height: 800 }),
    cleanup() {},
    getTextContent: () => new Promise<never>(() => state.request(0, 8)),
  };
  const pdf = {
    numPages: 1,
    getPage: async () => page,
    getMetadata: async () => ({ info: {} }),
    getOutline: async () => null,
    getPageLabels: async () => ['1'],
    destroy: state.destroy,
  };
  (globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport,
    getDocument: ({ range }: { range: PDFDataRangeTransport }) => {
      state.request = (begin, end) => range.requestDataRange(begin, end);
      return {
        destroy: state.destroy,
        promise: state.opening
          ? new Promise<never>(() => queueMicrotask(() => state.request(0, 8)))
          : Promise.resolve(pdf),
      };
    },
  };
  return {};
});

let makePDF: (file: File) => Promise<unknown>;
beforeAll(async () => {
  ({ makePDF } = await import('foliate-js/pdf.js'));
});

const open = (message: string | number = 'pdf_range_truncated') => {
  return makePDF({
    size: 8,
    slice: () => ({
      arrayBuffer: async () => {
        if (typeof message === 'number') return new ArrayBuffer(message);
        throw new Error(message);
      },
    }),
  } as unknown as File) as Promise<BookDoc>;
};

const bounded = <T>(pending: Promise<T>) =>
  Promise.race([
    pending,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('test_read_hung')), 500),
    ),
  ]);

beforeEach(() => {
  state.opening = false;
  state.destroy.mockClear();
});

describe('PDF byte range failures', () => {
  it('rejects document opening promptly when a range read fails', async () => {
    state.opening = true;
    await expect(bounded(open())).rejects.toThrow('pdf_range_truncated');
    expect(state.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    'getPDFText',
    'getPDFContentsLines',
  ] as const)('rejects %s promptly after a later range failure', async (method) => {
    const book = await open();
    await expect(bounded<string | string[]>(book[method]!(0))).rejects.toThrow(
      'pdf_range_truncated',
    );
    expect(state.destroy).toHaveBeenCalledOnce();
  });

  it('reports a safe range code instead of a source path from a failed reader', async () => {
    state.opening = true;
    await expect(bounded(open('/private/user-book.pdf: read failed'))).rejects.toThrow(
      'pdf_range_read_failed',
    );
  });

  it.each([
    [7, 'pdf_range_truncated'],
    [9, 'pdf_range_mismatch'],
  ] as const)('rejects a returned %i-byte block instead of feeding it to PDF.js', async (length, code) => {
    state.opening = true;
    await expect(bounded(open(length))).rejects.toThrow(code);
    expect(state.destroy).toHaveBeenCalledOnce();
  });
});
