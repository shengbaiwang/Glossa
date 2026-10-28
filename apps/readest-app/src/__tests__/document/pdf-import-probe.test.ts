import { beforeEach, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';

const f = vi.hoisted(() => ({
  page: vi.fn(),
  outline: vi.fn(),
  labels: vi.fn(),
  destroy: vi.fn(),
  metadata: vi.fn(),
}));

vi.mock('@pdfjs/pdf.min.mjs', () => {
  (globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport: class {},
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 10000,
        getPage: f.page,
        getMetadata: f.metadata,
        getOutline: f.outline,
        getPageLabels: f.labels,
      }),
      destroy: f.destroy,
    }),
  };
  return {};
});

beforeEach(() => {
  vi.clearAllMocks();
  f.page.mockResolvedValue({ getViewport: () => ({ width: 600, height: 800 }) });
  f.metadata.mockResolvedValue({ info: { Title: 'Original fixture' } });
});

it('validates a PDF and preserves cover capability without resolving full reading navigation', async () => {
  const { makePDF } = await import('foliate-js/pdf.js');
  const probe = (await makePDF(new File(['%PDF-1.7'], 'fixture.pdf'), {
    importOnly: true,
  })) as BookDoc;
  expect(probe.metadata.title).toBe('Original fixture');
  expect(f.page).toHaveBeenCalledWith(1);
  expect(f.outline).not.toHaveBeenCalled();
  expect(f.labels).not.toHaveBeenCalled();
  expect(probe.sections).toHaveLength(0);
  expect(probe.getCover).toBeTypeOf('function');
  await probe.destroy?.();
  expect(f.destroy).toHaveBeenCalledOnce();
});

it('rejects an unreadable first page instead of registering a filename-only placeholder', async () => {
  const { makePDF } = await import('foliate-js/pdf.js');
  f.page.mockRejectedValueOnce(new Error('fixture damaged page'));
  await expect(makePDF(new File(['%PDF-1.7'], 'broken.pdf'), { importOnly: true })).rejects.toThrow(
    'fixture damaged page',
  );
  expect(f.outline).not.toHaveBeenCalled();
  expect(f.destroy).toHaveBeenCalledOnce();
});

it('releases the parser if import metadata cannot be read', async () => {
  const { makePDF } = await import('foliate-js/pdf.js');
  f.metadata.mockRejectedValueOnce(new Error('fixture metadata unavailable'));
  await expect(makePDF(new File(['%PDF-1.7'], 'broken.pdf'), { importOnly: true })).rejects.toThrow(
    'fixture metadata unavailable',
  );
  expect(f.outline).not.toHaveBeenCalled();
  expect(f.destroy).toHaveBeenCalledOnce();
});

it('releases the background parser if full navigation loading fails before ownership transfers', async () => {
  const { makePDF } = await import('foliate-js/pdf.js');
  f.outline.mockRejectedValueOnce(new Error('fixture navigation unavailable'));
  await expect(makePDF(new File(['%PDF-1.7'], 'broken.pdf'))).rejects.toThrow(
    'fixture navigation unavailable',
  );
  expect(f.destroy).toHaveBeenCalledOnce();
});
