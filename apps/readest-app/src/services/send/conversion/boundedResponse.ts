/** Read resource bytes with a hard retained-byte ceiling, including chunked responses. */
export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  signal?.throwIfAborted();
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Resource exceeds byte limit');
  }
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = (): void => {
    rejectAbort(signal?.reason ?? new DOMException('Resource read cancelled', 'AbortError'));
    // Do not await cancellation: an upstream cancel handler may itself stall.
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal?.throwIfAborted();
      if (done) break;
      if (value.byteLength > maxBytes - total) {
        void reader.cancel().catch(() => undefined);
        throw new Error('Resource exceeds byte limit');
      }
      // Copy views so a small chunk cannot retain an unbounded backing buffer.
      chunks.push(value.slice());
      total += value.byteLength;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      reader.releaseLock();
    } catch {
      /* A cancelled reader can still be settling. */
    }
  }
}

/** A transport that ignores AbortSignal must not extend the resource deadline. */
export async function awaitResource<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => rejectAbort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
