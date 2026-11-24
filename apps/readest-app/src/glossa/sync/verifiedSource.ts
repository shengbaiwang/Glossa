import { describeObject } from '@glossa/sync-contracts/chunker';
import type { PreparedFile } from '@glossa/sync-contracts/publisher';

// A NativeFile may change after FastCDC. Only return bytes from the exact version
// identified by the upload plan, even if R2 already contains every chunk.
export class VerifiedSource {
  failure?: Error;
  private cache = new Map<string, Uint8Array>();
  private cacheBytes = 0;
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private file: Blob,
    private plan: PreparedFile,
  ) {}

  read(index: number, length: number) {
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(length) || index < 0 || length < 0)
      throw new RangeError('invalid_source_range');
    // Concurrent parser range requests share verification and bounded disk IO.
    const next = this.tail.then(() => this.copy(index, length));
    this.tail = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  private async copy(index: number, length: number) {
    if (this.failure) throw this.failure;
    const end = Math.min(index + length, this.plan.file_bytes);
    const out = new Uint8Array(Math.max(0, end - index));
    const chunks = this.plan.chunks;
    let lo = 0,
      hi = chunks.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (chunks[mid]!.end_byte < index) lo = mid + 1;
      else hi = mid;
    }
    for (let at = index; at < end; lo++) {
      const chunk = chunks[lo]!;
      let data = this.cache.get(chunk.blake3);
      if (data) this.cache.delete(chunk.blake3);
      else {
        try {
          data = new Uint8Array(
            await this.file.slice(chunk.start_byte, chunk.end_byte + 1).arrayBuffer(),
          );
          if (data.length !== chunk.bytes || describeObject(data).blake3 !== chunk.blake3)
            throw new Error('source_file_changed');
        } catch (error) {
          this.failure = error instanceof Error ? error : new Error('source_read_failed');
          throw this.failure;
        }
        while (this.cacheBytes + data.length > 32 << 20) {
          const oldest = this.cache.keys().next().value!;
          this.cacheBytes -= this.cache.get(oldest)!.length;
          this.cache.delete(oldest);
        }
        this.cacheBytes += data.length;
      }
      this.cache.set(chunk.blake3, data);
      const next = Math.min(end, chunk.end_byte + 1);
      out.set(data.subarray(at - chunk.start_byte, next - chunk.start_byte), at - index);
      at = next;
    }
    return out;
  }
}
