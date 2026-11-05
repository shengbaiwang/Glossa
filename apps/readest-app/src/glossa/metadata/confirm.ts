import { z } from 'zod';
import type { Book } from '@/types/book';
import {
  validateISBN,
  validateAndNormalizeDate,
  validateAndNormalizeLanguage,
} from '@/utils/validation';
import type { MetadataField } from './types';

const value = z.string().trim().min(1).max(1000);
export const metadataPatchSchema = z
  .object({
    title: value.optional(),
    author: value.optional(),
    translator: value.optional(),
    publisher: value.optional(),
    published: value.refine((s) => validateAndNormalizeDate(s).isValid).optional(),
    isbn: value.refine((s) => validateISBN(s).isValid).optional(),
    language: value.refine((s) => validateAndNormalizeLanguage(s).isValid).optional(),
    series: value.optional(),
  })
  .strict();
export type MetadataPatch = z.infer<typeof metadataPatchSchema>;

export function metadataFieldValue(book: Book, field: MetadataField): string {
  if (field === 'title' || field === 'author') return book[field];
  if (field === 'language')
    return (
      book.primaryLanguage ||
      (Array.isArray(book.metadata?.language)
        ? book.metadata.language.join(', ')
        : book.metadata?.language) ||
      ''
    );
  const current = book.metadata?.[field];
  if (typeof current === 'string') return current;
  return '';
}
