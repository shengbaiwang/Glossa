import { blake3 } from '@noble/hashes/blake3';
import { md5 } from '@noble/hashes/legacy';
import { bytesToHex } from '@noble/hashes/utils';
import { fastCdcProfile } from './index.ts';

// fastcdc-glossa-v1: uint32 wrap, xorshift32 gear table, normalization level 1.
// Skip the first min-1 bytes of each chunk and include the boundary byte in the emitted chunk.
const gear = new Uint32Array(256);
let seed = 0x9e3779b9;
for (let i = 0; i < gear.length; i++) {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  gear[i] = seed >>> 0;
}
// Shared by FastCDC chunks and independently uploaded sidecars.
export function describeObject(data: Uint8Array) {
  return {
    blake3: bytesToHex(blake3(data)),
    md5_b64: btoa(String.fromCharCode(...md5(data))),
    bytes: data.byteLength,
  };
}
export type FileChunk = {
  type: 'chunk';
  ordinal: number;
  start_byte: number;
  end_byte: number;
  blake3: string;
  md5_b64: string;
  bytes: number;
  data: Uint8Array;
};
export async function* chunkFile(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<
  FileChunk | { type: 'complete'; file_blake3: string; file_bytes: number; chunk_count: number }
> {
  const { min, average, max } = fastCdcProfile;
  const whole = blake3.create();
  const buffer = new Uint8Array(max);
  let used = 0,
    rolling = 0,
    offset = 0,
    ordinal = 0;
  function take(): FileChunk {
    const data = buffer.slice(0, used);
    const chunk: FileChunk = {
      type: 'chunk',
      ordinal: ordinal++,
      start_byte: offset,
      end_byte: offset + used - 1,
      ...describeObject(data),
      data,
    };
    offset += used;
    used = 0;
    rolling = 0;
    return chunk;
  }
  for await (const bytes of source) {
    whole.update(bytes);
    let start = 0;
    for (let i = 0; i < bytes.length; i++) {
      used++;
      if (used < min) continue;
      rolling = ((rolling << 1) + gear[bytes[i]!]!) >>> 0;
      const mask = used < average ? 0x7fffff : 0x1fffff;
      if ((rolling & mask) !== 0 && used < max) continue;
      buffer.set(bytes.subarray(start, i + 1), used - (i + 1 - start));
      start = i + 1;
      yield take();
    }
    buffer.set(bytes.subarray(start), used - (bytes.length - start));
  }
  if (used) yield take();
  yield {
    type: 'complete',
    file_blake3: bytesToHex(whole.digest()),
    file_bytes: offset,
    chunk_count: ordinal,
  };
}
