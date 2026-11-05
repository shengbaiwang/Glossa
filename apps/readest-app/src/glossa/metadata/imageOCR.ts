import { enqueueLocalOCRTask } from '@/services/pdfOCR';

/** One bounded embedded image; no filesystem path or remote image permission is granted. */
export function recognizeMetadataImage(blob: Blob, signal: AbortSignal): Promise<string> {
  return enqueueLocalOCRTask(async () => {
    signal.throwIfAborted();
    if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('metadata_image_limit');
    const { invoke } = await import('@tauri-apps/api/core');
    const jobId = crypto.randomUUID();
    const data = Array.from(new Uint8Array(await blob.arrayBuffer()));
    signal.throwIfAborted();
    const cancel = () => {
      void invoke('metadata_cancel_image_ocr', { jobId }).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      let value: unknown;
      for (;;) {
        signal.throwIfAborted();
        try {
          value = await invoke<unknown>('metadata_recognize_image', { jobId, data });
          break;
        } catch (error) {
          if (String(error) !== 'pdf_ocr_busy') throw error;
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
        }
      }
      signal.throwIfAborted();
      if (typeof value !== 'string' || value.length > 24000)
        throw new Error('metadata_image_invalid');
      return value;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }, signal);
}
