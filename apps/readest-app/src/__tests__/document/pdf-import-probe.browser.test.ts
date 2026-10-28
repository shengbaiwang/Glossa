import { expect, it } from 'vitest';
import { DocumentLoader, type BookDoc } from '@/libs/document';

it('imports a real PDF cover with minimal navigation, then opens its full reading document', async () => {
  const response = await fetch('/src/__tests__/fixtures/data/glossa-auto-toc-sample.pdf');
  expect(response.ok).toBe(true);
  const file = new File([await response.arrayBuffer()], 'original-import.pdf', {
    type: 'application/pdf',
  });
  let probe: BookDoc | undefined;
  let reader: BookDoc | undefined;
  try {
    const imported = await new DocumentLoader(file, {
      importOnly: true,
      loadPDFCache: false,
    }).open();
    expect(imported.format).toBe('PDF');
    probe = imported.book;
    expect(probe.sections).toHaveLength(0);
    expect(probe.toc).toHaveLength(0);
    const cover = await probe.getCover();
    expect(cover).toBeInstanceOf(Blob);
    expect(cover!.size).toBeGreaterThan(100);
    const bitmap = await createImageBitmap(cover!);
    try {
      expect(bitmap.width).toBeGreaterThan(0);
      expect(bitmap.height).toBeGreaterThan(0);
    } finally {
      bitmap.close();
    }
    const metadata = probe.metadata;
    await probe.destroy?.();
    probe = undefined;
    reader = (await new DocumentLoader(file).open()).book;
    expect(reader.metadata).toEqual(metadata);
    expect(reader.sections.length).toBeGreaterThan(1);
    expect(reader.pageList).toHaveLength(reader.sections.length);
    expect(reader.toc!.length).toBeGreaterThan(0);
    expect(await reader.getPDFText!(0)).toContain('Original reading material');
  } finally {
    await probe?.destroy?.();
    await reader?.destroy?.();
  }
}, 20000);

it('rejects a damaged real PDF during import validation', async () => {
  await expect(
    new DocumentLoader(new File(['%PDF-1.7\ncorrupted original fixture'], 'damaged.pdf'), {
      importOnly: true,
      loadPDFCache: false,
    }).open(),
  ).rejects.toThrow();
});
