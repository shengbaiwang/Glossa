import { z } from 'zod';

export const metadataFieldSchema = z.enum([
  'title',
  'author',
  'translator',
  'publisher',
  'published',
  'isbn',
  'language',
  'series',
]);
export type MetadataField = z.infer<typeof metadataFieldSchema>;
export const metadataSourceSchema = z
  .object({
    kind: z.enum(['file', 'text', 'ocr']),
    label: z.string().min(1).max(200),
    excerpt: z.string().max(1200),
    pageIndex: z.number().int().min(0).max(999999).optional(),
    href: z
      .string()
      .min(1)
      .max(2000)
      .refine(
        (href) =>
          !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(href) &&
          !href.includes('\\') &&
          !Array.from(href).some((char) => char.charCodeAt(0) < 32),
      )
      .optional(),
  })
  .strict();
export const metadataCandidateSchema = z
  .object({
    id: z.string().min(1).max(100),
    field: metadataFieldSchema,
    value: z.string().trim().min(1).max(1000),
    source: metadataSourceSchema,
    confidence: z.enum(['supported', 'review']),
    reason: z.string().max(200).optional(),
  })
  .strict();
export type MetadataCandidate = z.infer<typeof metadataCandidateSchema>;
export const metadataRecognitionSchema = z
  .object({
    version: z.literal(1),
    fingerprint: z.string().min(1).max(128),
    candidates: z.array(metadataCandidateSchema).max(128),
    complete: z.boolean(),
    reason: z.string().max(200).optional(),
    dismissed: z.array(z.string().min(1).max(100)).max(256).optional(),
  })
  .strict();
export type MetadataRecognition = z.infer<typeof metadataRecognitionSchema>;
