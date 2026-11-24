import { expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { waitForPDFOCR } from '@/services/pdfEnhancement';
it('polls the owned job even after another reader starts OCR', async () => {
  invoke.mockResolvedValue({
    cacheId: 'a'.repeat(32),
    jobId: 'first',
    state: 'completed',
    completed: 1,
    total: 1,
    error: null,
  });
  const result = await waitForPDFOCR(
    'a'.repeat(32),
    new AbortController().signal,
    () => {},
    'first',
  );
  expect(invoke).toHaveBeenCalledWith('pdf_ocr_status', {
    cacheId: 'a'.repeat(32),
    jobId: 'first',
  });
  expect(result.state).toBe('completed');
});
