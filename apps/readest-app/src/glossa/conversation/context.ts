// Read-only schema compatibility for conversation-1/2 records. New chat never builds this context.
import { z } from 'zod';

export const CONTEXT_BUDGETS = [2000, 4000, 8000] as const;
export type ContextBudget = (typeof CONTEXT_BUDGETS)[number];
export const contextBudgetSchema = z.union([z.literal(2000), z.literal(4000), z.literal(8000)]);
export const readingIdentitySchema = z
  .object({
    bookTitle: z.string().max(500),
    author: z.string().max(500),
    chapterTitle: z.string().max(500),
    progress: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type ReadingIdentity = z.infer<typeof readingIdentitySchema>;
export const memorySchema = z
  .array(
    z
      .object({
        question: z.string().max(240),
        summary: z.string().max(500),
        sourceIds: z.array(z.string().max(200)).max(100),
      })
      .strict(),
  )
  .max(4);
export const contextReceiptSchema = z
  .object({
    metadata: readingIdentitySchema,
    budget: contextBudgetSchema,
    includeHistory: z.boolean().optional(),
    selectedSourceIds: z.array(z.string().max(200)).max(100).optional(),
    sourceTitles: z.record(z.string().max(200), z.string().max(500)).optional(),
    scope: z.enum([
      'page',
      'selection',
      'paragraph',
      'section',
      'article',
      'chapter',
      'book',
      'none',
    ]),
    title: z.string().max(500),
    sampled: z.boolean(),
    history: memorySchema,
  })
  .strict();
export type ContextReceipt = z.infer<typeof contextReceiptSchema>;
