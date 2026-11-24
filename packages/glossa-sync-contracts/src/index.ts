import { z } from 'zod';

export const id = z.uuid();
const token = z.string().min(1).max(16_384);
export const exchangeInput = z.strictObject({
  identity_token: token,
  device_id: id,
  device_name: z.string().trim().min(1).max(100),
});
export const refreshInput = z.strictObject({ refresh_token: token });
export const confirmUploadInput = z.strictObject({
  object_ids: z
    .array(id)
    .min(1)
    .max(25)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const fastCdcProfile = { min: 2 << 20, average: 4 << 20, max: 16 << 20 } as const;

export const sessionTokens = z.strictObject({
  access_token: token,
  refresh_token: token,
  expires_in: z.number().int().positive(),
  device_id: id,
  session_id: id,
});
export const uploadConfirmation = z.strictObject({
  verified: z.array(id),
  pending: z.array(id),
});

export const blake3 = z.string().regex(/^[a-f0-9]{64}$/);
export const assetRole = z.enum([
  'layout_manifest',
  'search_sidecar',
  'head_preview_chunk',
  'cover_avif',
]);
const descriptor = {
  blake3,
  bytes: z.int().positive().max(fastCdcProfile.max),
  md5_b64: z.string().regex(/^[A-Za-z0-9+/]{21}[AQgw]==$/),
};
export const createUploadInput = z.strictObject({ op_id: id, base_manifest_id: id.nullable() });
export const negotiateChunksInput = z.strictObject({
  upload_id: id,
  chunks: z.array(z.strictObject(descriptor)).min(1).max(128),
});
export const negotiateAssetsInput = z.strictObject({
  upload_id: id,
  assets: z
    .array(
      z.strictObject({
        ...descriptor,
        role: assetRole,
        mime: z
          .string()
          .max(128)
          .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/),
        codec_version: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
      }).refine((asset) => asset.role !== 'cover_avif' || asset.mime === 'image/avif'),
    )
    .min(1)
    .max(4),
});
const offset = z.int().nonnegative();
const segment = z.strictObject({ blake3, start_byte: offset, end_byte: offset });
export const manifestPartInput = z.strictObject({
  first_ordinal: offset,
  chunks: z.array(segment).min(1).max(128),
});
const manifestHeader = {
  op_id: id,
  upload_id: id,
  base_manifest_id: id.nullable(),
  file_blake3: blake3,
  file_bytes: z.int().positive(),
  chunker: z.literal('fastcdc-glossa-v1'),
  chunk_count: z.int().positive(),
  assets: z
    .array(
      z.strictObject({ role: assetRole, object_id: id, codec_version: z.string().min(1).max(80) }),
    )
    .max(4)
    .refine((items) => new Set(items.map((a) => a.role)).size === items.length),
};
export const manifestInput = z.union([
  z.strictObject({
    ...manifestHeader,
    chunks: z
      .array(segment.extend({ ordinal: offset }))
      .min(1)
      .max(128),
  }),
  z.strictObject({ ...manifestHeader, parts_complete: z.literal(true) }),
]);
export const streamInput = z
  .strictObject({
    manifest_id: id,
    assets: z.array(assetRole).max(4),
    ranges: z
      .array(
        z
          .strictObject({ start_byte: offset, end_byte: offset })
          .refine((r) => r.end_byte >= r.start_byte),
      )
      .max(32),
  })
  .refine((q) => q.assets.length + q.ranges.length > 0);
