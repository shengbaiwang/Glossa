import { z } from 'zod';

/**
 * A durable, JSON-safe locator for an EPUB source fragment.
 *
 * V1 deliberately contains only fields that the EPUB adapter can obtain from
 * foliate or the loaded chapter text. Future formats extend SourceAnchor as a
 * discriminated union instead of adding nullable cross-format fields here.
 */
export type EpubSourceAnchorV1 = {
  version: 1;
  documentId: string;
  format: 'epub';
  sectionId?: string;
  cfi?: string;
  quote: {
    exact: string;
    prefix?: string;
    suffix?: string;
  };
};

export type SourceAnchor = EpubSourceAnchorV1;

const nonEmptyText = z.string().trim().min(1);
const textQuoteContext = z.string().refine((value) => Array.from(value).length <= 48, {
  message: 'TextQuote context must be at most 48 Unicode characters',
});

export const sourceAnchorSchema = z
  .object({
    version: z.literal(1),
    documentId: nonEmptyText,
    format: z.literal('epub'),
    sectionId: nonEmptyText.optional(),
    cfi: nonEmptyText.optional(),
    quote: z
      .object({
        exact: nonEmptyText,
        prefix: textQuoteContext.optional(),
        suffix: textQuoteContext.optional(),
      })
      .strict(),
  })
  .strict()
  .refine((anchor) => !!anchor.sectionId || !!anchor.cfi, {
    message: 'EPUB source anchors require sectionId or cfi',
  });

export function parseSourceAnchor(value: unknown): SourceAnchor {
  return sourceAnchorSchema.parse(value);
}

export function serializeSourceAnchor(anchor: SourceAnchor): string {
  return JSON.stringify(parseSourceAnchor(anchor));
}

export function deserializeSourceAnchor(serialized: string): SourceAnchor {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('Invalid serialized SourceAnchor JSON');
  }
  return parseSourceAnchor(value);
}
