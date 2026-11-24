import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { chunkFile, describeObject } from './chunker.ts';
import { id, blake3, assetRole, negotiateAssetsInput, uploadConfirmation } from './index.ts';
import type { CloudBookIdentity } from './reader.ts';

type Part = {
  ordinal: number;
  start_byte: number;
  end_byte: number;
  blake3: string;
  md5_b64: string;
  bytes: number;
};
export async function prepareFile(file: Blob) {
  const sha = sha256.create();
  async function* source() {
    if (typeof file.stream !== 'function') {
      for (let start = 0; start < file.size; start += 1024 * 1024) {
        const part = new Uint8Array(await file.slice(start, start + 1024 * 1024).arrayBuffer());
        sha.update(part);
        yield part;
      }
      return;
    }
    const stream = file.stream().getReader();
    try {
      for (;;) {
        const { value, done } = await stream.read();
        if (done) return;
        sha.update(value);
        yield value;
      }
    } finally {
      await stream.cancel();
      stream.releaseLock();
    }
  }
  const chunks: Part[] = [];
  for await (const event of chunkFile(source())) {
    if (event.type === 'complete') {
      if (!chunks.length || event.file_bytes !== file.size) throw new Error('invalid_source_file');
      return {
        chunks,
        file_bytes: file.size,
        file_blake3: event.file_blake3,
        sha256: 'sha256:' + bytesToHex(sha.digest()),
      };
    }
    const { data, type, ...part } = event;
    chunks.push(part);
  }
  throw new Error('incomplete_source_file');
}
export type PreparedFile = Awaited<ReturnType<typeof prepareFile>>;
const known = z.object({ blake3, object_id: id });
const negotiated = z.object({
  present: z.array(known),
  missing: z.array(
    known.extend({
      put_url: z.url({ protocol: /^https$/ }),
      headers: z.record(z.string(), z.string()),
    }),
  ),
});
export type UploadTransport = {
  control(path: string, method: 'GET' | 'PUT' | 'POST', body?: unknown): Promise<unknown>;
  put(
    url: string,
    headers: Record<string, string>,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<Response>;
};
export type PublicationAsset = {
  role: z.infer<typeof assetRole>;
  codec_version: string;
  mime: string;
  body: Blob;
};

async function confirm(api: UploadTransport, upload: string, ids: string[]) {
  if (!ids.length) return;
  const ack = uploadConfirmation.parse(
    await api.control('/storage/uploads/' + upload + '/confirm', 'POST', { object_ids: ids }),
  );
  if (
    ack.pending.length ||
    ack.verified.length !== ids.length ||
    ids.some((id) => !ack.verified.includes(id))
  )
    throw new Error('upload_unconfirmed');
}

async function putObject(
  api: UploadTransport,
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const res = await api.put(url, headers, bytes);
  if (!res.ok && res.status !== 412) throw new Error('object_upload_' + res.status);
}

async function publishAssets(
  api: UploadTransport,
  upload: string,
  assets: readonly PublicationAsset[],
) {
  if (!assets.length) return [];
  if (assets.length > 4 || new Set(assets.map((a) => a.role)).size !== assets.length)
    throw new Error('invalid_asset_roles');
  const descriptors = [];
  for (const { body, ...info } of assets) {
    if (!body.size || body.size > 16 << 20) throw new Error('invalid_asset_length');
    descriptors.push({ ...info, ...describeObject(new Uint8Array(await body.arrayBuffer())) });
  }
  const request = negotiateAssetsInput.parse({ upload_id: upload, assets: descriptors });
  const result = z
    .object({
      present: z.array(known.extend({ role: assetRole })),
      missing: z.array(
        known.extend({
          role: assetRole,
          put_url: z.url({ protocol: /^https$/ }),
          headers: z.record(z.string(), z.string()),
        }),
      ),
    })
    .parse(await api.control('/storage/assets/negotiate', 'POST', request));
  const responses = [...result.present, ...result.missing];
  const byRole = new Map(responses.map((r) => [r.role, r]));
  if (
    responses.length !== assets.length ||
    descriptors.some((d) => byRole.get(d.role)?.blake3 !== d.blake3)
  )
    throw new Error('asset_negotiation_mismatch');
  for (const item of result.missing) {
    const body = assets.find((a) => a.role === item.role)!.body;
    const data = new Uint8Array(await body.arrayBuffer());
    if (describeObject(data).blake3 !== item.blake3) throw new Error('source_asset_changed');
    await putObject(api, item.put_url, item.headers, data);
  }
  await confirm(
    api,
    upload,
    result.missing.map((r) => r.object_id),
  );
  return assets.map(({ role, codec_version }) => ({
    role,
    codec_version,
    object_id: byRole.get(role)!.object_id,
  }));
}

export async function publishFile(
  api: UploadTransport,
  book: string,
  file: Blob,
  prepared: PreparedFile,
  assets: readonly PublicationAsset[] = [],
): Promise<CloudBookIdentity> {
  const path = '/books/' + id.parse(book);
  const upload = crypto.randomUUID();
  const session = z
    .object({ upload_id: id })
    .parse(await api.control(path + '/uploads', 'POST', { op_id: upload, base_manifest_id: null }));
  if (session.upload_id !== upload) throw new Error('upload_session_mismatch');
  const rows = Array.from(new Map(prepared.chunks.map((c) => [c.blake3, c])).values());
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25);
    const expected = new Map(batch.map((c) => [c.blake3, c]));
    const result = negotiated.parse(
      await api.control('/storage/chunks/negotiate', 'POST', {
        upload_id: upload,
        chunks: batch.map(({ blake3, bytes, md5_b64 }) => ({ blake3, bytes, md5_b64 })),
      }),
    );
    const hashes = [...result.present, ...result.missing].map((r) => r.blake3);
    if (
      hashes.length !== expected.size ||
      new Set(hashes).size !== hashes.length ||
      hashes.some((h) => !expected.has(h))
    )
      throw new Error('negotiation_mismatch');
    for (const item of result.missing) {
      const c = expected.get(item.blake3)!;
      const bytes = new Uint8Array(await file.slice(c.start_byte, c.end_byte + 1).arrayBuffer());
      if (describeObject(bytes).blake3 !== c.blake3) throw new Error('source_file_changed');
      await putObject(api, item.put_url, item.headers, bytes);
    }
    await confirm(
      api,
      upload,
      result.missing.map((r) => r.object_id),
    );
  }
  const publishedAssets = await publishAssets(api, upload, assets);
  for (let i = 0; i < prepared.chunks.length; i += 128) {
    await api.control(path + '/uploads/' + upload + '/parts/' + i / 128, 'PUT', {
      first_ordinal: i,
      chunks: prepared.chunks
        .slice(i, i + 128)
        .map(({ blake3, start_byte, end_byte }) => ({ blake3, start_byte, end_byte })),
    });
  }
  const receipt = z
    .object({ book_id: id, manifest_id: id, availability: z.literal('cloud_ready') })
    .parse(
      await api.control(path + '/manifest', 'PUT', {
        op_id: crypto.randomUUID(),
        upload_id: upload,
        base_manifest_id: null,
        chunker: 'fastcdc-glossa-v1',
        file_blake3: prepared.file_blake3,
        file_bytes: prepared.file_bytes,
        chunk_count: prepared.chunks.length,
        assets: publishedAssets,
        parts_complete: true,
      }),
    );
  if (receipt.book_id !== book || receipt.manifest_id !== upload)
    throw new Error('manifest_receipt_mismatch');
  return { book_id: book, manifest_id: upload, file_blake3: prepared.file_blake3 };
}

export function uploadTransport(origin: string, token: () => Promise<string>): UploadTransport {
  return {
    async control(path, method, body) {
      const options = {
        method,
        redirect: 'error',
        credentials: 'omit',
        headers: {
          Authorization: 'Bearer ' + (await token()),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      } as const;
      const res = await fetch(new URL('/v1' + path, origin), options);
      if (!res.ok) throw new Error('sync_http_' + res.status);
      return res.json();
    },
    put(url, headers, bytes) {
      const options = {
        method: 'PUT',
        headers,
        body: bytes,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
      } as const;
      return fetch(url, options);
    },
  };
}
