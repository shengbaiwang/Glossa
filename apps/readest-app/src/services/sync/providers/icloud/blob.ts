import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { z } from 'zod';
import { CloudReaderFile } from '@/glossa/sync/readerFile';
import { ancestorsOf } from '../../file/layout';
import type { FileSyncProvider } from '../../file/provider';
import { vaultRoot } from './vault';
import { digest } from './noteJournal';

const size = 2 * 1024 * 1024;
const hex = z.string().regex(/^[0-9a-f]{64}$/);
export const assetReference = z
  .object({ vault: z.string().uuid(), manifest: hex, file: hex })
  .strict();
export type VaultAsset = z.infer<typeof assetReference>;
const manifest = z
  .object({
    schema_version: z.literal(2),
    file: hex,
    size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    chunks: z.array(hex).min(1),
  })
  .strict();
const hash = (b: ArrayBuffer) => bytesToHex(sha256(new Uint8Array(b)));
const root = (p: FileSyncProvider) => vaultRoot(p.vaultId!) + '/objects';
async function loadManifest(p: FileSyncProvider, ref: VaultAsset) {
  assetReference.parse(ref);
  if (ref.vault !== p.vaultId) throw new Error('The iCloud library changed');
  const raw = await p.readText(root(p) + '/manifests/' + ref.manifest + '.json');
  if (raw === null || digest(raw) !== ref.manifest)
    throw new Error('The iCloud file manifest is unavailable');
  const m = manifest.parse(JSON.parse(raw));
  if (m.file !== ref.file || m.chunks.length !== Math.ceil(m.size / size))
    throw new Error('Invalid iCloud file manifest');
  return m;
}
export async function publishBlob(
  p: FileSyncProvider,
  file: File,
  fingerprint: string,
  check: () => void,
) {
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint) || !file.size)
    throw new Error('Missing file identity');
  const base = root(p);
  await p.ensureDir([...ancestorsOf(base + '/chunks/file'), base + '/manifests']);
  const full = sha256.create(),
    chunks: string[] = [];
  const verified = new Set<string>();
  for (let at = 0; at < file.size; at += size) {
    check();
    const bytes = await file.slice(at, at + size).arrayBuffer();
    if (bytes.byteLength !== Math.min(size, file.size - at))
      throw new Error('Book changed during upload');
    full.update(new Uint8Array(bytes));
    const id = hash(bytes);
    const path = base + '/chunks/' + id;
    if (!verified.has(id)) {
      verified.add(id);
      const previous = await p.readBinary(path);
      if (previous !== null && hash(previous) !== id)
        throw new Error('Invalid existing iCloud chunk');
      if (previous === null) {
        check();
        await p.writeBinary(path, bytes);
      }
    }
    chunks.push(id);
  }
  const fileHash = bytesToHex(full.digest());
  if ('sha256:' + fileHash !== fingerprint) throw new Error('Book changed during upload');
  const raw = JSON.stringify({ schema_version: 2, file: fileHash, size: file.size, chunks });
  const id = digest(raw),
    path = base + '/manifests/' + id + '.json';
  const previous = await p.readText(path);
  if (previous !== null && previous !== raw) throw new Error('Invalid existing iCloud manifest');
  if (previous === null) {
    check();
    await p.writeText(path, raw);
  }
  return { vault: p.vaultId!, file: fileHash, manifest: id };
}
/** Release requires a verified manifest and system confirmation for every referenced object. */
export async function confirmUploadedBlob(p: FileSyncProvider, ref: VaultAsset, check: () => void) {
  const m = await loadManifest(p, ref);
  const paths = [
    root(p) + '/manifests/' + ref.manifest + '.json',
    ...Array.from(new Set(m.chunks), (id) => root(p) + '/chunks/' + id),
  ];
  for (const path of paths) {
    check();
    if ((await p.uploadStatus?.(path)) !== 'uploaded')
      throw new Error('Waiting for iCloud Drive to confirm upload');
  }
  return m;
}
export async function verifyUploadedBlob(p: FileSyncProvider, ref: VaultAsset, check: () => void) {
  const m = await confirmUploadedBlob(p, ref, check);
  const full = sha256.create();
  for (const [index, id] of m.chunks.entries()) {
    check();
    const bytes = await p.readBinary(root(p) + '/chunks/' + id);
    if (!bytes || bytes.byteLength !== Math.min(size, m.size - index * size) || hash(bytes) !== id)
      throw new Error('Cannot verify iCloud file chunk');
    full.update(new Uint8Array(bytes));
  }
  check();
  return 'sha256:' + bytesToHex(full.digest());
}
export async function openVaultBlob(
  p: FileSyncProvider,
  ref: VaultAsset,
  name: string,
  type: string,
  check: () => void,
) {
  check();
  const m = await loadManifest(p, ref);
  let closed = false;
  const cache = new Map<string, Promise<ArrayBuffer>>();
  const chunk = async (index: number) => {
    const id = m.chunks[index]!;
    let task = cache.get(id);
    if (!task) {
      task = (async () => {
        const bytes = await p.readBinary(root(p) + '/chunks/' + id);
        check();
        if (
          !bytes ||
          bytes.byteLength !== Math.min(size, m.size - index * size) ||
          hash(bytes) !== id
        )
          throw new Error('Cannot verify iCloud file chunk');
        return bytes;
      })();
      cache.set(id, task);
      if (cache.size > 4) cache.delete(cache.keys().next().value!);
    }
    try {
      return await task;
    } catch (e) {
      cache.delete(id);
      throw e;
    }
  };
  return new CloudReaderFile(
    {
      size: m.size,
      read: async (start, end) => {
        check();
        if (closed || start < 0 || end > m.size || start > end)
          throw new Error('Invalid iCloud file range');
        const out = new Uint8Array(end - start);
        for (let at = start; at < end; ) {
          const index = Math.floor(at / size),
            bytes = new Uint8Array(await chunk(index));
          const offset = at % size,
            n = Math.min(end - at, bytes.byteLength - offset);
          out.set(bytes.subarray(offset, offset + n), at - start);
          at += n;
        }
        return out;
      },
      close: () => {
        closed = true;
        cache.clear();
      },
    },
    name,
    type,
  );
}
