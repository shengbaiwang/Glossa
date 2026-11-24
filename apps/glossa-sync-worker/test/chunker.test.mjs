import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkFile } from '@glossa/sync-contracts/chunker';

test('fastcdc-glossa-v1 interoperable boundaries and digests across input buffers', async () => {
  const bytes = Buffer.alloc(20 * 1024 * 1024);
  let seed = 0x31c07b29;
  for (let i = 0; i < bytes.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    bytes[i] = seed & 255;
  }
  const ends = [5323670, 9565994, 14820169, 18013560, 20971519];
  const hashes = [
    '7d0d7e26884c4712439be4516f400e7c6e9625e883f87c3cc8239e82ec741c80',
    'cc9236f58300edf0d6e475f4faa9d3ec693643e77418703126e827e7b7a34326',
    '37f607e50092d92d55072b43bbe12f76ee55d3e7e0a3ce0287003e2e13745162',
    '54bcee421aca14a8007f074f5446c20412e7d7db464c1339b3043f88930be963',
    '1edd8da63e7c668efe44863c7522aee915e2fefc3aeffbd4329ce061fdbefda7',
  ];
  async function* fragmented() {
    for (let i = 0; i < bytes.length; i += 65513) yield bytes.subarray(i, i + 65513);
  }
  for await (const c of chunkFile(fragmented())) {
    if (c.type === 'complete') {
      assert.equal(
        c.file_blake3,
        'a70b41acec749c3e621177b455ccd6c46f4b1f7dbcf1c0f72142fe3183edf396',
      );
      assert.equal(c.chunk_count, ends.length);
      continue;
    }
    assert.equal(c.end_byte, ends[c.ordinal]);
    assert.equal(c.blake3, hashes[c.ordinal]);
  }
});
